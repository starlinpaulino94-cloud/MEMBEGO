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

**Cuándo se pone rojo.** Solo cuando el estado es de verdad incorrecto: el push
trae migraciones nuevas y no se pueden aplicar porque falta
`MIGRATIONS_DATABASE_URL`. Ahí el código desplegado espera columnas que la base
no tiene, y el rojo es exacto. Si el push no toca migraciones, calla.

Antes se ponía **verde** en ese caso, tras emitir un `::warning::`. Un aviso en
la interfaz de Actions no lo lee nadie —hay que entrar al run, abrir el job y
mirar—, y el resultado medido fue que se acumularon dos migraciones sin aplicar
mientras todos los checks decían que estaba bien. Se corrigió poniéndolo rojo
**condicionalmente**, no siempre: un check rojo permanente entrena a ignorar los
checks, que es peor que no tenerlo.

**Qué trae el resumen del job.** Con el secreto puesto, la salida de
`prisma migrate status` antes de migrar y la de `migrate deploy` después. Sin
él, y solo si hay algo pendiente, **el SQL de cada migración listo para pegar**
en el SQL Editor de Supabase — que es lo que se va a hacer de todos modos, y
buscar los archivos a mano es justo el paso donde se olvida uno.

**Su límite, dicho claro.** Sin el secreto no hay base a la que preguntar, así
que detecta las migraciones nuevas comparando este push con el anterior. Eso
solo ve lo de ESTE push: una migración que quedó sin aplicar hace tres semanas
no vuelve a avisar hoy. La única forma de cerrar ese hueco es configurar el
secreto, y entonces la verdad la da `migrate status` contra la base real.

## Configuración manual pendiente (sin esto, los flujos no protegen)

1. **Marcar los checks como obligatorios.** Settings → Rules → Rulesets → regla
   para `main` → *Require status checks to pass*. Sin esto siguen siendo
   informativos y el agujero continúa abierto: entre el 14 y el 17 de agosto de
   2026 se mezclaron cinco PR con el CI en rojo sin que nada lo impidiera.

   El buscador de esa pantalla usa el **nombre visible** del job, no su
   identificador en el YAML. Hay que buscar estos cinco, no los `verificar` /
   `construir` / `dependencias` / `esquema` del archivo:

   | Buscar en la interfaz | Job | Workflow |
   |---|---|---|
   | `Tipos, linter y pruebas` | `verificar` | CI |
   | `Build de producción` | `construir` | CI |
   | `Vulnerabilidades en dependencias` | `dependencias` | CI |
   | `Esquema de base de datos` | `esquema` | CI |
   | `Recorrido público` | `recorrido-publico` | E2E |

   `Esquema de base de datos` es el que detecta una migración que la base no
   tiene. Es el que habría evitado los cuatro incidentes de agosto de 2026.
2. **Dos secretos del repositorio** (Settings → Secrets and variables →
   Actions). Es lo único que separa a este proyecto de tener las migraciones
   automatizadas de verdad:
   - `MIGRATIONS_DATABASE_URL` — la **DIRECT_URL** de Supabase (puerto 5432,
     sin `pgbouncer`). El pooler no sirve para migrar: las sentencias DDL
     necesitan conexión directa.
   - `VERCEL_DEPLOY_HOOK_URL` — el deploy hook del proyecto en Vercel.
3. **Desactivar el auto-deploy de Vercel desde Git** para `main`, o el
   despliegue saldría en paralelo a la migración y se perdería el orden.

   ⚠️ Los tres puntos van **juntos**. Hoy el punto 2 no está hecho, así que el
   flujo no dispara el despliegue: si además se hiciera el punto 3, `main` se
   mezclaría y **no se desplegaría nada**. Configura el secreto ANTES de tocar
   el auto-deploy de Vercel.

## Lo que sigue siendo manual, a propósito

Las migraciones de `prisma/migrations_manual/` tocan el esquema `storage` de
Supabase (buckets y políticas RLS), que Prisma no gestiona. Se aplican en el
SQL Editor. Hoy son:

- `2026-07-storage-buckets.sql` — creación de los tres buckets.
- `2026-07-comprobantes-privado.sql` — cierra el bucket de comprobantes
  (auditoría · C-01). **Aplicado**: verificado con `comprobantes.public = false`
  y 0 políticas sobre ese bucket, que es el resultado esperado — sin política,
  RLS deniega, y solo pasa `service_role`.
- `2026-07-rls-capa2-aislamiento.sql` — **NO aplicar todavía**. Crea el rol
  `membego_app` y las políticas de aislamiento por empresa. Está montado y
  probado, pero encenderlo exige antes migrar las consultas a `conEmpresa()`.
  Léete `docs/RLS.md` § 4 entero antes de tocarlo.

  La Capa 1 de RLS, en cambio, **sí va sola**: es
  `prisma/migrations/20260771_rls_barrera_publica/`, una migración normal que
  se aplica con `migrate deploy`. Cierra el acceso de la clave anónima a
  `public` — que era el agujero grave. `docs/RLS.md` § 3.

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

## Por qué una columna que falta rompe pantallas que no la usan

Agosto de 2026: cuatro migraciones se mezclaron a `main` y nunca llegaron a la
base de producción, y cada una rompió algo distinto días después. Conviene
entender el mecanismo, porque no es intuitivo y por eso costó cuatro veces.

| Migración | Qué faltaba | Qué rompió |
|---|---|---|
| `20260813_solicitudes_empresa` | la tabla entera | el embudo de altas del superadmin |
| `20260814_permisos_empleado` | `users.permisos` | **el registro de clientes** |
| `20260814_qr_regalo_vip` | `qr_tokens.ofertaInvitadoId` | **el QR del cliente y el escáner del cajero** |
| `20260819_visita_reversa` | 4 columnas de `visits` | deshacer una visita |

**El mecanismo.** Un `find*` o un `create` de Prisma **sin `select`** pide
TODAS las columnas escalares del modelo, use el código esas columnas o no. Con
una sola ausente, la consulta entera falla:

```ts
// Rompe si a la tabla le falta CUALQUIER columna del modelo.
tx.qrToken.findFirst({ where: { membresiaId, activo: true } })

// Solo depende de las tres que nombra.
tx.qrToken.findMany({ where: { … }, select: { id: true, token: true, membresiaId: true } })
```

Por eso `qr_tokens.ofertaInvitadoId` —una columna del regalo VIP— tumbó la
pantalla del QR y el escáner, que no saben nada de regalos VIP. Y por eso el
listado de membresías, que sí usa `select`, siguió funcionando.

**La consecuencia práctica:** el radio de daño de una migración sin aplicar no
es «la función nueva no va», es «cualquier pantalla que toque esa tabla se
cae». No se puede acotar mirando qué hace la migración.

**Lo que lo cierra** no es revisar consultas una a una, es que la migración se
aplique: `MIGRATIONS_DATABASE_URL` configurado y el check `Esquema de base de
datos` obligatorio en `main`. Mientras falte cualquiera de los dos, esto vuelve.

**Para comprobar si hay deriva ahora mismo**, con la `DIRECT_URL` a mano:

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema --exit-code
```

Solo lee. Sale 0 si no hay diferencias; si las hay, imprime el SQL que falta.
Ojo: `migrate status` puede mentir si `_prisma_migrations` está desincronizada;
`migrate diff` compara la estructura real, que es lo que importa.

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

Resultado, verificado: **103 migraciones, 0 fallos desde una base vacía, y
`migrate diff --from-migrations` responde "No difference detected"**.

### El baseline — HECHO el 17-08-2026

Producción tenía todos los cambios pero Prisma no lo sabía: se aplicaron en el
SQL Editor, que no escribe en `_prisma_migrations`. Sin el baseline,
`migrate deploy` habría intentado crear tablas que ya existen, habría fallado, y
**el despliegue habría quedado bloqueado**.

Estado actual, verificado contra producción: **103 de 103 registradas,
`20260770_reconciliacion` y `20260771_rls_barrera_publica` aplicadas, cero
tablas de `public` sin RLS y cero alcanzables por `anon`/`authenticated`**.

Se hizo desde el SQL Editor y no con `npm run migraciones:baseline`, porque el
script necesita un checkout local y `psql`, y quien opera este proyecto trabaja
desde GitHub. El SQL equivalente es el mismo `INSERT` que emite el script, con
los checksums SHA-256 de cada `migration.sql` — que es lo que Prisma compara en
cada despliegue para detectar un historial alterado.

**Si hay que repetirlo alguna vez** (base nueva, entorno de staging, restauración
desde un volcado viejo), el camino con checkout local sigue siendo el corto:

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

# 5. Aplicar lo que el baseline deja a propósito sin marcar.
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
