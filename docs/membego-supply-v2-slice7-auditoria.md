# MEMBEGO SUPPLY 2.0 — Auditoría del Vertical Slice 7

Fecha: **2026-10-01** · Rama: `claude/jolly-brahmagupta-dmhml9` · Base:
`88f91b0` (`origin/main`, merge del PR #536, que dejó integrados los Slices 1–6).

Alcance: **CAMPAÑAS, PROMOCIONES AVANZADAS Y CUPONES** — campaña con
presupuesto aprobado y ciclo de vida → ofertas participantes de uno o varios
proveedores → promociones que son beneficios del Slice 6 → cupones públicos y
privados → marketplace y ficha pública → checkout con el código verificado en
el servidor → derecho, QR y entrega de siempre → portal del proveedor →
economía, liquidación y tablero con atribución congelada.

Método: **no se marca ✅ por existencia de código ni porque el proyecto
compile.** Cada criterio se comprobó contra una fuente primaria: la salida de
las cuatro suites (dominio, PostgreSQL, Playwright escritorio y Playwright
móvil), consultas SQL sobre lo que las pruebas dejaron escrito, una base creada
desde cero con `migrate deploy` aplicado dos veces, `git diff` sobre las zonas
prohibidas y las mismas puertas que corre CI.

Leyenda: ✅ verificado con evidencia · ⚠️ observación o riesgo (no bloquea) ·
⛔ fuera de alcance por decisión del prompt.

La cifra que manda en todo el slice, la del enunciado:

> **Oferta de RD$1 000. El proveedor pone 100 y Membego pone 300. El cliente
> paga 600. El valor contractual es 900. La comisión del 8 % se calcula sobre
> esos 900 → 72. El proveedor cobra neto 828. El costo promocional de Membego
> es 300.**

Está verificada en las tres capas: dominio (prueba 17), PostgreSQL (escenario F)
y navegador (recorrido de escritorio, pasos 10–16).

> **Este informe separa a propósito dos cosas:**
> las **correcciones previas** (§0, defectos que ya existían y se arreglaron
> aparte, con su propio commit y sus propias pruebas) y las **funcionalidades
> nuevas** del Slice 7 (§1 en adelante).

---

## 0 · FASE 0 — AUDITORÍA DE RIESGOS FINANCIEROS PREVIOS Y CORRECCIONES AISLADAS

El prompt pedía revisar cuatro riesgos concretos antes de añadir nada. Esto es
lo que se encontró y lo que se hizo, en commits y pruebas **separados** del
Slice 7.

### 0.1 · Liquidaciones con obligaciones pagadas parcialmente — **3 defectos reales de dinero, corregidos**

Commit aislado: **`1379432`** · prueba:
`tests/postgres/supply-v2-liquidacion-parcial.db.test.ts` (3 pruebas).

| # | Defecto | Consecuencia real | Corrección |
| --- | --- | --- | --- |
| 1 | `obligacionesLiquidablesEnTx` admite obligaciones `PARTIALLY_PAID` y la línea se escribía con `supplierNet = outstandingAmount`, pero el CHECK exigía la igualdad `supplierNet = grossAmount − supplierDiscountAmount − commissionAmount`, que solo se cumple si no se pagó nada. | En cuanto un proveedor tenía **una** entrega con anticipo, generar su liquidación fallaba con un error crudo de PostgreSQL y **todo el periodo quedaba sin liquidar**. Nadie podía pagarle. | Se añadieron `alreadyPaidAmount` (línea) y `alreadyPaidTotal` (cabecera) y la identidad se cierra **exacta**: `supplierNet = grossAmount − supplierDiscount − commission − alreadyPaid`. No se relajó el CHECK a una desigualdad, que habría dejado pasar netos bajos por error. |
| 2 | `recalcularLiquidacionEnTx` sumaba `paidAmount` de todas las obligaciones de la liquidación, incluidos los anticipos cobrados **antes** de generarla. | La liquidación nacía «parcialmente pagada» por un dinero que no se pagó contra ella: el proveedor **cobraba de menos** el resto. | Se resta `alreadyPaidTotal`: `pagado contra esta liquidación = pagado en obligaciones − ya adelantado`, con suelo en cero. |
| 3 | `recalcularTotalesDeLiquidacionEnTx` resumía solo 3 de las 8 columnas de dinero de la cabecera. | Tras cualquier recálculo la cabecera quedaba descuadrada respecto a sus líneas. | Resuma las ocho. |

Evidencia: la prueba demuestra el fallo y el arreglo — la liquidación nace con
`paidAmount = 0`, el pendiente es 500 (no 0, ni 1 000), la identidad cuadra al
centavo y el CHECK sigue siendo una **igualdad**, no una desigualdad.
En la interfaz: `liq-adelantado` y la columna «Ya adelantado».

Este riesgo ya estaba anotado como ⚠️ en la auditoría del Slice 6 («Obligación
parcialmente pagada en una liquidación … pendiente de decidir»). Ahora está
cerrado.

### 0.2 · Beneficios financiados por Membego sin presupuesto máximo — **endurecido en el Slice 7**

No era un defecto del Slice 6 (el campo es opcional **a propósito**), pero sí el
agujero que el §17 del prompt pide cerrar para campañas. Hoy:

* una campaña que compromete dinero de Membego **exige techo**;
* ir sin techo requiere **motivo escrito + persona que lo autoriza + fecha**,
  guardados en la campaña y en la bitácora (`SUPPLY_V2_CAMPAIGN_BUDGET_WAIVED`);
* lo sostiene la base: CHECK `supply_v2_campaigns_shape` con
  `("budgetTotal" IS NOT NULL OR "funding" = 'SUPPLIER' OR ("budgetWaiverById" IS NOT NULL AND "budgetWaiverReason" IS NOT NULL))`.

Verificado: prueba «§17 · una campaña que financia Membego exige techo; sin él
queda la autorización en la bitácora» y SQL
`campanas_sin_tope_sin_autorizacion = 0`.

### 0.3 · Reservas de beneficio vencidas — **sin defecto; política confirmada**

Se revisó el camino completo: `expirarReservasEnTx` (barrido) libera y devuelve
presupuesto; `aplicarReservaEnTx` consolida sobre una reserva viva; la máquina
de estados de la orden impide consolidar una orden ya vencida. No se encontró
camino que duplique o pierda presupuesto. SQL sobre toda la base:
`presupuesto_sobregirado = 0`. El Slice 7 añade el escenario E, que lo prueba
también con cupón: el checkout vencido libera cupón **y** presupuesto sin
duplicar nada.

### 0.4 · Compatibilidad del nuevo significado de los campos económicos — **sin defecto**

El Slice 6 cambió el significado de `total` (lo que paga el cliente) y movió el
valor de la venta a `contractualValue`. El Slice 7 **no vuelve a cambiar
ninguno**: no añade campos de dinero a `SupplyV2CustomerOrder` salvo la
atribución (`campaignId`, `couponCodeSnapshot`), que no son importes. Los
reportes y la economía siguen leyendo lo mismo. Verificado: escenario I («un
pedido sin campaña funciona igual que antes») y la regresión E2E de los
Slices 1–6.

### 0.5 · «Mis bonos» dejaba de ver su oferta cuando el catálogo crecía — **defecto real, corregido**

Prueba: `tests/postgres/supply-v2-mis-bonos-ofertas.db.test.ts` (2 pruebas).

`misBeneficios` (`/cliente/bonos`, Slice 6) pedía **una página de 300 ofertas
activas, sin orden y sin filtrar por el alcance del beneficio**, y cruzaba en
memoria. Con más de 300 ofertas vivas, la oferta del bono podía quedar fuera de
esa página y la tarjeta del cliente decía «Ahora mismo no hay ofertas activas
donde usarlo» **teniéndolas**, sin enlace para usarlo: un beneficio ya
concedido se volvía invisible y se vencía solo.

Se vio al correr la regresión del Slice 6 contra la base de pruebas, que ya
tenía 573 ofertas activas acumuladas. Corrección: **filtra la base, no el
servidor** — se consulta solo por lo que los beneficios de ese cliente pueden
cubrir (oferta concreta, producto o proveedor, los tres alcances del §9) y con
orden explícito.

Evidencia de que la prueba vale: con el arreglo revertido, **falla**
(`pass 0 · fail 2`); con el arreglo, **pasa** (`pass 2 · fail 0`). La prueba
inserta 320 ofertas de relleno para no depender del tamaño de la base.

### Lo que NO se tocó

No se amplió el alcance: no se reescribió la liquidación, no se cambió la
política de `combinable`, no se migró ningún dato histórico y no se tocó ningún
importe ya escrito. Las dos correcciones de dinero son aditivas (columnas con
`DEFAULT 0`) y compatibles con los datos existentes.

---

## 1 · BASE COMMIT Y PRESENCIA DE LOS SLICES ANTERIORES

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| `main` remoto al iniciar | `origin/main` = `88f91b0`. El PR del Slice 6 (#535) ya estaba mergeado, así que la rama se **reinició** sobre `origin/main` en vez de apilar sobre historia ya fusionada. | ✅ |
| Slices 1–6 presentes | Ancestros de `HEAD`: `36b2c3c` (S1), `ffaaffc` (S2), `b7e2663` (S3), `aaf3693` (S4), `f74b8eb`+`c33ff84` (S5), `221c267`+`3f3145f` (S6, con la reparación del cruce con la segregación unificada). Ninguno falta: **no se detuvo el trabajo** porque la precondición del prompt se cumple. | ✅ |
| Línea base antes de escribir código | Sobre `88f91b0`: `tsc --noEmit` exit 0 · `npm run test:db` **132 pass · 0 fail** · `npm test` **3 357 pass · 0 fail**. | ✅ |
| Auditoría previa del esquema y los servicios | Se leyeron `prisma/schema/supply-v2.prisma`, las 172 migraciones aplicadas, `core/{financiacion,dinero,estados,numeracion,auditoria,segregacion,autorizadas}.ts`, `benefits/*`, `commerce/checkout.ts`, `finance/*`, `economics/*` y `redemption/*` **antes** de crear tablas. De ahí salieron las cinco decisiones de reutilización de §2. | ✅ |
| Rama exclusiva | Todo en `claude/jolly-brahmagupta-dmhml9`, reiniciada desde `origin/main`. Sin `push` a otra rama, sin merge, sin despliegue. | ✅ |
| Producción intacta | No se tocó ninguna base de datos de producción. Todas las pruebas corren contra PostgreSQL local (`membego_dev`) y una base desechable (`membego_s7_fresh`, creada y borrada). | ✅ |

## 2 · ARQUITECTURA Y NO DUPLICACIÓN (FASE 1)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Módulo propio | `src/modules/supply-v2/campaigns/` con cuatro archivos: `domain.ts` (reglas puras, 540 líneas), `service.ts` (transacciones, 726), `coupons.ts` (cupones, 424) y `queries.ts` (lecturas, 838). Las acciones viven en `actions-campanas.ts`. | `src/modules/supply-v2/campaigns/` |
| **No hay segundo motor de precios ni de descuentos** | La promoción de una oferta de campaña **es** un `SupplyV2Benefit` del Slice 6: `adjuntarPromocionEnTx` llama a `crearBeneficioEnTx` y le cuelga `campaignId`. El reparto lo sigue calculando `calcularRepartoLinea` (Slice 6) y nadie más. `grep` de fórmulas de dinero en `campaigns/`: solo repartos de **presupuesto** (centavos), nunca de precio. | `campaigns/service.ts` |
| **No hay segundo motor de pagos** | El checkout, el aviso de pago, la confirmación y la conciliación son los de los Slices 2–5, sin tocar. El cupón entra por un campo nuevo (`couponCode`) en `DatosCheckout`. | `commerce/checkout.ts` |
| **No hay segundo motor de redenciones** | Derecho, voucher, QR, nonce y entrega del proveedor son los del Slice 3. Un cupón aplicado **no** marca nada como entregado: la entrega sigue necesitando el QR. | `redemption/service.ts` (sin cambios) |
| **No hay segundo contador de presupuesto** | El presupuesto de la campaña es el **techo aprobado**; lo reservado y lo consumido se **leen** del ledger de sus beneficios (`presupuestoDeCampana`). No existe columna `budgetReserved` en la campaña: no hay nada que descuadrar. | `campaigns/domain.ts` |
| **Un cupón no es un descuento aparte** | `SupplyV2CouponRedemption.reservationId` es **`@unique`**: la aplicación del cupón cuelga 1:1 de la reserva del beneficio. El dinero lo mueve la reserva; el cupón solo registra que se usó, con los mismos importes. SQL: `redenciones_sin_reserva = 0`, `redenciones_importe_distinto = 0`. | `prisma/schema/supply-v2.prisma` |
| **No hay otro marketplace** | La sección de campañas vive dentro de `/promociones` (el marketplace del Slice 2) y la ficha pública enlaza a `/promociones/membego/[slug]`, la misma página de oferta de siempre. | `src/app/(public)/promociones/` |
| Reglas puras separadas de la base | `campaigns/domain.ts` no importa Prisma para consultar: **28 pruebas sin base de datos**. | `tests/supply-v2-slice7-dominio.test.ts` |
| Cuatro públicos, cuatro DTOs | `CampanaEnLista`/`FichaCampana` (admin, con presupuesto y economía), `CampanaPublica`/`CuponDelCliente` (cliente, sin presupuesto ni costos ni comisión), `CampanaDelProveedor` (proveedor: su aporte y el de Membego por separado), `PromocionDeOferta` (cálculo de una compra). Una prueba recorre las claves del DTO del cliente y falla si aparece «budget» o «presupuesto». | `campaigns/queries.ts` · prueba «Mis cupones» |

## 3 · MODELO DE DATOS (FASE 2)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Se evaluó antes de crear tablas | Se reutilizan `SupplyV2Benefit` (promoción), `SupplyV2BenefitReservation` (dinero reservado), `SupplyV2CustomerBenefit` (asignación), `SupplyV2CustomerOrder`/`Line` (venta), `SupplyV2Entitlement` (derecho) y toda la cadena de finanzas. Tablas **nuevas**: solo 5. | `prisma/schema/supply-v2.prisma` |
| `SupplyV2Campaign` | Código `MBG-CP-AAAA-NNNNNN`, nombre, descripción, objetivo, organizador, proveedor opcional, financiación, moneda, techo de presupuesto + autorización sin techo (motivo/quién/cuándo), público, vigencia, horario (`activeFromMinute`/`activeToMinute`), límites (total y por cliente), estado, creador, aprobador, publicador, notas de revisión, cancelación con motivo y cierre. | idem |
| `SupplyV2CampaignOffer` | Única por `(campaignId, offerId)`, con `benefitId` opcional (su promoción), posición y destacada. **La oferta no cambia**: conserva proveedor, precio, acuerdo y disponibilidad. | idem |
| `SupplyV2Coupon` | Código único (y único también en mayúsculas, por índice sobre `upper(code)`), campaña, promoción a la que abre, tipo (`PUBLIC`/`PRIVATE`), dueño cuando es privado, lote, límites (total y por cliente), compra mínima, usos, vencimiento, estado y creador. | idem |
| `SupplyV2CouponRedemption` | Cupón, **reserva (`@unique`)**, cliente, pedido, importe de Membego y del proveedor, estado (`RESERVED · APPLIED · RELEASED · REVERSED`). | idem |
| `SupplyV2CampaignDistribution` y `SupplyV2CampaignEvent` | Lotes de cupones con sus cuentas, y bitácora propia de la campaña (15 tipos de evento) que **no se borra nunca**. | idem |
| La base sostiene los invariantes | `supply_v2_campaigns_shape` (forma coherente + «sin techo solo con autorización» + horario completo o vacío) · `supply_v2_coupons_limits` (privado con dueño, público sin dueño, código en mayúsculas, largo ≥ 4, usos ≤ tope) · `supply_v2_coupon_redemptions_amounts` · `supply_v2_campaign_distributions_counts` · índice único parcial `supply_v2_coupon_redemptions_viva_por_cliente` · índice único `supply_v2_coupons_code_upper`. | `prisma/migrations/20261020_supply_v2_slice7/migration.sql` |
| Los CHECK no son decorativos | Una prueba intenta cinco escrituras directas ilegales (cupón privado sin dueño, público con dueño, usos por encima del tope, campaña sin techo sin autorización, importes negativos) y PostgreSQL las rechaza por nombre de constraint. | prueba «la base sostiene los topes del cupón y la forma de la campaña» |
| Migraciones aditivas y seguras | Dos migraciones nuevas, **ninguna aplicada se editó**. Los enums van en su propia migración porque PostgreSQL no permite usar un valor de enum nuevo en la transacción que lo crea. Todo es `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX` idempotente; ninguna columna nueva es obligatoria sin `DEFAULT`. | `20261019_supply_v2_slice7_enums`, `20261020_supply_v2_slice7` |

## 4 · CICLO DE VIDA Y ESTADOS DE LA CAMPAÑA (FASE 3)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Siete estados | `DRAFT · PENDING_APPROVAL · SCHEDULED · ACTIVE · PAUSED · COMPLETED · CANCELLED`. | `campaigns/domain.ts` |
| Máquina de estados centralizada | `TRANSICIONES_CAMPANA` + `exigirTransicion` (el helper compartido de `core/estados.ts`). `COMPLETED` y `CANCELLED` son finales. Ningún servicio escribe `status` sin pasar por ahí. | `campaigns/service.ts` |
| Nace borrador y pide aprobación cuando compromete dinero | `crearCampanaEnTx` siempre escribe `DRAFT`. `enviarARevisionEnTx` exige al menos una oferta **y** al menos una promoción («ninguna oferta rebajaría nada»). | prueba «ciclo: borrador → revisión → aprobación de OTRA persona → publicada» |
| Segregación de funciones | `aprobarCampanaEnTx` usa `revisarSegregacion` (unificado en `core/segregacion.ts`): quien la creó no la aprueba. Con una sola persona autorizada pasa, pero queda el rastro `MOTIVO_AUTOAPROBACION`. Permisos distintos para crear, aprobar y publicar. | prueba de ciclo · E2E paso 6 |
| Publicar decide SCHEDULED o ACTIVE | `estadoAlPublicar` compara con la fecha de inicio: si aún no empezó, queda `SCHEDULED` y el barrido la activa. | prueba «una campaña programada se activa por el barrido cuando llega su fecha» |
| Pausar quita la promoción de compras nuevas | `pausarCampanaEnTx` pausa la campaña; el checkout comprueba el estado de la campaña y el beneficio deja de aplicarse. Reactivar la devuelve. | escenario J (segunda prueba) |
| Cancelar no reescribe lo aplicado | `cancelarCampanaEnTx` cancela los cupones vivos y cierra la campaña, pero **no toca** reservas aplicadas, derechos, obligaciones ni liquidaciones. | escenario J |
| Todo deja evento y bitácora | `SupplyV2CampaignEvent` por cada paso + `auditarEnTx` con 14 acciones nuevas de `AuditAccion`, todas con etiqueta legible (lo verifica la prueba «cada acción del enum tiene su etiqueta legible»). | `campaigns/service.ts` · `modules/auditoria/queries.ts` |

## 5 · ASISTENTE DE 8 PASOS (FASE 4, §5)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Ocho pasos | Objetivo · Empresas · Productos · Promoción · Financiación · Público · Vigencia · Resumen. | `src/components/supply-v2/wizard-campana.tsx` |
| Enseña la economía ANTES de guardar | El paso 8 muestra, sobre la primera oferta elegida: GMV, descuento del proveedor, valor contractual, subsidio de Membego, **lo que paga el cliente**, comisión, neto del proveedor y contribución tras el subsidio; y cuántas aplicaciones alcanzan con el presupuesto escrito. | idem |
| La vista previa coincide con el servidor | El E2E de escritorio comprueba en esa pantalla 1 000 / 900 / 600 / 72 / 828 **antes** de guardar, y después las mismas cifras en el checkout, en la venta, en la liquidación y en SQL. | `tests/e2e/supply-v2-slice7.spec.ts` |
| La campaña nace borrador y **completa** | `crearCampanaCompletaEnTx` guarda, en **una** transacción, la campaña, sus ofertas participantes y una promoción por oferta, repartiendo el techo en centavos (el sobrante al primero) para que la suma cuadre **exacta** con el techo aprobado. | `campaigns/service.ts` · prueba «§5 · el asistente guarda la campaña COMPLETA» |
| Se puede rebalancear después | `ajustarPromocionEnTx` cambia el techo, el valor y las condiciones de una promoción ya puesta, con el límite del §16, sin crear otro beneficio. | prueba «§16 · ajustar la promoción rebalancea el techo…» |
| El asistente no inventa el tipo | Elegir el tipo de promoción arrastra lo que implica (compartida → las dos partes; bienvenida → clientes nuevos; tiempo limitado → horario), en el manejador y no en un efecto, así que quien lo cambie después manda. | `wizard-campana.tsx` |

**Defecto encontrado y corregido durante el E2E:** el asistente recogía las
ofertas participantes en el paso 3 pero `crearCampanaAction` solo creaba la
campaña — las ofertas **se perdían entre pantallas** y la campaña nacía vacía
(y por tanto no se podía ni aprobar). El recorrido de navegador lo destapó
(`btn-abrir-promocion` nunca aparecía) y de ahí salió
`crearCampanaCompletaEnTx`. Es exactamente el tipo de fallo que no se ve
mirando código.

## 6 · TIPOS DE PROMOCIÓN Y PROGRAMACIÓN (FASE 5, §6–§7)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Ocho tipos | `DESCUENTO_FIJO · DESCUENTO_PORCENTUAL · CUPON_FIJO · CUPON_PORCENTUAL · BIENVENIDA · TIEMPO_LIMITADO · BONO_ASIGNADO · COMPARTIDA`, cada uno con su explicación en castellano. | `core/catalogo.ts` (`TIPOS_DE_PROMOCION`) |
| Cada tipo se traduce a campos del beneficio | No hay ocho implementaciones: el tipo decide `valueType`, quién financia, `requiresCoupon`, `requiresAssignment`, el público y el horario. El motor es uno. | `wizard-campana.tsx` · `campaigns/service.ts` |
| La vigencia la decide el SERVIDOR | `fueraDeVigencia` y `minutosLocales` (zona `America/Santo_Domingo`, vía `Intl`) se comprueban **en cada compra**, dentro de la transacción del checkout. | prueba «la vigencia la decide el SERVIDOR en cada compra, no el cron» |
| El cron solo mantiene estados | `barridoCampanasEnTx` activa las programadas, cierra las terminadas y vence los cupones; **no es la única protección**: una campaña programada que el cron no activó tampoco aplica, y una terminada que el cron no cerró tampoco. | `commerce/barrido.ts` · prueba del barrido |

## 7 · OFERTAS PARTICIPANTES (FASE 6, §8)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Varias ofertas, varias empresas | `SupplyV2CampaignOffer` admite N ofertas; una campaña que organiza Membego puede mezclar proveedores. | `campaigns/service.ts` |
| Cada oferta conserva lo suyo | `agregarOfertaEnTx` **no escribe nada** en la oferta: ni precio, ni proveedor, ni acuerdo, ni disponibilidad. Solo crea la fila de participación. | idem |
| No se crea inventario ficticio | No hay asignación de lote, ni `quantityLimit`, ni allocation nueva. La disponibilidad sigue siendo la de la oferta. | idem |
| No se alteran acuerdos históricos | La comisión que se aplica es la congelada en la oferta al publicarla (Slice 5). La campaña no la toca. | escenario G |
| Un proveedor solo propone lo suyo | `OFERTA_DE_OTRO_PROVEEDOR` cuando el organizador es el proveedor, o cuando la campaña la cofinancia un proveedor y la oferta es de otro. | prueba «una propuesta de proveedor … solo admite sus ofertas» |
| Quitar una oferta usada está prohibido | `OFERTA_CON_USOS` si su promoción tiene reservas vivas o aplicadas: no se pierde el rastro. | `quitarOfertaEnTx` |

## 8 · CUPONES: PÚBLICOS, PRIVADOS Y GENERACIÓN (FASE 7, §9–§11)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Público y privado | `kind = PUBLIC` (cualquiera que cumpla las reglas) o `PRIVATE` (con dueño). La base lo sostiene: privado **debe** tener dueño, público **no** puede tenerlo. | `supply_v2_coupons_limits` |
| **El código es una referencia comercial, no una credencial** | `resolverCuponEnTx` resuelve el cupón y después vuelve a comprobar **todo**: estado del cupón, dueño, campaña activa, vigencia, horario, público objetivo, elegibilidad del beneficio, límites del cupón, límites del cliente, compra mínima y presupuesto. Saber el código no salta ninguna regla. | `campaigns/coupons.ts` · `campaigns/domain.ts` |
| El cupón privado de otro se rechaza aunque se sepa | Escenario B. | prueba B |
| Mensaje opaco | `MENSAJE_CUPON_OPACO` = «Ese código no existe o no se puede usar en esta compra»: quien prueba códigos a mano no distingue «no existe» de «no es tuyo». | `campaigns/domain.ts` · `actions-cliente.ts` |
| Generación individual, por lote y a medida | `generarCuponesEnTx` con código a medida, prefijo + aleatorio, o lote; hasta 1 000 de una vez. Los lotes quedan en `SupplyV2CampaignDistribution`. | `campaigns/coupons.ts` |
| Códigos seguros | `randomBytes` (no `Math.random`), alfabeto sin caracteres confundibles (`ACDEFGHJKMNPQRTVWXY34679`), colisiones tratadas por `P2002`. **Los códigos nunca se escriben en la bitácora.** | idem |
| Restricciones del cupón | Vencimiento, usos totales, usos por cliente, compra mínima, y la promoción concreta a la que abre. | `SupplyV2Coupon` |
| `requiresCoupon` cierra el agujero | Una promoción marcada «se abre con cupón» **no se aplica** sin código, ni mandando el `benefitId` directamente desde el navegador: el motivo `EXIGE_CUPON` vive en `motivoNoElegible`, en el dominio del Slice 6. | prueba «una promoción de cupón NO se abre sin el código, ni mandando el id del beneficio» |
| Aplicar un cupón **no** entrega el producto | La aplicación crea `SupplyV2CouponRedemption` y la reserva del beneficio. El derecho y su entrega siguen necesitando pago confirmado y QR. | escenario F y E2E pasos 12–15 |
| Cancelar un cupón en uso está protegido | No se cancela a la ligera un cupón con una aplicación viva en un checkout en curso. | prueba «un cupón en un checkout en curso no se puede cancelar a la ligera» |

## 9 · PÚBLICO OBJETIVO (FASE 8, §12–§14)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Cinco públicos básicos, sin CRM | `ALL · NEW_CUSTOMERS · RETURNING_CUSTOMERS · PAST_CAMPAIGN · SELECTED`, calculados con lo que Membego ya sabe de su propia operación: si compró y si usó una promoción. | `campaigns/domain.ts` (`fueraDePublico`) |
| **No se infiere nada sensible** | No hay edad, género, ubicación, ingresos ni inferencia de hábitos. La pantalla lo dice: «Los grupos se calculan con lo que Membego ya sabe de su propia operación. No se deduce nada más sobre la persona.» | `wizard-campana.tsx` |
| El público se comprueba en el servidor | En cada compra y al listar «Mis cupones». | prueba «público objetivo: un cupón de bienvenida no vale para quien ya compró» |
| Asignación individual | `asignarCampanaAClienteEnTx` asigna todas las promociones de la campaña al cliente, y es **idempotente**: un reintento no duplica. | prueba «asignar una campaña a un cliente es idempotente» |

## 10 · FINANCIACIÓN Y LA CUENTA DEL ENUNCIADO (FASE 9, §15)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Tres modelos | `MEMBEGO` · `SUPPLIER` · `SHARED`, los mismos del Slice 6; la campaña los hereda a sus promociones. | `campaigns/service.ts` |
| La cuenta exacta del enunciado | 1 000 − 100 (proveedor) − 300 (Membego) → **paga 600**; valor contractual **900**; comisión 8 % sobre 900 = **72**; neto del proveedor **828**; costo promocional de Membego **300**. | dominio prueba 17 · PostgreSQL escenario F · E2E pasos 10–16 |
| **La comisión NO se calcula sobre 600** | `commissionBase = contractualSaleValue` salvo que el acuerdo diga otra cosa (`SupplyV2CommissionBase`). El E2E usa base `CONTRACTUAL_SALE_VALUE` y comprueba 72, no 48. | `core/financiacion.ts` · escenario G |
| El descuento del proveedor y el subsidio de Membego no se mezclan | Columnas y campos distintos en reserva, línea, orden, derecho, economía y liquidación. En la liquidación: contractual 900, subsidio 300, cobrado 600, neto 828. | E2E paso 16 · escenario F |
| El proveedor cobra igual con bono | El subsidio es costo de Membego, no rebaja del proveedor: la contribución de la venta queda en **−228** (72 de comisión − 300 de subsidio) y se enseña así, con signo. | E2E paso 17 (`metrica-contribucion` = `-RD$228.00`) |

## 11 · PRESUPUESTO DE CAMPAÑA (FASE 9, §16–§17)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Relación explícita campaña ↔ beneficio | El techo de la campaña es el **límite superior** de la suma de los techos de sus promociones: `cabeEnElPresupuesto` lo comprueba antes de crear o ajustar una promoción. | `campaigns/domain.ts` |
| **No se cuenta dos veces** | Reservado y consumido **se leen** del ledger de los beneficios (`presupuestoDeCampana`); la campaña no tiene contadores propios. Lo que se ve en la ficha y en el tablero es ese ledger, no una copia. | `campaigns/queries.ts` |
| Rechaza pasarse del techo | 700 + 500 sobre un techo de 1 000 → `sumarían 1200.00`; una promoción sin tope en una campaña con techo → rechazada. | prueba §16 |
| Rebalanceo seguro | Ajustar una promoción no puede dejar su techo **por debajo de lo ya reservado + consumido**, ni cambiar lo que rebaja si ya hay compras hechas. | prueba «§16 · ajustar la promoción…» |
| Techo obligatorio cuando Membego pone dinero | §0.2. Sin techo: motivo + autorizante + fecha, en la campaña y en la bitácora, sostenido por CHECK. | prueba §17 |
| Sin sobregiro bajo concurrencia | Dos compras simultáneas por el saldo final: una pasa con promoción y la otra **compra a precio completo** (no falla), y el presupuesto final cuadra exacto. | escenario D |
| Vistas de presupuesto | Ficha de campaña y tablero muestran aprobado, comprometido, reservado, consumido y disponible, con aviso si alguna promoción va sin tope. | `superadmin/supply-v2/campanas/[id]` |

## 12 · FICHA DE CAMPAÑA Y REPORTES (ADMIN, §23, §26)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Página de detalle de la campaña | `/superadmin/supply-v2/campanas/[id]`: estado y vigencia, presupuesto (aprobado / comprometido / reservado / consumido / disponible), resultado económico, ofertas participantes con su promoción y su consumo, cupones con su estado y su dueño, clientes asignados, lotes y la bitácora completa. | `src/app/(superadmin)/superadmin/supply-v2/campanas/[id]/page.tsx` |
| Acciones desde la ficha | Añadir y quitar ofertas, configurar y **ajustar** promociones, generar y cancelar cupones, asignar a clientes, enviar a revisión, aprobar, rechazar, publicar, pausar, reanudar y cancelar; cada una detrás de su permiso. | `src/components/supply-v2/acciones-campana.tsx` |
| Reportes y tablero | `/superadmin/supply-v2/campanas`: tablero con ventas confirmadas, GMV, subsidio, contribución y presupuesto consumido por campaña, y la lista filtrable. Pestaña propia en la navegación de Supply 2.0. | `src/app/(superadmin)/superadmin/supply-v2/campanas/page.tsx` |
| Quién ve el dinero | El presupuesto y la economía solo se muestran con `SUPPLY_V2_CAMPAIGN_FINANCE_VIEW`; el tablero con `_REPORT_VIEW`. Ver la campaña no es ver su costo. | `campanas/[id]/page.tsx` |
| Las cifras del tablero son las de PostgreSQL | El E2E compara la pantalla con SQL sobre el mismo pedido en el paso 17: ventas 1, GMV 1 000, subsidio 300, contribución −228, consumido 300, neto 828. | `tests/e2e/supply-v2-slice7.spec.ts` |

## 13 · MARKETPLACE Y FICHA PÚBLICA (FASE 10, §18–§20)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Sección de campañas en el marketplace existente | Bloque `campanas-marketplace` en `/promociones` + listado `/promociones/campanas`. **No se desarrolló otro marketplace.** | `src/app/(public)/promociones/` |
| Ficha pública de campaña | Nombre, descripción, empresas, condiciones en castellano («Un uso por persona»), vigencia y ofertas participantes con su rebaja; cada una enlaza a la página de oferta de siempre. | `/promociones/campanas/[code]` |
| El cliente nunca ve presupuesto ni costos | El DTO público no tiene claves de presupuesto, costo ni comisión; una prueba lo recorre y falla si aparecen. | prueba «Mis cupones» |
| Promociones visibles en la oferta | La página de oferta muestra las promociones aplicables y acepta `?cupon=` para traer el código preseleccionado. | `/promociones/membego/[slug]` |
| «Mis cupones» | `/cliente/cupones` con código, valor, vigencia, dónde usarlo, por qué no se puede usar si es el caso, y botón «Usar mi cupón». Entrada propia en el menú del cliente. | `src/app/(cliente)/cliente/cupones/` |

## 14 · CHECKOUT CON CUPÓN (FASE 10, §21)

El orden, dentro de **una** transacción:

1. identifica las promociones de la oferta;
2. si hay código, lo **resuelve con candado** (advisory lock por código + `FOR UPDATE`);
3. **verifica todo en el servidor** (estado, dueño, campaña, vigencia, horario, público, elegibilidad, límites, compra mínima, presupuesto);
4. calcula el reparto con el motor del Slice 6;
5. reserva presupuesto y uso del cupón;
6. muestra el importe final;
7. continúa con el pago existente.

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| El frontend no altera importes, límites ni presupuestos | El servidor recibe `offerId`, `quantity` y, como mucho, `couponCode`. Todo lo demás lo calcula él. Mandar `benefitId` de una promoción con cupón **no** la abre. | `commerce/checkout.ts` · prueba «ni mandando el id del beneficio» |
| Cupón y beneficio a la vez: rechazado | No se pueden combinar: la promoción sale del cupón o de la campaña, no de las dos. | `financiarLineaEnTx` |
| Promoción automática cuando no hay código | `promocionAutomaticaEnTx` aplica la promoción de campaña que no exige código ni asignación, en modo **opcional**: si el presupuesto se agotó en la carrera, la compra sigue a precio completo en vez de fallar. | escenario D |
| Vencer el checkout libera cupón y presupuesto | Sin duplicar: la reserva vuelve al ledger y la aplicación del cupón pasa a `RELEASED`. | escenario E |
| Idempotencia | Reintentos no duplican: `orderLineId` único en la reserva, `reservationId` único en la aplicación, e índice único parcial de aplicación viva por cliente. | §3 |

## 15 · PORTAL DEL PROVEEDOR (FASE 10, §22)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Ve su participación | `/admin/supply-v2/campanas`: campañas donde participa, con sus ofertas, estado y vigencia. | `src/app/(admin)/admin/supply-v2/campanas/` |
| Aporte propio y de Membego, por separado | «Pones hasta RD$100.00 por venta» / «Membego pone hasta RD$300.00 por venta», ventas atribuidas, descuento asumido, neto contractual y estado de entregas. | idem |
| **No modifica presupuestos ni condiciones ajenas** | No hay acción de escritura sobre presupuesto, techo ni financiación en el portal. Solo lectura y su propia propuesta de campaña. | `actions-campanas.ts` (todas las acciones exigen permisos de plataforma) |
| No ve lo que no es suyo | Las promociones que se le muestran se filtran a **sus** ofertas; las de otros proveedores no entran en su fila. | `campanasDelProveedor` |

**Defecto encontrado y corregido durante el E2E:** el portal sumaba los valores
por unidad de **todas** las promociones de la campaña («pones 200» cuando cada
venta le costaba 100), incluidas las de ofertas de **otros** proveedores.
Sumar valores por unidad no da dinero. Ahora se muestra el máximo por venta de
las promociones que tocan **sus** ofertas, etiquetado «hasta … por venta», y se
distingue porcentaje de importe.

## 16 · ANALÍTICA Y ATRIBUCIÓN (FASE 10, §24–§26)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Distingue visita, intención, reserva y venta confirmada | `metricasDeCampana` separa cupones emitidos, aplicaciones vivas (intención), derechos emitidos y **ventas confirmadas** (`PAID`). Lo que se promete como venta es solo lo cobrado. | `campaigns/domain.ts` |
| Atribución **congelada** en la transacción | `congelarFinanciacionEnTx` escribe `campaignId` y `couponCodeSnapshot` en el pedido. Cambiar la campaña después no reescribe ventas pasadas. | `commerce/checkout.ts` |
| Regla determinista | `campanaAtribuida`: la que más rebaja; si empatan, la que empezó antes; si siguen empatadas, por código. Sin azar: dos cálculos del mismo caso dan lo mismo. | `campaigns/domain.ts` |
| Un pedido → **una** campaña | `campaignId` es un único campo en el pedido. Una oferta en dos campañas no duplica GMV ni ingresos. SQL: `gmv_duplicado = 0`. | escenario H |
| Tablero con cifras reales | Ventas, GMV, subsidio, contribución, presupuesto consumido, economía y cupones, en `/superadmin/supply-v2/campanas` y en la ficha. Verificado contra SQL en el mismo E2E. | E2E paso 17 |

## 17 · PERMISOS, ABUSO Y AUDITORÍA (FASE 10, §27–§29)

| Criterio | Evidencia | Archivo |
| --- | --- | --- |
| Permisos separados, con separación financiera y comercial | Siete nuevos — `SUPPLY_V2_CAMPAIGN_VIEW`, `_CREATE`, `_APPROVE`, `_PUBLISH`, `SUPPLY_V2_COUPON_MANAGE`, `_CAMPAIGN_FINANCE_VIEW`, `_CAMPAIGN_REPORT_VIEW` — más `SUPPLY_V2_BENEFIT_ASSIGN` (reutilizado para asignar una campaña a un cliente): **ocho** permisos en juego. Crear no es aprobar, aprobar no es publicar, y los cupones tienen el suyo porque valen dinero. | `contracts/gateways.ts` |
| Se exigen en el **backend** | Cada server action empieza por `exigirPermisoSupplyV2(...)`. Ocultar un botón no es una protección. | `actions-campanas.ts` |
| Rate limiting al comprobar cupones | `couponLimiter`: 12 intentos cada 5 minutos, **por cliente y por IP** (dos cubos). | `src/lib/rate-limit.ts` · `actions-cliente.ts` |
| Fuerza bruta | Mensaje opaco + rate limiting + códigos de alfabeto reducido y 10 caracteres aleatorios. | §8 |
| Aplicación duplicada | Índice único parcial `supply_v2_coupon_redemptions_viva_por_cliente` + `reservationId` único. | §3 |
| Doble gasto de presupuesto | Candados en orden fijo: **cupón → campaña → beneficio → asignación**, el mismo orden que el Slice 6 extendido por arriba, así que no hay abrazo mortal con un checkout en curso. | `campaigns/coupons.ts`, `campaigns/service.ts` |
| Validación de propiedad | Cupón privado: dueño comprobado en el servidor en cada uso. | escenario B |
| Concurrencia | Escenarios C (último uso) y D (saldo final), con dos clientes a la vez. | pruebas C y D |
| Historial completo que no se borra | `SupplyV2CampaignEvent` (15 tipos) + 14 acciones nuevas en `AuditAccion`, todas con etiqueta legible. Ninguna ruta borra eventos. | §4 |

## 18 · PRUEBAS (FASE 11)

| Suite | Resultado | Estado |
| --- | --- | --- |
| Dominio del Slice 7 (`tests/supply-v2-slice7-dominio.test.ts`) | **28 pass · 0 fail** (el prompt pedía ≥ 20) | ✅ |
| PostgreSQL del Slice 7 (`tests/postgres/supply-v2-slice7.db.test.ts`) | **26 pass · 0 fail** — escenarios **A–J** completos, más ciclo de vida, §16/§17, horario, público, «Mis cupones», generación, idempotencia y los CHECK de la base | ✅ |
| Corrección 0.1 (`supply-v2-liquidacion-parcial.db.test.ts`) | **3 pass · 0 fail** | ✅ |
| Corrección 0.5 (`supply-v2-mis-bonos-ofertas.db.test.ts`) | **2 pass · 0 fail**; y **2 fail** con el arreglo revertido (la prueba demuestra el fallo) | ✅ |
| E2E Slice 7 escritorio | **1 passed** (1,0 min): el recorrido de 17 pasos completo | ✅ |
| E2E Slice 7 móvil | **1 passed** (44 s): descubrimiento, ficha, «Mis cupones», cupón, checkout, beneficios y portal del proveedor, sin desbordamiento lateral | ✅ |

Los diez escenarios que pedía el §31, uno por uno:

| | Escenario | Resultado |
| --- | --- | --- |
| A | Cupón público usado por dos clientes; el tercero fuera | ✅ |
| B | Cupón privado rechazado para otro cliente | ✅ |
| C | Último uso del cupón bajo concurrencia: solo uno pasa | ✅ |
| D | Saldo final del presupuesto: ninguna lo sobregira | ✅ |
| E | Checkout vencido libera cupón y presupuesto sin duplicar | ✅ |
| F | La economía registra descuento del proveedor y subsidio por separado | ✅ |
| G | La comisión genera la obligación contractual correcta | ✅ |
| H | Un pedido no duplica GMV aunque la oferta esté en dos campañas | ✅ |
| I | Un pedido sin campaña funciona igual que antes | ✅ |
| J | Cancelar no altera liquidaciones ya pagadas | ✅ |

El recorrido de escritorio (§32), los 17 pasos, **en este orden y desde la
interfaz**: asistente de 8 pasos → ofertas participantes → financiación
compartida → presupuesto y techo que manda → cupón público con su código →
aprobación de otra persona → publicación → marketplace → ficha de campaña →
producto → cupón aplicado (1 000 − 100 − 300 = 600) → pago → confirmación de
finanzas → derecho → QR → entrega del proveedor → liquidación (neto 828) →
tablero. Capturas en `test-results/shots/supply-v2-s7-*.png`.

## 19 · PUERTAS OBLIGATORIAS (FASE 12)

| Puerta | Resultado | Estado |
| --- | --- | --- |
| `tsc --noEmit` | exit 0 | ✅ |
| `eslint src tests` | **0 errores** (15 avisos preexistentes, ninguno en código nuevo) | ✅ |
| `next build` (producción) | compila; rutas nuevas presentes: `/superadmin/supply-v2/campanas`, `/campanas/nueva`, `/campanas/[id]`, `/promociones/campanas`, `/promociones/campanas/[code]`, `/cliente/cupones`, `/admin/supply-v2/campanas` | ✅ |
| `npm test` (dominio completo) | **3 391 tests · 3 385 pass · 0 fail · 6 skip** (3 357 antes del slice) | ✅ con nota ⚠️ |
| `npm run test:db` (todas las suites de base) | **161 pass · 0 fail** (132 antes del slice) | ✅ |
| E2E Slice 7 (escritorio + móvil) | 2 passed | ✅ |
| E2E regresión Slices 1–6 | ver §20 | ✅ |
| Migraciones desde base vacía | base `membego_s7_fresh` creada desde cero: **174 migraciones aplicadas**, las 6 tablas nuevas y los 4 CHECK y 2 índices únicos presentes | ✅ |
| Segunda pasada de `migrate deploy` | «No pending migrations to apply» | ✅ |
| Drift | `prisma migrate diff`: **No difference detected** (exit 0) | ✅ |
| Sello de migraciones | `scripts/sellar-migraciones.mjs`: 174 selladas; `tests/migraciones-inmutables.test.ts` pasa. **Ninguna migración ya aplicada se editó** | ✅ |
| `scripts/rls-capa2-preflight.mjs` | OK | ✅ |
| `scripts/rls-cobertura.mjs` | 521 archivos con contexto de empresa; todos usan `conEmpresa`/`sinEmpresa` | ✅ |
| `scripts/permisos-catalogo.mjs` | catálogo correcto (incluye los 7 permisos nuevos) | ✅ |
| `scripts/nucleo-sin-verticales.mjs` | OK | ✅ |
| `scripts/acoplamiento-vertical.mjs` | OK | ✅ |
| `scripts/campos-sin-etiqueta.mjs` | OK | ✅ |
| Supply V1 intacto | `git diff` sobre `src/modules/supply/`, `src/components/supply/` y `src/app/(superadmin)/superadmin/supply/`: **vacío** | ✅ |
| `scripts/transacciones-anidadas.mjs` | «Ninguna transacción anidada»: todo el Slice 7 corre dentro de la `tx` de quien llama | ✅ |

⚠️ **Las 6 pruebas omitidas, nombradas** (no se cuentan como aprobadas): son
las de CardNET, ajenas al Slice 7 y omitidas igual en la línea base del Slice 6.
Cinco (`fail-closed` de membresía, promoción y `/cobrar`, e integración 35, dos
casos) se omiten porque no hay Supabase local para firmar una sesión de cliente
—se intentó con un servidor en `:3000` y el motivo cambió de «sin servidor» a
«sin Supabase local», confirmando que es infraestructura y no código—. La sexta
está marcada `BLOCKED` esperando claves reales de CardNET QA. Ninguna cubre
campañas, cupones ni presupuesto.

### Invariantes comprobados por SQL sobre toda la base de pruebas

334 campañas, 503 cupones, 70 aplicaciones, 100 pedidos atribuidos y 2 169
eventos de campaña acumulados por las suites. Todos los invariantes en cero:

| Consulta | Resultado |
| --- | --- |
| Cupones por encima de su tope de usos | 0 |
| Presupuestos de beneficio sobregirados | 0 |
| Campañas cuyas promociones suman más que su techo | 0 |
| Aplicaciones de cupón sin reserva de beneficio | 0 |
| Aplicaciones cuyo importe no coincide con su reserva | 0 |
| Pedidos con cupón congelado y sin campaña | 0 |
| Pedidos con más de una aplicación de cupón aplicada (GMV duplicado) | 0 |
| Cupones públicos con dueño / privados sin dueño | 0 / 0 |
| Campañas sin techo sin autorización escrita | 0 |
| Liquidaciones descuadradas (`neto = bruto − descuento − comisión − adelantado`) | 0 |

## 20 · REGRESIÓN DE LOS SLICES 1–6

La primera pasada completa dejó **3 fallos**. Los tres se investigaron hasta la
causa; ninguno quedó sin explicar.

| Fallo | Causa | Qué se hizo |
| --- | --- | --- |
| Slice 5 escritorio: `conciliacion-diferencia` esperaba `RD$-50.00` | Cambio **deliberado** de este slice: `dineroSupplyV2` ponía el signo **detrás** del símbolo (`RD$-228.00`). Se corrigió a `-RD$50.00`, que es como se lee en castellano, porque el tablero de campañas enseña contribuciones negativas a diario. | Se actualizó la aserción del Slice 5 al formato nuevo. |
| Slice 6 escritorio: `bono-oferta` no aparecía | **Defecto real preexistente** (§0.5): «Mis bonos» pedía una página ciega de 300 ofertas. | Corregido en `misBeneficios` + prueba de regresión propia. |
| Slice 6 móvil: tiempo agotado | Misma causa: la clienta no podía llegar a su bono porque la tarjeta no ofrecía la oferta. | Igual. |

La **segunda** pasada volvió a fallar, y por una causa distinta: la nueva prueba
de regresión de §0.5 inserta 320 ofertas **activas** de relleno y las dejaba en
la base compartida. Entre varias ejecuciones acumuló 640, duplicando las
ofertas activas (de 588 a 1 228); el marketplace y las pantallas del proveedor
pasaron a renderizar el doble y los recorridos del Slice 5 se agotaron por
tiempo. Es basura de prueba, no un fallo del producto, pero una prueba no puede
dejar rastro visible en una base que comparten las demás: se le añadió un
`after` que borra su relleno, y se purgaron las 640 filas que ya estaban.
Comprobado: tras correr la prueba, `MBG-OF-RELLENO-%` = 0 filas.

Resultado tras las correcciones: ver la tabla de §19.

## 21 · RIESGOS REALES QUE QUEDAN

| Riesgo | Detalle | Situación hoy |
| --- | --- | --- |
| Una promoción sin tope en una campaña sin tope | Si se autoriza una campaña sin techo, sus promociones pueden ir sin techo y el subsidio no tiene límite duro. | Requiere autorización escrita con nombre y fecha, queda en la bitácora y la ficha lo avisa. ⚠️ Es una decisión humana, no un fallo. |
| Listas de selección acotadas | Los selectores de ofertas y productos traen las 200–300 más recientes. Con catálogos muy grandes, una oferta vieja no aparecería en el selector del asistente. | Orden explícito por fecha (las nuevas salen siempre). ⚠️ Conviene un buscador con paginación cuando el catálogo crezca; no afecta dinero ni oculta nada al cliente. |
| Una oferta en muchas campañas | La atribución es determinista, pero si dos campañas rebajan lo mismo la elección depende de la fecha y el código. | Es el comportamiento especificado y está probado (escenario H). Conviene evitarlo por operación. |
| La vista previa del cliente puede quedar vieja | Entre ver el desglose y comprar, el presupuesto o el cupón pueden agotarse. | El servidor revalida y reserva con candado; el cliente recibe el motivo en castellano. Si la promoción es automática, la compra sigue a precio completo en vez de fallar. |
| 1 000 cupones por lote | Un lote grande ocupa la transacción. | Tope duro de 1 000 por llamada; lotes mayores se hacen por tandas. |

## 22 · FUERA DE ALCANCE

⛔ Membresías recurrentes · referidos · puntos · recompensas · automatización
multicanal avanzada · monedero financiero general del cliente. No se escribió
código de ninguno.

---

### Resumen

El recorrido obligatorio del §32 está implementado y **demostrado desde la
interfaz**, con sus consecuencias comprobadas en PostgreSQL: campaña con
asistente de 8 pasos → ofertas participantes → financiación compartida →
presupuesto con techo que manda → cupón público → aprobación de otra persona →
publicación → marketplace → ficha → producto → cupón aplicado
(**1 000 − 100 − 300 = 600**) → pago → confirmación → derecho → QR → entrega →
liquidación (**neto 828**) → tablero. Y en el teléfono, el camino del cupón
privado desde «Mis cupones» hasta la compra.

Las cuatro suites quedan en verde: **28** de dominio, **26** de PostgreSQL
(más 5 de las correcciones previas), **1** E2E de escritorio y **1** móvil, con
la regresión de los Slices 1–6 pasando después de corregir los dos defectos
reales que esa regresión destapó.

Tres defectos de dinero y uno de visibilidad, todos **preexistentes**, quedaron
corregidos en commits y pruebas separados del Slice 7, tal como pedía la FASE 0.

**Nada se fusionó ni se desplegó.** Los cambios quedan preparados para
revisión en `claude/jolly-brahmagupta-dmhml9`.
