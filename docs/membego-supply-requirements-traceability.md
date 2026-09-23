# MEMBEGO SUPPLY — Matriz de trazabilidad

Requisito → dominio → entidad → UI → prueba → estado.

Sirve para dos cosas: comprobar que nada del encargo se quedó sin construir, y
—cuando algo se rompa— saber en un renglón qué pantalla y qué prueba tocar.

Leyenda: ✅ implementado · ⚠️ parcial (la nota dice qué falta)

---

## 1 · Procurement

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Una empresa es comercio y proveedora a la vez | Capacidades | `Company.capacidades` | `/superadmin/capacidades` | `supply-contratos` · capacidades | ✅ |
| Registrar el contrato con un proveedor | `contrato.ts`, `procurement.ts` | `SupplyAcuerdo` | `/superadmin/supply/acuerdos` | `supply-procurement` · validación | ✅ |
| Cuatro tipos de supply (una arquitectura, seis industrias) | `catalogo.ts` | `SupplyTipo` | Formulario de acuerdo | `supply-procurement` · tipos | ✅ |
| Política de unidades no utilizadas | `catalogo.ts` | `SupplyPoliticaSobrante` | Formulario + vencimientos | `supply-procurement` | ✅ |
| Orden de compra con aprobación separada | `procurement.ts` | `SupplyOrden` | `/superadmin/supply/ordenes/[id]` | `supply-procurement` · sin atajos | ✅ |
| Cuatro modalidades de pago al proveedor | `finanzas.ts` | `SupplyModalidadPago` | Formulario + liquidaciones | `supply-procurement` | ✅ |
| Lote con snapshot económico congelado | `procurement.ts` | `SupplyLote.snapshot*` | `/superadmin/supply/lotes/[id]` | `supply-e2e` · paso 3 | ✅ |
| Enmiendas de contrato auditadas | `procurement.ts` | `SupplyEnmienda` | Ficha del acuerdo | `supply-e2e` · enmienda | ✅ |

## 2 · Ledger

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Ledger auditable, no un contador editable | `ledger.ts`, `movimientos.ts` | `SupplyMovimiento` | Ficha del lote (ledger completo) | `supply-ledger` (22) | ✅ |
| Invariante comprado = suma de cubetas | `ledger.ts:comprobarInvariante` | `CHECK supply_lotes_cuadre_cubetas` | Columna «Cuadra» | `supply-ledger` · invariante | ✅ |
| Nunca borrar movimientos; reversa o ajuste | `ledger.ts` | `REVERSA_REDENCION`, `AJUSTE` | Ledger del lote | `supply-contratos` · nadie borra | ✅ |
| Motivo obligatorio en lo correctivo | `ledger.ts` | — | Formularios de reversa | `supply-ledger` · motivo | ✅ |

## 3 · Supply pool y asignación

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Vista global del supply con valor en riesgo | `pool.ts:resumenPool` | — | `/superadmin/supply` | — | ✅ |
| Asignar a campañas sin consumir | `asignaciones.ts` | `SupplyAsignacion` | Ficha del lote | `supply-e2e` · paso 4 | ✅ |
| Liberar lo asignado y no emitido | `asignaciones.ts:liberar` | — | Ficha del lote | `supply-economia` · liberar | ✅ |
| Asignadas / emitidas / por emitir separadas | `asignaciones.ts`, `economia.ts` | — | Ficha del lote + economía | `supply-economia` · campaña | ✅ |
| Concurrencia: la última unidad | `movimientos.ts` | `FOR UPDATE` + `CHECK` | — | `supply-ledger` · última unidad | ✅ |
| FEFO configurable | `fefo.ts` | — | — | `supply-distribucion` (10) | ✅ |

## 4 · Cliente

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Derecho del cliente con su origen | `derechos.ts` | `SupplyDerecho` | `/superadmin/supply/derechos` | `supply-e2e` · paso 5 | ✅ |
| Voucher ≠ cupón | `derechos.ts` | `SupplyVoucher` | Tarjeta de beneficio | `supply-procurement` · códigos | ✅ |
| QR dinámico de 5 min con antireplay | `qr.ts` | `SupplyQrSesion` | Tarjeta de beneficio | `supply-contratos` · credenciales | ✅ |
| Elegibilidad ANTES de comprometer | `elegibilidad.ts` | — | Vitrina + emisión | `supply-distribucion` (12) | ✅ |
| Hold temporal con expiración | `derechos.ts:retener` | `estado: RETENIDO` | Checkout (puerto) | `supply-e2e` · hold | ✅ |
| «Mis beneficios» con detalle y condiciones | `pool.ts` | — | `/cliente/beneficios` | — | ✅ |
| Reserva de sucursal, día y hora | `reservas.ts` | `SupplyReserva` | Tarjeta de beneficio | `supply-distribucion` · capacidad | ✅ |

## 5 · Cumplimiento

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Escáner del proveedor en dos pasos | `actions.ts`, `qr.ts` | — | `/admin/supply/escaner` | — | ✅ |
| Redención atómica con todo el contexto | `redencion.ts` | `SupplyRedencion` | Escáner + reportes | `supply-e2e` · paso 7 | ✅ |
| Doble uso imposible | `redencion.ts` + índice único parcial | — | Escáner («YA UTILIZADO» con fecha y sucursal) | `supply-e2e` · paso 8 | ✅ |
| Reversa sin borrar la operación | `redencion.ts:reversarRedencion` | `reversadaAt` | `/superadmin/supply/redenciones` | `supply-e2e` · reversa | ✅ |
| Capacidad diaria / horaria / bloqueos | `capacidad.ts` | Snapshot del lote | Reserva + portal | `supply-distribucion` (9) | ✅ |
| Portal del comercio: ve pero no edita | `pool.ts:compromisosDelProveedor` | — | `/admin/supply` | `supply-contratos` · aislamiento | ✅ |
| Incidencias ligadas al lote | `incidencias.ts` | `SupplyIncidencia` | `/superadmin/supply/incidencias` | — | ✅ |
| Flujo de disputa con seis estados | `estados.ts` | — | Resolución de incidencia | `supply-procurement` · máquinas | ✅ |
| Extras separados contablemente | `redencion.ts` | `extrasMonto` | Escáner + reportes | — | ✅ |
| Cancelaciones con política distinta por caso | `derechos.ts:cancelarDerecho` | — | Panel | `supply-e2e` · cancelación | ✅ |

## 6 · Distribución comercial

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Regalos con CAC asociado | `distribucion.ts:regalar` | `origen: CAMPANA_BIENVENIDA` | `/cliente/beneficios/disponibles` | `supply-economia` · regalo | ✅ |
| Venta con descuento | `distribucion.ts` | `precioCliente` | — | `supply-economia` · venta | ⚠️ falta el cobro |
| Checkout Membego | `distribucion.ts:PuertoCobroMembego` | — | — | `supply-contratos` · no finge | ⚠️ puerto declarado |
| Subsidized offers separadas | `economia.ts:desglosarSubsidio` | `SUBSIDIO` | Formulario de acuerdo | `supply-economia` · subsidio | ✅ |
| Membresías | `distribucion.ts:porMembresia` | `origen: MEMBRESIA` | — | `supply-distribucion` · membresía | ✅ |
| Recompensas por puntos | `distribucion.ts:porRecompensa` | `origen: RECOMPENSA` | — | — | ✅ |
| Referidos desde el mismo pool | `distribucion.ts:porReferido` | `origen: REFERIDO` | — | — | ✅ |
| Cross-selling registrado | `distribucion.ts:recorridoDelCliente` | — | — | — | ✅ |
| Marketplace sin exponer el costo | `distribucion.ts:ofertasDisponibles` | — | `/cliente/beneficios/disponibles` | `supply-contratos` · no finge | ✅ |

## 7 · Dinero

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Pagos a proveedores | `finanzas.ts:registrarPago` | `SupplyPago` | `/superadmin/supply/liquidaciones` | — | ✅ |
| Ledger financiero, no un saldo guardado | `finanzas.ts:saldoDeProveedor` | `SupplyAsientoFinanciero` | Liquidaciones + proveedor | — | ✅ |
| Liquidación propuesta, no automática | `finanzas.ts:proponerLiquidacion` | — | Liquidaciones | — | ✅ |
| Conciliación con hallazgos accionables | `conciliacion.ts` | — | `/superadmin/supply/conciliacion` | `supply-economia` · hallazgos | ✅ |
| Siete costos separados | `economia.ts:costosDeLote` | — | Ficha del lote | `supply-economia` · costos | ✅ |

## 8 · Analítica

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Unit economics por unidad | `economia.ts:economiaUnidad` | — | `/superadmin/supply/economia` | `supply-economia` (2) | ✅ |
| Economía de campaña | `economia.ts:economiaCampana` | — | Economía | `supply-economia` (3) | ✅ |
| CAC alcanzado y activado | `economia.ts:metricasAdquisicion` | — | Economía | `supply-economia` (2) | ✅ |
| LTV vs CAC con datos reales | `economia.ts:ltvVsCac` | — | Economía | `supply-economia` (2) | ✅ |
| Scorecard de proveedor | `economia.ts:scorecard` | — | `/superadmin/supply/proveedores` | `supply-economia` (3) | ✅ |
| Señales de riesgo deterministas | `conciliacion.ts:senalesDeRiesgo` | — | Conciliación | — | ✅ |
| Motor de vencimientos con acciones | `vencimientos.ts` | — | `/superadmin/supply/vencimientos` | `supply-procurement` · riesgo | ✅ |

## 9 · Transversales

| Requisito | Dominio | Entidad | UI | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Permisos de plataforma y de proveedor | `permisos.ts` | Sección `supply` | Panel de permisos | `supply-contratos` · sección | ✅ |
| Multi-tenancy inviolable | `permisos.ts:ambitoProveedor` | `proveedorId` denormalizado | — | `supply-contratos` · aislamiento | ✅ |
| Auditoría de lo sensible | `actions.ts:auditar` | 19 `AuditAccion` | `/superadmin/auditoria` | `supply-contratos` · bitácora | ✅ |
| Idempotencia | `codigos.ts`, escrituras | `claveIdempotencia` único | — | `supply-contratos` · idempotencia | ✅ |
| Integridad en base | Migración | 6 `CHECK`, 3 únicos parciales | — | `supply-contratos` · invariantes | ✅ |
| Rendimiento | Esquema + migración | Índices compuestos y parciales | — | — | ✅ |
| Exportación reutilizada | `/supply/exportar` | — | Botón de exportar | `supply-contratos` · CSV | ✅ |
| Notificaciones | `vencimientos.ts`, cron | — | Panel | — | ⚠️ falta el envío |
| No eliminar histórico | Esquema (`onDelete: Restrict`) | — | — | `supply-contratos` · nadie borra | ✅ |
| Escenario E2E completo | — | — | — | `supply-e2e` (7) | ✅ |

---

## Las diecinueve preguntas de la Fase 77

| Pregunta | Respuesta | Dónde se comprueba |
| --- | --- | --- |
| ¿Puedo comprar 1.000 pizzas? | Sí | `/superadmin/supply/acuerdos` → orden → activar |
| ¿Puedo saber exactamente cuánto pagué? | Sí | Ficha del acuerdo y del lote |
| ¿Puedo asignar 200 a una campaña? | Sí | Ficha del lote |
| ¿Puedo regalar algunas? | Sí | Vitrina del cliente |
| ¿Puedo vender otras? | Modelo sí, **cobro no** | Puerto `PuertoCobroMembego` |
| ¿Puedo usarlas como recompensas? | Sí | `porRecompensa` |
| ¿Puedo usarlas como membresía? | Sí | `porMembresia` |
| ¿Puedo saber quién recibió cada una? | Sí | `/superadmin/supply/derechos` |
| ¿Puedo saber quién la consumió? | Sí | `/superadmin/supply/redenciones` |
| ¿En qué sucursal? | Sí | Columna «Sucursal» |
| ¿Qué empleado la entregó? | Sí | Columna «Entregó» |
| ¿Puedo impedir doble uso? | Sí | Índice único + estado + nonce |
| ¿Puedo detectar las próximas a vencer? | Sí | `/superadmin/supply/vencimientos` |
| ¿Cuánto supply queda exactamente? | Sí | Seis cubetas que suman lo comprado |
| ¿El comercio ve sus compromisos? | Sí | `/admin/supply` |
| ¿El comercio puede alterar las cifras? | **No** | Sin campos editables; solo enmienda |
| ¿Puedo reconciliar con el proveedor? | Sí | `/superadmin/supply/conciliacion` |
| ¿Puedo saber cuánto le debo? | Sí | `/superadmin/supply/liquidaciones` |
| ¿Puedo calcular el CAC y comparar campañas? | Sí | `/superadmin/supply/economia` |
| ¿Sirve la misma arquitectura para servicios? | Sí | Cuatro `SupplyTipo`, capacidad por contrato |
