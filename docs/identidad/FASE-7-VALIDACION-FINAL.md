# Verificación de identidad · Fase 7 — Validación final

Rama `claude/identidad-fase1` (sin push). Siete fases, del 22 al 26 de octubre de 2026. Base de comparación: `70f88487` (el `main` sobre el que se
construyó). Diseño de origen: [AUDITORIA-VERIFICACION-IDENTIDAD.md](./AUDITORIA-VERIFICACION-IDENTIDAD.md); notas de cada fase en esta misma carpeta.

Este documento reúne los diez entregables que se pidieron para cerrar el trabajo. Los dos últimos tienen su propio archivo:
[lista de despliegue](./LISTA-DE-DESPLIEGUE.md) y [manual de operación](../runbooks/verificacion-identidad.md).

## Veredicto

| Pregunta | Respuesta |
|---|---|
| ¿Está terminado lo que se pidió? | **Sí**, las siete fases, con las salvedades de «Lo que no se pudo verificar» |
| ¿Se puede desplegar? | **Sí, apagado.** Nace apagado y sin reglas; con la verificación apagada nada del producto cambia (ninguna compra, promoción, membresía, renovación ni acceso depende de ella) |
| ¿Se puede encender con documentos reales? | **No todavía.** Faltan, y son tuyos: el dictamen legal (Ley 4-23 arts. 58–60 y Ley 358-05), el contrato con el proveedor, la configuración de Didit y una verificación de punta a punta en su sandbox. Ver los riesgos R1–R4 |
| ¿Hay algo a medio hacer? | No. Hay cosas **deliberadamente fuera** (contracargo, crédito corporativo, anomalías, SDK nativo, vía oficial de la JCE) por falta de datos o de decisión; están en «Riesgos y pendientes» |

---

## 1 · Funcionalidades implementadas

### La persona (cliente)

- **Pantalla «Verificación de identidad»** en la web (`/cliente/identidad`) y en la app (`/identidad`), con un resumen en Configuración. Estado con texto (Sin verificar,
  En proceso, En revisión, Verificada, Vencida, Retirada), explicación del proceso en tres pasos, información de privacidad y el motivo de cada rechazo en español.
- **Tres permisos por separado** (biometría, transferencia de datos a la UE, y —opcional— que los negocios vean «verificado»), ninguno marcado de antemano, versionados por el
  texto que la persona vio: un permiso dado sobre un texto anterior no cubre el nuevo.
- **Captura en el flujo hospedado del proveedor** (web: redirección; app: navegador del sistema), nunca en una WebView, con vuelta a la app y consulta del estado.
- **Reintento** con espera de 5 minutos tras un rechazo y tope de tres rechazos por semana (luego, a soporte); **reportar un problema** (tipo + mensaje, con límites);
  **borrar mis datos** (derecho de supresión); **avisos** del resultado en la campana, por push y por correo, sin datos personales ni el motivo de un fraude.
- **Política de privacidad** (`/privacy` §7) y texto de eliminación de cuenta alineados con lo que el sistema hace (una prueba los cruza).

### El equipo de Membego (solo `SUPERADMIN`)

- **Panel `/superadmin/identidad`** con seis pestañas: Resumen (compuerta, intentos de 24 h, verificadas vigentes, por vencer, y lo que hay que vigilar), Casos en revisión,
  Incidencias, Buscar a una persona, Reglas y Auditoría. Cada consulta de un caso pide un motivo de una lista cerrada y queda con el nombre de quien la hizo.
- **Acciones:** rechazar o pedir que repita un caso en revisión (**no existe «aprobar»**: se aprueba en la consola del proveedor), tomar y resolver incidencias con
  respuesta a la persona, retirar una verificación, pedir revalidación, atender un borrado, **reabrir la verificación de quien quedó bloqueado** (ver «Un defecto hallado en la
  validación»), encender o apagar la verificación y encender, apagar o cambiar el alcance de una regla. Todas con motivo y asiento.
- **Cron diario** (`/api/cron/identidad`): vence verificaciones, abandona intentos sin avance, avisa de la revalidación, reintenta avisos y **reconcilia con el proveedor**.

### Los negocios

- Solo una **insignia binaria «Identidad verificada»** en la ficha de un cliente, si la persona lo permitió y la empresa tiene la capacidad `VERIFICACION_IDENTIDAD`.
  Nunca ven documento, selfie, número, rechazos ni nivel; ningún negocio puede descargar nada.

### La plataforma

- **Regla «pago a un proveedor»** (apagada de serie): antes de confirmar un pago a un proveedor de Supply se puede exigir que la persona que aceptó su contrato esté
  verificada con documento (solo el primer pago, o todos). Esa persona verifica desde el portal del proveedor. Es **la única** puerta del sistema que consulta una regla.

### Por debajo

- Resultado global por persona (`User`), historial de intentos con máquina de estados que solo avanza, bandeja de avisos del proveedor con deduplicación, verificación de la
  firma de cada aviso, **«consultar la verdad»** al proveedor antes de aplicar nada, **«procesar y purgar»** (la sesión con los documentos se borra del proveedor al concluir),
  detección del mismo documento en dos cuentas sin guardar el número (HMAC con pepper), referencia del proveedor **sellada** (AES-256-GCM), interruptor automático ante caídas
  del proveedor, supresión que borra primero en el proveedor y luego en Membego, y bloqueo de la eliminación de cuenta mientras haya datos sin borrar en el proveedor.
- **Único escritor de «verificada»:** `aplicarDecision`, llamado solo por el worker tras consultar al proveedor. Ninguna ruta, acción ni pantalla puede marcar a nadie
  como verificado (hay guardas que lo impiden).

## 2 · Archivos modificados

117 archivos desde la base `70f88487` hasta el último commit de la Fase 6 (81 nuevos, 36 modificados, ~16 000 líneas, casi todo código nuevo y pruebas), más los de esta fase.
Resumen por área; la lista completa está en el [Apéndice](#apéndice--lista-completa-de-archivos).

| Área | Archivos clave |
|---|---|
| Núcleo del dominio (`src/modules/identidad/`) | `identidadCore.ts` (estados, reglas, mensajes), `identidad.ts` (único escritor de las tablas), `sincronizacion.ts` (worker), `eventos.ts` (bandeja y firma), `supresion.ts`, `identidadPuerta.ts` y `vistaCore.ts` (lo que ven web y app), `staff.ts` (el equipo), `reglas.ts` + `reglasCore.ts`, `avisos*.ts`, `correoAviso.ts`, `clienteActions.ts`, `proveedor/` (`didit.ts`, `diditMapeo.ts`, `circuito.ts`, `contrato.ts`) |
| Esquema y migraciones | `prisma/schema/identidad-verificacion.prisma` (nuevo), `identidad.prisma` y `clientes.prisma` (campos y enums), 10 migraciones `20261078`–`20261087`, `prisma/migrations_manual/2026-10-rls-identidad.sql` |
| Rutas | `api/v1/cliente/identidad/{estado,sesion,consentimientos,incidencias,borrado}`, `api/webhooks/identidad/[proveedor]`, `api/cron/identidad`; `api/v1/auth/cuenta` (purga antes de eliminar) |
| Web | `(cliente)/cliente/identidad`, resumen en `ajustes`, `(superadmin)/superadmin/identidad` (+ `[userId]`), `(admin)/admin/supply/identidad`, `/privacy` §7, componentes en `components/cliente/identidad`, `components/superadmin/identidad`, `components/admin/IdentidadVerificadaBadge` |
| App móvil | `apps/client/app/identidad.tsx`, `src/components/identidad/`, `src/hooks/useIdentidad.ts`, `src/lib/identidad-retorno.ts`, enlaces desde `ajustes` y `+native-intent` |
| Otros módulos tocados | `supply-v2/finance/payments.ts` (la puerta del pago), `supply-v2/core/catalogo.ts` y `portal/queries.ts`, `superadmin/identidadActions.ts` y `eliminarActions.ts`, `admin/actions.ts` (no eliminar a un empleado con borrado pendiente), `auditoria/queries.ts`, `capacidades/catalogo.ts`, `lib/env.ts`, `lib/rate-limit.ts`, `layout/nav-config.ts`, `vercel.json` (cron), `package.json` (script de sandbox), `.env.example` |
| Pruebas | 12 archivos puros y 8 con base de datos (ver §4) y el auxiliar `tests/postgres/_helpers/didit-falso.ts`; el `shim` de pruebas (`scripts/supply-db/`) extendido |
| Documentación | `docs/identidad/` (auditoría, fases 1–7, despliegue), `docs/runbooks/verificacion-identidad.md` |

## 3 · Migraciones

Diez, todas **aditivas e idempotentes**, selladas (`npm run migraciones:sellar`: 253 en total). Las de enum van **solas** (PostgreSQL no deja usar un valor de enum en la
transacción que lo crea) y **se aplican antes del código**.

| Migración | Qué hace |
|---|---|
| `20261078_identidad_acciones_enum` | Asientos de la bitácora de la fase 1 |
| `20261079_identidad_verificacion` | Tablas de la persona (`identidad_verificaciones`, `_intentos`, `_consentimientos`), el interruptor (nace apagado), la proyección en `clientes`, claves foráneas, CHECK de valores válidos y RLS activado |
| `20261080_identidad_acciones_proveedor` | Asientos: sesión borrada del proveedor, aviso descartado |
| `20261081_identidad_proveedor` | Bandeja `identidad_eventos_externos` (aviso único por proveedor + evento + tipo) y columnas de purga y reconciliación |
| `20261082_identidad_avisos_incidencias_enums` | Tres avisos para la campana y el asiento de incidencia reportada |
| `20261083_identidad_incidencias` | Tabla de incidencias (con límites de tipo, estado y largo) |
| `20261084_identidad_admin_enums` | Asientos de revisión resuelta e incidencia atendida; aviso de repetición |
| `20261085_identidad_incidencias_respuesta` | Respuesta del equipo a una incidencia, con su CHECK |
| `20261086_identidad_reglas_enums` | Asiento de cambio de regla |
| `20261087_identidad_reglas` | Tabla `identidad_reglas` (nace vacía; CHECK que solo admite la operación del catálogo) |

**Manual:** `prisma/migrations_manual/2026-10-rls-identidad.sql` (políticas de seguridad por fila de las siete tablas; exige la Capa 2 de RLS). Ver el riesgo R5.

## 4 · Pruebas ejecutadas

Todas con **datos sintéticos** y el proveedor simulado: ningún documento ni persona reales, ninguna llamada a la red.

| Capa | Archivos | Pruebas |
|---|---|---|
| Núcleo puro y textos | `identidad-core`, `identidad-consentimientos`, `identidad-vista`, `identidad-proveedor`, `identidad-reglas`, `politicas-identidad` | 92 |
| Pantallas (render de servidor y fuentes) | `identidad-render`, `identidad-equipo-render`, `identidad-pantalla-app` | 30 |
| Seguridad sin base de datos | `identidad-seguridad` (barrido de advertencias, 400 alteraciones de un aviso firmado, basura, higiene del repositorio) | 10 |
| Guardas de código, matriz y documentos | `identidad-guardas`, `identidad-matriz-fase6`, `identidad-docs-finales` | 37 |
| Dominio contra PostgreSQL | `identidad`, `identidad-proveedor`, `identidad-puerta`, `identidad-equipo`, `identidad-reglas`, `identidad-rechazos` | 145 |
| Rutas HTTP reales (Supabase simulado) | `identidad-rutas` | 7 |
| Políticas de seguridad por fila (como `membego_app`) | `identidad-rls` | 7 |
| **Mutaciones** (se rompe cada protección y debe fallar alguna prueba) | fases 4, 5, 6 y 7 | **44 de 44 atrapadas** (7 + 13 + 15 + 9) |
| Estática | `tsc --noEmit`, `eslint`, `prisma validate`, deriva del esquema (`migrate diff`), `rls:cobertura`, `rls:preflight`, `permisos:catalogo`, auditor de diseño | ver §5 |

La matriz de escenarios de seguridad (quince, los que se pidieron) está en [FASE-6-PRUEBAS-DE-SEGURIDAD.md](./FASE-6-PRUEBAS-DE-SEGURIDAD.md) y una prueba comprueba que cada prueba
citada sigue existiendo.

## 5 · Resultados

Última corrida completa (el árbol de trabajo de esta fase):

| Corrida | Pruebas | Pasan | Fallan | Omitidas |
|---|---|---|---|---|
| `npm test` (todo lo que no necesita base de datos) | 5091 | 5083 | 1 | 7 |
| Identidad con PostgreSQL (8 archivos, `tests/postgres/identidad*.db.test.ts`) | 159 | 159 | 0 | 0 |
| Batería completa con PostgreSQL (`npm run test:db`) | 1331 | 1328 | 3 | 0 |

- Fallos de `npm test`: «tests\reportes-excel.test.ts» (ver abajo: ajenos a identidad).
- Fallos de la batería completa: «§24A · el proveedor de correo devuelve 500: el dinero NO se mueve y el aviso queda FAILED», «§24B · el segundo intento sale bien y el aviso queda DELIVERED, sin duplicar nada», «§24C · un 4xx NO gasta la escalera: se cierra con su razón» (todos en `supply-v2-slice9`; ver abajo).
- `tsc --noEmit`: solo el error de `src/lib/xlsx.ts` (módulo que falta en este entorno). `eslint` sobre todo lo tocado: sin errores ni avisos. `prisma validate` y la deriva del esquema contra la base de pruebas: sin diferencias. `rls:cobertura`, `rls:preflight` y `permisos:catalogo`: en verde.

**Fallos conocidos, ajenos a identidad:**

- `tests/reportes-excel.test.ts` y el error de `tsc` en `src/lib/xlsx.ts`: falta `write-excel-file/node` en este entorno. Falla igual sin ninguno de estos cambios.
- `tests/postgres/supply-v2-slice9.db.test.ts` (outbox y arriendos de Supply, no identidad): **intermitente**. En esta fase falló en las dos corridas completas (1 y 3 pruebas), y aislada falló
  4 de 7 veces (con 3 a 5 pruebas distintas) y pasó 85/85 las otras tres; también falló en la fase 3. Se comprobó que **no es contaminación de las pruebas de identidad** (falla igual
  corrida justo después de ella, sin identidad de por medio) y que **ningún archivo del outbox ni de los arriendos fue tocado** (de Supply solo cambian `finance/payments.ts`, el
  catálogo de rutas y una consulta del portal). Es una fragilidad de esa prueba en una base de pruebas reutilizada; en CI, con una base nueva, no se ha visto. Conviene mirarla aparte.

## 6 · Riesgos y pendientes

Ordenados por lo que **impide encender**. «Quién» es quien debe resolverlo.

| # | Riesgo / pendiente | Gravedad | Quién | Qué hace falta |
|---|---|---|---|---|
| R1 | **Legal.** Ley 4-23 arts. 58–60 (¿puede un privado tratar biometría con consentimiento, o el art. 60 lo impide?). Ley 358-05 (¿condicionar un pago a una verificación?). El texto de `/privacy` §7 y de los permisos | **Bloquea encender** | Tú + abogado | Dictamen escrito. Preguntas listas en la auditoría («Para el abogado») |
| R2 | **Contrato / DPA con Didit** (seguridad, subencargados, borrado certificado, ARCO, incidentes, fuente de la consulta de cédula) y transferencia a la UE | **Bloquea encender** | Tú | Contrato firmado |
| R3 | **Configuración de Didit no probada contra su sandbox**: flujo (documento + vida + rostro), **edad mínima 18**, retención, webhook | **Bloquea encender** | Tú | `npm run identidad:probar-didit`, «Try Webhook», una verificación sintética de punta a punta (D1–D5 de la lista) |
| R4 | **Pantallas nunca vistas en un navegador ni en un dispositivo con sesión real** (solo render de servidor, guardas y pruebas de ruta); la app solo se tipó en una copia aislada, sin compilar | Alta | Tú | E3 de la lista de despliegue |
| R5 | **Las políticas de seguridad por fila de identidad no protegen en producción** hasta que la aplicación use el rol `membego_app` (hoy usa `postgres`, que las salta). Están bien escritas y probadas como ese rol; mientras tanto, la defensa es el código (guardas + `rls:cobertura`). Además el archivo es manual y exige la Capa 2 | Media | Tú | B5/B6 de la lista; `docs/runbooks/rls-encender.md` |
| R6 | **CORS de toda la API v1** refleja el origen con credenciales. Pre-existente y de toda la aplicación; para la app (Bearer) no pesa y para el navegador protege la cookie `SameSite=Lax`. Las rutas de identidad que escriben aceptan también la cookie | Media | Tú | Decisión de producto/seguridad |
| R7 | **Pérdida de `IDENTIDAD_CLAVES_MAESTRAS`:** deja ilegibles las referencias selladas y Membego ya no sabe qué sesiones borrar en el proveedor (rige entonces su retención). Tampoco hay herramienta para volver a sellar con una clave nueva | Media | Operación | Copia de las claves fuera del sistema; no retirar versiones viejas |
| R8 | **Cambiar el pepper** invalida la detección del mismo documento en dos cuentas para todo lo ya verificado | Baja | Operación | No rotarlo salvo emergencia |
| R9 | **Si Didit no borra** una sesión (caída larga), los documentos permanecen allí bajo la retención del proveedor. El sistema reintenta a diario y el panel lo cuenta («Borrados pendientes») | Media | Operación | Vigilar el contador; definir la retención máxima en el contrato |
| R10 | **Solo `SUPERADMIN`** atiende casos, incidencias y borrados: es un cuello de botella y, con el plazo de 10 días hábiles del derecho de supresión, un riesgo de incumplimiento si falta esa persona | Media | Tú | Decidir si se crea un rol de soporte de plataforma (y con qué contrato) |
| R11 | **Costes:** según la auditoría (corte del 21-oct), las primeras 500 verificaciones al mes eran gratis hasta el 31-oct-2026; desde el 1-nov, US$ 0,33 por verificación completa | Baja | Tú | Confirmarlo con el proveedor |
| R12 | **«Representante legal» de un proveedor** no existe como dato: la regla usa a quien aceptó el contrato. Si se quiere verificar a otra persona (RNC, firma), hay que modelarlo | Baja | Producto | Decisión |
| R13 | **Sin puerta todavía:** recompra tras contracargo (no existe el modelo), crédito corporativo (no hay persona firmante ni límite que se haga cumplir) y anomalías (no hay señales de dispositivo ni velocidad). Gift cards, regalos y referidos **no** llevan identidad: la auditoría los clasifica como T1+ | Baja | Producto | Cuando existan los datos; el catálogo de reglas está hecho para añadirlas |
| R14 | **Captura nativa** (SDK de Didit, NFC de la cédula nueva) no se hizo: la captura va por el flujo hospedado | Baja | Producto | Segunda iteración, con build nueva y permisos de cámara |
| R15 | **El «en revisión» por documento repetido** se distingue de «verificada» (no revela que el documento tenga otra cuenta, pero no se puede ocultar del todo sin dejar pasar duplicados) | Baja | — | Compromiso aceptado en la auditoría |
| R16 | **Límites de uso por instancia** si no hay Upstash configurado en producción (6 sesiones cada 5 min, 30 consultas por minuto) | Media | Operación | C4 de la lista |
| R17 | **Vía oficial de la JCE** (arts. 61–62) no existe todavía como canal; el modelo ya guarda la vía para añadirla sin rediseño | Baja | Tú | Solicitud formal a la JCE |

## 7 · Controles de privacidad

| Principio | Cómo se cumple | Dónde se prueba |
|---|---|---|
| **Minimización:** nada de imágenes, vídeo, plantillas biométricas, número de documento en claro, nombre legal ni cuerpos de aviso | El esquema no tiene dónde guardarlos; lo único del documento es un hash con pepper; el proveedor los borra al concluir | `identidad-guardas` («EL ESQUEMA NO TIENE DÓNDE GUARDAR…»), `identidad-seguridad` (higiene del repositorio) |
| **Consentimiento explícito y probado** (art. 58: aviso de captura, finalidad y plazo) | Pantalla propia previa, casillas sin marcar, texto versionado, registro por persona con versión, canal, IP y agente; sin permiso no hay captura; retirar la biometría cancela el intento | `identidad.db` 2–2f, `identidad-puerta.db` 2–4 |
| **Finalidad limitada** | Solo verificar que la persona es la titular y prevenir fraude; el aviso y la política lo dicen; los negocios ven un sí/no con fecha, y solo si la persona lo permitió | `politicas-identidad`, `identidad.db` 10 |
| **Procesar y purgar** | La sesión con los documentos se borra del proveedor al concluir (aprobada, rechazada o cerrada), después de guardar el resultado; los fallos se reintentan y se cuentan | `identidad-proveedor.db` 3–3d, 7f; `identidad-rechazos.db` |
| **Retención limitada** | Una verificación vale 36 meses; vence sola aunque el cron no haya pasado; se avisa 30 días antes | `identidad-core`, `identidad.db` 8 |
| **Derecho de supresión** | Desde la pantalla, por soporte o al eliminar la cuenta: primero el proveedor (con borrado de plantillas), y solo si lo confirma, Membego; se conserva la prueba del consentimiento y los intentos sin datos; el plazo legal se vigila | `identidad-proveedor.db` 8–8e, `identidad-puerta.db` 6, `identidad-equipo.db` 6b |
| **Acceso restringido y auditado** | Solo `SUPERADMIN`; abrir un caso pide un motivo de una lista cerrada y deja asiento antes de leer; nadie ve imágenes ni la referencia ni el hash; las empresas no importan el módulo ni leen sus tablas | `identidad-equipo.db` 1–2, `identidad-guardas`, `identidad-rls.db` |
| **La persona no puede acreditarse a sí misma ni nadie por ella** | «Verificada» solo la escribe el worker tras consultar al proveedor; no hay endpoint, acción ni botón que lo haga; un aviso falso o repetido solo provoca una consulta inocua | `identidad-guardas`, `identidad-proveedor.db` 2, 4, 5 |
| **Sin datos personales en bitácoras, logs ni avisos** | Lista cerrada de claves en la bitácora; los logs no llevan clave, dirección con token ni documento; los avisos no llevan datos ni el motivo de un fraude; el correo de soporte solo lleva ids | `identidad.db` 11c, `identidad-proveedor.db` 9d, `identidad-puerta.db` 5, 7 |
| **Cifrado** | La referencia del proveedor se sella con AES-256-GCM atada a la persona; el documento solo existe como HMAC con pepper; secretos solo en el servidor | `identidad.db` 5b, `identidad-guardas` |
| **Fraude sin enseñar a evadirlo** | Las señales de ataque o alteración dan un mensaje neutro, no se reintentan y no se explican | `identidad-seguridad` 1b, `identidad-rechazos.db` |
| **Menores** | Rechazo por edad definitivo y visible; la edad mínima de 18 la aplica el flujo del proveedor (hay que verificarlo en su sandbox) | `identidad-rechazos.db` («menor de edad»), R3 |
| **Transferencia internacional** | Permiso específico para el tratamiento en la UE, registrado y exigido antes de capturar | `identidad.db` 2e |

## 8 · Configuración del proveedor (Didit)

Membego usa Didit como encargado: **crea una sesión por intento**, la persona hace la captura en su flujo hospedado, Didit **avisa por webhook firmado**, Membego **le pregunta la
decisión** por API (nunca se fía del aviso), guarda solo el resultado y **borra la sesión**. Hacia Didit solo viaja el id de nuestro intento (`vendor_data`) y la dirección de
vuelta; nunca datos de la persona.

| Qué | Cómo |
|---|---|
| **Flujo (workflow)** en la consola | Documento de identidad (cédula; añade pasaporte o residencia solo si lo decides) + **prueba de vida** + **comparación facial**, con **edad mínima 18** y **retención mínima**. Copiar su id a `DIDIT_WORKFLOW_ID`. Un flujo con menos de las tres pruebas **nunca acredita**: va a «en revisión» |
| **API key** | `DIDIT_API_KEY` (solo servidor) |
| **Destino del webhook** | `https://<dominio>/api/webhooks/identidad/didit`, evento **`status.updated`**. Su secreto compartido va en `DIDIT_WEBHOOK_SECRET` (rotación con `DIDIT_WEBHOOK_SECRET_ANTERIOR`). El aviso se acepta si la firma V2 (HMAC-SHA256 sobre el cuerpo canónico) es válida y su marca de tiempo tiene menos de 5 minutos |
| **Base de la API** | Por defecto `https://verification.didit.me`; `DIDIT_API_BASE` (solo https) para otro entorno |
| **Claves propias de Membego** | `IDENTIDAD_CLAVES_MAESTRAS` (`1:<base64 de 32 bytes>`, mismo formato que el de los conectores pero **variable propia**) y `IDENTIDAD_PEPPER_DEDUPE` (mínimo 32 caracteres). Sin ellas, falla cerrada |
| **Lo que Membego le pide a Didit** | Crear sesión (`POST /v3/session/`), leer la decisión (`GET /v3/session/{id}/decision/`), borrar la sesión (`DELETE /v3/session/{id}/delete/`) y borrar a la persona (`POST /v3/users/delete/`, en la supresión). Tiempo máximo 8 s, sin seguir redirecciones, y un interruptor automático tras 5 fallos seguidos |
| **Probar sin documentos** | `npm run identidad:probar-didit`: crea una sesión, la lee, la traduce y la borra |
| **Probar el webhook** | «Try Webhook» en la consola: un 200 confirma firma, frescura y bandeja |
| **Qué queda en manos de Didit** | La retención que fije su contrato y su flujo mientras no se borre la sesión; por eso el borrado es inmediato tras guardar el resultado |

## 9 · Lista de despliegue

Ver [LISTA-DE-DESPLIEGUE.md](./LISTA-DE-DESPLIEGUE.md): seis bloques (antes de tocar nada, base de datos, código, proveedor, encender, después de encender) y la marcha atrás.
Una prueba comprueba que la lista nombra todas las migraciones, todas las variables de entorno y el cron.

## 10 · Manual de operación

Ver [docs/runbooks/verificacion-identidad.md](../runbooks/verificacion-identidad.md): rutina diaria, cada procedimiento del equipo (encender y apagar, casos en revisión, incidencias,
personas bloqueadas, borrados, retirar y revalidar, la regla de pago), qué hacer cuando falla (proveedor caído, avisos atrasados, borrados pendientes, rotación de claves, claves
expuestas) y lo que no se debe hacer.

---

## Un defecto hallado en la validación (y cerrado)

Al escribir el manual apareció un hueco en lo ya entregado: los mensajes dicen «contacta a soporte» a quien queda **bloqueado** (rechazo definitivo o demasiados rechazos), y el servicio
sabía reabrirlo (`desbloqueoPorStaff`, probado desde la fase 1), pero **ningún botón del panel lo exponía**: soporte no tenía cómo atenderlo. Se añadió
**«Reabrir la verificación»** en el caso de la persona: solo `SUPERADMIN`, con motivo, que crea un intento nuevo del equipo (deja asiento con su nombre y el motivo, y avisa a la
persona). **No verifica a nadie**: la persona tiene que pasar por el proveedor, y siguen en pie la compuerta, los permisos dados por ella y «ya verificada». Dos pruebas con base
de datos, una guarda y seis mutaciones lo vigilan. Es un commit separado y se puede revertir sin tocar nada más.

## Correcciones de documentación

- Las notas de las fases 1 a 5 y varios textos decían que la verificación tenía una **«triple compuerta»** (entorno + interruptor + capacidad por empresa). **Son dos**: el entorno completo y el
  interruptor. La capacidad `VERIFICACION_IDENTIDAD` solo gobierna si una empresa ve la insignia en la ficha de sus clientes (la verificación es de la persona, no de una empresa, y las
  reglas son de la plataforma). Se corrigieron las notas, el comentario del catálogo de capacidades y la etiqueta que se ve al configurarla.

## Lo que no se pudo verificar

- **El sandbox real de Didit** (nada de lo de este informe ha hablado con Didit: es un proveedor simulado con la misma firma y los mismos contratos).
- **Un navegador o dispositivo con sesión real:** el entorno de QA no tiene login (el proyecto de Supabase de `.env` ya no existe). Las pantallas se probaron con render de servidor, guardas y
  pruebas de ruta con Supabase simulado.
- **La app móvil compilada:** se comprobó el tipado en una copia aislada, no un build ni un dispositivo.
- **Producción:** ni la base, ni las políticas de seguridad por fila, ni Upstash, ni el correo.
- **El plazo real de los derechos ARCO** y el cumplimiento legal: son del dictamen.

## Apéndice · lista completa de archivos

`A` = nuevo, `M` = modificado (frente a `70f88487`; incluye lo de esta fase, aún sin commit).

```text
M .env.example
M apps/client/app/+native-intent.tsx
M apps/client/app/ajustes.tsx
A apps/client/app/identidad.tsx
A apps/client/src/components/identidad/PanelIdentidad.tsx
A apps/client/src/components/identidad/ResumenIdentidad.tsx
A apps/client/src/hooks/useIdentidad.ts
M apps/client/src/lib/api.ts
M apps/client/src/lib/client-route-presentation.ts
A apps/client/src/lib/identidad-retorno.ts
M apps/client/src/lib/notificacion-navegacion.ts
A docs/identidad/AUDITORIA-VERIFICACION-IDENTIDAD.md
A docs/identidad/FASE-1-BACKEND.md
A docs/identidad/FASE-2-PROVEEDOR.md
A docs/identidad/FASE-3-CLIENTE.md
A docs/identidad/FASE-4-ADMINISTRACION.md
A docs/identidad/FASE-5-REGLAS.md
A docs/identidad/FASE-6-PRUEBAS-DE-SEGURIDAD.md
A docs/identidad/FASE-7-VALIDACION-FINAL.md
A docs/identidad/LISTA-DE-DESPLIEGUE.md
M docs/runbooks/README.md
A docs/runbooks/verificacion-identidad.md
M docs/SEPARACION_LANDING_APP.md
M package.json
A prisma/migrations_manual/2026-10-rls-identidad.sql
A prisma/migrations/20261078_identidad_acciones_enum/migration.sql
A prisma/migrations/20261079_identidad_verificacion/migration.sql
A prisma/migrations/20261080_identidad_acciones_proveedor/migration.sql
A prisma/migrations/20261081_identidad_proveedor/migration.sql
A prisma/migrations/20261082_identidad_avisos_incidencias_enums/migration.sql
A prisma/migrations/20261083_identidad_incidencias/migration.sql
A prisma/migrations/20261084_identidad_admin_enums/migration.sql
A prisma/migrations/20261085_identidad_incidencias_respuesta/migration.sql
A prisma/migrations/20261086_identidad_reglas_enums/migration.sql
A prisma/migrations/20261087_identidad_reglas/migration.sql
M prisma/migrations/SUMAS.txt
M prisma/schema/clientes.prisma
A prisma/schema/identidad-verificacion.prisma
M prisma/schema/identidad.prisma
A scripts/probar-didit-sandbox.mts
M scripts/supply-db/shim-next-hooks.mjs
M scripts/supply-db/shim-next-stub.cjs
M scripts/supply-db/shim-next.mjs
M scripts/verificar-migraciones-resumen.sql
M scripts/verificar-migraciones.sql
M src/app/(admin)/admin/clientes/[id]/page.tsx
M src/app/(admin)/admin/supply/configuracion/page.tsx
A src/app/(admin)/admin/supply/identidad/page.tsx
M src/app/(cliente)/cliente/ajustes/page.tsx
A src/app/(cliente)/cliente/identidad/page.tsx
M src/app/(public)/eliminar-cuenta/confirmar/page.tsx
M src/app/(public)/eliminar-cuenta/page.tsx
M src/app/(public)/privacy/page.tsx
A src/app/(superadmin)/superadmin/identidad/[userId]/page.tsx
A src/app/(superadmin)/superadmin/identidad/page.tsx
A src/app/api/cron/identidad/route.ts
M src/app/api/v1/auth/cuenta/route.ts
A src/app/api/v1/cliente/identidad/borrado/route.ts
A src/app/api/v1/cliente/identidad/consentimientos/route.ts
A src/app/api/v1/cliente/identidad/estado/route.ts
A src/app/api/v1/cliente/identidad/incidencias/route.ts
A src/app/api/v1/cliente/identidad/sesion/route.ts
A src/app/api/webhooks/identidad/[proveedor]/route.ts
A src/components/admin/IdentidadVerificadaBadge.tsx
A src/components/cliente/identidad/ResumenIdentidad.tsx
A src/components/cliente/identidad/VerificacionIdentidad.tsx
M src/components/cliente/MisAvisos.tsx
M src/components/layout/nav-config.ts
A src/components/superadmin/identidad/AccionConTexto.tsx
M src/lib/env.ts
M src/lib/rate-limit.ts
M src/modules/admin/actions.ts
M src/modules/auditoria/queries.ts
M src/modules/capacidades/catalogo.ts
A src/modules/identidad/avisos.ts
A src/modules/identidad/avisosCore.ts
A src/modules/identidad/clienteActions.ts
A src/modules/identidad/correoAviso.ts
A src/modules/identidad/eventos.ts
A src/modules/identidad/identidad.ts
A src/modules/identidad/identidadConsentimientosCore.ts
A src/modules/identidad/identidadCore.ts
A src/modules/identidad/identidadPuerta.ts
A src/modules/identidad/proveedor/circuito.ts
A src/modules/identidad/proveedor/contrato.ts
A src/modules/identidad/proveedor/didit.ts
A src/modules/identidad/proveedor/diditMapeo.ts
A src/modules/identidad/reglas.ts
A src/modules/identidad/reglasCore.ts
A src/modules/identidad/sincronizacion.ts
A src/modules/identidad/staff.ts
A src/modules/identidad/supresion.ts
A src/modules/identidad/vistaCore.ts
M src/modules/plataforma/conceptos.ts
M src/modules/superadmin/eliminarActions.ts
A src/modules/superadmin/identidadActions.ts
M src/modules/supply-v2/core/catalogo.ts
M src/modules/supply-v2/finance/payments.ts
M src/modules/supply-v2/portal/queries.ts
A tests/identidad-consentimientos.test.ts
A tests/identidad-core.test.ts
A tests/identidad-docs-finales.test.ts
A tests/identidad-equipo-render.test.ts
A tests/identidad-guardas.test.ts
A tests/identidad-matriz-fase6.test.ts
A tests/identidad-pantalla-app.test.ts
A tests/identidad-proveedor.test.ts
A tests/identidad-reglas.test.ts
A tests/identidad-render.test.ts
A tests/identidad-seguridad.test.ts
A tests/identidad-vista.test.ts
A tests/politicas-identidad.test.ts
A tests/postgres/_helpers/didit-falso.ts
A tests/postgres/identidad-equipo.db.test.ts
A tests/postgres/identidad-proveedor.db.test.ts
A tests/postgres/identidad-puerta.db.test.ts
A tests/postgres/identidad-rechazos.db.test.ts
A tests/postgres/identidad-reglas.db.test.ts
A tests/postgres/identidad-rls.db.test.ts
A tests/postgres/identidad-rutas.db.test.ts
A tests/postgres/identidad.db.test.ts
M vercel.json
```

