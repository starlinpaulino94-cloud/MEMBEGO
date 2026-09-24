# Runbook · Encender RLS Capa 2 (aislamiento real entre empresas)

**Esto NO es un incidente: es una operación planificada y reversible.** Se hace
en frío, con calma, no a las 3 de la mañana. Pero se escribe como un runbook
porque el síntoma de hacerlo mal es traicionero —una pantalla en blanco, sin
error— y porque la marcha atrás tiene que estar a un env-var de distancia.

**Qué cambia:** hoy la app se conecta como `postgres`, que se salta RLS. Las
políticas están escritas, probadas y encendidas en las 137 tablas, pero no
protegen de nada mientras el rol las ignore. Este procedimiento cambia
`DATABASE_URL` al rol `membego_app` (NOBYPASSRLS), y a partir de ahí una consulta
sin contexto de empresa no devuelve datos de más: devuelve **cero**.

**Lo que da:** que un `where companyId` olvidado deje de filtrar datos de otra
empresa. **Lo que NO da:** defensa contra un servidor comprometido —la válvula
`sinEmpresa` la puede abrir la propia app; eso es la «versión fuerte» con un
segundo rol, y va aparte. Ver `docs/RLS.md`.

**Contexto completo:** `docs/RLS.md` §§ 4–5. Este runbook es solo los pasos.

---

## 0 · Antes de empezar (precondiciones de código)

Todo esto debe estar verde en `main` ANTES de tocar ninguna base. Son gates de
CI y de la suite local; si alguno falla, el cutover se para aquí.

```bash
node scripts/rls-cobertura.mjs        # cada consulta declara su empresa
node scripts/rls-capa2-preflight.mjs  # ninguna tabla queda denegada sin decidir
```

Los dos tienen que salir con `✓` y exit 0. El preflight es de papel (no toca la
base): si delata una tabla nueva «sin ruta al inquilino», **hay que decidirla en
`prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql` antes de seguir**
—catálogo global (lectura abierta), de empresa (darle `companyId`/FK) o de
plataforma (solo omnisciente)—. No se enciende nada con el preflight en rojo.

---

## 1 · Ensayo en una base DESECHABLE (nunca la primera vez en producción)

El objetivo es descubrir las tablas denegadas donde no cuesta nada: en una base
de usar y tirar, no en la de los clientes.

```bash
# 1. Una base limpia (local o un proyecto Supabase de prueba). Crear el esquema:
DATABASE_URL="<url-de-prueba>" npx prisma db push

# 2. Aplicar las capas. La contraseña del rol se manda con SET, no con -v
#    (psql no sustituye variables dentro de las comillas de dólar del bloque DO):
psql "<url-de-prueba>" -v ON_ERROR_STOP=1 \
  -f prisma/migrations/20260771_rls_barrera_publica/migration.sql
psql "<url-de-prueba>" -v ON_ERROR_STOP=1 \
  -c "set membego.clave = '<clave-del-rol-de-prueba>'" \
  -f prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql

# 3. La prueba de aislamiento siembra dos empresas y comprueba que una no ve a
#    la otra. Tiene que dar 6 de 6:
DATABASE_URL="<url-de-prueba>" npm run rls:probar
```

`6 de 6` = las políticas aíslan de verdad. Menos = una política está mal (o
`using (true)`); no se sigue.

**4. Ejercitar la app entera** apuntando `DATABASE_URL` al rol `membego_app` de
esa base de prueba. Recorrer, buscando **pantallas o listas vacías** (el síntoma
de una tabla denegada):

- Panel de empresa `/admin/**` (clientes, membresías, citas, promociones, caja).
- App de cliente `/cliente/**`.
- Mostrador / POS.
- Superadmin `/superadmin/**` (cruza empresas: debe seguir viéndolo todo).
- La API pública `/api/platform/v1/**` y los crons (`/api/cron/**`, `/api/jobs`).

Cada pantalla vacía → mirar el log, encontrar la tabla, decidirla en el SQL,
re-aplicar el SQL (es idempotente) y volver a `rls:probar`. Repetir hasta que la
app funcione entera con `membego_app`. Con la Fase 0 hecha, el preflight ya debe
dejar esta lista vacía; esto lo confirma contra una base real.

---

## 2 · Cutover en producción

Solo cuando la Fase 1 pasó limpia. En orden, sin saltarse la verificación.

```bash
# 1. RED: snapshot / backup de la base. Es la marcha atrás de verdad si algo
#    peor que un env-var sale mal. Anota la hora.

# 2. Crear el rol membego_app con SU contraseña (fuera del repo) y aplicar la
#    Capa 2 en producción. Mientras DATABASE_URL siga en `postgres`, esto NO
#    cambia nada todavía (postgres se salta RLS): es un punto de control seguro.
psql "<DIRECT_URL-prod>" -v ON_ERROR_STOP=1 \
  -c "set membego.clave = '<clave-de-produccion>'" \
  -f prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql

# 3. VERIFICAR por filas (el editor de Supabase no enseña los RAISE NOTICE):
psql "<DIRECT_URL-prod>" -f prisma/migrations_manual/2026-07-rls-capa2-verificar.sql
```

Lo que tiene que salir en la verificación:

| # | Comprobación | Esperado |
|---|---|---|
| 1 | Rol `membego_app` | OK: existe, NOBYPASSRLS, puede conectarse |
| 2 | Tablas con RLS encendido | OK: 137 de 137 |
| 3 | Políticas `membego_*` | 137 |
| 4 | Tablas SIN RLS | ninguna |
| 5 | Sin política (solo omnisciente) | solo catálogos geo y búsquedas |

Si la fila 2 dice «MAL: N sin RLS» o la 4 lista tablas, **no se cambia la
variable**: RLS quedó a medias y eso no protege de nada.

```bash
# 4. EL INTERRUPTOR: cambiar DATABASE_URL **y** DIRECT_URL al rol membego_app en
#    el entorno (Vercel), y desplegar. A partir de aquí RLS se hace cumplir.
```

**5. Smoke test inmediato**, el mismo recorrido de la Fase 1, esta vez en
producción y sin prisa: paneles, cliente, mostrador, superadmin, API, un cron.
Vigilar los logs por resultados vacíos los primeros minutos.

---

## Marcha atrás

Instantánea y sin pérdida de datos: **devolver `DATABASE_URL` y `DIRECT_URL` al
rol `postgres`** y redesplegar. `postgres` se salta RLS, así que todo vuelve a
comportarse como antes del cutover; las políticas quedan puestas pero inertes.
Es el motivo por el que el interruptor es una variable de entorno y no un cambio
de esquema: la reversión no toca la base.

Si además el snapshot hiciera falta (algo escribió mal durante la ventana), es la
red de la Fase 2 · paso 1.

---

## Después

- Las políticas quedan encendidas; no hay que apagarlas para nada.
- El gate del preflight en CI impide que una tabla nueva vuelva a driftar. Si un
  PR lo pone en rojo, es una tabla sin decisión de inquilino: se decide en el SQL
  y se re-aplica en producción (idempotente) en la siguiente ventana.
- Pendiente aparte (no bloquea esto): geo RLS (`app.user_id`) en la misma
  verificación, la «versión fuerte» con un segundo rol para `sinEmpresa`, y un
  pentest externo. Ver `docs/RLS.md` § 6.
