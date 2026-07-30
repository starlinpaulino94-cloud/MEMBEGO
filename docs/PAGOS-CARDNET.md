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

## 4. Checklist de certificación — VERIFICAR contra el QA de CardNET

Hay cosas que solo se confirman con un cobro real de prueba. **Antes de ir a
producción**, corre un cobro de punta a punta en QA y confirma:

- [ ] **El iframe abre y devuelve el token.** El callback se llama `tokenCreated`
      y el método para abrir es `OpenIframeCustom`. Si tu QA usa otros nombres,
      amplía `PagoTokenCardnet.tsx` (está marcado `VERIFICAR-QA`).
- [ ] **La forma del token.** `tokenDe()` busca `Token`/`TrxToken`/`PWToken`. Si
      viene con otro nombre, agrégalo.
- [ ] **La respuesta del Purchase.** `interpretarCompraToken()` aprueba con
      `Approved:true` o `ResponseCode:'00'`. Si tu QA marca el aprobado de otra
      forma, ajústalo. Ante la duda NO aprueba — es lo seguro.
- [ ] **El monto.** El `Amount` va en centavos ENTEROS (`Amount = pesos×100`).
      Si tu QA espera decimales, cambia `montoEnteroMenor()`.
- [ ] **Tarjeta de prueba** (la de CardNET) y clave del reto 3DS.

Cuando queden confirmados, el cobro está listo para producción — no antes.

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
