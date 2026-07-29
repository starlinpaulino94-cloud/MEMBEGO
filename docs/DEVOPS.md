# Despliegue, migraciones y puertas automáticas

Documenta los arreglos de la Fase 1 de `docs/AUDITORIA-PRODUCCION.md` (C-02 y
C-03) y lo que hay que configurar **a mano** para que funcionen.

## Antes: no había ninguna puerta

No existía `.github/`. Los 113 tests, `tsc`, ESLint y `next build` solo se
ejecutaban si una persona se acordaba, y las 68 migraciones se aplicaban
copiándolas en el SQL Editor de Supabase. Un error de tipado o una migración
olvidada llegaban a producción sin encontrarse con nada — y por la tolerancia
*fail-open* del código, la migración olvidada **no daba error**: los módulos
aparecían vacíos. Ya pasó con `companies.capacidades`.

## Ahora

### `.github/workflows/ci.yml` — en cada push y cada PR

| Trabajo | Qué comprueba |
|---|---|
| `verificar` | `tsc --noEmit`, `eslint --max-warnings=0`, `npm test` |
| `construir` | `next build` completo |
| `dependencias` | `npm audit --omit=dev --audit-level=high` |
| `esquema` | `prisma validate` + detecta cambios en `prisma/schema/` sin migración |

### `.github/workflows/deploy-migraciones.yml` — al mezclar en `main`

Aplica `prisma migrate deploy` **antes** de disparar el despliegue. Si la
migración falla, no se despliega: el código nunca va por delante de la base.

## Configuración manual pendiente (sin esto, los flujos no protegen)

1. **Marcar los checks como obligatorios.** Settings → Branches → regla para
   `main` → *Require status checks to pass*: `verificar`, `construir`,
   `dependencias`, `esquema`. Sin esto siguen siendo informativos y el agujero
   continúa abierto.
2. **Dos secretos del repositorio** (Settings → Secrets → Actions):
   - `MIGRATIONS_DATABASE_URL` — la **DIRECT_URL** de Supabase (puerto 5432,
     sin `pgbouncer`). El pooler no sirve para migrar: las sentencias DDL
     necesitan conexión directa.
   - `VERCEL_DEPLOY_HOOK_URL` — el deploy hook del proyecto en Vercel.
3. **Desactivar el auto-deploy de Vercel desde Git** para `main`, o el
   despliegue saldría en paralelo a la migración y se perdería el orden.

## Lo que sigue siendo manual, a propósito

Las migraciones de `prisma/migrations_manual/` tocan el esquema `storage` de
Supabase (buckets y políticas RLS), que Prisma no gestiona. Se aplican en el
SQL Editor. Hoy son:

- `2026-07-storage-buckets.sql` — creación de los tres buckets.
- `2026-07-comprobantes-privado.sql` — **pendiente de aplicar**: cierra el
  bucket de comprobantes (auditoría · C-01). Ver abajo.

## Orden de despliegue de la Fase 1

El cierre del bucket y el código nuevo tienen que ir juntos, en este orden:

1. **Primero el código** (este commit). Sube comprobantes con URL firmada y los
   lee firmándolos. Con el bucket todavía público, funciona igual — la lectura
   firmada también sirve sobre un bucket público.
2. **Después el SQL** `2026-07-comprobantes-privado.sql` en Supabase. A partir
   de ese momento las URL públicas antiguas dejan de responder, pero el código
   ya sabe extraer la ruta de esas URL y firmarla, así que el historial de
   pagos ya validados se sigue viendo.

Al revés (SQL primero) los comprobantes quedarían inaccesibles durante el
tiempo que tarde el despliegue.

## Verificación después de aplicar

```sql
-- Debe devolver false y 0.
select public from storage.buckets where id = 'comprobantes';
select count(*) from pg_policies
 where schemaname='storage' and tablename='objects' and qual::text like '%comprobantes%';
```

Y en la aplicación: subir un comprobante nuevo, verlo desde el cliente, verlo
desde el panel de la empresa, y comprobar que pegar esa URL en una ventana de
incógnito **caduca a los cinco minutos**.

---

## Simulacro de restauración (Fase 5)

`.github/workflows/respaldo-verificacion.yml` corre cada lunes a las 08:00 de
Santo Domingo: vuelca producción, la restaura en un PostgreSQL desechable y
comprueba que lo restaurado sirve — incluidas las **credenciales**, que un
volcado del esquema `public` no incluye.

Usa el mismo secreto que el despliegue de migraciones, `MIGRATIONS_DATABASE_URL`
(la DIRECT_URL), y solo lo lee. El volcado **no se guarda** en ningún sitio:
lleva datos personales de clientes reales y los artefactos de Actions no son el
sitio para eso. El razonamiento completo está en la cabecera del flujo.

A mano: Actions → *Simulacro de restauración* → *Run workflow*, o
`npm run respaldo:verificar` con `RESPALDO_ORIGEN` y `RESPALDO_DESTINO`.

Plan de recuperación, RPO/RTO y qué sigue sin cubrirse: `docs/RECUPERACION.md`.
Qué hacer cuando algo se rompe: `docs/runbooks/`.

## Variables nuevas de la Fase 5

| Variable | Para qué |
|---|---|
| `MODO_MANTENIMIENTO` | Cierra la aplicación entera. Paso 0 de toda restauración |
| `MANTENIMIENTO_PASE` | Deja entrar a quien opera mientras está cerrada. **Distinto de `BOOTSTRAP_SECRET`** |

Ambas documentadas en `.env.example` y en `docs/runbooks/modo-mantenimiento.md`.

---

## El historial de migraciones (arreglado) y qué hay que hacer UNA vez

### Qué estaba roto

Las 69 migraciones **no se podían reproducir desde cero**. Faltaba el
principio: ninguna creaba `users`, `companies`, `clientes` ni `memberships`
—el esquema inicial se hizo con `db push`—, tres tablas del módulo de
invitaciones se crearon a mano y nunca tuvieron migración, y dos migraciones
vivían en `scripts/` en vez de `prisma/migrations/`.

Consecuencias: no se podía levantar un entorno nuevo replicando el historial,
y el trabajo `esquema` del CI llevaba `continue-on-error: true` porque fallaba
siempre — un check decorativo que ocupaba sitio y no comprobaba nada.

### Qué se hizo

| Migración | Qué es |
|---|---|
| `0_genesis` | El esquema de 20 modelos que existía antes de la primera migración, sacado del propio git (commit `a39508b^`) |
| `20260713b_invitaciones_campanas` | Las 3 tablas de "Invita y Gana" que se crearon a mano. Idempotente |
| `20260745_*`, `20260746_*` | Promovidas desde `scripts/`, donde estaban perdidas |
| `20260770_reconciliacion` | Alinea la base con el esquema: 37 claves foráneas, 21 columnas, 12 índices renombrados, 3 borrados. Idempotente |

Además, `20260768_visitas_indices` dejó de usar `CONCURRENTLY` (no puede correr
dentro de una transacción, y Prisma envuelve cada migración en una). La versión
con `CONCURRENTLY`, que es la que hay que usar en producción, está en
`prisma/migrations_manual/2026-07-visitas-indices-concurrently.sql`.

Resultado, verificado: **74 migraciones, 0 fallos desde una base vacía, y
`migrate diff --from-migrations` responde "No difference detected"**.

### EL PASO QUE TE TOCA — una sola vez, antes del próximo deploy a `main`

Producción tiene todos los cambios pero Prisma no lo sabe: se aplicaron en el
SQL Editor, que no escribe en `_prisma_migrations`. Sin este paso,
`migrate deploy` intentaría crear tablas que ya existen, fallaría, y **el
despliegue quedaría bloqueado**.

```bash
export DATABASE_URL="<la DIRECT_URL de Supabase, puerto 5432>"

# 1. Comprobar que la base está de verdad al día. Si esto se queja, PARA:
#    marcar migraciones como aplicadas cuando falta algo esconde el agujero.
npm run db:doctor

# 2. Ver qué se marcaría. No cambia nada.
npm run migraciones:baseline

# 3. Hacerlo. Solo inserta filas en _prisma_migrations; no toca datos.
npm run migraciones:baseline -- --aplicar

# 4. Los índices de `visits` con CONCURRENTLY, en el SQL Editor de Supabase,
#    UNA SENTENCIA A LA VEZ:
#    prisma/migrations_manual/2026-07-visitas-indices-concurrently.sql

# 5. Aplicar lo único que queda de verdad: la reconciliación.
npx prisma migrate deploy

# 6. Confirmar.
npx prisma migrate status   # "Database schema is up to date!"
npm run db:doctor
```

**Sobre el paso 5:** la reconciliación borra y vuelve a crear 37 claves
foráneas para dejarlas con la regla `ON DELETE` que declara el esquema. Durante
los milisegundos que dura cada par, esa integridad referencial no está vigente.
No es para hacerlo un sábado a mediodía; cualquier momento tranquilo sirve.

**Si algo sale mal en el paso 3:** se deshace borrando las filas que insertó.
```sql
delete from _prisma_migrations where migration_name = '<nombre>';
```

### Por qué existe `prisma.config.ts`

`package.json#prisma` está deprecado, y —más importante— al pasar el esquema a
carpeta Prisma empezó a buscar las migraciones en `prisma/schema/migrations/`.
`migrate deploy` decía "No migration found" y no aplicaba nada: el fallo C-03
de la auditoría reintroducido por la puerta de atrás, y en silencio.
`prisma.config.ts` declara las dos rutas por separado.
