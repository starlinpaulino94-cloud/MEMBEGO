# Reglas financieras del Commerce Core (sprint de cierre, 2026-10-08)

> Lo que el código HACE hoy con el dinero de un pedido Membego: la base comisionable, los niveles de
> verificación, quién respalda un pago, cómo se ajusta una comisión cuando el pago se verifica después y
> por qué comisiona un pedido. Cada regla cita el archivo donde vive y la prueba que la vigila. Donde la
> regla depende de una decisión que no es técnica, se dice `USER / ACCOUNTING DECISION REQUIRED`.

## 1. La base comisionable (`commissionableBase`)

Regla real (`src/modules/orders/domain.ts` → `calcularPedido`; la base la repite en los CHECK de
`membego_orders`, migración `20261042`):

```
subtotal            = Σ cantidad × precio unitario (precio congelado de la variante al pedir)
discount            = Σ descuentos de línea
adjustment          = ajuste de la empresa sobre el monto (+ recargo / − rebaja), con motivo
commissionableBase  = subtotal − discount + adjustment          (≥ 0)
tax                 = impuestos del pedido (hoy SIEMPRE 0; ver §1.3)
total               = commissionableBase + tax
```

| Concepto | ¿Entra en la base? | Dónde |
|---|---|---|
| Subtotal (cantidad × precio de catálogo) | Sí | `calcularPedido` |
| Descuentos de línea | Restan | `calcularPedido`; solo el actor SISTEMA puede fijar un descuento (`orders/service.ts`, `DESCUENTO_NO_PERMITIDO`) y lo usa la oferta con presupuesto |
| Ajuste de la empresa (`ajustarMontoEnTx`) | Suma o resta | Recalcula base y total; borra la confirmación del cliente |
| Impuestos (`tax`) | **No** (`total = base + tax`) | Hoy ningún camino pasa `impuesto`: `tax = 0` siempre |
| Propinas | **No existe** el concepto en `MembegoOrder` | — |
| Cargos externos (envío, servicio) | **No existe** el concepto | — |
| Reembolso total | Revierte la comisión entera (`REFUND`, asiento contrario exacto) y, si lo hubo, el ajuste por verificación | `billing/service.ts` → `revertirComisionDePedidoEnTx` |
| Reembolso parcial | **No existe**: un pedido se reembolsa entero o no se reembolsa | — |
| Promoción financiada por el comercio (oferta con presupuesto) | El descuento de línea baja la base; la comisión de ese pedido es la **cuota fija de la oferta**, no el porcentaje (`calcularCuotaDeOferta`) | `deals/`, `billing/domain.ts` |
| Subsidio de Membego | **No existe** (no hay forma de que Membego pague parte de un pedido) | — |

### 1.1 Lo que decide cuánto se cobra

`billing/domain.ts` → `calcularComision(pedido, config)`:

- `CPA_FIXED` → siempre `cpaAmount` (RD$100 por defecto) si la base > 0.
- `PERCENTAGE` → `percentageRate` % (8 % por defecto) de la base, redondeado al centavo (mitad hacia arriba).
- `HYBRID` (por defecto) → CPA mientras el pago **no esté verificado**; porcentaje desde `PAYMENT_VERIFIED`.
- Base 0 → no hay comisión (`SIN_COMISION`), salvo la cuota de una oferta (una oferta gratis paga su cuota).

La comisión se asienta en la **misma transacción** que cierra el pedido y es una foto (`baseAmount`,
`verificationLevel`, `rate`, `amount` no cambian nunca; la base lo impide con el disparador
`merchant_commissions_reglas`).

### 1.2 Pruebas que vigilan la base

`tests/orders-domain.test.ts` (aritmética), `tests/postgres/orders.db.test.ts` 6 (descuento baja la base),
13 (ajuste), 34 (CHECK de montos), `tests/postgres/billing.db.test.ts` 2–3 (porcentaje sobre la base
ajustada), conciliación C05/C06 (comisión ≠ base × tasa; base de la comisión ≠ base del pedido).

### 1.3 `USER / ACCOUNTING DECISION REQUIRED` · ITBIS y comprobante fiscal

Hoy `tax = 0` y los precios del catálogo se tratan como el monto que el cliente paga. No está decidido
(y el código no lo inventa):

1. Si los precios del catálogo **incluyen** el ITBIS o se le suma; y, en el primer caso, si la base
   comisionable debe ser el precio **neto** de ITBIS (la base actual es el precio tal cual).
2. Si Membego emite comprobante fiscal (e-CF) por su comisión y con qué datos.
3. Qué se considera «conciliado fiscalmente» (`FISCALLY_RECONCILED`): hoy nada lo deriva.

Hasta que se decida, la regla es la de arriba y está documentada como tal.

## 2. Niveles de verificación y quién respalda un pago

Cadena (`orders/domain.ts` → `NIVELES`, `nivelDeVerificacion`; cada nivel exige el anterior):

| Nivel | Qué hace falta | Quién lo produce |
|---|---|---|
| `ATTRIBUTED` | El pedido existe con su canal | `crearPedidoEnTx` |
| `REDEEMED` | El QR cerró el pedido (COMPLETED) | `completarPorQrEnTx` |
| `CUSTOMER_VERIFIED` | + el cliente confirmó el monto vigente | `confirmarMontoEnTx` |
| `EXTERNAL_PAYMENT_REPORTED` | + la **empresa** registró un pago con método verificable (tarjeta, transferencia, checkout), referencia y el monto del pedido | `registrarPagoEnTx` (panel, caja). Es su palabra: `payment_evidences.source = MERCHANT_REPORTED` |
| `PAYMENT_VERIFIED` | + una **fuente externa** confirmó ese pago: pasarela firmada (`GATEWAY_VERIFIED`), conciliación bancaria (`BANK_RECONCILED`), proveedor (`PROVIDER_VERIFIED`), siempre con `verificationRef` (el id del hecho) y `verifiedAt` | `verificarPagoExternamenteEnTx` (solo SISTEMA o superadmin) y el envoltorio de Supply (`cerrarPedidoExternoEnTx` con `source: PROVIDER_VERIFIED`) |
| `FISCALLY_RECONCILED` | Reservado al comprobante fiscal | Nadie todavía (§1.3) |

Reglas que lo sostienen:

- Una referencia tecleada en la caja **nunca** verifica (`pagoVerificado` exige `source` externa). Antes del
  sprint de cierre sí lo hacía y, en HYBRID, cobraba el 8 % sobre la palabra del negocio.
- La base exige (`payment_evidences_fuente`) que una fuente externa traiga `verifiedAt` y `verificationRef`,
  y que la reportada no los traiga.
- La empresa no puede registrar encima de una constancia verificada (`PAGO_YA_VERIFICADO`); el mismo
  `verificationRef` es idempotente; otro hecho sobre un pedido ya verificado se rechaza.
- Migración `20261051`: las constancias existentes son `MERCHANT_REPORTED` (no existía otro camino) salvo las
  del envoltorio de Supply (`PROVIDER_VERIFIED`, referencia = la compra); los pedidos que estaban en
  `PAYMENT_VERIFIED` por una constancia reportada bajan a `EXTERNAL_PAYMENT_REPORTED`. Las comisiones ya
  cobradas no se tocan; la regla P05 de la conciliación muestra las que cobraron el porcentaje sobre un pago
  solo reportado.

Pruebas: `tests/orders-domain.test.ts` (cadena, fuentes, validación), `tests/postgres/orders.db.test.ts` 18,
18b, 19, 30c, `tests/postgres/pos.db.test.ts` 13, 20, `tests/postgres/supply-bridge.db.test.ts` 22–23,
conciliación P01–P05.

## 3. Pago verificado DESPUÉS de cobrar la comisión: el ajuste por verificación

Escenario: pedido de RD$5,000 cerrado solo con redención → CPA RD$100. Después CardNET (o el banco)
confirma el pago → el modelo HYBRID manda 8 % = RD$400.

Mecanismo (`billing/domain.ts` → `calcularAjustePorVerificacion`; `billing/service.ts` →
`ajustarComisionPorVerificacionEnTx`; lo llama `verificarPagoExternamenteEnTx` en la misma transacción):

```
COMMISSION (REDEMPTION_FEE)     +100   al cerrar          (no cambia nunca)
VERIFICATION_ADJUSTMENT         +300   al verificar       (porcentaje − CPA, con signo, una sola vez)
```

- Append-only: la comisión original no se edita; registra el ajuste (`verificationAdjustmentAmount`,
  `…EntryId`, `verificationAdjustedAt`, `verificationRef`) y la base impide cambiarlo después.
- Idempotencia: clave del asiento `commission:<pedido>:verification` (única por empresa) + CHECK
  `merchant_commissions_ajuste_verificacion` + disparador (una vez, con su asiento exacto, pedido
  COMPLETED y PAYMENT_VERIFIED o superior).
- Concurrencia: candado del pedido (quien verifica) y de la cuenta (`cuentaBloqueada`); dos confirmaciones
  simultáneas dejan un ajuste (`tests/postgres/billing.db.test.ts` 42).
- Solo HYBRID, solo comisiones CPA sin cuota de oferta (la cuota de una oferta es un precio pactado).
  Con `CPA_FIXED` el CPA es la regla; con `PERCENTAGE` ya se cobró el porcentaje.
- Signo: si el porcentaje es menor que el CPA, la diferencia es negativa (la regla es «porcentaje», no «lo
  que sea mayor»). En el corte va con los ajustes (`adjustments`), no con `totalCommissions` (que el corte
  exige ≥ 0).
- Reverso: reembolsar revierte la comisión Y el ajuste, cada uno con su asiento `REFUND` contrario exacto
  (`commission:<pedido>:verification:reversal`); la base exige que vayan juntos.
- Bitácora: `COMMISSION_VERIFICATION_ADJUSTED` sobre el asiento, con la fuente y la referencia externa;
  `ORDER_PAYMENT_VERIFIED` sobre el pedido.
- Conciliación: P04 acusa un pedido verificado con comisión CPA/HYBRID sin ajuste; P05 acusa una comisión al
  porcentaje cuya constancia es solo reportada.

Pruebas: `tests/billing-domain.test.ts` (tabla de casos), `tests/postgres/billing.db.test.ts` 41–46,
`tests/postgres/conciliacion.db.test.ts` 11.

## 4. Adquisición ≠ cumplimiento: por qué comisiona un pedido

`billing/domain.ts` → `pedidoGeneraComision`:

```
Supply (origen SUPPLY o sourceType SUPPLY_V2_CUSTOMER_ORDER)   → nunca (otra economía)
origen MARKETPLACE                                             → siempre (nació en Membego)
cualquier otro origen (POS, EXCURSION, API)                    → solo si su atribución es demostrable:
    MARKETPLACE_BROWSE · MARKETPLACE_SEARCH · PROMOTION_CLAIM · CAMPAIGN · REFERRAL
    (cada uno con el dato que la base exige: promoción, campaña, código de referido)
DIRECT (venta espontánea de mostrador) y QR_SCAN (el cliente se identificó con su QR)   → no
```

- El pedido del marketplace que la caja cobra y entrega (`cobrarPedidoEnCajaEnTx`) sigue siendo
  MARKETPLACE: comisiona aunque lo cumpla el POS.
- La venta de mostrador pura (`venderEnMostradorEnTx`, origen POS, canal DIRECT) no comisiona.
- Nada se cobra hacia atrás: el barrido de Merchant Billing (`billing/barrido.ts`) solo mira 45 días y
  solo pedidos con origen MARKETPLACE o canal demostrable; un POS con DIRECT nunca entra.
- Conciliación: C01 (lo que debía comisionar y no tiene comisión) y C04 (comisión fuera de la regla) usan
  la misma lista (`CANALES_ATRIBUIDOS_A_MEMBEGO`).

Pruebas: `tests/billing-domain.test.ts` («qué pedidos comisionan»), `tests/postgres/billing.db.test.ts` 6,
7, 47, `tests/postgres/pos.db.test.ts` (venta de mostrador no comisiona).

`USER DECISION` pendiente (ya registrada en `IMPLEMENTATION_STATUS.md` §16): si la venta de mostrador de un
cliente **identificado por su QR de membresía** debe comisionar. Hoy no, porque identificarse no demuestra
que Membego trajera la venta.

## 5. Lo que NO está (y se dice)

- Pago en línea (CardNET) dentro del pedido Membego: `BLOCKED — EXTERNAL CREDENTIALS`. La ruta de entrada
  ya existe (`verificarPagoExternamenteEnTx` con `GATEWAY_VERIFIED` y el id de la transacción como
  `verificationRef`); el adaptador que la llame desde el webhook firmado se escribe cuando haya credenciales
  y contrato.
- Conciliación bancaria automática: hoy la hace el superadmin (`BANK_RECONCILED` con la referencia del
  extracto). No hay lector de extractos.
- ITBIS / e-CF: §1.3.
