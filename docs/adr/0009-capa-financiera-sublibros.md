# ADR-0009 · Depósitos, cuentas y liquidaciones son sub-libros del ledger financiero

**Estado:** aceptado · **Fecha:** 2026-09-29 · Extiende el ADR-0008

## Contexto

La auditoría de 2026-09 encontró que el dinero de Membego Supply cabía en una
sola tabla de asientos (ADR-0008) y una de pagos. Eso responde «cuánto se le
debe a este proveedor», pero no «por qué», ni «cuánto queda de aquel depósito
de 100.000», ni «qué se liquidó en el corte de la quincena y con qué
condiciones». El encargo pide depósitos con saldo y movimientos, cuentas por
pagar y por cobrar con estados, liquidaciones con snapshot, facturas y
conciliación con el proveedor.

## Decisión

El ledger financiero (`supply_asientos_financieros`) sigue siendo la única
fuente del **saldo**. Encima se añaden sub-libros que explican ese saldo, cada
uno con su entidad, su máquina de estados y su rastro:

| Sub-libro | Entidad | Qué asienta en el ledger |
| --- | --- | --- |
| Depósitos | `SupplyDeposito` + `SupplyDepositoMovimiento` | `DEPOSITO` (−) al confirmar el pago; `REEMBOLSO` (+) al devolver. **Aplicar** un depósito a una cuenta NO asienta: el neteo ya está en el ledger |
| Cuentas por pagar | `SupplyCuentaPorPagar` | `CUENTA_POR_PAGAR` (+) al nacer; `REVERSA` al cancelar |
| Cuentas por cobrar | `SupplyCuentaPorCobrar` | `CUENTA_POR_COBRAR` (−) al nacer; `REVERSA` al cancelar |
| Facturas | `SupplyFacturaProveedor` | Nada: la factura es el documento; su cuenta es la obligación |
| Liquidaciones | `SupplyLiquidacion` + `SupplyLiquidacionLinea` | `PAGO` (−) o `REEMBOLSO` (+) al pagar el neto |
| Ventas sin precompra | `SupplyVentaDirecta` | Nada al vender; al **entregar** nace la cuenta por pagar por bruto − comisión |

Reglas que se derivan:

1. **Signo por tipo, en un solo sitio** (`dinero.ts:signoDeAsiento`):
   `CREDITO`, `REEMBOLSO` y `CUENTA_POR_PAGAR` suman; todo lo demás resta. Así
   se corrigió el hallazgo H1 (el reembolso restaba).
2. **Una obligación se salda por tres caminos y ninguno a mano**: un pago
   directo (`cuentaPorPagarId` en el pago), un depósito (movimiento
   `APLICACION`) o una liquidación (línea). `moverCuenta` solo disputa,
   levanta disputa o cancela.
3. **La liquidación reclama, no copia.** `calcularLiquidacion` marca con
   `liquidacionId` las cuentas y los asientos de redención del período con un
   `UPDATE … WHERE "liquidacionId" IS NULL … RETURNING`, dentro de la misma
   transacción: dos cortes simultáneos del mismo proveedor no pueden repartirse
   la misma redención. Cancelar la liquidación libera lo reclamado.
4. **El snapshot se congela al calcular.** Las líneas llevan montos, no
   referencias a precios. Una enmienda posterior del acuerdo crea una versión
   nueva (`SupplyAcuerdoVersion`) y no toca ningún corte.
5. **Aplicar un depósito dentro de una liquidación es un plan** hasta que se
   paga: `pagarLiquidacion` es quien mueve el saldo del depósito, con el
   depósito y las cuentas bloqueadas.
6. **La venta sin precompra no toca ningún lote.** La comisión se congela al
   abrir la venta con la versión vigente del acuerdo; el cliente paga por el
   flujo de cobro existente (`SupplyPedido.ventaId`); el proveedor entrega con
   el escáner y solo entonces nace la deuda.

## Consecuencias

- El saldo de un proveedor sigue siendo Σ asientos: nada de lo anterior
  cambió de significado. Los sub-libros se pueden reconstruir desde el ledger
  si hiciera falta, pero el ledger no se reconstruye desde ellos.
- Toda escritura del dinero pasa por `FOR UPDATE` sobre la fila que se mueve
  (depósito, cuenta, liquidación, venta) y por `CHECK`s en la base
  (`aplicado + devuelto ≤ original`, `saldado ≤ neto`, `comisión + proveedor =
  bruto`). Un camino nuevo que se salte el dominio choca con la base.
- Las pantallas se agrupan bajo **Finanzas** (Pagos · Depósitos · Facturas ·
  CxP · CxC · Liquidaciones · Cobros a clientes) pero cada una lee su propio
  sub-libro. La antigua pestaña «Cobros», que mezclaba cinco cosas, redirige.
