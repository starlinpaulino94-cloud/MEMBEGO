# Migraciones de base de datos — flujo y prevención de schema drift

> **Actualizado el 2026-10-16.** Este documento decía que las migraciones «se aplican a mano en el SQL Editor» y que «no hay
> `prisma migrate deploy` automático». **Eso dejó de ser cierto el 2026-09-14/29**: el flujo `deploy-migraciones.yml` aplica las migraciones
> al fusionar en `main`. Lo vigente para el despliegue está en [`DEVOPS.md`](DEVOPS.md); aquí queda el flujo del día a día, el diagnóstico
> y los modos de fallo que se previenen. Los informes de las entregas INV-3a → INV-5b3 repitieron la instrucción vieja («aplica el SQL a
> mano»); era un error de esos informes, no del flujo (ver `AUDITORIA-ESTADO-2026-10-16.md` § 2).

## El problema que este flujo previene

Un modo de fallo recurrente cuando el código y la base se desincronizan:

1. Se hace deploy en Vercel de código cuyo Prisma Client espera columnas o
   tablas nuevas.
2. La base no tiene esa migración.
3. Cualquier query que toque esos objetos revienta con `P2021`/`P2022`
   ("column … does not exist") y el usuario ve pantallas como
   **"No pudimos cargar tu información"**.

Ya ocurrió al menos dos veces: el hotfix del 14-07-2026
(`scripts/hotfix-2026-07-14-migraciones-pendientes.sql`, rompía el registro) y
el perfil del cliente (columnas `clientes.ciudad/genero/notifPromos/…` de
`20260723_add_cliente_profile_fields`).

## Cómo llega una migración a producción (hoy)

```
rama  →  PR  →  CI (tipos, lint, pruebas, test:db, esquema)  →  merge a main
                                                                   │
        .github/workflows/deploy-migraciones.yml («Migrar y desplegar»)
                                                                   ▼
        1. detecta las migraciones nuevas del push
        2. prisma migrate status   (resumen del job)
        3. prisma migrate deploy   ← aplica las pendientes, en orden de nombre
        4. si falló: ROJO y NO se despliega (el código nunca va por delante de la base)
        5. si no: dispara el deploy hook de Vercel
```

El auto-deploy de Vercel para `main` está apagado (`vercel.json`): **producción solo se despliega desde ese flujo, después de migrar**. Por eso
la regla de oro se cumple sola: *la base se migra antes que el código que la usa*. Como todas nuestras migraciones son aditivas e idempotentes,
aplicarlas antes nunca rompe el código viejo.

Registros reales de ese flujo (GitHub Actions → «Migrar y desplegar»): el merge del PR #615 aplicó `20261059_inventory_costs` y el del #617,
`20261066_inventory_reorder`, cada uno antes de su despliegue.

### Lo único manual que queda

1. **Elegir la hora del merge cuando la migración toca una tabla caliente.** `migrate deploy` corre en el momento del merge y una migración que
   toma un bloqueo sobre una tabla que escribe cada venta (el ledger `inventory_movements`, `inventory_levels`) compite con el tráfico. Las de
   ese tipo van de una sola transacción con `SET LOCAL lock_timeout`: si no consiguen el bloqueo, fallan enteras y no dejan nada a medias, y
   se reintentan con **«Run workflow»** (Actions → «Migrar y desplegar»). Aun así, se fusionan **fuera de hora punta**. Hoy: `20261068`
   (lotes) añade un índice único sobre el ledger; `20261059` hizo lo propio con los costos. Cada migración de ese tipo lo dice en su cabecera.
2. **No aplicar nada a mano en el SQL Editor** salvo emergencia: `_prisma_migrations` deja de cuadrar y el flujo falla con
   `already exists` / `migration has been modified`. Si hubo que hacerlo, se registra según `DEVOPS.md` § «El registro se desactualiza solo».
3. **Sellar la migración nueva** (`npm run migraciones:sellar`, que añade su línea a `prisma/migrations/SUMAS.txt`) y **regenerar los
   verificadores SQL** (`node scripts/generar-verificar-migraciones.mjs`). Una prueba (`tests/migraciones-verificadores.test.ts`) falla si
   cualquiera de los dos quedó viejo: hasta el 2026-10-16 los verificadores llevaban 19 migraciones de retraso sin que nada lo avisara.

## La herramienta: DB Doctor

`scripts/db-doctor.mjs` compara **todo** `prisma/schema/` (lo que el
código espera) contra la base de datos real, y
lista exactamente qué falta y qué migración lo crea. Reemplaza a los
verificadores manuales parciales (`scripts/verificar-migraciones-produccion.sql`),
que solo cubrían un puñado de objetos y quedaban obsoletos con cada fase.
Hoy sirve para **diagnosticar** (¿qué le falta a esta base?), no para aplicar: aplicar lo hace el flujo.

### Modo 1 — con conexión local (recomendado)

```bash
DATABASE_URL="postgres://…"   # la de producción (Supabase → Connection string)
npm run db:doctor
```

- `✓ Esquema al día` → no hay nada pendiente.
- `✗ SCHEMA DRIFT` → lista cada tabla/columna/valor de enum faltante **y el
  archivo de migración que lo crea**. Sale con código 1 (sirve para CI).

### Modo 2 — sin conexión local (pegar en Supabase)

```bash
npm run db:doctor:sql > /tmp/doctor.sql
```

Pega el contenido en el **SQL Editor de Supabase** y ejecútalo. Es un SELECT de
solo lectura: devuelve una tabla con lo que FALTA (vacía = todo al día).

### Los verificadores SQL del registro

Distintos del doctor: no miran el esquema sino **`_prisma_migrations`** (¿están registradas TODAS las migraciones del repo, con su nombre y su
checksum?). Los genera `scripts/generar-verificar-migraciones.mjs` a partir de `prisma/migrations`:

- `scripts/verificar-migraciones-resumen.sql` — corto, para pegar en el SQL Editor de Supabase: **una fila** con el veredicto (`OK` si no falta
  ninguna y coinciden nombre y contenido).
- `scripts/verificar-migraciones.sql` — largo, para `psql -f`: lista qué falta, qué está a medias, qué difiere y qué sobra.

Solo leen. Son útiles después de un merge que añadió migraciones («¿se aplicó todo?») y para detectar una migración aplicada a mano con otro
contenido. Embeben el total, la última migración y las huellas de **todas**, así que **hay que regenerarlos con cada migración nueva**
(la prueba de arriba lo exige).

## Flujo en cada cambio de esquema

1. Cambia `prisma/schema/` y crea la carpeta en `prisma/migrations/` (aditiva e idempotente: `IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`).
2. `npm run migraciones:sellar` y `node scripts/generar-verificar-migraciones.mjs`.
3. Comprueba la deriva: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema --shadow-database-url <base sombra> --exit-code`
   (el CI lo corre en el trabajo `esquema`).
4. Abre el PR; el CI corre. **Fusiona cuando el E2E remoto haya terminado en verde** y, si la migración toca el ledger, fuera de hora punta.
5. Mira el resumen del job «Migrar y desplegar» (✅ Migraciones aplicadas, 🚀 Despliegue disparado). Opcional: `npm run db:doctor` contra
   producción, o el verificador del registro, para confirmar.

> Regla de oro: **la base de datos se migra ANTES que el código que la usa.** El flujo lo garantiza; no lo saltes con un despliegue manual
> desde Vercel de un commit con migraciones sin aplicar.

## Señales de drift en producción

- **`/api/health`** (con el header `x-health-secret`): el check `schema`
  reporta `DRIFT` y lista los objetos centinela faltantes. Los centinelas son
  una muestra (una tabla/columna por tanda de migraciones); el detalle completo
  lo da el doctor.
- **Logs de Vercel**: los `catch` instrumentados con
  `src/lib/prisma-errors.ts` clasifican el error (`SCHEMA_DRIFT` / `CONEXION` /
  `RESTRICCION`) e imprimen el remedio, en lugar del genérico "Error loading".

## Defensa en profundidad en el código

- `getClientePerfil` (perfil del cliente) tiene **degradación controlada**: si
  el select completo falla por columna faltante, reintenta con el núcleo
  estable de columnas y rellena las nuevas con defaults — la página carga con
  la información básica en vez de morir. Usa este patrón en páginas críticas
  cuando agregues columnas nuevas a un select.
- Preferir siempre `select` explícito (nunca traer el modelo completo): una
  query sin `select` selecciona TODAS las columnas del modelo y convierte
  cualquier columna nueva sin migrar en un error fatal (así se rompió el
  registro el 14-07).

## Nota sobre entornos

`db:doctor` verifica la BD a la que apunte `DATABASE_URL`. Si tienes staging y
producción, córrelo contra cada una. El modo `--sql` es agnóstico: el mismo
script pegado en cada proyecto de Supabase.
