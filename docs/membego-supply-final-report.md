# MEMBEGO SUPPLY — Reporte final

**Fecha:** 2026-09-23 · **Rama:** `claude/project-analysis-ojg18w`

Documentos hermanos: `membego-supply-architecture.md` (el diseño),
`membego-supply-implementation-status.md` (fase por fase),
`membego-supply-requirements-traceability.md` (requisito → prueba),
`docs/adr/0001`–`0008` (las decisiones).

---

## 1 · Arquitectura implementada

Tres capas que nunca se mezclan:

```
CAPA 1 · MERCHANT INVENTORY     lo que el comercio tiene y vende por su cuenta
CAPA 2 · MEMBEGO SUPPLY         derechos que Membego compró  ← este módulo
CAPA 3 · CUSTOMER ENTITLEMENTS  lo que una persona posee hoy
```

Y una cadena con trazabilidad de punta a punta:

```
acuerdo → orden → lote → ledger → asignación → derecho → voucher → QR →
redención → conciliación → liquidación → unit economics
```

De «Membego compró esta unidad» a «Carlos la recibió en Bávaro el 15 de octubre
a las 18:40, por la campaña de bienvenida, y costó RD$300» hay un camino de
claves foráneas sin saltos.

## 2 · Entidades creadas (15)

`SupplyAcuerdo` · `SupplyEnmienda` · `SupplyOrden` · `SupplyOrdenLinea` ·
`SupplyLote` · `SupplyMovimiento` · `SupplyAsignacion` · `SupplyDerecho` ·
`SupplyVoucher` · `SupplyQrSesion` · `SupplyReserva` · `SupplyRedencion` ·
`SupplyIncidencia` · `SupplyPago` · `SupplyAsientoFinanciero`

Más 14 enums de dominio.

## 3 · Entidades reutilizadas

`Company` (con dos capacidades nuevas — **no se crea una segunda empresa**),
`Sucursal`, `Cliente`, `User`, `Servicio`, `Promocion`, `Membership`,
`AuditLog`, `Notificacion`. Y la infraestructura: `conEmpresa`/`sinEmpresa`
para el aislamiento, `requireSection` para el RBAC, `randomBytes` de
`modules/qr/token.ts` para las credenciales, `lib/csv.ts` para exportar,
`autorizarCron` para el trabajo diario.

**Lo que se rechazó reutilizar, y por qué:** `Proveedor`/`OrdenCompra` son las
compras del comercio a sus proveedores de insumos —el comprador es la empresa,
no la plataforma—; `ProductoInventario` es stock físico con `stock` como verdad;
`ProductoCompra` modela el sentido contrario del dinero. Razonado en ADR-0001.

## 4 · Migraciones

`prisma/migrations/20260926_membego_supply/migration.sql`

Solo crea: 15 tablas, 14 enums y 19 valores de `AuditAccion`. Cero `ALTER` sobre
tablas vivas, cero `DROP`, cero `DELETE`. Idempotente. Sellada. Rollback
documentado en su cabecera.

## 5 · APIs

| Ruta | Qué hace |
| --- | --- |
| `GET /superadmin/supply/exportar` | Los 7 reportes en CSV (bloques o uno) |
| `GET /api/cron/supply` | Holds caducados, cierre de vencidos, avisos, conciliación |

Más 20 server actions en `modules/supply/actions.ts`, todas con guardia,
regla de dominio y bitácora, en ese orden.

## 6 · Páginas (21)

**Plataforma** — `/superadmin/supply` y once vistas: proveedores (+ ficha),
acuerdos (+ ficha), órdenes (+ ficha), lotes (+ ficha con el ledger completo),
derechos, redenciones, incidencias, vencimientos, liquidaciones, conciliación,
economía.

**Comercio** — `/admin/supply` (compromisos, liquidación, entregas) y
`/admin/supply/escaner`.

**Cliente** — `/cliente/beneficios` y `/cliente/beneficios/disponibles`.

## 7 · Permisos

Plataforma (`SUPERADMIN`): ver, crear, aprobar, asignar.
Proveedor (sección `supply` + capacidad `MEMBEGO_SUPPLIER`): ver compromisos,
redimir, reportar incidencias, ver liquidaciones.

Los ocho nombres del encargo se conservan como vocabulario y cada uno se
**resuelve** contra el RBAC existente: crear un segundo sistema de permisos en
paralelo habría sido exactamente el «no dupliques» de la Fase 71.

## 8 · Flujos

Negociación → contrato → aprobación → orden → aprobación (por otra persona) →
confirmación → activación (nacen los lotes y el asiento de compra) → asignación
→ elegibilidad → emisión → voucher → reserva si el contrato la exige → QR de
cinco minutos → escaneo → confirmación → redención → conciliación → liquidación
→ analítica.

## 9 · Estados

Seis máquinas declaradas en `estados.ts`. Una transición que no esté ahí **no
ocurre**: se comprueba antes de escribir y el error nombra los dos estados.

## 10 · Eventos y bitácora

19 acciones `SUPPLY_*`, todas con etiqueta y filtrables desde Auditoría. Cada
una lleva actor, entidad, fecha, IP y lo que cambió.

## 11 · Ledgers

**De derechos** (`supply_movimientos`): seis cubetas, partida doble, invariante
en `CHECK`. **Financiero** (`supply_asientos_financieros`): el saldo se suma,
nunca se guarda. Los dos: nada se borra.

## 12 · Reportes (12)

Overview · Proveedor · Compras · Lote · Asignación · Campaña · Redención ·
Vencimiento · Cumplimiento · Financiero · Conciliación · Unit economics.
Todos exportables por la infraestructura CSV que ya existía.

## 13 · Pruebas

99 nuevas en 6 archivos; 2.615 en total, todas en verde. El escenario E2E
recorre la cadena entera comprobando el invariante **después de cada paso**.

## 14 · Seguridad

Credenciales al portador con 192 bits (voucher) y 128 (nonce del QR), nunca
`cuid`. QR de un solo uso con antireplay. Idempotencia en las tres escrituras
que mueven valor. Aislamiento con tres cierres independientes. El comercio no
puede editar ninguna cifra contractual. El escáner rechaza cobrar al cliente una
unidad que Membego ya pagó.

## 15 · Rendimiento

Índices compuestos por proveedor, lote, cliente, estado y vencimiento, más
cuatro parciales para los recorridos caros (qué vence, qué holds soltar,
liquidación del mes, ocupación del día). Las agregaciones se hacen en la base,
no en el navegador.

## 16 · Riesgos

Al corte del 23-09-2026 esta sección listaba cinco. Cuatro se cerraron después;
el detalle de cada cierre está en `membego-supply-implementation-status.md`.

**Abiertos:**

1. **Sin cobro a nombre de la plataforma** → la venta de supply no se puede
   completar hoy. Se declara en voz alta y la vitrina no publica precios.
2. **«Producto listo» sin implementar** → único hueco de la Fase 40. El modelo
   no tiene el concepto de *pedido preparado*: `SupplyReserva` guarda la hora
   acordada, pero nadie en el comercio marca «ya está hecho».

**Cerrados:**

- ~~Notificaciones sin enviar~~ · **cerrado.** `notificar.ts` escribe los diez
  avisos vía `@/modules/notificaciones/service`, enganchados en las funciones de
  dominio (`entregar`, `reservar`, `redimir`, `abrirIncidencia`, `confirmarPago`)
  y siempre después de que cierre la transacción. 39 pruebas en
  `supply-avisos.test.ts` vigilan las claves de deduplicación y lo que no viaja.
- ~~Migración sin aplicar~~ · **cerrado el 25-09-2026.** El check `Esquema de
  base de datos` del CI levanta su propio PostgreSQL 16 y replica las migraciones
  desde cero en cada PR; los seis `CHECK` se probaron uno a uno contra PG 16.
- ~~Sin prueba de carrera real~~ · **cerrado el 25-09-2026.** Dos clientes
  simultáneos contra PG 16 peleando por la última unidad con el patrón de
  `bloquearLote`: el bloqueo serializa y el lote sigue cuadrando.
- ~~Políticas RLS de `supply_*`~~ · **cerrado el 25-09-2026.** No había que
  escribirlas — se deducen del esquema —, pero dos tablas tenían la política
  equivocada. Corregido con el Nivel 0.5 en la derivación y con claves foráneas
  compuestas (`20261003_supply_coherencia_proveedor`). `npm run rls:probar` pasa
  de 9 a 14 comprobaciones.

## 17 · Deuda técnica

`destinoId` sin FK (cinco destinos posibles), `sucursalIds` como array
congelado, conciliación con tope de 200 lotes. Las tres son decisiones
explicadas en el código, no olvidos.

## 18 · Funcionalidades incompletas

| Qué | Estado | Qué falta |
| --- | --- | --- |
| Venta de supply (Fases 22-23) | Puerto declarado | Cobro a nombre de la plataforma |
| «Producto listo» (Fase 40) | Los diez avisos escriben | El concepto de *pedido preparado* no existe en el modelo |
| Transferencia entre lotes | Tipo en el ledger | Acción y pantalla |
| Automatización de vencimientos | Propone | Aplicar acciones (por diseño: se negocian) |

---

## La prueba de invariantes (Fase 78)

```
comprado = DISPONIBLE + ASIGNADO + RETENIDO + EMITIDO + REDIMIDO + CERRADO
```

- por construcción: los asientos son traslados, no signos;
- en la base: `CHECK supply_lotes_cuadre_cubetas`;
- en las pruebas: verificado tras **cada** asiento del escenario E2E;
- en producción: la conciliación lo comprueba a diario y reporta la fila exacta.

```
saldo del proveedor = suma de sus asientos financieros
```

No hay ninguna cifra manual sin explicación en todo el módulo.
