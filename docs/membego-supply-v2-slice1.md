# MEMBEGO SUPPLY 2.0 — Vertical Slice 1 · Procurement

> Proveedor → Producto → Acuerdo → Orden de compra → Aprobación → Recepción → Supply disponible

Fecha: **2026-09-29** · Rama: `claude/inspiring-gates-2h8ew7`

Supply 2.0 es un dominio NUEVO que convive con Supply V1 (`src/modules/supply/`,
tablas `supply_*`, `/superadmin/supply`) sin tocarlo. Este documento describe
lo que el Slice 1 construye y lo que deja fuera a propósito.

---

## A · Arquitectura implementada

```
src/modules/supply-v2/
├── core/            ledger (puro), máquinas de estado (puras), dinero (Decimal),
│                    numeración segura, etiquetas, errores, bitácora en transacción
├── contracts/       gateways.ts (interfaces con Core) · adapters.ts (implementación)
├── suppliers/       domain.ts (reglas) · service.ts (escritura en tx) · queries.ts
├── catalog/         domain.ts · service.ts
├── agreements/      domain.ts · service.ts
├── procurement/     orders.ts · receipts.ts · queries.ts
├── pool/            lotes.ts (escritura del ledger) · queries.ts
├── permisos.ts      guardia de servidor (SUPPLY_V2_*)
├── actions.ts       server actions ('use server')
└── actions-util.ts
```

Reglas que gobiernan el módulo:

- **Nada se duplica de Core.** `Company`, `User`, `Sucursal`, `Servicio` y
  `ProductoInventario` se referencian por clave foránea. No existen
  `SupplyV2User`, `SupplyV2Company` ni `SupplyV2Branch`.
- **Contratos con Core** (`contracts/gateways.ts`): `CompanyGateway`,
  `UserGateway`, `BranchGateway`, `AuthorizationGateway`. Los adaptadores son
  el único sitio que sabe cómo el Core guarda empresas, usuarios, sucursales y
  roles.
- **Una transacción por operación.** Los `service.ts` reciben la `tx` y nunca
  abren la suya (gate `scripts/transacciones-anidadas.mjs`). Las actions abren
  `sinEmpresa` una vez, y la bitácora (`AuditLog` de Core) se escribe con la
  misma `tx`: si la operación se deshace, la bitácora también.
- **El ledger es la verdad.** Los contadores del lote son caché; `CHECK` en la
  base garantizan cuadre y no-negatividad aunque alguien escriba SQL a mano.
- **Sin `count()+1`.** Los correlativos (`MBG-PO-2026-000001`,
  `MBG-RC-…`, `MBG-AG-…`, `LOT-…`) se asignan bajo `pg_advisory_xact_lock`
  dentro de la transacción; el índice único es la última red.

## B · Entidades

Todas en `prisma/schema/supply-v2.prisma`, tablas `supply_v2_*` (prefijo
temporal hasta que V2 sustituya a V1).

| Modelo | Tabla | Qué es |
| --- | --- | --- |
| `SupplyV2Supplier` | `supply_v2_suppliers` | Relación comercial. `companyId` apunta a la `Company` cuando es una empresa registrada (una por empresa); nulo si es externo |
| `SupplyV2CatalogItem` | `supply_v2_catalog_items` | Lo que ese proveedor puede vender a Membego. `supplierId+sku` único; `slug` derivado del nombre; vínculo opcional a `Servicio`/`ProductoInventario` de la misma empresa |
| `SupplyV2Agreement` | `supply_v2_agreements` | Condiciones (tipo, alcance, costo negociado, plazo, vigencia). **Sin cantidad** |
| `SupplyV2AgreementVersion` | `supply_v2_agreement_versions` | Foto de las condiciones. Nace la v1 al activar; cada cambio crea otra |
| `SupplyV2PurchaseOrder` | `supply_v2_purchase_orders` | La compra. Apunta a `agreementId` **y** `agreementVersionId` |
| `SupplyV2PurchaseOrderLine` | `supply_v2_purchase_order_lines` | Cantidad, costo congelado, `descriptionSnapshot`, `receivedQuantity` (nunca > `quantity`) |
| `SupplyV2PurchaseOrderEvent` | `supply_v2_purchase_order_events` | Historial: creada, enviada, aprobada, rechazada (con motivo), cancelada, recepciones |
| `SupplyV2PurchaseReceipt` | `supply_v2_purchase_receipts` | Una entrega del proveedor. `idempotencyKey` único |
| `SupplyV2PurchaseReceiptLine` | `supply_v2_purchase_receipt_lines` | Cuánto de qué línea; vencimiento opcional |
| `SupplyV2Lot` | `supply_v2_lots` | Un lote por línea de recepción, con costo congelado y seis cubetas |
| `SupplyV2LedgerEntry` | `supply_v2_ledger_entries` | Traslado entre cubetas con saldo antes/después, referencia, actor |

Relación completa:

```
Company? ── SupplyV2Supplier ── SupplyV2CatalogItem ──┐
                 │                                     │
                 └── SupplyV2Agreement ── SupplyV2AgreementVersion
                              │                  │
                              └── SupplyV2PurchaseOrder ── SupplyV2PurchaseOrderLine
                                        │    │                      │
                                        │    └── SupplyV2PurchaseOrderEvent
                                        └── SupplyV2PurchaseReceipt ── SupplyV2PurchaseReceiptLine
                                                                              │ 1:1
                                                                        SupplyV2Lot ── SupplyV2LedgerEntry
```

Invariante del lote (dominio + prueba + `CHECK`):

```
quantityReceived = available + allocated + reserved + issued + redeemed + closed
```

## C · Migraciones

- `prisma/migrations/20261010_supply_v2_slice1/migration.sql` — solo crea:
  16 enums, 11 tablas, índices, claves foráneas hacia Core, 11 valores en
  `AuditAccion`, y 9 `CHECK` (cuadre y no-negatividad del lote, cantidad
  positiva del asiento, recibido ≤ comprado, montos ≥ 0, fechas del acuerdo,
  proveedor registrado ⇒ `companyId`). Idempotente. Cero ALTER sobre columnas
  vivas, cero DROP.
- Sellada en `prisma/migrations/SUMAS.txt`.
- Cambios mínimos en esquemas de Core, solo relaciones inversas (no añaden
  columnas): `Company.supplyV2Supplier`, nueve listas en `User`,
  `Sucursal.supplyV2Recepciones`, `Servicio.supplyV2CatalogItems`,
  `ProductoInventario.supplyV2CatalogItems`.

## D · UI

Ruta base `/superadmin/supply-v2` (Supply V1 sigue en `/superadmin/supply`).

| Ruta | Pantalla |
| --- | --- |
| `/superadmin/supply-v2` | Tablero: valor disponible, unidades, compras abiertas, proveedores, actividad reciente |
| `/superadmin/supply-v2/compras` | Listado de órdenes |
| `/superadmin/supply-v2/compras/nueva` | **Wizard** de seis pasos; crea proveedor, producto y acuerdo sin salir |
| `/superadmin/supply-v2/compras/[id]` | Ficha de la orden: siguiente paso, líneas, recorrido (timeline derivado), datos, recepción, recepciones |
| `/superadmin/supply-v2/proveedores` | Listado + «Nuevo proveedor» (¿ya está en Membego? sí/no) |
| `/superadmin/supply-v2/proveedores/[id]` | Perfil: catálogo, acuerdos, compras, supply adquirido |
| `/superadmin/supply-v2/supply` | Pool agrupado por producto |
| `/superadmin/supply-v2/supply/[catalogItemId]` | Producto: comprado, recibido, disponible, valor, lotes |
| `/superadmin/supply-v2/supply/lotes/[id]` | Lote y su ledger |

Navegación: Resumen · Compras · Proveedores · Supply. Entrada «Supply 2.0» en
el menú de plataforma (`nav-config.ts`).

## E · Journey demostrado

1. Superadmin entra a Supply 2.0 y pulsa **Nueva compra**.
2. Crea el proveedor (externo o vinculando una empresa) sin salir del wizard.
3. Crea el producto (nombre, tipo, SKU, precio público).
4. Crea el acuerdo de compra anticipada a RD$300; nace vigente con versión 1.
5. Cantidad 1.000 × RD$300 = RD$300.000 (el servidor recalcula).
6. Forma de pago y resumen → **Crear orden de compra** → `MBG-PO-2026-NNNNNN` en Borrador.
7. **Enviar para aprobación.** El creador no ve «Aprobar» y el servidor lo rechaza.
8. Otra persona aprueba → «Aprobada por …» en el recorrido.
9. Recepción de 500 → lote `LOT-…`, asiento `RECEIPT`, 500 disponibles en Supply.
10. Recepción de 300 → 800. Recepción de 200 → 1.000 y la orden queda **Recibida**.
11. Recibir 1.001 se rechaza; el ledger del lote muestra `RECEIPT +500` con usuario y fecha.

Seed de demostración (solo datos V2, idempotente): `npm run db:seed:supply-v2`
crea proveedor, producto, acuerdo y una orden **aprobada sin recibir**, para
probar la recepción parcial desde la pantalla.

## F · Tests

| Suite | Archivo | Qué cubre |
| --- | --- | --- |
| Dominio (puro) | `tests/supply-v2-dominio.test.ts` | Ledger e invariante, máquinas de estado, segregación, over-receipt, Decimal, numeración, compatibilidad de acuerdos, validaciones |
| PostgreSQL real | `tests/postgres/supply-v2-slice1.db.test.ts` | Los 16 casos de §48 más concurrencia de numeración, versionado histórico, `CHECK` en base y doble confirmación concurrente |
| Playwright | `tests/e2e/supply-v2-slice1.spec.ts` | El recorrido completo en navegador con dos sesiones (creador y aprobador) |

Cómo entra el E2E sin Supabase: `tests/e2e/supply-v2-sesion.ts` firma un
access token HS256 con `SUPABASE_JWT_SECRET` y lo guarda en la cookie con el
formato de `@supabase/ssr`; la aplicación lo valida localmente cuando el
servidor de auth no responde. En `e2e.yml`, `NEXT_PUBLIC_SUPABASE_URL` apunta
a un puerto local sin servicio y `SUPABASE_JWT_SECRET` es un valor de relleno.
Sin esas variables la prueba se salta con su motivo.

## G · Archivos principales

- Esquema y migración: `prisma/schema/supply-v2.prisma`, `prisma/migrations/20261010_supply_v2_slice1/`.
- Dominio: `src/modules/supply-v2/**` (ver A).
- UI: `src/app/(superadmin)/superadmin/supply-v2/**`, `src/components/supply-v2/**`.
- Seed: `prisma/seed-supply-v2.ts` (`npm run db:seed:supply-v2`).
- Pruebas: `tests/supply-v2-dominio.test.ts`, `tests/postgres/supply-v2-slice1.db.test.ts`, `tests/e2e/supply-v2-slice1.spec.ts`, `tests/e2e/supply-v2-sesion.ts`.
- Tocado en compartido (documentado): `identidad.prisma` y `carwash.prisma`
  (relaciones inversas y enum de bitácora), `nav-config.ts` (una entrada),
  `modules/auditoria/queries.ts` (etiquetas de las acciones nuevas),
  `.github/workflows/e2e.yml` (dos variables), `package.json` (un script).
  `src/modules/supply/**` no se tocó.

## H · Decisiones

- **El acuerdo no lleva cantidad.** La cantidad es de la orden. Un acuerdo por
  producto exige costo negociado; el wizard lo propone como costo de la línea
  y avisa si se cambia.
- **El acuerdo nace vigente desde el wizard** (crear + activar en la misma
  transacción). Su aprobación separada no está en el Slice 1; la de la orden
  sí, y es la que compromete dinero.
- **Rechazar devuelve a Borrador** con el motivo en el evento; la orden puede
  corregirse y reenviarse. Cancelar es terminal y exige motivo; no se cancela
  una orden con recepciones.
- **Recepción y lote son 1:1.** Cada línea de recepción crea su lote con el
  costo de la línea de la orden y un único asiento `RECEIPT`. «Valor adquirido»
  = unidades × ese costo.
- **Idempotencia por clave** en la recepción, comprobada después del bloqueo
  de fila: el doble clic devuelve la misma recepción.
- **Permisos resueltos contra el RBAC existente.** Los seis `SUPPLY_V2_*` son
  vocabulario; en el Slice 1 los tiene el rol `SUPERADMIN`. No hay una segunda
  tabla de permisos.
- **Gateways sin capa ceremonial.** Cuatro interfaces, un archivo de
  adaptadores; los servicios reciben la `tx` y las reglas puras viven en
  `domain.ts`/`core/`.

## I · Riesgos reales

- `SupplyV2Supplier.companyId` es opcional: con RLS Capa 2 encendido la tabla
  entra por la regla de «tabla con `companyId`» y las filas externas
  (`companyId` nulo) solo se ven en modo omnisciente, que es como opera la
  plataforma hoy. Si un día el proveedor accede por su empresa, hay que
  decidir la política de esa tabla en el SQL manual.
- La numeración serializa por prefijo y año con un cerrojo de transacción:
  correcto, pero bajo mucha concurrencia las altas de órdenes se encolan.
  Es aceptable para el volumen de compras de la plataforma.
- El E2E depende de que `getUser()` caiga a verificación local cuando el auth
  no responde. Si esa política de `auth-service.ts` cambia, el E2E se
  saltará o fallará y hay que revisar `supply-v2-sesion.ts`.
- V1 y V2 conviven: hoy nada cruza entre ellos, pero la migración de datos
  V1 → V2 (otra fase) tendrá que mapear acuerdos con cantidad a
  acuerdo + orden.

## J · Pendiente para el Slice 2 (no implementado)

```
Supply disponible → Offer → Marketplace → Customer purchase
```

- `SupplyV2Offer` (origen PREPURCHASED_SUPPLY / COMMISSION / SUBSIDIZED),
  precio Membego y publicación en marketplace.
- `SupplyV2Allocation` (campaña, venta, referidos): asientos ALLOCATION /
  RELEASE_ALLOCATION ya declarados en el ledger, sin flujo.
- `SupplyV2Entitlement` → voucher → sesión QR → redención (ISSUE, REDEMPTION,
  REVERSAL, EXPIRATION), reutilizando selectivamente el QR y la redención de V1
  si pasan revisión.
- Pagos de la orden (PARTIALLY_PAID / PAID), depósitos, CxP, liquidaciones,
  conciliación.
- Acuerdos a comisión, por categoría y por catálogo desde la interfaz (el
  dominio ya calcula la compatibilidad).
- Lado proveedor (permisos `SUPPLIER_*`), incidencias, vencimientos
  automáticos de lotes.
