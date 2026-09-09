# R0: gates de seguridad

Fecha: 2026-09-09. Alcance: prerrequisitos seguros, no cambio de autorizacion.
**Auth/RLS conductual: BLOCKED.** Un preflight verde solo valida configuracion;
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
| `E2E_TEST_DATABASE_URL` | URL PostgreSQL local allowlisted, con nombre de BD, sin query ni fragmento |
| `DATABASE_URL`, `DIRECT_URL` | Ambas iguales a la URL local TEST aprobada |

Este contrato conservador admite Auth de un proyecto alojado explicitamente
aprobado y BD local; **no admite BD remota, poolers, ni Supabase Auth local**.
Ampliarlo para Auth local requiere una identidad/origen local aprobado y pruebas,
no relajar la comprobacion ni inferir permisos por estar en localhost.
Una variable de aprobacion es una declaracion del operador, no una prueba de que
el proyecto sea desechable. Claves opacas: solo presencia/coherencia, no firma,
rol o pertenencia comprobados. No se imprimen ni siquiera errores Zod crudos.

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
No se agrega workflow manual: sin entorno/fixtures aprobados no hay uno util que
ejecute Auth honestamente sin provisionamiento. El CI existente incorpora las
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
No se ejecutaron en esta tarea los comandos que requieren BD ni el gate Auth valido.

`scripts/probar-rls.mjs` exige DATABASE_URL, psql y rol membego_app sin BYPASSRLS.
Prueba lectura directa/hija, insercion y update cruzados, omnisciente, ausencia de
contexto y Home revision/bloques. Usa identificadores fijos rlsprueba_a/b: no
ejecutar concurrentemente sobre una misma BD. Su rechazo remoto detecta Supabase
salvo RLS_PERMITIR_REMOTA=si, **no es una allowlist universal de entornos seguros**.
No activar esa excepcion. CI tambien comprueba cero grants de tablas public a
anon/authenticated tras la capa 1. Esto no demuestra politicas de cada sucursal,
Auth real ni que una instalacion desplegada use el rol restringido.

## Evidencia y bloqueos

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
