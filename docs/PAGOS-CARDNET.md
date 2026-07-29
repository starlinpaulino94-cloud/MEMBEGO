# Pago con tarjeta — CardNET (integración directa 3DS)

Cobro con tarjeta para las membresías y compras de **CARTOWN** (y solo CARTOWN).
Convive con el pago en efectivo en sucursal, que no cambia.

---

## 1. La decisión que hay detrás, y lo que asumes

CardNET en República Dominicana **solo ofrece integración directa**: el número
de tarjeta y el CVV pasan por el servidor de MembeGo camino a CardNET. No hay
página hospedada. El dueño de CARTOWN eligió este camino **a conciencia**,
sabiendo que pone al comercio en el alcance PCI-DSS más exigente (**SAQ D**).

### Lo que el código garantiza (la parte que sí se puede resolver con software)

- **La tarjeta nunca se guarda.** Ni el PAN ni el CVV se escriben en la base de
  datos, ni en `localStorage`/`sessionStorage`, ni en la URL. Existen solo en
  memoria: en el navegador mientras el cliente paga, y en el servidor el
  instante que dura la llamada a CardNET.
- **La tarjeta nunca se registra.** Ningún `console`/Sentry de la capa de pago
  escribe PAN ni CVV. Todo lo que se loguea pasa por `sinTarjeta()`, que
  enmascara el PAN a los últimos 4 y borra el CVV. Hay pruebas que lo fijan
  (`tests/cardnet.test.ts`).
- **`import 'server-only'`** impide que la capa de pago llegue al navegador.
- **El monto sale de la base, nunca del navegador.** El cliente dice QUÉ paga
  (una membresía/compra por id); cuánto se cobra lo lee el servidor.
- **Solo CARTOWN cobra.** Se exige la capacidad `PAGO_CARDNET` encendida y que
  no sea empresa demo — comprobado en la orquestación, no solo en la UI.

### Lo que sigue siendo tuyo (no lo arregla el código)

- Firmar el **autocuestionario SAQ** anual ante tu adquiriente.
- Los **escaneos ASV trimestrales**, si CardNET los exige a tu nivel (Nivel 4).
- Mantener el servidor parcheado y con acceso restringido.
- La responsabilidad última ante una filtración. La mitigación más fuerte —no
  almacenar nada— ya está: no puede filtrarse de una base lo que nunca se
  guardó.

---

## 2. Cómo funciona un cobro

Son **dos APIs de CardNET** con credenciales distintas: el **servidor 3DS**
(autentica al tarjetahabiente) y la **API de pagos** (cobra).

```
Cliente escribe la tarjeta en la pantalla de compra (CARTOWN)
        │
        ▼  POST /api/pagos/cardnet/iniciar   (la tarjeta viaja aquí)
  autenticar3DS ──► ¿el banco pide reto?
        │                     │
   NO (frictionless)      SÍ (challenge)
        │                     │
        │           el navegador abre la pantalla del banco EN UN IFRAME
        │           (la página de compra sigue viva con la tarjeta en memoria)
        │                     │
        │           el banco termina → /api/pagos/cardnet/retorno (dentro del
        │           iframe) hace postMessage a la ventana padre
        │                     │
        │             POST /api/pagos/cardnet/completar  (la tarjeta otra vez)
        ▼                     ▼
  consultarEstado3DS  →  crearIdempotencyKey  →  procesarVenta
        │
        ▼
  response-code 00 → confirmarIntento activa el producto (una sola vez)
```

Por qué el reto va en un **iframe** y no como redirección completa: para no
perder la tarjeta que el navegador tiene en memoria mientras el cliente hace el
OTP. Guardarla en disco (storage) para sobrevivir a una redirección sería
justo lo que PCI prohíbe.

### Las piezas en el código

| Archivo | Qué es |
|---|---|
| `src/lib/payments/cardnet-core.ts` | Lógica pura: firmas, formatos, redacción, códigos. Testeable. |
| `src/lib/payments/cardnet.ts` | Capa de servidor: config del entorno + las llamadas HTTP. |
| `src/modules/pagos/cardnet3ds.ts` | Orquestación: monto desde la base, intentos, activación, guardas. |
| `src/app/api/pagos/cardnet/iniciar` | Recibe la tarjeta, autentica, cobra o devuelve el reto. |
| `src/app/api/pagos/cardnet/completar` | Cobra después del reto. |
| `src/app/api/pagos/cardnet/retorno` | Puente del reto: avisa a la ventana padre. |
| `src/components/membresia/PagoTarjetaCardnet.tsx` | Formulario de tarjeta + manejo del reto en iframe. |

---

## 3. Qué te toca configurar

### Variables de entorno (en Vercel, nunca en el repositorio)

```
CARDNET_MERCHANT_ID       # API de pagos
CARDNET_TERMINAL_ID       # API de pagos
CARDNET_INTEGRATOR_CODE   # servidor 3DS
CARDNET_API_KEY           # servidor 3DS — SECRETO
CARDNET_AMBIENTE          # 'pruebas' | 'produccion'
```

Los de QA (para probar) están en `.env.example`. Los de producción los entrega
tu ejecutivo de cuenta de CardNET — te dará DOS juegos: merchant/terminal para
pagos e integratorCode/apiKey para 3DS.

### Encender la pasarela para CARTOWN

Enciende la capacidad `PAGO_CARDNET` para la empresa CARTOWN desde el
superadmin. Sin capacidad, o sin las cuatro variables, la opción de tarjeta
no aparece y el cliente solo ve "pagar en sucursal".

---

## 4. Checklist de certificación — VERIFICAR contra el QA de CardNET

Las **firmas** están verificadas contra los ejemplos de la guía (hay pruebas
que reproducen los hashes exactos). Pero hay cosas que solo se confirman
llamando al ambiente de QA con las tarjetas de prueba. **Antes de ir a
producción**, corre un cobro de prueba de punta a punta y confirma:

- [ ] **El monto del 3DS.** Se envía en centavos (`purchaseAmount` = pesos×100,
      `purchaseExponent: "2"`). Si el QA espera el monto con decimales, cambia
      `montoMenor()` en `cardnet-core.ts`. (Está marcado `VERIFICAR-QA`.)
- [ ] **El endpoint de idempotency.** Se usa `/idenpotency-keys` (la grafía del
      Postman). Si responde 404, prueba `/idempotency-keys` (la de la guía).
- [ ] **El nombre del campo AVV.** Se envía `tds_avv` (el de los ejemplos de
      venta). La tabla de parámetros lo llama `tds_aav`; si la venta se rechaza
      por campo faltante, es esto.
- [ ] **`tds_mode`.** En QA se envía `2`; en producción `1` (autenticando con el
      servidor de CardNET). Ya está atado al ambiente; confírmalo.
- [ ] **Los nombres del retorno del reto.** `retorno/route.ts` lee `rd` y
      `threeDSServerTransID`. Si tu QA devuelve el reto con otros nombres,
      amplía las listas `RD`/`TDS`.
- [ ] **Tarjetas de prueba** (de la guía): `5555555555555557` venc. `12/22`
      CVV `123`. Clave del reto: `123456`.

Cuando los seis queden confirmados, es cuando el cobro está listo para
producción — no antes.

---

## 5. Cuando un pago no cuadra

El runbook `docs/runbooks/pagos-cardnet.md` sigue vigente: explica cómo
diagnosticar un `PagoIntento` atascado, la idempotencia (`activadoAt`) y la
conciliación contra el panel de comercio de CardNET. **El cierre de lote es
automático a las 7:00 PM**; una anulación (`anularVenta`) solo procede antes de
esa hora.

---

## 6. Lo que NO cambió

- **Pago en efectivo en la sucursal**: intacto. El cliente elige sucursal,
  recibe su referencia y paga en la Caja. Siempre está disponible, para todas
  las empresas.
- **Transferencia**: sigue como estaba donde esté encendida.
- **Otras empresas**: nunca ven la opción de tarjeta. La pasarela es solo de
  CARTOWN, por capacidad.
