# MEMBEGO SUPPLY 2.0 — Auditoría del Vertical Slice 6

Fecha: **2026-10-01** · Rama: `claude/jolly-brahmagupta-dmhml9` · Base: `a1ec078`.
Alcance: **BONOS PARCIALES, SUBSIDIOS Y PAGOS COMBINADOS** — beneficio con
presupuesto y ledger → asignación a clientes → motor de financiación
(descuento del proveedor / bono de Membego / compartido) → checkout unificado
con diferencia a pagar → cobertura total sin pago bancario → derecho y QR de
siempre → reconocimiento económico separado → liquidación con el valor
contractual intacto.

Método: **no se marca ✅ por existencia de código ni porque el proyecto
compile**. Cada criterio se comprobó contra una fuente primaria: la salida de
las cuatro suites (dominio, PostgreSQL, Playwright escritorio y móvil),
consultas SQL sobre lo que las pruebas dejaron escrito, una base creada desde
cero con `migrate deploy` aplicado dos veces, `git diff` sobre las zonas
prohibidas y las mismas puertas que corre CI.

Leyenda: ✅ verificado con evidencia · ⚠️ observación o riesgo (no bloquea) ·
⛔ fuera de alcance por decisión del prompt.

La cifra que manda en todo el slice: **1 000 de venta con bono de 500 →
el cliente paga 500, la comisión del 8 % son 80 sobre el VALOR CONTRACTUAL de
1 000, el proveedor cobra 920 y la contribución tras el subsidio es −420.**
Está verificada en las tres capas (dominio, PostgreSQL y navegador).

---

## 1 · BASE COMMIT

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `main` remoto al iniciar | `origin/main` = `a1ec078` (merge del PR #533, que integró el Slice 5). La rama se reinició sobre ese commit porque el PR anterior ya estaba mergeado. | ✅ |
| Slices 1–5 integrados | Ancestros de `HEAD`: `36b2c3c` (S1), `ffaaffc` (S2), `b7e2663` (S3), `aaf3693` (S4), `f74b8eb` + `c33ff84` (S5). Ninguno falta: no se construyó sobre una base incorrecta. | ✅ |
| Línea base antes de escribir código | Sobre `a1ec078`: `tsc --noEmit` exit 0 · `npm run test:db` **114 pass · 0 fail** · `npm test` **3 325 pass · 0 fail**. | ✅ |
| Auditoría previa del esquema, migraciones, contratos y servicios | Se leyeron `prisma/schema/supply-v2.prisma`, las 169 migraciones aplicadas, `core/{comision,dinero,estados,numeracion,auditoria}.ts`, `commerce/checkout.ts`, `finance/*`, `economics/*` y `redemption/*` antes de tocar nada. De ahí salieron las tres decisiones que evitaron duplicar: reutilizar la reserva como registro de aplicación, reutilizar `SupplyV2PricingEngine` y reutilizar el QR del Slice 3. | ✅ |
| Sin duplicar funcionalidad | No hay tabla nueva de «aplicaciones de beneficio» (la reserva es el registro: `ACTIVE → APPLIED/RELEASED/EXPIRED/REVERSED`), ni segundo motor de precios (`core/financiacion.ts` **extiende** `repartirEnUnidades`/`validarPorcentajeComision` del Slice 5), ni segundo voucher, ni segunda cola de pagos. | ✅ |
| Rama exclusiva del slice | Todo el trabajo en `claude/jolly-brahmagupta-dmhml9`, reiniciada desde `origin/main`; ningún commit sobre el historial ya mergeado. | ✅ |

## 2 · ARCHITECTURE

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Cada cifra tiene UN significado (§3) | `RepartoFinanciado` separa `gmv`, `supplierDiscount`, `contractualSaleValue`, `membegoSubsidy`, `customerPayable`, `benefitApplied`, `commissionBase`, `commissionAmount` y `supplierNet`. El nombre de cada campo es el significado; nada se reutiliza para dos cosas. | `src/modules/supply-v2/core/financiacion.ts` |
| Reglas puras separadas de la base | `core/financiacion.ts` (motor) y `benefits/domain.ts` (validación, transiciones, elegibilidad, saldo del ledger) no importan Prisma para consultar: **30 pruebas sin base de datos**. | `tests/supply-v2-slice6-dominio.test.ts` |
| Un solo sitio calcula el reparto | `calcularRepartoLinea` se llama desde el checkout (al abrir la orden) y desde la vista previa del cliente; el checkout **vuelve a comprobar** el reparto congelado al emitir (`ORDEN_INCONSISTENTE` si no cuadra). Las pantallas no repiten fórmulas. | `commerce/checkout.ts`, `benefits/queries.ts` |
| Reutiliza Slices 1–5 | Mismos `SupplyV2CustomerOrder`/`Line`, mismo `SupplyV2Entitlement`, mismo voucher/QR/redención (S3), mismas obligaciones, pagos y liquidaciones (S4–S5). El beneficio añade tablas propias y cuatro columnas de financiación a las existentes. | `prisma/schema/supply-v2.prisma` |
| El ledger del beneficio es independiente del ledger de lotes | `supply_v2_benefit_movements` es una tabla nueva; `core/ledger.ts` (unidades de lote) **no se tocó**: `git diff` sobre él = 0 líneas. | `benefits/service.ts` |
| Tres públicos, tres DTOs | `BeneficioEnLista`/`FichaBeneficio` (admin, con presupuesto), `BeneficioDelCliente`/`BeneficioAplicable` (cliente, sin presupuesto ni costos), `BeneficioDelProveedor` (proveedor, su aporte y el de Membego por separado). Una prueba recorre las claves del DTO del cliente y falla si aparece «budget» o «presupuesto». | `benefits/queries.ts` · `tests/postgres/supply-v2-slice6.db.test.ts` (J) |

## 3 · DATA MODEL (§7, §10–§12)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Entidad `SupplyV2Benefit` | Código `MBG-BN-AAAA-NNNNNN`, nombre, descripción, objetivo, financiación, tipo de valor, valores y topes de cada parte, alcance, moneda, presupuesto (total / reservado / consumido), límite por cliente, `requiresAssignment`, vigencia, estado, creador, aprobador y cancelación con motivo. | `prisma/schema/supply-v2.prisma` |
| Estados del beneficio | `DRAFT · ACTIVE · PAUSED · EXHAUSTED · EXPIRED · CANCELLED` con `TRANSICIONES_BENEFICIO`; `EXPIRED` y `CANCELLED` son finales. | `benefits/domain.ts` · prueba 21 |
| Asignación a clientes | `SupplyV2CustomerBenefit` con `usesAllowed`/`usesConsumed`, vencimiento propio, estado (`AVAILABLE · EXHAUSTED · EXPIRED · CANCELLED`), nota interna y quién la otorgó. Única por `(benefitId, customerId)`. | `prisma/schema/supply-v2.prisma` |
| Reserva = registro de aplicación | `SupplyV2BenefitReservation` con `orderLineId` **único**, importes separados (`supplierAmount`, `membegoAmount`), estado y marcas de tiempo de aplicación, liberación y reversa con motivo. | `prisma/schema/supply-v2.prisma` |
| Ledger del beneficio | `SupplyV2BenefitMovement`: `GRANTED · RESERVED · APPLIED · RELEASED · EXPIRED · REVERSED`, con el delta de reservado y de consumido, el descuento del proveedor implicado (informativo) y el saldo DESPUÉS de cada movimiento. | `prisma/schema/supply-v2.prisma` |
| La base sostiene los invariantes | CHECK `supply_v2_benefits_shape` (forma coherente con quién financia), `supply_v2_benefits_budget` (reservado + consumido ≤ total, nada negativo), `supply_v2_customer_benefits_uses`, `supply_v2_benefit_reservations_amounts`, y los tres CHECK de financiación en orden, línea y derecho. | `prisma/migrations/20261017_supply_v2_slice6/migration.sql` |
| El CHECK no es decorativo | Un `UPDATE` directo que sobregira el presupuesto es rechazado por PostgreSQL con `supply_v2_benefits_budget`. | prueba E (PostgreSQL) |

## 4 · FUNDING MODELS (§4)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Bono de Membego | `MEMBEGO`: baja lo que paga el cliente, el valor contractual **no cambia**, el proveedor cobra su importe completo y el bono es costo promocional. 1 000 − 500 → paga 500, contractual 1 000, comisión 80, neto 920. | ✅ pruebas 1–2, A, E2E |
| Descuento del proveedor | `SUPPLIER`: baja el precio del proveedor, así que baja el valor contractual y la base de la comisión. No es dinero de Membego y no consume presupuesto (el alta lo rechaza si se le pone presupuesto). | ✅ pruebas 14, 17, H |
| Financiación compartida | `SHARED`: 1 000 − 100 (proveedor) − 300 (Membego) = 600 a pagar, contractual 900, comisión 90 al 10 % (72 al 8 % en el E2E), neto 828. Solo el subsidio consume presupuesto; el movimiento del ledger guarda los 100 del proveedor como informativos. | ✅ prueba 4, escenario C, E2E journey 4 |
| En precompra no cabe un descuento del proveedor | Membego ya compró y pagó la unidad: `DESCUENTO_SOLO_COMISION`. El bono de Membego sí se permite. | ✅ prueba 17, escenario H |
| El SQL lo confirma | Órdenes pagadas del recorrido: `600.00 | 900.00 | 100.00 | 300.00 | 72.00 | 828.00` y `500.00 | 1000.00 | 0.00 | 500.00 | 80.00 | 920.00`. | ✅ |

## 5 · BENEFIT VALUE (§8)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Importe fijo y porcentaje | `FIXED_AMOUNT` y `PERCENTAGE`, cada parte con su valor. | `core/financiacion.ts` |
| Topes por aplicación | 15 % de 3 000 son 450, pero con tope 300 se aplican 300. | prueba 6 |
| Nunca por debajo de cero | El subsidio se capa a lo que queda tras el descuento del proveedor: bono de 500 sobre una compra de 400 aplica 400 y el total queda en 0, nunca negativo. | prueba 5, escenario B |
| El importe fijo es por aplicación, no por unidad | 3 × 1 000 con bono de 500 → se descuentan 500, no 1 500. | prueba 7 |
| Valores imposibles rechazados | Negativos, porcentajes > 100, topes en cero, bono de Membego con parte del proveedor y al contrario, compartido sin una de las dos partes. | pruebas 11–12 |

## 6 · SCOPE Y ELEGIBILIDAD (§9, §16, §33)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Tres alcances exactos | `SPECIFIC_OFFER`, `CATALOG_ITEM`, `SUPPLIER`; `cubreOferta` compara ids, sin asociaciones ambiguas. | ✅ prueba 15 |
| Orden de validación completo | beneficio (estado, vigencia, moneda) → oferta (alcance, financiación, modelo) → asignación (existe, es suya, está viva, no venció) → usos → presupuesto. 14 motivos con mensaje propio en castellano. | ✅ `benefits/domain.ts`, pruebas 16–20 |
| Todo se revalida en el servidor | La vista previa del cliente no decide nada: `reservarBeneficioEnTx` recalcula el reparto y vuelve a comprobar la elegibilidad con la oferta bloqueada. | ✅ `commerce/checkout.ts` |
| Un beneficio ajeno no se usa ni con su id | Pasar el `customerBenefitId` de otra persona → `ASIGNACION_AJENA`; pasar el `benefitId` sin tener asignación → `SIN_ASIGNACION`; usarlo en una oferta que no cubre → `PRODUCTO_NO_ELEGIBLE`. | ✅ escenario J |

## 7 · ASSIGNMENT (§10)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Solo a clientes de Membego | Asignar a un usuario que no es `CLIENTE` falla con `CLIENTE_NO_ENCONTRADO`. | ✅ escenario «asignación» |
| Idempotente | Asignar dos veces devuelve la misma asignación (`repetida: true`), no crea una segunda. | ✅ |
| Usos acotados al beneficio | `usesAllowed` entre 1 y `perCustomerLimit`; fuera de rango falla. | ✅ |
| El vencimiento no puede pasar del beneficio | Una asignación que venciera después del beneficio se rechaza. | ✅ |
| El cliente se elige de una búsqueda del servidor | El formulario busca por nombre o correo con `buscarClientesBeneficioAction` (tras `SUPPLY_V2_BENEFIT_ASSIGN`); nadie escribe un id a mano. | ✅ `form-asignar-beneficio.tsx` |
| Queda en el ledger y en la bitácora | Movimiento `GRANTED` (sin mover presupuesto) y `SUPPLY_V2_BENEFIT_GRANTED` en `audit_logs`. | ✅ |

## 8 · BUDGET (§11)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Tres cifras distintas, nunca mezcladas | `budgetTotal`, `budgetReserved`, `budgetConsumed`, y `disponible` derivado. El listado y la ficha las enseñan en columnas separadas. | ✅ `/superadmin/supply-v2/beneficios` |
| El checkout reserva, el pago consume | Antes de pagar: reservado 500 / consumido 0. Después: reservado 0 / consumido 500. | ✅ escenario A, E2E |
| Cancelar, expirar y reversar devuelven | `RELEASED`, `EXPIRED` y `REVERSED` devuelven al presupuesto y el beneficio agotado vuelve a `ACTIVE`. | ✅ escenarios D, E, I |
| Nunca negativo ni sobregirado | Lo impide el servicio (`PRESUPUESTO_INCONSISTENTE`) y, por detrás, el CHECK de la base. SQL sobre toda la base: **0 presupuestos sobregirados**. | ✅ |
| Sin tope es explícito | `budgetTotal = null` significa sin tope, y la pantalla lo dice («Sin tope», con la advertencia de usarlo con cuidado). | ✅ |
| Se agota solo | Cuando el disponible llega a cero, el beneficio pasa a `EXHAUSTED` dentro de la misma transacción que lo agotó. | ✅ escenario E |

## 9 · CONCURRENCY (§33)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Orden de candados fijo | oferta (`FOR UPDATE`, Slice 2) → beneficio (`FOR UPDATE`) → asignación (`FOR UPDATE`). Siempre el mismo orden: no hay abrazo mortal. | ✅ `benefits/service.ts` |
| Dos checkouts a la vez con el mismo bono de un uso | `Promise.allSettled` con dos aperturas simultáneas: **una pasa, una falla**; queda una sola reserva viva. | ✅ escenario D |
| Dos clientes a la vez por el último peso del presupuesto | Presupuesto para una sola aplicación, dos clientes simultáneos: **una pasa, una falla** («sin presupuesto disponible» o «agotado», según quién llegue primero dentro del candado). | ✅ escenario E |
| Los usos cuentan reservas vivas, no solo aplicaciones | `usosVivos` = reservas `ACTIVE` + `APPLIED`; así dos checkouts paralelos no burlan el límite por cliente. | ✅ prueba 19 |
| Una línea, una reserva viva | `orderLineId` único + índice parcial único `(orderId, benefitId) WHERE status IN ('ACTIVE','APPLIED')`. Verificado leyendo `pg_indexes`. | ✅ escenario J |

## 10 · PRICING ENGINE (§13–§15)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Campos del motor | Los nueve del prompt, más el reparto por unidad. | ✅ `core/financiacion.ts` |
| Reparto por unidad determinista | El centavo sobrante va a las primeras unidades (`repartirEnUnidades`, Slice 5): 500 entre 3 → `166.67 · 166.67 · 166.66`; cada unidad cuadra consigo misma y la suma cuadra con la línea. | ✅ prueba 8 |
| Se congela en la orden | `benefitFundingSnapshot` guarda la foto completa (beneficio, GMV, descuento, contractual, subsidio, a pagar, base, comisión, neto). | ✅ prueba 10, escenario A |
| Se reconstruye igual al emitir | `unidadesDesdeLinea` rehace el reparto por unidad desde lo congelado; si no cuadra con el motor, la emisión falla. | ✅ `commerce/checkout.ts` |
| Nada se recalcula con precios de hoy | El derecho, la redención, la liquidación y los eventos económicos llevan su propia foto. | ✅ escenarios I, J |

## 11 · COMMISSION BASE (§14)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Dos bases posibles | `CONTRACTUAL_SALE_VALUE` (de fábrica) y `CUSTOMER_PAID_AMOUNT`, en el acuerdo. | ✅ `SupplyV2CommissionBase` |
| Se congela en la versión del acuerdo | `politicaDeVersion(snapshot).commissionBase`; un snapshot sin el campo o con basura cae en el valor contractual. | ✅ prueba 25 |
| Con el valor contractual el proveedor no pierde | 1 000 con bono de 500 al 8 % → comisión 80, neto 920 (igual que sin bono). | ✅ prueba 2, escenario G |
| Con lo pagado por el cliente, Membego cobra menos | Mismo caso → comisión 40, neto 960. | ✅ prueba 3, escenario G |
| Se elige al crear el acuerdo | Selector «Base de la comisión» en el formulario, con la explicación de qué cambia. | ✅ `form-acuerdo.tsx`, E2E |

## 12 · CHECKOUT (§16–§19, §21)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Un solo checkout | El mismo flujo con y sin beneficio, para precompra y comisión. No hay segunda pantalla de pago. | ✅ `commerce/checkout.ts` |
| Reserva con vencimiento | La reserva del beneficio vence con la orden (mismo `expiresAt`) y la libera el mismo camino que expira el checkout. | ✅ escenario E |
| «Beneficio aplicado» visible | El checkout muestra precio regular, descuento Membego, precio Membego, descuento del proveedor, «Beneficio aplicado: …» y el total a pagar; más un aviso con el ahorro. | ✅ `checkout-cliente.tsx`, E2E |
| El beneficio no se paga en el banco | La cuenta de cobro pide solo la diferencia y lo dice. Con total 0, **no se muestra cuenta bancaria** (verificado: `checkout-cuenta` con 0 elementos). | ✅ E2E journey 3 |
| Avisar o confirmar un pago de 0 está prohibido | `avisarPagoEnTx` y `confirmarPagoEnTx` rechazan total 0 («está cubierta por completo…»). | ✅ escenario B |
| Cobertura total sin pago bancario | `confirmarCoberturaTotalEnTx`: la confirma el **dueño de la orden**, exige total 0 y una reserva viva, deja `paymentStatus = COVERED_BY_BENEFIT`, importe visto 0, sin método ni confirmador de pago. Idempotente. | ✅ escenario B, E2E |
| Un beneficio por línea | `orderLineId` único; el selector del cliente es de elección única. | ✅ escenario J |

## 13 · ENTITLEMENTS Y REDEMPTION (§22–§24)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Un derecho por unidad, con las dos cifras | `customerUnitPrice` = lo que pagó el cliente; `contractualUnitValue`, `supplierDiscountAmount` y `membegoSubsidyAmount` aparte. SQL: **0 derechos con subsidio y sin valor contractual**. | ✅ |
| El QR es el del Slice 3 | Mismo voucher, misma sesión temporal, mismo escáner; `redemption/service.ts` solo añade la foto de la financiación. | ✅ escenario I, E2E |
| La redención guarda la foto | `contractualValueSnapshot`, `supplierDiscountSnapshot`, `membegoSubsidySnapshot` junto a las del Slice 5. | ✅ escenario I |
| La orden representa la compra completa | Totales de orden y línea con las cuatro cifras de financiación y el `benefitId` de la línea. | ✅ escenario A |

## 14 · OBLIGATIONS Y SETTLEMENTS (§25–§26)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| La precompra no crea obligación nueva | Con bono de Membego sobre una oferta de supply ya comprado: **0 obligaciones** por ese derecho; el lote, el costo (300) y el margen (200) son los del Slice 4. | ✅ escenario H |
| A comisión la deuda es el neto contractual | Entrega de una venta de 1 000 con bono de 400 → obligación **920**, no 600. | ✅ escenario I |
| La liquidación distingue las cifras | `grossSales` (GMV), `contractualValue`, `supplierDiscountTotal`, `membegoSubsidyTotal`, `customerPaidTotal`, `commissionAmount`, `supplierNet`, `paidAmount` y pendiente. SQL: `1000.00 | 1000.00 | 0.00 | 400.00 | 600.00 | 80.00 | 920.00`. | ✅ escenario J |
| Los totales se suman de las líneas | Cada total de la liquidación es la suma de su columna en las líneas, verificado en la prueba. | ✅ escenario J |
| El bono no rebaja el neto del proveedor | La línea de la liquidación: bruto 1 000, contractual 1 000, bono 400, pagó el cliente 600, **neto 920**. | ✅ escenario J |
| El proveedor lo ve así | Portal: «valor contractual 1 000», «Membego financió 400: no sale de tu neto», neto 920. | ✅ E2E |

## 15 · REVERSALS Y CANCELACIONES (§27)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Cancelar el checkout libera | Reserva `RELEASED`, presupuesto devuelto, el bono vuelve a estar usable. | ✅ escenario D |
| Expirar libera | Reserva `EXPIRED`, presupuesto devuelto, el beneficio agotado vuelve a `ACTIVE`. | ✅ escenario E |
| Reversar una aplicación es explícito y exige motivo | Sin motivo falla; con derechos vivos o entregados falla («no se reversa en silencio»); solo con todos los derechos vencidos o cancelados se permite, y devuelve presupuesto y uso. Idempotente: un solo movimiento `REVERSED`. | ✅ escenario I |
| Cancelar un beneficio con checkouts en curso está bloqueado | Dice cuántos hay y pide pausar y esperar; cancelar exige motivo; al cancelar, las asignaciones disponibles pasan a `CANCELLED` y lo aplicado queda aplicado. | ✅ escenario F |
| Vencimientos por el cron | `expirarBeneficiosEnTx` en el barrido: beneficio `EXPIRED`, asignaciones vivas `EXPIRED`, movimiento `EXPIRED` en el ledger; un beneficio vencido no se reactiva ni se usa. | ✅ escenario F |

## 16 · ECONOMICS (§28)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| El subsidio es su propio evento | `MEMBEGO_SUBSIDY`, uno por derecho, idempotente; nunca se resta del ingreso ni del GMV. SQL: **43 eventos de subsidio** escritos por las pruebas. | ✅ |
| Las columnas de financiación viajan en el evento | `contractualAmount`, `supplierDiscountAmount`, `subsidyAmount`, `customerPaidAmount`. | ✅ |
| Prepago: ingreso = valor contractual | Bono de 200 sobre una venta de 500: ingreso 500, costo 300, margen 200, cobrado 300, subsidio 200 aparte. | ✅ escenario H |
| Comisión: ingreso = comisión | GMV 1 000, ingreso 80, neto del proveedor 920 (obligación), subsidio 500 aparte. | ✅ prueba 28, escenario A |
| Nueve cifras separadas en el reporte | GMV, ingreso, costo, margen, descuento de proveedores, subsidio de Membego (= costo promocional), cobrado a clientes, obligaciones con proveedores y **contribución tras el subsidio**. | ✅ `/superadmin/supply-v2/economia` |
| La contribución puede ser negativa y se enseña tal cual | 80 de comisión − 500 de subsidio = **−420**; la tarjeta se pone en rojo. | ✅ prueba 28, E2E |

## 17 · ADMIN UI (§29–§30)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Pestaña propia | `Beneficios` en la navegación de Supply 2.0 (novena pestaña). | ✅ `components/supply-v2/nav.tsx` |
| Listado | Una fila por beneficio con quién financia, valor, alcance, las tres cifras del presupuesto, asignados, usos (con las reservas en curso aparte), estado y vigencia. | ✅ `/superadmin/supply-v2/beneficios` |
| Asistente de 7 pasos | Qué es · Quién financia · Cuánto · A qué aplica · Presupuesto · Vigencia y usos · Resumen con **ejemplo económico** (GMV, descuento, contractual, bono, a pagar, comisión, neto, contribución). El E2E comprueba que el ejemplo dice 1 000 / 500 / 80 / 920 antes de guardar. | ✅ `wizard-beneficio.tsx`, E2E |
| Ficha completa | Qué rebaja, quién financia (con explicación), presupuesto con el ledger y el aviso de si **cuadra**, resultado económico, clientes asignados, usos en compras y libro de movimientos. | ✅ `/superadmin/supply-v2/beneficios/[id]` |
| Acciones del ciclo de vida | Aprobar, pausar, reactivar, cancelar (con motivo), asignar, retirar asignación y reversar aplicación, cada una tras su permiso. | ✅ `acciones-beneficio.tsx` |
| Nace borrador | El alta deja `DRAFT` y lo dice: no rebaja nada hasta que otra persona lo apruebe. | ✅ E2E |

## 18 · CLIENT Y PROVIDER UI (§31–§32)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| «Mis bonos y descuentos» del cliente | `/cliente/bonos`: valor, usos restantes, vigencia efectiva, quién lo pone, ofertas donde vale y botón «Usar mi beneficio» que lleva a la oferta con el bono preseleccionado. | ✅ E2E, móvil |
| Nunca ve lo que no es suyo | El DTO no lleva presupuesto, costo ni comisión; una prueba falla si aparece una clave con «budget» o «presupuesto». Los bonos de otra persona no aparecen. | ✅ escenario J |
| Si no se puede usar, dice por qué | Mensaje en castellano sin tecnicismos («Ya usaste este beneficio», «Este beneficio se agotó», «Ahora mismo no hay ofertas activas donde usarlo»). | ✅ E2E journey 5 |
| Selector en la oferta | Lista los beneficios del cliente aplicables, con el desglose (precio Membego, descuento del proveedor, beneficio Membego, a pagar) recalculado en el servidor al cambiar la cantidad. | ✅ `boton-comprar.tsx` |
| El proveedor ve lo suyo | `/admin/supply-v2/beneficios`: qué promoción afecta a sus ofertas, **cuánto pone él** y **cuánto pone Membego**, por separado; ventas con valor contractual y neto; liquidación con el aviso de que el bono no sale de su neto. | ✅ E2E |
| El bono de Membego nunca se presenta como suyo | «No pones nada» cuando lo financia Membego; «Membego financió X: no sale de tu neto» en cada venta. | ✅ E2E |

## 19 · AUTHORIZATION, AUDIT E IDEMPOTENCIA (§34)

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Seis permisos separados | `SUPPLY_V2_BENEFIT_VIEW · CREATE · APPROVE · ASSIGN · CANCEL · FINANCE_VIEW`, con etiqueta en el catálogo y guardia en cada acción. `scripts/permisos-catalogo.mjs`: 93 funciones, guardia viva en las dos direcciones. | ✅ prueba 29 |
| Segregación de funciones | Quien crea un beneficio no lo aprueba si hay más de una persona autorizada; con una sola, el sistema no se bloquea. Comprobado también en el navegador: compras recibe el aviso y el beneficio sigue en borrador; finanzas lo aprueba. | ✅ prueba 22, escenario «alta», E2E |
| Todo queda en la bitácora | 12 acciones nuevas (`SUPPLY_V2_BENEFIT_CREATED/APPROVED/PAUSED/RESUMED/CANCELLED/GRANTED/GRANT_CANCELLED/RESERVED/APPLIED/RELEASED/REVERSED` y `SUPPLY_V2_ORDER_COVERED_BY_BENEFIT`), con etiqueta en castellano. SQL: **482 registros** escritos por las pruebas. | ✅ |
| Idempotencia | Aprobar, asignar, aplicar, liberar, reversar y confirmar la cobertura total son idempotentes: repetir no duplica movimientos ni derechos (verificado contando filas). | ✅ escenarios «alta», B, I |
| La propiedad se decide en el servidor | El cliente nunca manda su `customerId`: sale de la sesión. La orden cubierta solo la confirma su dueño. | ✅ escenario B |

## 20 · PRUEBAS, PUERTAS Y REGRESIÓN

| Puerta | Resultado | Estado |
| --- | --- | --- |
| Dominio del Slice 6 (`tests/supply-v2-slice6-dominio.test.ts`) | **30 pass · 0 fail** (el prompt pedía 20) | ✅ |
| PostgreSQL del Slice 6 (`tests/postgres/supply-v2-slice6.db.test.ts`) | **17 pass · 0 fail** — escenarios A–J completos, incluidas las dos carreras de concurrencia | ✅ |
| `npm run test:db` (todas las suites de base) | **131 pass · 0 fail** (114 antes del slice) | ✅ |
| `npm test` (dominio completo) | **3 361 tests · 3 354 pass · 0 fail · 6 skip** (3 331 antes) | ✅ |
| E2E Slice 6 escritorio | **1 passed** (1,6 min): journeys 1–5 completos | ✅ |
| E2E Slice 6 móvil | **1 passed** (28 s): «Mis bonos» → oferta → cobertura total | ✅ |
| E2E Slices 1–3 (regresión) | **7 passed** | ✅ |
| E2E Slices 4–5 (regresión) | **5 passed** | ✅ |
| `tsc --noEmit` | exit 0 | ✅ |
| `eslint src tests` | 0 errores (15 avisos preexistentes) | ✅ |
| `next build` | compila; rutas nuevas presentes (`/superadmin/supply-v2/beneficios`, `/beneficios/nuevo`, `/beneficios/[id]`, `/cliente/bonos`, `/admin/supply-v2/beneficios`) | ✅ |
| `scripts/rls-cobertura.mjs` | todos los archivos con consultas usan `conEmpresa`/`sinEmpresa` | ✅ |
| `scripts/transacciones-anidadas.mjs` | ninguna transacción anidada | ✅ |
| `scripts/permisos-catalogo.mjs` | catálogo correcto | ✅ |
| `scripts/rls-capa2-preflight.mjs` | 258 tablas, 244 cubiertas; ninguna quedaría denegada sin decisión | ✅ |
| Migraciones | 2 nuevas (enums aparte, por la regla de PostgreSQL de no usar un valor nuevo en la misma transacción), idempotentes; **base creada desde cero** y `migrate deploy` aplicado **dos veces** (la segunda: «No pending migrations») | ✅ |
| Drift | `migrate diff --from-migrations --to-schema-datamodel`: **No difference detected** (exit 0) | ✅ |
| Migraciones anteriores intactas | `tests/migraciones-inmutables.test.ts` pasa; solo se resselló la del propio Slice 6, que nunca se aplicó fuera de esta rama | ✅ |
| Supply V1 intacto | `git diff` sobre `src/modules/supply`, `src/components/supply`, `src/app/(superadmin)/superadmin/supply`, `src/app/(cliente)/cliente/beneficios` y `prisma/schema/supply.prisma`: **vacío**. Por eso «Mis beneficios» del cliente (V1) no se tocó y el Slice 6 vive en `/cliente/bonos` | ✅ |
| Invariantes en toda la base, por SQL | 0 presupuestos descuadrados frente al ledger · 0 órdenes que rompan `contractual = GMV − descuento` y `total = contractual − bono` · 0 derechos con subsidio sin valor contractual · 0 presupuestos sobregirados · 0 reservas con importes negativos | ✅ |

### Cambios de comportamiento en slices previos, justificados

1. **`total` de orden y línea pasa a significar «lo que paga el cliente»** (antes
   coincidía con el valor de la venta porque no había beneficios). El valor de
   la venta vive ahora en `contractualValue`. Las ventas anteriores se
   rellenaron con `contractual = total`, así que nada cambió de significado
   hacia atrás.
2. **Tres CHECK anteriores se reemplazaron** porque escribían a mano la
   suposición «pagar = valer»: `supply_v2_customer_orders_amounts`,
   `supply_v2_customer_order_lines_amounts` y
   `supply_v2_customer_orders_commission`; más los dos de liquidación, para que
   el bruto sea el GMV y el neto se calcule sobre el contractual. Los nuevos son
   más estrictos: obligan a que las cuatro cifras de financiación cuadren en
   cada fila.
3. **El ingreso de una venta de supply pasa a ser su valor contractual** (antes,
   lo que pagó el cliente). Sin beneficios es la misma cifra; con bono, el
   margen bruto no se hunde por una promoción, y la promoción se ve en su
   propia línea.
4. **El bruto de la liquidación es el GMV** (contractual + descuento del
   proveedor), no lo que pagó el cliente.

## 21 · RIESGOS REALES

| Riesgo | Detalle | Mitigación hoy |
| --- | --- | --- |
| Un beneficio sin presupuesto | `budgetTotal = null` no tiene tope: una campaña mal configurada puede subsidiar sin límite. | La pantalla lo advierte y el asistente calcula cuántas aplicaciones alcanzan con el presupuesto escrito. ⚠️ Queda a criterio de quien aprueba. |
| La reserva caducada que nadie liberó | Si el cron no corrió y la orden sigue viva, aplicar consolida una reserva ya vencida. | Es la política segura: el presupuesto siguió reservado, así que la aplicación es consistente. Si el cron la liberó, está `EXPIRED` y la máquina de estados de la orden lo impide antes. |
| Obligación parcialmente pagada en una liquidación | El CHECK de liquidación exige `neto = bruto − descuento − comisión`; una obligación pagada a medias entraría por su saldo y no cuadraría. | Comportamiento heredado del Slice 5, no introducido aquí. ⚠️ Pendiente de decidir si la liquidación debe excluir obligaciones con pagos parciales. |
| Un solo beneficio por línea | `combinable` existe en el modelo pero hoy siempre es `false`. | Decisión explícita del §18; el modelo ya guarda el campo para cuando se quiera abrir. |
| La vista previa del cliente puede quedar vieja | Entre ver el desglose y comprar, el presupuesto puede agotarse. | El servidor revalida y reserva con el candado puesto; el cliente recibe el motivo en castellano, no un error técnico. |

## 22 · FUERA DE ALCANCE (§41)

⛔ Constructor de campañas · segmentación automática · cupones públicos ·
membresías · referidos · puntos · automatización multicanal · monedero general
del cliente · integración bancaria real · contabilidad completa.

---

### Resumen

El recorrido del §2 está implementado y **demostrado desde la interfaz**, con
sus consecuencias comprobadas en PostgreSQL: marketplace → producto → orden
completa → beneficio aplicado → motor de financiación → reparto → diferencia a
pagar → checkout → confirmación (bancaria o cobertura total) → derecho → QR →
entrega del proveedor → reconocimiento económico → liquidación.

Las cuatro suites quedan en verde (**30** de dominio, **17** de PostgreSQL,
**2** de Playwright del Slice 6 y **12** de regresión de los Slices 1–5), las
puertas de CI pasan, el esquema no tiene drift, la base se construye desde
cero dos veces y **Supply V1 no tiene una sola línea de diferencia**.
