# Verificación de identidad · Fase 3 — Experiencia del cliente

Estado: **construida y probada (render, código fuente y base de datos); sin verla en un dispositivo ni en un
navegador con sesión real.** Sigue apagada: la verificación no se ofrece a nadie hasta que se encienda el
interruptor (entorno completo + interruptor en base de datos; la capacidad por empresa solo gobierna la insignia de la ficha), y no se usa con documentos reales
hasta el dictamen legal y el contrato con el proveedor. Base: [AUDITORIA-VERIFICACION-IDENTIDAD.md](./AUDITORIA-VERIFICACION-IDENTIDAD.md),
[FASE-1-BACKEND.md](./FASE-1-BACKEND.md) y [FASE-2-PROVEEDOR.md](./FASE-2-PROVEEDOR.md).

## Qué ve la persona

Una pantalla **Verificación de identidad**, en la web (`/cliente/identidad`) y en la app (`/identidad`), a la que
lleva un resumen dentro de **Configuración** (estado + botón). Tiene, en este orden:

| Pieza pedida | Dónde |
|---|---|
| Estado actual | Cabecera con una etiqueta (con texto, no solo color): Sin verificar · Pendiente · En proceso · En revisión · Verificada · Vencida · Retirada |
| Explicación del proceso | «Cómo funciona»: tres pasos |
| Información de privacidad | «Tu privacidad»: qué se usa, quién lo procesa y dónde, qué se conserva y cuánto, quién lo ve, sus derechos; con enlace a `/privacy#verificacion-identidad` |
| Consentimiento | Tres casillas (biometría, transferencia a la UE, y —opcional— que los negocios vean «verificado»), **ninguna marcada**, con el texto exacto que se registra |
| Inicio de la verificación | Botón que registra los permisos (con la versión del texto que se vio) y abre la verificación |
| Captura | En la verificación hospedada del proveedor (ver «Decisiones») |
| Estado de revisión | «Estamos revisando tu verificación» / «Estamos procesando…»; la pantalla se actualiza sola |
| Motivos de rechazo comunicables | El motivo en español cuando se puede decir; para ataques o documentos alterados, solo «contacta a soporte» |
| Opción de reintentar | «Intentar de nuevo»; con espera tras un rechazo (se dice a qué hora) y tope semanal (se manda a soporte) |
| Gestión de incidencias | «¿Algo no va bien?»: tipo + mensaje; queda en la cola del equipo y se avisa a soporte |
| (además) Qué ven los negocios | Interruptor del permiso de divulgación |
| (además) Borrar mis datos | Derecho de supresión desde la pantalla |

## Cómo está hecho

**El servidor decide todo; las pantallas pintan.** `src/modules/identidad/vistaCore.ts` arma, a partir del estado, la
**vista**: etiqueta, título, descripción, tono, qué botón ofrecer, si hay que pedir permisos, si la pantalla debe
sondear. La web y la app reciben esa vista ya armada (`identidadPuerta.ts`), así que los textos no se contradicen entre
superficies, y que alguien quede verificado solo lo decide el servidor tras consultarle al proveedor (nada de lo
nuevo puede marcarlo).

| Pieza | Dónde |
|---|---|
| Vista, textos, privacidad, tipos de incidencia, mensajes de error | `src/modules/identidad/vistaCore.ts` (puro) |
| Puerta compartida web + app (panel, empezar, permisos, incidencias, borrado, límites de uso) | `src/modules/identidad/identidadPuerta.ts` |
| API de la app | `api/v1/cliente/identidad/{estado,sesion,consentimientos,incidencias,borrado}` |
| Acciones web | `src/modules/identidad/clienteActions.ts` (cada una exige a la persona de la **sesión**) |
| Pantalla web | `src/app/(cliente)/cliente/identidad/page.tsx` + `src/components/cliente/identidad/` |
| Pantalla de la app | `apps/client/app/identidad.tsx` + `src/components/identidad/` + `src/hooks/useIdentidad.ts` |
| Avisos de resultado (campana + push + correo) | `avisosCore.ts` (textos), `correoAviso.ts`, `avisos.ts`; se disparan desde `sincronizarIntento` |
| Política pública | `/privacy` §7 (id `verificacion-identidad`) + `/eliminar-cuenta` |
| Migraciones | `20261082_identidad_avisos_incidencias_enums` (3 avisos + 1 asiento, sola) y `20261083_identidad_incidencias` (tabla de incidencias con RLS de dueño) |

## Reglas que el código hace cumplir

- **Consentimiento por versión:** un permiso dado sobre un texto anterior ya no cubre el nuevo (cambio en
  `tiposVigentes`, de la Fase 1: antes bastaba con que existiera uno sin retirar). El panel lo vuelve a pedir y
  el servidor no deja capturar sin él.
- **Una versión que la persona no vio no se registra** (`texto_cambio`, 409) y nada se anota.
- **Ninguna casilla viene marcada**; sin las obligatorias, el botón no se habilita (y el servidor lo exige igual).
- **La persona sale siempre de la sesión**, nunca del formulario ni de la URL.
- **Límites de uso:** crear sesión (cuesta dinero) 6 cada 5 min; el resto, el límite de formularios.
- **Aviso de resultado único** por intento y resultado (clave de deduplicación en la base). No lleva datos
  personales ni el motivo de un rechazo por fraude; un documento ya asociado a otra cuenta va a «en revisión»
  **sin decirlo** (no se revela si una cédula tiene cuenta).
- **Incidencias:** a lo sumo 3 abiertas por persona; el intento al que apuntan tiene que ser suyo; el texto de la
  persona **no va a la bitácora ni al correo a soporte** (solo id y tipo); se quitan los caracteres de control;
  CHECK en la base para tipo, estado y largo.
- **Borrar mis datos:** el proveedor primero (`privacy_erasure`), lo local solo si lo confirma; si no responde, se
  dice con claridad y no se borra nada. Tras borrar, la sección «borrar» desaparece (no queda nada que borrar).
- **Con la verificación apagada:** sin historial la sección no se anuncia; con historial se ve lo que hay pero no se
  ofrece empezar (tampoco la espera tras un rechazo, que sería mentira).
- **La política pública y la pantalla dicen lo mismo:** `tests/politicas-identidad.test.ts` cruza el plazo («3
  años» = `POLITICA_IDENTIDAD`), el proveedor, la UE, el borrado, los tres permisos y que ninguna casilla viene marcada.

## Decisiones y lo que NO se hizo

- **Captura por el flujo hospedado, no por el SDK nativo.** El encargo decía «captura mediante SDK». Hoy la captura se
  hace en la verificación hospedada del proveedor: en la web se redirige a su dirección y se vuelve a
  `/cliente/identidad`; en la app se abre en el **navegador del sistema** (`WebBrowser.openAuthSessionAsync`, el mismo
  patrón que la ventana de CardNET, porque la cámara en una WebView falla) y se vuelve por `membego://identidad/retorno`.
  El SDK nativo de Didit (mejor captura, NFC de la cédula nueva) exige `expo prebuild`, una build nueva de
  *dev client*, `NSCameraUsageDescription` y `android.permission.CAMERA` (hoy no existen en `app.json`) y revisar su
  compatibilidad con Expo 57 / RN 0.86: queda para una iteración aparte, decisión que ya recogía la auditoría.
- **El retorno nunca decide:** solo dispara una consulta de estado. Aunque el enlace venga alterado, lo peor que
  provoca es una consulta (y la app solo lo da por «este intento» si coinciden el id y el nonce).
- **Notificaciones:** campana, push y correo. Si el correo falla no se reintenta (la campana es lo principal).
- **No se tocó** `docs/design/client-parity-manifest.json`: ya estaba desfasado antes de esta fase (47 páginas web en el
  manifiesto frente a 70 en disco) y ninguna prueba exige que esté al día.

## Lo que NO se pudo probar aquí

- **Verlo.** No hay sesión de cliente (el proyecto de Supabase de los `.env` ya no existe), así que la pantalla web no
  se abrió en un navegador ni la app en un teléfono o simulador. Lo que sí hay: render del servidor de la web en cada
  estado (`tests/identidad-render.test.ts`), guardas de código fuente de web y app, y tipado de la app en una copia
  aislada con sus dependencias (sin errores en lo nuevo).
- **La cámara en el navegador del sistema** (iOS SFSafariViewController, Android Custom Tabs): es lo esperado por la
  documentación, no está comprobado en un dispositivo.
- **El diseño final.** Usa los primitivos y tokens del sistema (sin hexadecimales ni paleta cruda; el auditor de
  diseño no sube), pero conviene que alguien la mire y la ajuste a ojo.

## Pruebas

- `tests/identidad-vista.test.ts` — la vista en cada estado, privacidad, permisos, errores, avisos y correo (17).
- `tests/politicas-identidad.test.ts` — la política pública dice lo que hace el sistema (7).
- `tests/identidad-pantalla-app.test.ts` — la app y la web no deciden; los tipos de la app son los de la API (15).
- `tests/identidad-render.test.ts` — la pantalla web se pinta en cada estado (10).
- `tests/postgres/identidad-puerta.db.test.ts` — la puerta contra PostgreSQL con el Didit falso (18).
- `tests/identidad-guardas.test.ts` — ampliado (incidencias, avisos, rutas).
- Por mutación: aceptar cualquier versión del texto, no comprobar el intento de la incidencia, quitar el límite,
  quitar la deduplicación del aviso, seguir ofreciendo empezar con la verificación apagada y meter el texto de la
  persona en el correo a soporte rompen una prueba concreta.

## Configuración que esto añade al proveedor

Además de lo de la Fase 2: en el flujo de Didit, **edad mínima de 18 años** (la política dice que solo pueden
verificarse mayores de 18; si el flujo no la exige, la política promete algo que el sistema no impone).

## Pendiente (siguientes fases y del dueño)

- Fase 4: panel del equipo (cola de `en_revision` e incidencias, revocar, supresión, interruptor, auditoría).
  La cola de incidencias ya existe y se llena; falta quién la resuelva (`resueltaAt`/`resueltaPorId`).
- Fase 5: reglas por función (qué operaciones piden verificación y por qué).
- **Legal, del dueño:** el texto de los permisos y la sección 7 de `/privacy` son borrador hasta el dictamen sobre
  Ley 4-23 arts. 58–60 y el contrato con el proveedor; **no se activa con documentos reales antes**.
