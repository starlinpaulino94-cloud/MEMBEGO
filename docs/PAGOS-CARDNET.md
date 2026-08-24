# Pago con tarjeta — CardNET (tokenización HOSPEDADA)

Cobro con tarjeta para las membresías de **CARTOWN** (y solo CARTOWN). Convive
con el pago en efectivo en sucursal, que no cambia.

---

## 1. El modelo, y por qué es el seguro

CardNET captura la tarjeta en **su propia página** (un iframe servido por
`*.cardnet.com.do`). El cliente digita el número **en CardNET**, y a nosotros
solo nos llega un **token**. **El número de tarjeta nunca pasa por el servidor
de MembeGo.** Ese es el modelo de **menor alcance PCI (SAQ A)**: no se puede
filtrar de nuestra base lo que nunca la toca.

> Antes existió una integración DIRECTA (SAQ D, la tarjeta pasaba por nuestro
> servidor). Se descartó a favor de esta. El código directo se conserva en
> pausa (`cardnet-core.ts` / `cardnet.ts` / `cardnet3ds.ts` y sus rutas) pero
> **no se usa**; el flujo activo es el de tokens.

### Lo que el código garantiza

- **La tarjeta nunca llega al servidor.** Solo el token. No hay PAN ni CVV en
  ninguna parte de MembeGo.
- **La llave privada es un secreto de servidor.** Va en `Authorization: Basic`
  desde el servidor, nunca al navegador, nunca a la base, nunca a un log
  (`sinSensibles()` enmascara tokens en la evidencia).
- **El monto sale de la base, nunca del navegador.** El cliente dice QUÉ paga
  (una membresía por id); cuánto se cobra lo lee el servidor (`montoDeObjetivo`).
- **Solo CARTOWN cobra.** Capacidad `PAGO_CARDNET` encendida + no ser empresa
  demo — comprobado en la orquestación, no solo en la UI.
- **Idempotencia.** La activación (`confirmarIntento`) ocurre una sola vez
  aunque el cliente recargue o haga doble clic.

### Lo que sigue siendo tuyo

- Firmar el **autocuestionario SAQ A** anual ante tu adquiriente (mucho más
  liviano que el SAQ D).
- Mantener el servidor parcheado y las llaves fuera de todo lo versionado.

---

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
| Ventana de captura | **CardNET** (iframe) | Número, CVV, expiración, y el **3DS** del emisor | Nunca vemos el PAN: es lo que nos mantiene en **SAQ A**. `cardnetToken.ts` lo dice: «no hay 3DS que orquestar (lo hace el iframe)» |
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

### Lo que solo confirma un cobro real

- [ ] Un cobro aprobado de punta a punta, con la consola del navegador abierta.
- [ ] Que `pago_intentos.respuesta` guarde la respuesta cruda del Purchase.

---

## 5. Lo que NO cambió

- **Pago en efectivo en la sucursal**: intacto, siempre disponible.
- **Transferencia**: sigue donde esté encendida (se apaga por capacidad).
- **Otras empresas**: nunca ven la opción de tarjeta.

---

## 6. Fase 2 (pendiente): cobros recurrentes

Esta fase (cobro único) NO guarda el token. Para membresías con renovación
automática mensual, la Fase 2 guardará el `Customer`/token de CardNET y una
automatización mandará el `Purchase` cada período — la lógica de recurrencia es
nuestra (así lo confirmó CardNET). Endpoints ya conocidos del Postman de
tokenización: `POST /api/Customer`, `POST /api/Customer/{id}/activate`,
`POST /api/Customer/{id}/PaymentProfileDelete`.
