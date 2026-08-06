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
| Autenticación | `Authorization: Basic {llavePrivada}` (cruda) | §2.4 · Postman |
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

### Los DOS juegos de llaves NO son intercambiables

CardNET entrega dos pares, y cambian el flujo, no solo las credenciales:

| | SIN autenticación | CON autenticación (3DS) |
|---|---|---|
| Tras capturar la tarjeta | El token queda **activo solo** (§3.1.2 operativo) | El perfil nace `Enabled: false` (§4.1.2.2 p.12) |
| Paso extra | Ninguno | CardNET cobra **RD$1.00** y el banco muestra un código de 6 dígitos (`Cardnet:Z2R78V`) que el cliente debe ingresar (§4.1.2.3) |
| Reintentos | — | 3; al tercero CardNET **borra la tarjeta** |
| ¿Implementado aquí? | Sí, completo | **No.** Falta la pantalla de activación y la llamada `POST /Customer/{id}/activate` |

Hoy el código **detecta** el perfil deshabilitado y le explica al cliente qué
pasó (`estado: 'pendiente_activacion'`), en vez de intentar un cobro que iba a
fallar sin decir por qué. Pero no puede completarlo: eso requiere la pantalla
de activación.

**Para probar y certificar: usa el juego SIN autenticación.** La decisión de
producción (menos fricción vs. más protección antifraude) está abierta.

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
