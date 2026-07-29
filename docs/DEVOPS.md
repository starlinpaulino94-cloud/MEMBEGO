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
