# Pago con tarjeta — CardNET tokenizado

## Billetera de tarjetas guardadas

El usuario confirma que CardNET ya opera correctamente en producción para
Membego. Los checkouts web y móvil permiten elegir una tarjeta guardada en
pagos puntuales de membresías y promociones. El servidor verifica propietario,
empresa, perfil vigente y estado de eliminación; consulta el perfil vigente a
CardNET y cobra dentro de la misma sesión e intento auditable del flujo actual.
La petición conserva el identificador de compra único para idempotencia y los
resultados inciertos se concilian consultando CardNET antes de informar el
estado final. No se prueba con cargos reales en este cambio.

Membego conserva metadatos permitidos y el token del proveedor cifrado con
AES-256-GCM; nunca almacena PAN o CVV. Las sesiones registran el consentimiento
para guardar la tarjeta separado del consentimiento de renovación. Pagar con
una credencial guardada es una compra iniciada expresamente por el cliente y no
activa ni modifica `autoRenovar`.

La migración `20261074_cardnet_saved_cards_security` añade cifrado, tarjeta
predeterminada y estado de eliminación pendiente. La variable
`CARDNET_VAULT_KEY`, si se usa para los tokens de la bóveda, debe ser una llave
privada base64 de 32 bytes, estable entre despliegues y nunca exponerse con
prefijo `NEXT_PUBLIC_`. Si la base conserva tokens históricos en claro, el
operador debe confirmar si ya se ejecutó el backfill antes de completar el
retiro de esos valores. El script controlado está en
`scripts/cardnet/cifrar-tokens-historicos.ts`.

[Guía oficial de tokenización y autenticación de CardNET](https://developers.cardnet.com.do/guias/tokenizacion-autenticacion/).

Estado revisado el **2026-10-19**. El flujo tokenizado de pagos puntuales cubre membresías y compras de promociones en la API móvil. El checkout de MembegoOrder y Supply no incorporan esta pasarela.

## 1. Frontera de seguridad y retiro del flujo directo

- La UI web activa es `PagoTokenCardnet`; Expo consume el BFF `/api/v1/cliente/pagos/cardnet/*`. La captura prevista ocurre en la superficie hospedada del proveedor; Membego opera con tokens, importe del servidor y activación idempotente.
- La habilitación real depende de `PAGO_CARDNET`, configuración de pasarela y rechazo de empresas demo. **No hay una restricción de identidad hardcodeada a CARTOWN** en la orquestación. CARTOWN es el piloto histórico, no una garantía de autorización.
- Antes de esta limpieza, `POST /api/pagos/cardnet/iniciar` y `completar` sí aceptaban PAN/CVV de un cliente autenticado. Su formulario `PagoTarjetaCardnet` no tiene consumidores en el árbol revisado. No era correcto describir estas rutas como inactivas ni afirmar ausencia absoluta de PAN en el servidor.
- Ahora `iniciar`, `completar` y el retorno GET/POST responden **410 Gone**, sin leer cuerpo, URL ni sesión, sin persistir ni contactar CardNET. Se conserva esa respuesta para enlaces/clientes antiguos, que deben volver al pago tokenizado. No se redirigen cuerpos de pago.
- Se mantienen los helpers legacy porque `cardnetToken.ts` y `cardnetClienteObjetivo.ts` comparten `montoDeObjetivo` desde `cardnet3ds.ts`. Eso no autoriza reactivar el cobro directo. Su redacción histórica era superficial y había respuestas crudas persistibles; detalles en [CODEX_ONBOARDING_AUDIT.md](CODEX_ONBOARDING_AUDIT.md).
- Sentry descarta `request.data`; la política compartida también se aplica en Edge. No se inspeccionaron datos/logs históricos ni la infraestructura del proveedor de hosting. No puede concluirse que nunca hubo almacenamiento accidental.

Pruebas: `tests/cardnet-legacy-retirado.test.ts`, `tests/e2e/cardnet-legacy.spec.ts`, `tests/observabilidad.test.ts` y suites existentes de CardNET tokenizado. No hubo pago real ni uso de credenciales QA. El cumplimiento PCI y el cuestionario aplicable requieren validación con el adquirente; no se certifican por una revisión de código.

Las secciones siguientes conservan la guía del piloto e investigación de protocolos; sus hipótesis no sustituyen documentación del proveedor ni una prueba QA.

## 2. Cómo funciona un cobro

```
Cliente (pantalla de compra CARTOWN) → clic "Pagar RD$X con tarjeta"
        │
        ▼  se abre el IFRAME de CardNET (con la LLAVE PÚBLICA)
   el cliente digita la tarjeta EN CARDNET
        │
        ▼  CardNET devuelve un TOKEN al navegador (callback tokenCreated)
   el navegador manda SOLO el token → POST /api/pagos/cardnet-token/cobrar
        │
        ▼  el servidor cobra: POST /api/Purchase con el token + LLAVE PRIVADA
   response aprobado → confirmarIntento activa la membresía (una sola vez)
```

### Las piezas en el código

| Archivo | Qué es |
|---|---|
| `src/lib/payments/cardnet-tokens-core.ts` | Lógica pura: URLs por ambiente, monto en centavos, interpretación de la respuesta, redacción. Testeable. |
| `src/lib/payments/cardnet-tokens.ts` | Capa de servidor: config (llaves) + el `Purchase`. `server-only`. |
| `src/modules/pagos/cardnetToken.ts` | Orquestación: monto desde la base, guardas, activación idempotente. |
| `src/app/api/pagos/cardnet-token/cobrar` | Recibe el token, cobra, activa. |
| `src/components/membresia/PagoTokenCardnet.tsx` | Abre el iframe de CardNET y maneja el token. Nunca toca la tarjeta. |

---

## 3. Qué te toca configurar

### Variables de entorno (en Vercel, nunca en el repositorio)

```
CARDNET_TOKENS_PUBLIC_KEY    # va al navegador (abre el iframe)
CARDNET_TOKENS_PRIVATE_KEY   # SECRETO — cobra en el servidor
CARDNET_TOKENS_AMBIENTE      # 'pruebas' | 'produccion'
```

Los de QA (juego CON autenticación 3DS) están en `.env.example`. Los de
producción los entrega tu ejecutivo de cuenta de CardNET.

### Encender la pasarela para CARTOWN

Enciende la capacidad `PAGO_CARDNET` para CARTOWN desde el superadmin
(`/superadmin/capacidades`). Sin capacidad, o sin las dos llaves, la opción de
tarjeta no aparece y el cliente solo ve "pagar en sucursal".

---

## 4. El contrato, confirmado contra el manual oficial

> **Nota sobre la autenticación.** Las dos fuentes de CardNET se contradicen:
> el **§2.4** dice que la llave va «como el dato de *username* de Basic
> Authentication (sin necesidad de informar *password*)», que sería
> `base64(llave + ":")`; la **colección Postman de CardNET** envía la llave
> **cruda** tras `Basic`. Como no se resuelve leyendo, el servidor prueba las
> grafías en orden —cruda primero, que es la que usa su propia herramienta— y
> fija la que el proveedor acepte. Confirmarlo en la certificación permite
> dejar una sola.

Todo lo de abajo está verificado contra el **MANUAL TÉCNICO DE TOKENIZACIÓN
v1.7**, el Postman y el HTML de ejemplo que entregó CardNET. Ya no son
suposiciones: cada punto tiene su sección, y una prueba que lo fija.

| Qué | Valor | Fuente |
|---|---|---|
| Base de pruebas | `https://lab.cardnet.com.do/servicios/tokens/v1` | §11.1 |
| Base de producción | `https://servicios.cardnet.com.do/servicios/tokens/v1` | §11.2 |
| API REST | `{base}/api/{objeto}` | §6.1 |
| Ventana de captura | `{base}/Capture` | §11 |
| Script del widget | `{base}/Scripts/PWCheckout.js` | §11 |
| Autenticación | `Authorization: Basic {llavePrivada}` (cruda) | Postman · el §2.4 dice «como username de Basic» (ver nota) |
| Activación de perfil | `{ Token, ActivationCode }` — ambos mandatorios | §7.5 · Postman |
| Campo del token | **`TokenId`** | §7.1 |
| Callback del widget | `tokenCreated` | §3.3 |
| Abrir el iframe | `OpenIframeCustom(captureUrl + "?key=" + publicKey + "&session_id=" + uniqueId, uniqueId)` | §4.1.2.2 |
| `Amount` | Entero, parte entera + 2 decimales sin punto (RD$100 → `10000`) | §10.4 |
| `Currency` | `String[3]` alfanumérico ISO-4217 → `DOP` | §7.2 |
| `UniqueID` | `String[50]` opcional — clave de idempotencia | §2.6 · §7.2 |
| Vida del token | Un solo uso, **10 minutos** | §4.1.1 |
| Estado de la transacción | 1 Approved · 2 Pending · 3 Preauthorized · 4 Rejected | §10.6 |

### La regla que sostiene todo el flujo

**El script del widget y la ventana de captura tienen que estar en el MISMO
origen.** El token vuelve del iframe a la página por `postMessage`; si el SDK
se sirve desde un dominio y el iframe desde otro, el token no cruza — el
cliente digita su tarjeta, no pasa nada, y no queda rastro en ninguna parte.

Por eso el script se **deriva** del `CaptureURL` que devuelve CardNET
(`scriptDesdeCaptura()`) en vez de configurarse aparte: así no pueden
desalinearse. El §3.1 del manual además prohíbe cargar la librería desde un
host que no sea de CardNET.

### Tarjeta de prueba

Del ejemplo de `TokenRequest` del manual (§5, p. 18):

| Campo | Valor |
|---|---|
| Número | `4111 1111 1111 1111` |
| CVV | `123` |
| Expiración | cualquier fecha futura |

### QUÉ PANTALLA ES DE QUIÉN (y por qué se confunden)

Hay **dos** momentos en los que el cliente teclea algo, y son de dueños
distintos. Confundirlos lleva a conclusiones opuestas —«quitemos nuestra
pantalla, eso lo hace CardNET» o «pidamos el OTP nosotros»— y las dos rompen
algo, así que queda escrito:

| Pantalla | De quién | Qué se teclea | Por qué |
|---|---|---|---|
| Ventana de captura | **CardNET** (iframe) | Número, CVV, expiración, y el **3DS** del emisor | La captura hospedada evita que esta UI envíe PAN al backend; no certifica por sí sola el alcance PCI. `cardnetToken.ts` lo dice: «no hay 3DS que orquestar (lo hace el iframe)» |
| Código de activación | **NUESTRA** | Los 6 caracteres del cargo de RD$1.00 | CardNET **no hospeda ninguna** para esto: su API nos exige mandarle el `ActivationCode` (§7.5) |

**La prueba de que la segunda es nuestra** está en el propio contrato: si
CardNET la mostrara, `POST /Customer/{id}/activate` no nos pediría el
`ActivationCode` — lo tendría él.

**Y el código de activación NO es un OTP de 3DS.** Esa es la raíz de la
confusión:

| | OTP de 3DS | Código de activación |
|---|---|---|
| Cómo llega | SMS del emisor, en segundos | **Descripción de un cargo** de RD$1.00 en el estado de cuenta |
| Dónde se teclea | Solo en la página del emisor | En nuestra pantalla |
| Cuándo está disponible | Inmediato | Cuando el cargo **se asienta** — puede tardar |

Los dos «los da el banco», y ahí acaba el parecido. Capturar un OTP de 3DS en
un formulario propio sí estaría mal: tiene forma de phishing y rompe el
traslado de responsabilidad al emisor. El código de activación no es eso — no
es PAN, no es CVV, no es la clave del banco: es un reto de un solo uso que ya
viajó por el estado de cuenta del propio cliente.

Que el código tarde en aparecer es lo que obliga a que la pantalla se pueda
**abandonar y retomar**: ver `GET /api/pagos/cardnet-token/pendiente` y el
aviso «Tienes una tarjeta esperando su código».

### Los DOS juegos de llaves NO son intercambiables

CardNET entrega dos pares, y cambian el flujo, no solo las credenciales:

| | SIN autenticación | CON autenticación (3DS) |
|---|---|---|
| Tras capturar la tarjeta | El token queda **activo solo** (§3.1.2 operativo) | El perfil nace `Enabled: false` (§4.1.2.2 p.12) |
| Paso extra | Ninguno | CardNET cobra **RD$1.00** y el banco muestra un código de 6 dígitos (`Cardnet:Z2R78V`) que el cliente debe ingresar (§4.1.2.3) |
| Reintentos | — | 3; al tercero CardNET **borra la tarjeta** |
| ¿Implementado aquí? | Sí, completo | **Sí** (12-08-2026): pantalla de activación + `POST /Customer/{id}/activate` |

**Decisión de producción tomada: las llaves son CON autenticación (3DS).**

Cómo funciona: cuando el sondeo encuentra el perfil deshabilitado
(`pendiente_activacion`), la pantalla de pago muestra el campo del código. El
cliente pega lo que ve en su banco («Cardnet:Z2R78V» entero vale — el servidor
lo normaliza en `normalizarCodigoActivacion` ANTES de gastar un intento), y el
servidor activa y **cobra en el mismo movimiento** (`activarTarjetaPendiente`
→ `cobrarPendienteConPerfil`, la misma tubería idempotente). Si CardNET
rechaza el código, el mensaje advierte de los 3 intentos; si el perfil
desapareció (tercer fallo), se le pide registrar la tarjeta de nuevo.

### Dos disparadores de la pantalla del código (19-08-2026)

La pantalla del código de activación es NUESTRA — vive en
`src/components/membresia/PagoTokenCardnet.tsx`, estado `activacion` — y se
abre cuando el servidor lo dice. Ahora tiene **dos** disparadores, no uno:

| Disparador | De dónde sale | Cuándo sirve |
|---|---|---|
| `Enabled: false` en el perfil | `GET /Customer/{id}` → `extraerPerfiles` | Cuando el listado trae el campo |
| **Error `CS012`** en el `Purchase` | `interpretarCompraToken` → `exigeActivacionPrimero` | Siempre que se intente cobrar |

`CS012` (`PROFILE_MUST_BE_ACTIVATED_FIRST`, tabla §9.1) es la fuente más
fiable de las dos: `Enabled` es un campo «Solo Lectura» (§7.4) que puede no
venir en una respuesta, y cuando no viene el parser asume **habilitado** —a
propósito, para que un campo ausente no bloquee un cobro que sí habría
pasado—. Con solo ese disparador, el caso «el campo no vino» terminaba en un
callejón: se intentaba cobrar, CardNET respondía `CS012`, y al cliente le
salía «no se pudo procesar el pago» **con el código de su banco en la mano y
ningún lugar donde escribirlo**. El error no es un campo opcional: es la
respuesta explícita del servicio a esa pregunta exacta.

Un rechazo del emisor (fondos, tarjeta vencida) **no** abre esa pantalla:
mandaría al cliente a buscar un código que no existe. Fijado en pruebas.

### El contrato del `activate`, fijado (18-08-2026)

El cuerpo es el objeto **`CustomerActivation`** del manual §7.5, con **dos
campos, ambos mandatorios**:

```json
{ "Token": "CT__jCqoIyEqOcig7RUCF_xdtYdV1XcdO50S_XyX93vTsE0_",
  "ActivationCode": "Z2R78V" }
```

| Campo | Descripción | Presencia |
|---|---|---|
| `Token` | Identificador del Token asociado al perfil que se desea activar | Mandatorio |
| `ActivationCode` | Código de activación recibido por el cliente | Mandatorio |

Dos fuentes independientes lo confirman: la tabla del **§7.5** del manual
técnico v1.7 y la petición `ActivacionPayment` de la **colección Postman** de
CardNET, que envía exactamente esos dos campos.

> **Corrección**: antes se enviaban tres grafías del código a la vez y el
> `PaymentProfileId` en lugar del `Token`. Nunca llegó a probarse contra el
> proveedor; de haberse probado habría fallado siempre, porque faltaba el único
> identificador que el servicio exige. Los campos que sobraban no eran el
> problema — el que faltaba, sí.

### Cómo fijar el contrato SIN pasar por la pantalla de pago (sonda `?activar`)

La ruta de diagnóstico `/api/pagos/cardnet-token/estado` tiene una sonda
dedicada a la activación (logueado, en el deploy que se quiere probar):

1. Registrar la tarjeta de prueba en la ventana de captura (es el único paso
   que no puede saltarse: el PAN solo entra por la página hospedada de
   CardNET). El perfil queda `Enabled: false`.
2. `GET /api/pagos/cardnet-token/estado?activar=1` — consulta pura, enseña
   los perfiles con su estado y cuál está pendiente. **No gasta intentos.**
3. `GET /api/pagos/cardnet-token/estado?activar=1&codigo=Z2R78V` — ejecuta la
   activación real contra el último perfil pendiente y devuelve el expediente
   completo: cuerpo enviado, status y respuesta cruda del `activate`, y la
   re-consulta (¿quedó `habilitado`?). **Un código incorrecto gasta 1 de los
   3 intentos.** A propósito no cobra después: aísla la pregunta del contrato.

Con ese expediente se decide: si el `activate` acepta el cuerpo combinado, se
deja UN solo campo (el que la respuesta confirme); si lo rechaza, el texto del
error dice qué esperaba.

### Cuando «el código no llega» (06-10-2026)

Síntoma: la tarjeta se registra sin problema en la ventana de CardNET, la
ventana se cierra, MembeGo enseña la pantalla «Verifica tu tarjeta» y el
código de 6 caracteres **nunca aparece**. CardNET confirma que la tarjeta
quedó registrada. Antes de tocar código, hay que tener claro **quién hace
cada parte**, porque la hipótesis natural —«MembeGo no está mandando bien el
último paso»— apunta al sitio equivocado.

#### Lo que dice CardNET, literalmente

La guía oficial de *Tokenización & Autenticación* del portal de
desarrolladores de CardNET (developers.cardnet.com.do) describe la activación
así:

> El comercio deberá mostrar al usuario los distintos medios de pago que
> tiene registrados, indicando cuando aplique que dicho medio de pago está
> deshabilitado y necesita ser «activado». El comercio deberá presentar al
> usuario un campo donde pueda ingresar el código de activación que recibió
> previamente (**el método de entrega de dicho código está fuera del alcance
> de esta documentación**). Una vez que el comercio obtiene el código de
> activación ingresado por el usuario, deberá hacer la llamada a la operación
> «Activate» de la API de Customer.

Tres consecuencias directas:

1. **La pantalla del código es del comercio, no de CardNET.** La ventana de
   captura de CardNET no pide el código y no lo va a pedir: su API nos exige
   mandárselo nosotros (`POST /Customer/{id}/activate`, §7.5). Mover el campo
   «al portal de CardNET» no es una opción que exista.
2. **MembeGo no envía el código al cliente.** No hay ningún paso de MembeGo
   que dispare un SMS, un correo o el cargo de verificación. Lo único que
   MembeGo manda a CardNET es: registrar el Customer (una vez), consultarlo
   (GET), cobrar (Purchase) y activar (activate, con el código que el cliente
   teclea). El código **lo entrega CardNET/el banco**, y ellos mismos dicen
   que cómo lo entregan está fuera de su documentación técnica.
3. **El mecanismo concreto —cargo de RD$1.00 con `Cardnet:XXXXXX` en la
   descripción— viene del manual PDF v1.7 §4.1.2.3**, no de la guía web. Es
   una configuración del producto *Autenticación* en la cuenta del comercio.
   Si esa configuración no está activa, o el ambiente no la ejecuta, el
   código no existe en ningún sitio y ninguna pantalla nuestra lo va a hacer
   aparecer.

#### Árbol de diagnóstico, en orden

| # | Pregunta | Dónde se mira | Si la respuesta es… |
|---|---|---|---|
| 1 | ¿El despliegue está en **pruebas**? | `/admin/metodos-pago` (recuadro «La tarjeta está en modo de pruebas») o `/api/pagos/cardnet-token/estado` → `ambiente` | **Sí** → es la causa. En laboratorio CardNET **no hace el cargo de RD$1.00** y el banco nunca muestra código. Poner `CARDNET_TOKENS_AMBIENTE=produccion` **con las llaves de producción** (las de lab dan 401 en producción). |
| 2 | ¿El perfil nace de verdad `Enabled: false`? | `/api/pagos/cardnet-token/estado?expediente=<correo del cliente>` (como administrador de la empresa) → `cardnet.perfiles[].habilitado`, `pendienteDeActivar`, `consultaCruda` e `intentos[]` con la respuesta cruda del Purchase | **No** (viene `true`) y aun así se pide código → el Purchase está devolviendo PR001/CS012 con un perfil habilitado: mandar `consultaCruda` + la fila de `pago_intentos.respuesta` a CardNET. |
| 3 | ¿CardNET ve la **transacción de verificación**? | Panel de comercio de CardNET / ejecutivo de cuenta, con el `CustomerId` y los últimos 4 | **No existe** → la cuenta no tiene el cargo de verificación configurado, o las llaves son del producto sin autenticación pero los perfiles nacen deshabilitados. Es de CardNET. |
| 4 | ¿El cliente miró el **movimiento**, no el SMS? | Pantalla «Verifica tu tarjeta» (ya lo dice) | El código va en la **descripción del cargo**, en la app del banco, y puede tardar horas en asentarse. No llega por mensaje. |

Las preguntas 1 y 2 se contestan desde MembeGo en un minuto. La 3 solo la
contesta CardNET, y es la que decide: **si CardNET no generó la transacción
de verificación, no hay código que esperar**.

#### Qué preguntarle a CardNET (texto para el ticket)

- «Para el Customer `NNNN` (correo del cliente), perfil terminado en `XXXX`,
  registrado el `fecha`: ¿se generó la transacción de verificación (RD$1.00)
  asociada a la activación del PaymentProfile? ¿Con qué descripción y en qué
  estado quedó?»
- «¿Las llaves que tenemos en producción son del producto **con
  autenticación** (perfil nace `Enabled=false` y requiere `activate`) o
  **sin autenticación** (perfil nace habilitado)? Nuestros perfiles nacen
  deshabilitados.»
- «¿Cuál es el método de entrega del código de activación para nuestra cuenta?
  La guía web lo deja fuera de alcance; el manual v1.7 §4.1.2.3 habla del
  cargo de RD$1.00.»

Con la respuesta de `?expediente=<correo>` (`consultaCruda` sin tokens, el
`CustomerId` y los intentos con su respuesta cruda) el ticket se contesta en
una vuelta. Las sondas `?perfiles=1` y `?activar=1` miran el Customer de
**quien está logueado**: si entras como administrador te dirán
`customerId: null`, y eso no significa que el cliente no tenga tarjeta.

#### Lo que sí se cambió en MembeGo por este caso

- El ambiente de la pasarela se ve en el **panel de métodos de pago** de la
  empresa (`EstadoPasarelas`), con un aviso claro cuando es de pruebas. Antes
  solo estaba en una variable de Vercel y en la sonda de la API.
- El aviso de pruebas también sale en el banner «Tienes una tarjeta esperando
  su código», no solo dentro de la pantalla de activación (ya estaba ahí
  desde el 28-09-2026).

### Móvil: la tarjeta queda registrada y la app nunca cobra (12-10-2026)

**Síntoma.** CardNET confirma que la tarjeta se registró bien (el `Customer` trae su `PaymentProfile`, `Enabled: true`), pero
el pago desde la app nunca avanza: la pantalla se queda en «Completa el formulario dentro de CardNET» hasta que la sesión
vence a los 10 minutos. En la base, 18 sesiones seguidas de `cardnet_capture_sessions` quedaron en `CAPTURE_OPEN` (ninguna
con `capturadoAt`) y no hubo ni un `pago_intentos` móvil. **Era nuestro, no de CardNET.**

**Por qué.** El flujo móvil tenía UNA sola salida de `CAPTURE_OPEN`: que la app mandara `POST /confirmar` cuando el formulario
de CardNET le entregaba el token. Y `GET /estado` contestaba «pendiente» sin mirar a CardNET. Si la señal del formulario se
perdía, la tarjeta existía en CardNET y nadie lo averiguaba. La web no tiene ese punto único: su sondeo le pregunta al
servidor, y el servidor consulta los perfiles del Customer. Y la señal de la app se perdía en silencio por tres sitios:

| Dónde | Qué pasaba |
|---|---|
| Reconocer la ventana (`captureDocument.native.ts`, `security.ts`) | Solo aceptaba un iframe cuya dirección tuviera EXACTAMENTE `key` y `session_id`. El widget añade a esa dirección lo que se le configura (`Capture/?key=…&name=…`), y la web ya lo documentaba: la app no reconocía su propia ventana. |
| Leer el token | Solo `{ TokenId }` en un objeto plano. La web ya había tenido que aceptar texto suelto, JSON en texto y objetos envueltos. |
| Entregarlo | Exigía además un mensaje previo del iframe, y que el iframe SIGUIERA en el documento: el widget cierra su ventana ANTES de entregar el token, y su `Iframe.Close` puede reventar a medias (fallo conocido que la web ya blinda). |

No se pudo ver el iframe real desde un teléfono, así que cuál de las tres era la que fallaba en producción no está
demostrado; las tres eran un riesgo real y están cerradas. Lo importante es que el servidor ya no depende de ninguna.

**Qué cambió.**

1. **El servidor reconcilia (la pieza principal).** Con la captura abierta, cada `GET /estado` puede consultar al Customer
   (como mucho una vez cada 2 s por sesión) y, si CardNET muestra UN perfil que no estaba al abrir la sesión —con el correo
   del usuario verificado—, la consume y sigue hasta el cobro por la misma tubería que `/confirmar`
   (`reconciliarCapturaAbierta` en `cardnetClienteAcciones.ts`). El `token` de `/confirmar` nunca se usó para cobrar (el
   cobro lee el perfil de CardNET), así que esta señal solo decide CUÁNDO mirar, no QUÉ cobrar: no es menos segura. Re-valida
   objetivo, importe y consentimiento, igual que `/confirmar`; dos sondeos simultáneos cobran una vez. Reutiliza el perfil
   que ya leyó (no se lo vuelve a pedir a CardNET) y sigue por `advanceWithProfile`, el mismo tramo que `progressCapture`.
   Y si CardNET todavía no lista el perfil (o la lectura falla) tras consumir, la sesión vuelve a `CAPTURE_CONSUMED` para que
   el PRÓXIMO sondeo reintente de inmediato: antes se quedaba 45 s en `PROFILE_PENDING` por el arriendo de
   `claimProfileCheck`, y el sondeo de la app (18 × 2,5 s) casi se acababa antes. Una captura consumida que lleva 5 minutos sin
   perfil, sin perfil elegido y sin intento de cobro se expira y **libera la reserva** del cliente (`expireConsumedWithoutProfile`,
   atómica: no puede expirar un cobro que empezó después de leerla); sin eso, un aviso que no era de una tarjeta dejaba al cliente
   sin poder abrir otro pago.
2. **La app pregunta mientras el servidor no haya dicho nada** (`Capture.tsx`, cada 3,5 s, también con un error de captura a
   la vista y mientras se envía el token). `/estado` marca el `pending`: `capture: 'open'` = el servidor sigue esperando la
   tarjeta; `capture: 'closed'` = ya se capturó y el pago avanza. Hay DOS valores a propósito: sin marca (un servidor que no
   la manda) la app no cierra el formulario, porque cerrarlo por error rompería todos los pagos; así se puede desplegar app y
   servidor en cualquier orden. Un fallo de red no cambia nada en pantalla (no se pierde lo que el cliente ya tecleó).
   La decisión de qué hacer con cada respuesta es una función pura (`decideCaptureStatus`, `security.ts`): aceptar un
   resultado, ignorar una respuesta atrasada (nunca pisa un resultado ya conocido) o **volver a armar el formulario** cuando el
   token ya se entregó, `/confirmar` no avanzó y el servidor sigue sin ver la tarjeta. Esa última rama cierra una carrera real:
   el token de la app y un sondeo coincidían, `/confirmar` respondía 409 («el servidor ya avanzó»), la consulta de respaldo se
   descartaba por haber otra en vuelo y la pantalla se quedaba con el formulario reabierto, sin entrega y sin sondeo.
3. **Puente tolerante.** Ventana reconocida con cualquier parámetro extra (origen, ruta, `key` y `session_id` siguen fijos y
   se exigen UNA vez); token en cualquier forma conocida; entrega aunque el iframe ya se haya cerrado, con tal de haber visto
   la ventana correcta abrirse; `Iframe.Close` blindado; y plan B que lee el campo oculto `PWToken`. El texto del puente
   vive en `pageHelpers.ts` y una prueba lo EJECUTA y lo compara con las versiones de TypeScript.
4. **`/estado` ya no se corta solo.** Usaba el límite de los cobros (10/min) y el sondeo de la app (cada 2,5 s) lo agotaba:
   el 429 se leía como «no pudimos confirmar». Pasa al de lecturas (30/min, `paymentSessionLimiter`); confirmar, activar y
   cobrar conservan el estrecho (lo fija una prueba).
5. **Rastro.** Una captura que vence sin que nadie avise deja una línea
   `[pagos:cardnet-cliente] captura vencida sin confirmar`, y una recuperada por el servidor, `captura recuperada por el
   servidor` (esa línea es la señal de que el puente de la app sigue fallando: si aparece, hay que mirar el iframe real).

**Lo que NO está verificado.** Todo se probó con simulaciones: el servidor contra un CardNET de mentira y la WebView contra un
SDK y un DOM de mentira. Falta una prueba en un teléfono real (Android e iOS) con una tarjeta de verdad. (Lo que se temía aquí
—que la WebView no dejara pasar el 3DS del banco— pasó en Android el 14-10-2026; ver la sección siguiente: la app ya no usa
WebView para el formulario.)

**La tarjeta de prueba que ya quedó registrada.** El Customer ya tiene su perfil, así que el próximo intento lo toma como
«anterior» y espera uno NUEVO. CardNET crea un perfil por cada captura, de modo que basta repetir la captura. La membresía
sigue `PENDIENTE` hasta que un cobro apruebe.

**Cómo comprobar que funciona.** Pagar con la app y mirar `cardnet_capture_sessions`: la sesión debe pasar de
`CAPTURE_OPEN` a `CAPTURE_CONSUMED` (con `capturadoAt`) y aparecer un `pago_intentos` con `cardnetUniqueId`.

### Móvil: «la autenticación falló» dentro del formulario de CardNET (14-10-2026)

**Síntoma.** En la app de Android, CardNET mostraba «la autenticación falló» DENTRO de su formulario a las tarjetas cuyo
banco pide la verificación 3D Secure; otras tarjetas (las que el banco aprueba sin pedir nada) sí se registraban. La MISMA
tarjeta se registraba bien en membego.com desde Chrome en el mismo teléfono. Es decir: el fallo era de la WebView, no del
banco ni de CardNET.

**Por qué la WebView.** El reto 3DS del banco se pinta en un marco de NUESTRA página y el formulario que lo abre hace POST a
la pasarela (lo dice la CSP de `next.config.ts`); además el banco puede abrir ventanas y usar sus cookies. Un navegador lo da
todo; la WebView de la app no (ventanas emergentes bloqueadas, navegación restringida a CardNET, sin `Referer`, documento
armado en memoria). Imitar Chrome dentro de la WebView era perseguir el síntoma.

**Arreglo.** La app ya no pinta el formulario en una WebView: abre en el navegador del sistema (pestaña de Chrome en
Android, Safari en iPhone, con `expo-web-browser` · `openAuthSessionAsync`) una ventana que sirve el servidor:

| Pieza | Dónde |
|---|---|
| Ventana (HTML: SDK oficial, mismos `SetProperties` que la web, puente del token) | `src/modules/pagos/cardnetVentanaHtml.ts` |
| Quién puede abrirla | `src/modules/pagos/cardnetVentana.ts` |
| Ruta | `GET /api/v1/cliente/pagos/cardnet/ventana?s=<sessionId>&n=<nonce>` |
| Botón en la app | `apps/client/src/components/pagos/cardnet/CaptureSurface.native.tsx` |
| Vuelta a la app | `membego://pago-cardnet?s=…&t=…` (`CARDNET_WINDOW_RETURN_URL`; `app/+native-intent.tsx` evita que el router navegue con ella) |

- La pestaña no tiene la sesión de la app: se abre con el id de la sesión de captura **y su nonce** (la base guarda el hash),
  solo si la captura está ABIERTA y sin vencer, y con la URL de captura, el script y la llave pública del ambiente
  configurado. Cualquier otra cosa da la misma página «ya no está disponible» (404), sin oráculo. Límite por IP.
- Lo que la página enseña (llave pública, `UniqueID`, `CaptureURL`, monto) ya se le entregaba a la app. Cobrar sigue
  exigiendo la sesión autenticada de la app (`/confirmar` con el nonce) o lo decide el servidor viendo el perfil nuevo.
- Al entregar CardNET el token, la ventana vuelve a la app con él y la app lo confirma como antes. Si la vuelta se pierde
  (el cliente cierra la pestaña), el sondeo de `/estado` encuentra la tarjeta nueva en CardNET y avanza
  (`reconciliarCapturaAbierta`, 12-10-2026).
- Se retiraron el documento de la WebView (`captureDocument.native.ts`, `pageHelpers.ts`), su política de navegación y sus
  diagnósticos, y la variable `EXPO_PUBLIC_CARDNET_MERCHANT_ORIGIN`. La versión web de la app (`CaptureSurface.web.tsx`) no
  cambia.
- `expo-web-browser` es un módulo nativo: el arreglo llega a los teléfonos con un **build nuevo** de la app. La ruta del
  servidor tiene que estar desplegada antes de repartir ese build.

Pruebas: `tests/cardnet-ventana-navegador.test.ts` ejecuta la ventana real contra un SDK y un DOM simulados (abre con los
parámetros de la web, entrega el token en todas sus formas, plan B, `Close` que revienta, sin SDK, datos hostiles) y fija la
vuelta a la app y el router; `tests/postgres/cardnet-capture-reservation.db.test.ts` fija quién puede abrirla.

### Lo que solo confirma un cobro real

- [ ] Un cobro aprobado de punta a punta, con la consola del navegador abierta.
- [ ] Que `pago_intentos.respuesta` guarde la respuesta cruda del Purchase.

---

## 5. Lo que NO cambió

- **Pago en efectivo en la sucursal**: intacto, siempre disponible.
- **Transferencia**: sigue donde esté encendida (se apaga por capacidad).
- **Otras empresas**: nunca ven la opción de tarjeta.

---

## 6. Renovaciones automáticas

Las compras puntuales pueden guardar el perfil solamente con consentimiento
explícito y usarlo cuando el cliente inicia otro pago. Ese consentimiento no
autoriza cobros futuros. La renovación automática sigue siendo una función
independiente, bajo el consentimiento y las reglas ya existentes de Membego;
esta implementación no la activa ni amplía su alcance.

Endpoints CardNET relacionados: `POST /api/Customer`,
`POST /api/Customer/{id}/activate` y
`POST /api/Customer/{id}/PaymentProfileDelete`.
