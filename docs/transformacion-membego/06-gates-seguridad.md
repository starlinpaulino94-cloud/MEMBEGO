# R0: gates de seguridad

Fecha: 2026-09-09. Alcance: prerrequisitos y verificacion remota TEST autorizada,
sin cambio de semantica de autorizacion. **Auth HTTP: 4/5, FAIL; RLS: BLOCKED.**
Un preflight verde solo valida configuracion;
no autentica, no verifica claves con Supabase, no certifica fixtures ni politicas.
La tarea 3 del plan permanece pendiente.

## Prerrequisito ejecutable

`node scripts/verificar-entorno-e2e.mjs` no carga `.env`, no hace solicitudes,
no conecta a BD y no imprime valores de entrada. Devuelve JSON con `status`,
`issues` (nombre de variable y codigo), `scope` y accion recomendada.
Salida 1 = `BLOCKED`; salida 0 = `PREREQUISITES_OK`, nunca Auth/RLS aprobado.

Contrato explicito, sin derivar aprobacion de `NEXT_PUBLIC_*`:

| Variable | Requisito |
| --- | --- |
| `E2E_ISOLATED_APPROVED` | Literal `si`, solo tras aprobacion del responsable |
| `E2E_ALLOWED_TEST_PROJECT_ID` | Identidad allowlisted del proyecto TEST, 20 letras minusculas; nunca copiar automaticamente la identidad de produccion |
| `E2E_TEST_PROJECT_ID` | Debe coincidir con la identidad aprobada |
| `E2E_SUPABASE_URL` | Exactamente `https://<identidad-aprobada>.supabase.co`; rechaza placeholders, otro proyecto, credenciales y sufijos |
| `NEXT_PUBLIC_SUPABASE_URL` | Igual a `E2E_SUPABASE_URL` |
| `E2E_SUPABASE_ANON_KEY` | Clave anon del proyecto TEST, no vacia |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Igual a la clave anon TEST |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | Clave service del proyecto TEST, no vacia |
| `SUPABASE_SERVICE_ROLE_KEY` | Igual a la clave service TEST |
| `E2E_BASE_URL` | Origen HTTP(S) de localhost, 127.0.0.1 o ::1, sin usuario, ruta, query ni fragmento |
| `NEXT_PUBLIC_APP_URL` | Igual al origen del navegador |
| `E2E_TEST_DATABASE_URL` | URL exacta de BD TEST allowlisted; localhost sin query o proveedor Supabase del proyecto aprobado |
| `E2E_TEST_DIRECT_URL` | URL directa/session pooler exacta allowlisted, obligatoria para remoto; local conserva fallback a E2E_TEST_DATABASE_URL |
| `DATABASE_URL`, `DIRECT_URL` | Iguales a sus respectivas URLs TEST aprobadas, comparacion exacta |
| `E2E_REMOTE_APPROVED` | Literal `si` adicional para cualquier destino remoto; no mezclar BD local y remota |

Remoto: host directo `db.<project>.supabase.co:5432` o pooler
`aws-<numero>-<region>.pooler.supabase.com:5432/6543` con usuario terminado en
`.<project>`. Base `/postgres`, password presente, sin fragmentos. Query acotada a
pgbouncer, connection_limit, connect_timeout, pool_timeout, sslmode, schema y
statement_cache_size; no duplicados, schema solo public y SSL nunca disable.
No se admiten overrides host/options ni sufijos de dominio arbitrarios.
Auth local sigue fuera de este contrato.
Una variable de aprobacion es una declaracion del operador, no una prueba de que
el proyecto sea desechable. Si la clave service tiene formato JWT se comprueban
los claims ref y role=service_role; **no se verifica firma en el parser**. Claves
opacas: solo presencia/coherencia. No se imprimen errores Zod crudos ni claves.

## Gate autenticado dedicado

`node scripts/probar-auth-e2e.mjs` valida primero; sin configuracion termina con
`BLOCKED`, salida 1, antes de resolver o lanzar Playwright. No hace `skip` de Auth.
Con prerrequisitos validos invoca el CLI **instalado**, sin `npx` ni descargas:

```text
playwright test sidebar-auth.setup.ts --project=setup
playwright test sidebar-niveles.spec.ts --project=movil --project=escritorio
```

El setup debe pasar antes del spec; un fallo/timeout termina el gate con salida 1.
El alcance es solo el shell admin/superadmin existente. Los skips de viewport del
spec son deliberados; no representan permisos denegados ni cobertura Auth faltante.
No provisiona fixtures, no arranca el servidor, no hace migracion/push/seed.
El operador debe levantar **una nueva app local con estas mismas variables** y
build aislado: el preflight no puede inspeccionar la configuracion de un servidor
ya arrancado ni las variables incrustadas en un build anterior.

El setup existente requiere las cuentas admin y superadmin del seed historico,
roles/app_metadata y filas correspondientes en la BD local, mas empresa activa.
Las credenciales fijas estan en `tests/e2e/sidebar-auth.setup.ts`; este cambio no
las crea ni las modifica. Sus estados se escriben en `playwright/.auth/`.
Ejecutar en checkout desechable exclusivo: no compartir esos estados ni publicar
trazas/cookies. Limpiar al terminar solo artefactos propios del run.

Los comandos directos antiguos `npm run e2e`/`playwright test` conservan sus skips
por ausencia de `E2E_SUPABASE_URL`: **no son el gate autenticado dedicado**.
`e2e.yml` y el recorrido publico permanecen intactos y no requieren proyecto TEST.
No se agrega workflow: la autorizacion manual de este proyecto no configura los
secretos/fixtures ni permisos de CI. El CI existente incorpora las
pruebas puras nuevas mediante `npm test`, sin secretos ni cambios de workflow.

## Matriz actual

Fuentes: `src/types/index.ts` (`ROUTE_PROTECTION`, `ADMIN_ROLES`,
`FULL_ADMIN_ROLES`, `SCANNER_ROLES`), `src/lib/auth/permissions.ts`,
`src/lib/auth/guards.ts`, `src/proxy.ts`. Matriz base, antes de ajustes individuales:

| Rol | /superadmin | /admin | /empleado | /cliente | /vendedor |
| --- | --- | --- | --- | --- | --- |
| SUPERADMIN | Si | Todas las secciones base | Si | No | No |
| ADMINISTRADOR, ADMIN_EMPRESA (legacy) | No | Todas las secciones base | Si | No | No |
| GERENTE, CAJERO | No | Todas las secciones base | Si | No | No |
| MARKETING | No | Lista Marketing | No | No | No |
| SUPERVISOR | No | Lista Supervisor | No | No | No |
| RECEPCION, EMPLEADO | No | No | Si | No | No |
| CLIENTE | No | No | No | Si | No |
| VENDEDOR | No | No | No | No | Si |
| Anonimo | Login | Login | Login | Login | Login |

Marketing: `dashboard, ofertas, promociones, publicaciones, campanas, marketing,
audiencia, adquisicion, notificaciones, automatizaciones, riesgo, retencion`.

Supervisor: `dashboard, reportes, seguimiento, registros, actividad, clientes,
membresias, pagos, scanner, citas, app, riesgo, retencion, conciliacion`.

`/onboarding` admite FULL_ADMIN_ROLES. Las rutas establecer-contrasena de cliente
y vendedor son excepciones publicas explicitas del proxy y layouts.

`seccionPermitida`: ajuste individual true/false prevalece sobre rol; solo
SUPERADMIN esta exento. `funcionPermitida`: exige seccion y niega funciones
marcadas false, las demas se permiten. SUPERADMIN puede editar permisos de otros
roles, no de otro SUPERADMIN; ADMINISTRADOR/ADMIN_EMPRESA solo equipo no admin.
La prohibicion de autoedicion y el alcance de empresa corresponden al caller.

`requireAdminUser` solo comprueba FULL_ADMIN_ROLES, no permisos por funcion.
`requireSection` lee permisos vivos si existe dbUserId, devuelve null ante fila
ausente/error y aplica seccion, funcion opcional y capacidad. Sin dbUserId
continua con permisos null y base del rol: no atribuirle un cierre que no tiene.
`usuarioPuedeFuncion` si exige dbUserId para no exentos. Capacidades: SUPERADMIN
exento; seccion no mapeada/sin empresa pasa, el lector tiene fallbacks y cache
300 s (`src/modules/capacidades/resolver.ts`). No hay fail-closed universal.

El proxy usa permisos del token para UX, permite dashboard para evitar bucles,
y deja rutas /admin desconocidas a roles plenos, no a roles acotados.
**Gap crm/facturas:** ambas rutas existen pero no estan en ADMIN_SECTIONS;
`adminSectionForPath` devuelve null. Marketing/Supervisor se redirigen, roles
plenos pasan. CRM usa requireRole(ADMIN_ROLES) y companyId de sesion; facturas usa
requireRole(ADMIN_ROLES), requireCompanyContext y conEmpresa. No se inventa un
alias crm=clientes/facturas=pagos ni se conceden permisos nuevos.

## Auth y contexto

`requireUser` exige `getUser`, sin usuario redirige /login; `requireRole` tambien
redirige /login si el rol no esta en la lista. El proxy redirige roles insuficientes
a ROLE_HOME. `auth-service.ts` valida con Supabase getUser, reintenta una vez ante
error transitorio y puede usar JWT local verificado si persiste; rechazo real
retorna null. No confundir comentarios historicos del proxy con su codigo actual.

`requireCompanyContext`: toda pagina /admin usa empresa activa incluso superadmin;
sin empresa existente, superadmin va a /superadmin/empresas y staff a
/admin/sin-empresa. `resolveCompanyId`: staff ignora companyId del formulario;
superadmin admite empresa explicita o activa y verifica existencia.

CLIENTE puede ser global sin empresa; su layout exige rol, no afiliacion.
Mi Membego agrupa fichas de la misma persona por supabaseId/misClienteIds entre
empresas; no es acceso a todos los clientes. Reservar/regalar sigue contextual.
`conEmpresa` fija app.company_id por transaccion, `conUsuario` app.user_id y
`sinEmpresa` app.omnisciente para cruces deliberados. El rol no convierte el panel
de empresa en una vista global. No hay prueba nueva de aislamiento por sucursal;
estas barreras por empresa no lo acreditan automaticamente.

## Gates y comandos

| Gate | Comando exacto / ubicacion | Lo que acredita |
| --- | --- | --- |
| Prerrequisitos | `node scripts/verificar-entorno-e2e.mjs` | Solo configuracion, sin red |
| Pruebas nuevas | `node_modules/.bin/tsx --test tests/entorno-e2e.test.ts` | Parser y CLI sinteticos |
| Permisos/contexto | `node_modules/.bin/tsx --test tests/accesos.test.ts tests/permisos-empleado.test.ts tests/ambito-empresa.test.ts tests/cliente-sin-empresa.test.ts tests/mi-membego-global.test.ts tests/aislamiento.test.ts` | Funciones puras y contratos estaticos, no Auth/RLS vivo |
| Tipos | `node_modules/.bin/tsc --noEmit --incremental false` | Tipado, no ejecucion |
| CI verificar | `npx tsc --noEmit`, `npx eslint src tests`, `npm test`, `node scripts/rls-cobertura.mjs` | Tipos, lint, tests y envoltorios tenant |
| CI construir/dependencias | `npm run build`, `npm run presupuesto`, `npm audit --omit=dev --audit-level=high` | Build/presupuesto/dependencias |
| CI esquema | `.github/workflows/ci.yml`, job esquema | PostgreSQL 16 desechable; validate/diff, esquema y roles locales, aplica capas RLS y `npm run rls:probar` |
| E2E publico | `.github/workflows/e2e.yml`, `npx playwright test` | Publico con placeholders; skips Auth no cuentan como aceptacion |
| Auth shell | `node scripts/probar-auth-e2e.mjs` | Setup real y sidebar solamente, pendiente de entorno |
| RLS conductual | `npm run rls:probar` | Escribe fixtures y limpia; SOLO BD de prueba aprobada |

En Windows usar sufijo `.cmd` para los ejecutables de `node_modules/.bin`.
La primera entrega no conecto BD/Auth; la reanudacion autorizada se detalla abajo.

`scripts/probar-rls.mjs` exige DATABASE_URL, psql y rol membego_app sin BYPASSRLS.
Prueba lectura directa/hija, insercion y update cruzados, omnisciente, ausencia de
contexto y Home revision/bloques. Usa identificadores fijos rlsprueba_a/b: no
ejecutar concurrentemente sobre una misma BD. Su rechazo remoto detecta Supabase
salvo RLS_PERMITIR_REMOTA=si, **no es una allowlist universal de entornos seguros**.
No activar esa excepcion. CI tambien comprueba cero grants de tablas public a
anon/authenticated tras la capa 1. Esto no demuestra politicas de cada sucursal,
Auth real ni que una instalacion desplegada use el rol restringido.

## Evidencia inicial (historica)

- TDD: stub permisivo produjo 23 fallos de 24; parser implementado paso 24/24;
  stub de gate Auth produjo el fallo 25; gate corregido paso 25/25, sin skips.
- CLI aislada sin entorno: salida 1, BLOCKED y nombres de 14 variables requeridas.
- CLI con configuracion sintetica: salida 0, PREREQUISITES_OK, issues vacio,
  scope configuration-only. **Sintetico, no QA vivo**; ninguna clave es real.
- Regresion focalizada existente: 44/44, cero skips; incluye contratos de texto.
- Lint focalizado: cero errores/advertencias. Tipado de los scripts aprobado con
  `node_modules/.bin/tsc --noEmit --allowJs --checkJs --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck scripts/verificar-entorno-e2e.mjs scripts/probar-auth-e2e.mjs`.
- Node 24.19.0, tsx 4.22.4 y Playwright instalado 1.62.0. Chrome 152.0.7977.82
  y Edge 152.0.4191.66 detectados por version, sin abrir navegador.
- Docker no disponible en PATH. psql no disponible en PATH, pero binario en
  Program Files/PostgreSQL/16/bin confirma 16.15; servicio postgresql-x64-16
  Running. **Servicio local no equivale a BD aislada aprobada ni Supabase Auth**.
- Supabase CLI existe en PATH; `supabase --version` agoto el limite de 10 s sin
  salida. No se ejecuta status/start ni se inspeccionan credenciales. Tras el
  timeout no quedo proceso supabase; disponibilidad de Auth local no acreditada.
- No hay entorno/fixtures Auth aprobado para esta ejecucion. No se leyeron .env,
  credenciales o estados historicos; ninguna conexion DB, login, seed o descarga.
- Typecheck global tras corregir el test nuevo: errores TS5097 en scripts/visual
  y tests/stitch-visual.test.ts del carril concurrente. No modificados aqui.
- Pendiente: usuario anonimo, rol insuficiente, cruce empresa/sucursal y acceso
  permitido contra sistema real aislado; fixtures cliente global y otros roles,
  transacciones/RLS y fallos negativos. Shell admin/superadmin no sustituye matriz.
- No afirmar CI remoto pasado ni proteccion de rama configurada: no se consultaron.
- Baseline Git inicial: cuatro archivos dirty del usuario y stitch-manifest.json
  nuevo. Sin commits/staging/cambio de rama; archivos ajenos preservados. No se
  ejecuta scripts/verificar-home-e2e.mts ni se modifican visuales/docs05.
- Scope despues: los mismos cuatro archivos dirty, stitch-manifest y adiciones
  concurrentes scripts/visual y tests/stitch-visual.test.ts. Cambios propios:
  este documento, dos scripts, tests/entorno-e2e.test.ts y append de issues/learnings
  en .omo (ignorado). `git diff --check` pasa. No se crean sesiones ni artefactos
  de navegador/DB; procesos de prueba terminados, sin limpieza de datos ajenos.

## Reanudacion autorizada

Autorizacion exacta: **'es exclusivamente de pruebas puedes proseder'**.
Proyecto identificado en memoria y fijado manualmente: `ybzhvfmybyyomwpjpaud`.
Plan actualizado sin marcar tarea 3. Registro local en
`.omo/start-work/r0-auth-approval.json`, sin URLs de BD ni credenciales.
El runner exige ademas `--project=<identidad>` y `--approve-scoped-fixtures`;
sin flags no lee credenciales ni conecta, aunque existan NEXT_PUBLIC_*.
Solo fixtures propias; prohibidos reset, migraciones, grants/politicas/roles,
pagos/envios y cambios de autorizacion. Loader `.env`/`.env.local` en memoria,
sin Read/cat ni salida de contenidos; preflight compara conexiones y claim JWT.

```text
node_modules/.bin/tsx scripts/r0-auth/attest.mts --project=ybzhvfmybyyomwpjpaud --approve-scoped-fixtures
node_modules/.bin/tsx scripts/r0-auth/live.mts --project=ybzhvfmybyyomwpjpaud --approve-scoped-fixtures
```

El segundo comando usa copia de src/packages/public/config en Temp/opencode,
sin copiar .env, y servidor propio Next dev --webpack con MEMBEGO_QA=1
(`next.config.ts`: salida .next-qa). No es build de produccion ni despliegue.
Puerto 127.0.0.1:3217 reservado antes del arranque; no reutiliza servidores.
Claves solo en memoria/entorno hijo; stdout/stderr del servidor descartados,
Sentry y telemetria desactivados. No se ejecuto el harness dirty de Home ni
los harnesses antiguos con prefijos compartidos de limpieza.

### Evidencia real

Raiz `.omo/start-work/r0-auth/`:

- `attest-854898ba-00d0-4502-a127-799998ead8f8`: transaccion READ ONLY, timeout SQL
  10 s. Conexion postgres, BYPASSRLS=true, superuser=false; membego_app ausente.
  Las siete tablas companies/users/clientes/plans/memberships/home_revisiones/
  home_bloques tienen RLS habilitado, sin FORCE y **cero politicas** observadas.
  Esto no prueba aislamiento: no existe camino con rol restringido que verificar.
- `live-a1f3b091-bff4-47ee-b178-31839edaca09`: 4 PASS/1 FAIL; primera expectativa
  usaba el not-found global, no el del panel. Conservado, no presentado como PASS.
- `live-b1451a9c-4490-4209-8b6a-2c6516e5a870`: 4 PASS/1 FAIL; tampoco aparece el
  not-found del panel. Sin nombre del cliente B ni placeholder de error observado.
- `live-9dad1afc-53e5-4e3e-af6f-41b207efda66`: 4 PASS/1 FAIL tras espera acotada
  adicional de 15 s. Captura abierta directamente: shell con esqueleto de carga,
  no contenido de B. **No acredita denegacion completa ni demuestra filtracion**.

En cada run: dos empresas privadas, dos clientes y tres usuarios de aplicacion
vinculados a tres identidades Auth nuevas (ADMIN_EMPRESA, CLIENTE, MARKETING).
Sin seed credentials, membresias activas, QR secretos ni pagos. Pass reales:
anonimo -> login 307; admin A ve su cliente (200 + contenido propio); CLIENTE
-> su home 307 al pedir /admin; MARKETING -> dashboard 307 al pedir empleados.
El acceso al cliente B devuelve HTTP 200 y queda en carga, sin estado de denegacion
completo: criterio FAIL. No cambiar guards para hacer verde el harness.

Capturas finales: `live-9dad1afc-53e5-4e3e-af6f-41b207efda66/admin-own-client-1280.png`
y `company-b-observed-1280.png` en el mismo directorio. Chromium headless
151.0.7922.34, viewport CSS 1280x900, DPR 1, es-DO, America/Santo_Domingo.
Son fixtures reales temporales, no fidelidad Stitch aprobada. No authState/trazas.

Cada run conserva baseline.json/after.json de hashes de codigo de autorizacion
y archivos dirty, catalog.json, rls.json, ownership/fixtures.json, auth.json y
cleanup.json. Los tres recibos prueban cero filas/identidades propias restantes;
se cerraron navegador, conexiones DB y procesos propios (30908, 37008, 36124).
Snapshots eliminados; el primero tiene recibo adicional snapshot-cleanup.json.
Totales de fixtures: nueve identidades Auth y 21 filas principales retiradas;
limpieza de dependencias acotada por IDs propios. No borrados por prefijo compartido.

Estado pendiente: RLS conductual BLOCKED (rol/politicas faltantes), UI negativa
de empresa B FAIL, sucursal y matriz completa no ejecutadas. Una futura prueba
con rol restringido requiere aprobacion separada para su provisionamiento seguro.
El resultado general sale no-cero; ninguno de estos bloqueos se convierte en skip.
Typecheck global y lint focalizado pasan en esta reanudacion; el TS5097 historico
del carril visual ya no bloquea. Pruebas puras remotas/locales separadas de lo vivo.
