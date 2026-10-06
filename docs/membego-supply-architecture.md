# MEMBEGO SUPPLY — Arquitectura del inventario patrocinado

> Membego compra por adelantado productos, servicios, experiencias o capacidad a
> empresas afiliadas, y después los regala, los vende con descuento, los usa como
> recompensa, los incluye en membresías o los reparte por campañas. Este documento
> es la arquitectura de ese dominio dentro del proyecto existente.

Estado: **implementado por releases** (ver `docs/membego-supply-implementation-status.md`).
Trazabilidad requisito → entidad → UI → prueba: `docs/membego-supply-requirements-traceability.md`.

---

## 0. La regla que gobierna todo el dominio

Cuando Membego compra 1.000 pizzas a Litre Pizza **no adquiere 1.000 pizzas
físicas**. Adquiere:

> **1.000 derechos de consumo contractuales** que el proveedor está obligado a
> cumplir cuando exista una redención válida.

De ahí sale todo lo demás: no hay almacén de Membego, hay un ledger de derechos;
no hay stock, hay cubetas de un lote; no hay "cantidad restante" editable, hay
movimientos que se suman.

---

## 1. Auditoría del repositorio (qué existía ya)

Inspección de `prisma/schema/*.prisma` (24 archivos, 7.428 líneas, ~190 modelos),
`src/modules/` (63 módulos) y `src/lib/`.

### 1.1 Lo que se REUTILIZA sin tocar

| Necesidad del prompt | Lo que ya existe | Cómo se usa |
| --- | --- | --- |
| Organización con dos roles (comercio + proveedor) | `Company.capacidades` (JSON) + `src/modules/capacidades/` | Se añaden dos capacidades nuevas. **No se crea una segunda empresa.** |
| Multi-tenancy | `conEmpresa()` / `sinEmpresa()` en `src/lib/tenant.ts` (RLS capa 2, `SET LOCAL`) | Toda consulta con ámbito de empresa pasa por `conEmpresa` |
| RBAC por sección | `ADMIN_SECTIONS` + `requireSection()` en `src/lib/auth/` | Se añade la sección `supply` |
| Auditoría | `AuditLog` + `AuditAccion` | Se añaden acciones `SUPPLY_*` |
| Idempotencia | `ClaveIdempotencia` (Connect) | Patrón replicado a nivel de dominio con claves únicas en las tablas de escritura |
| QR de un solo uso | `QrToken` + `src/modules/qr/token.ts` (24 bytes `randomBytes`, caducidad) | Se reutiliza el **generador**; el QR de supply es dinámico y de 5 min, así que vive en su propia tabla con nonce |
| Sucursales | `Sucursal` | Ámbito de un acuerdo y lugar de la redención |
| Clientes | `Cliente` | Titular de un derecho |
| Exportación | `src/lib/csv.ts` (`SEPARADOR_CSV`, `celdaCsv`, `armarCsv`) | Los 12 reportes exportan con **esta** infraestructura, no con una nueva |
| Notificaciones | `Notificacion` + `NotifTipo` | Avisos a proveedor, cliente y superadmin |
| Campañas | `Campana`, `CampanaGlobal`, `MarketingCampaign` | Una asignación apunta a la campaña por id + tipo; **no se sustituye el motor de campañas** |
| Promociones / beneficios | `Promocion`, `Promotion`, `Benefit`, `BenefitGrant` | El motor de promociones sigue decidiendo *bajo qué regla* el usuario obtiene algo; Supply decide *quién lo financia y de dónde sale la unidad* |

### 1.2 Lo que NO servía y por qué

| Candidato | Por qué no se reutiliza |
| --- | --- |
| `Proveedor` + `OrdenCompra` + `OrdenCompraLinea` (`carwash.prisma`) | Son las compras **del comercio a sus proveedores de insumos** (shampoo, ceras), con `companyId` del comercio comprador. Aquí el comprador es Membego —la plataforma—, no una empresa. Reutilizarlas obligaría a inventar una "empresa Membego" dentro de su propio multi-tenant y a mezclar el gasto operativo de un lavadero con la inversión promocional de la plataforma. |
| `ProductoInventario` + `MovimientoInventario` | Stock físico propiedad del comercio, con `stock` materializado como verdad. Supply necesita cubetas (disponible/asignado/emitido/redimido) y un ledger como fuente. Son el **Merchant Inventory** de la capa 1, y el prompt exige no mezclarlos. |
| `ProductoCompra` | Es la compra de una promoción **por un cliente a una empresa**. Modela el otro sentido del dinero. |
| `Regalo` (P2P) | Regalo de usos entre dos clientes de la misma empresa; no tiene lote, ni costo, ni proveedor. |

### 1.3 Las tres capas que nunca se mezclan

```
CAPA 1 · MERCHANT INVENTORY   productos_inventario, movimientos_inventario, servicios
         lo que el comercio tiene y vende por su cuenta
                     │ mismo catálogo, distinta propiedad
CAPA 2 · MEMBEGO SUPPLY       supply_acuerdos → supply_ordenes → supply_lotes → supply_movimientos
         derechos que Membego compró
                     │ distribución
CAPA 3 · CUSTOMER ENTITLEMENTS supply_derechos → supply_vouchers → supply_redenciones
         lo que una persona concreta posee hoy
```

---

## 2. Entidades nuevas

Todas viven en `prisma/schema/supply.prisma`, con tablas prefijadas `supply_`.

| Modelo | Tabla | Qué es |
| --- | --- | --- |
| `SupplyAcuerdo` | `supply_acuerdos` | El contrato: qué se compra, a qué costo, con qué vigencia, sucursales, capacidad y políticas |
| `SupplyEnmienda` | `supply_enmiendas` | Cambio posterior al contrato, con antes/después/motivo/aprobación |
| `SupplyOrden` | `supply_ordenes` | La orden de compra de Membego al proveedor |
| `SupplyOrdenLinea` | `supply_orden_lineas` | Qué y cuánto se compra en esa orden |
| `SupplyLote` | `supply_lotes` | El lote de derechos adquiridos, con **snapshot económico congelado** |
| `SupplyMovimiento` | `supply_movimientos` | **El ledger.** Un asiento = un traslado entre cubetas |
| `SupplyAsignacion` | `supply_asignaciones` | Reserva de unidades de un lote para una campaña/destino |
| `SupplyDerecho` | `supply_derechos` | El derecho que posee un cliente concreto |
| `SupplyVoucher` | `supply_vouchers` | Cómo se presenta ese derecho en el mostrador |
| `SupplyQrSesion` | `supply_qr_sesiones` | QR dinámico de 5 minutos, con nonce y antireplay |
| `SupplyReserva` | `supply_reservas` | Recogida/cita: sucursal, fecha y hora dentro de la capacidad |
| `SupplyRedencion` | `supply_redenciones` | La entrega efectiva, con todo su contexto |
| `SupplyIncidencia` | `supply_incidencias` | Incumplimiento reportado y su disputa |
| `SupplyPago` | `supply_pagos` | Pago de Membego al proveedor |
| `SupplyAsientoFinanciero` | `supply_asientos_financieros` | Ledger financiero del proveedor |

### 2.1 Relación completa (trazabilidad de punta a punta)

```
Company (proveedor, capacidad MEMBEGO_SUPPLIER)
   └── SupplyAcuerdo ──── SupplyEnmienda
          └── SupplyOrden ── SupplyOrdenLinea
                 └── SupplyLote  ←── snapshot del catálogo (Servicio | Promocion | libre)
                        ├── SupplyMovimiento        (ledger · fuente de verdad)
                        ├── SupplyAsignacion        (campaña / destino)
                        └── SupplyDerecho           (cliente)
                               ├── SupplyVoucher
                               │      ├── SupplyQrSesion
                               │      └── SupplyRedencion ── SupplyIncidencia
                               └── SupplyReserva
          └── SupplyPago ── SupplyAsientoFinanciero
```

De "Membego compró esta unidad" a "este consumidor la recibió en esta sucursal,
a esta hora, por esta campaña, y costó RD$300" hay un camino de claves foráneas
sin saltos.

---

## 3. El ledger: cubetas y asientos

### 3.1 Seis cubetas

| Cubeta | Significado |
| --- | --- |
| `DISPONIBLE` | Membego todavía puede decidir qué hacer con ella |
| `ASIGNADO` | Apartada para una campaña (**asignar no es consumir**) |
| `RETENIDO` | Hold temporal de checkout/reserva, con `expiraAt` |
| `EMITIDO` | Un cliente ya posee el derecho (**emitido ≠ redimido**) |
| `REDIMIDO` | El comercio ya entregó. Terminal |
| `CERRADO` | Venció o se canceló. Terminal |

### 3.2 Un asiento es un traslado

Cada `SupplyMovimiento` lleva `origen` y `destino` (cubeta o `null` = fuera del
lote) y una `cantidad` **siempre positiva**. Eso hace que el balance sea
aritmética de partida doble y que el invariante se cumpla por construcción:

```
comprado  = Σ(cantidad donde origen = null) − Σ(cantidad donde destino = null)
comprado  = DISPONIBLE + ASIGNADO + RETENIDO + EMITIDO + REDIMIDO + CERRADO
```

| Tipo | origen → destino |
| --- | --- |
| `COMPRA` | `null` → DISPONIBLE |
| `ASIGNACION` | DISPONIBLE → ASIGNADO |
| `LIBERACION_ASIGNACION` | ASIGNADO → DISPONIBLE |
| `RETENCION` | DISPONIBLE\|ASIGNADO → RETENIDO |
| `LIBERACION_RETENCION` | RETENIDO → DISPONIBLE\|ASIGNADO |
| `EMISION` | DISPONIBLE\|ASIGNADO\|RETENIDO → EMITIDO |
| `DEVOLUCION_EMISION` | EMITIDO → DISPONIBLE\|ASIGNADO |
| `REDENCION` | EMITIDO → REDIMIDO |
| `REVERSA_REDENCION` | REDIMIDO → EMITIDO |
| `EXPIRACION` | cualquiera no terminal → CERRADO |
| `CANCELACION` | cualquiera no terminal → CERRADO |
| `AJUSTE` | cualquiera → cualquiera, o `null` → DISPONIBLE (enmienda que amplía) |
| `TRANSFERENCIA` | sale de un lote y entra en otro (dos asientos con la misma `referencia`) |

**Nunca se borra un asiento.** Un error se corrige con `REVERSA_REDENCION`,
`AJUSTE` o `CANCELACION`, siempre con `motivo`, `actorId`, `createdAt` y
`referencia`. Los contadores de `SupplyLote` son caché: se recalculan desde el
ledger y la conciliación compara ambos.

---

## 4. Máquinas de estado

```
SupplyAcuerdo    BORRADOR → PENDIENTE_APROBACION → APROBADO → ACTIVO → (COMPLETADO | VENCIDO | CANCELADO)
SupplyOrden      BORRADOR → PENDIENTE_APROBACION → APROBADA → CONFIRMADA
                          → PARCIALMENTE_FONDEADA → FONDEADA → ACTIVA → COMPLETADA | CANCELADA
SupplyLote       PROGRAMADO → ACTIVO → (AGOTADO | VENCIDO | CANCELADO | CERRADO)
SupplyDerecho    RETENIDO → ACTIVO → (REDIMIDO | VENCIDO | CANCELADO | REVOCADO)
SupplyVoucher    ACTIVO → (REDIMIDO | VENCIDO | CANCELADO | REVOCADO)
SupplyIncidencia ABIERTA → EN_REVISION → (RESUELTA_CLIENTE | RESUELTA_COMERCIO | RESUELTA_MEMBEGO) → CERRADA
```

Las transiciones válidas viven en `src/modules/supply/estados.ts` (puro) y se
comprueban antes de escribir. Una transición no declarada no ocurre.

---

## 5. Los dos modelos comerciales que no se pueden confundir

| | `COMPRA_UNIDAD_COMPLETA` | `SUBSIDIO` |
| --- | --- | --- |
| Qué compra Membego | La unidad entera | Una parte del precio |
| Pizza de RD$700 | Membego paga RD$300 al comercio | Membego aporta RD$300 |
| Qué paga el cliente | RD$0 (regalo) o RD$399 **a Membego** | RD$400 **al comercio** |
| Quién cobra al cliente | Membego (checkout Membego) | El comercio |
| Cuenta por cobrar del comercio | Ya liquidada por contrato | RD$300 de Membego |
| Extras (queso, refresco) | Los cobra el comercio aparte | Los cobra el comercio aparte |

Son campos distintos (`modeloComercial`) y ramas distintas del cálculo económico.
Un derecho de compra completa **no puede** generar un cobro del comercio al
cliente por la unidad base: la pizza va `INCLUIDA`.

---

## 6. Modalidades de pago al proveedor

`PREPAGO_TOTAL` · `PREPAGO_PARCIAL` (anticipo % + saldo) · `PAGO_POR_REDENCION`
· `SUBSIDIO`. El ledger financiero (`SupplyAsientoFinanciero`) representa
`COMPROMISO_COMPRA`, `DEPOSITO`, `REDENCION_POR_PAGAR`, `PAGO`, `REEMBOLSO`,
`CREDITO`, `AJUSTE`, `REVERSA`. **El saldo del proveedor nunca es un número
guardado a mano**: es la suma de sus asientos.

## 7. Tipos de supply (una arquitectura, seis industrias)

`ON_DEMAND` (pizza) · `STOCK_RESERVADO` (500 termos) · `CAPACIDAD_SERVICIO`
(500 lavados) · `CAPACIDAD_AGENDADA` (100 excursiones con fecha y cupo).

La diferencia no es el modelo de datos: es qué validaciones exige la emisión y
la redención (capacidad diaria/horaria, reserva previa, fecha). El motor de
capacidad (`src/modules/supply/capacidad.ts`) es genérico y se configura por
acuerdo; no hay nada específico de pizzas en el código.

## 8. Política de unidades no utilizadas

`EXPIRAR` · `EXTENDER` · `REEMBOLSO` · `CREDITO_COMERCIO` · `CONVERTIR` ·
`RENEGOCIAR`. Se declara en el acuerdo y el motor de vencimientos propone
acciones según ella; ninguna se aplica sola.

---

## 9. Permisos y multi-tenancy

| Permiso | Quién |
| --- | --- |
| `MEMBEGO_SUPPLY_VIEW` / `_CREATE` / `_APPROVE` / `_ALLOCATE` | Superadmin de plataforma |
| `SUPPLIER_VIEW_COMMITMENTS` / `_REDEEM` / `_REPORT_INCIDENT` / `_VIEW_SETTLEMENT` | Empresa con capacidad `MEMBEGO_SUPPLIER` |

Regla inviolable: **el proveedor A jamás consulta los compromisos del proveedor
B**. Toda consulta del portal del comercio se hace dentro de `conEmpresa(companyId)`
y además lleva `where: { proveedorId: companyId }`. La creación de compromisos
financieros exige rol de plataforma; el comercio **lee** sus números y no puede
cambiar ni la cantidad ni el costo: eso solo ocurre por `SupplyEnmienda`.

## 10. Concurrencia e idempotencia

- Toda mutación de cubetas ocurre dentro de una transacción con un `SELECT … FOR
  UPDATE` sobre la fila del lote (bloqueo pesimista). La última unidad no se
  puede entregar dos veces.
- Restricciones de base que hacen imposible el sobregiro aunque falle el código:
  `CHECK` de no-negatividad sobre los contadores del lote y `CHECK (asignadas <=
  cantidad)` sobre la asignación.
- Claves de idempotencia únicas en `supply_derechos.claveIdempotencia`,
  `supply_redenciones.claveIdempotencia` y `supply_pagos.claveIdempotencia`: un
  reintento devuelve el mismo resultado y no duplica asientos.
- El QR es de un solo uso por nonce: `supply_qr_sesiones.nonce` único y
  `consumidoAt` no nulo bloquea el segundo intento.

## 11. Riesgos conocidos

1. **Exposición de capital**: unidades compradas que vencen sin usarse. Mitigado
   por el motor de vencimientos (alertas a 30/14/7/3/1 días con valor en riesgo)
   y por la política de sobrantes negociada en el acuerdo.
2. **Comercio que no escanea**: la redención no queda registrada y el voucher
   sigue activo. El incentivo está alineado (sin escaneo no hay liquidación en
   `PAGO_POR_REDENCION`) y el cliente puede abrir incidencia.
3. **Sobreventa por concurrencia**: cerrado con bloqueo de fila + `CHECK` en base.
4. **Deriva entre contadores y ledger**: la conciliación lo detecta y lo reporta;
   los contadores se recalculan desde el ledger, nunca al revés.
5. **Checkout de cliente**: la venta de supply necesita cobro real. Se deja el
   puerto (`src/modules/supply/checkout.ts`) sobre la infraestructura de pagos
   existente, sin simular seguridad financiera que no existe.

## 12. Decisiones arquitectónicas (ADR)

Las ocho decisiones críticas están en `docs/adr/` — ver
`docs/membego-supply-final-report.md` §12 para el índice.
