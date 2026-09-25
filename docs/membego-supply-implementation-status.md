# MEMBEGO SUPPLY — Estado de implementación

Fecha de corte: **2026-09-23** · Rama: `claude/project-analysis-ojg18w`
Arquitectura: `docs/membego-supply-architecture.md` · ADRs: `docs/adr/0001`–`0008`

Puertas de calidad en el corte: **typecheck limpio · lint 0 errores · 2.615
pruebas en verde** (99 nuevas de Supply). Warnings de lint: 99, dos MENOS que
la línea base — el módulo no añadió ninguno.

---

## Resumen por release

| Release | Alcance | Estado |
| --- | --- | --- |
| **A · Procurement Foundation** | Capacidades de proveedor, acuerdos, órdenes, lotes, ledger | ✅ completo |
| **B · Supply Management** | Pool, asignación, concurrencia, FEFO, vencimientos | ✅ completo |
| **C · Customer Distribution** | Derechos, vouchers, QR dinámico, elegibilidad, holds | ✅ completo |
| **D · Merchant Fulfillment** | Escáner, redención, reversa, capacidad, reservas, portal, enmiendas, incidencias | ✅ completo |
| **E · Commercial Distribution** | Regalos, membresías, recompensas, referidos, marketplace, cross-selling | ✅ completo · **venta con cobro: puerto sin implementar** (ver §Pendientes) |
| **F · Financial Control** | Pagos, ledger financiero, liquidaciones, conciliación, costos separados | ✅ completo |
| **G · Analytics** | Unit economics, economía de campaña, CAC, LTV, scorecard, riesgo, 12 reportes | ✅ completo |

---

## Cambios en base de datos

**Una migración, solo creación:** `prisma/migrations/20260926_membego_supply/`.

- 15 tablas nuevas, todas con prefijo `supply_`.
- 14 enums nuevos.
- 19 valores añadidos al enum `AuditAccion` con `ADD VALUE IF NOT EXISTS`.
- **Cero** `ALTER` sobre tablas vivas, cero `DROP`, cero `DELETE`. Las relaciones
  inversas en `Company`, `User`, `Cliente`, `Sucursal`, `Servicio` y `Promocion`
  son relaciones de Prisma: no añaden columnas.
- Idempotente: todo va con `IF NOT EXISTS` o dentro de un bloque que traga
  `duplicate_object`.
- **Rollback**: `DROP TABLE` de las quince en orden inverso + `DROP TYPE` de los
  catorce enums. Ninguna fila de otro módulo depende de ellas.
- **Invariantes en la base**: 6 `CHECK` (cuadre de cubetas, no-negatividad,
  cantidad positiva, traslado real, sin sobregiro de asignación, montos
  válidos) y 3 índices únicos parciales (una redención viva por voucher, un
  voucher activo por derecho, una reserva viva por derecho).
- 4 índices parciales de rendimiento para los recorridos caros.

Sellada en `prisma/migrations/SUMAS.txt` (`npm run migraciones:sellar`).

---

## Fase por fase

Las 80 fases del encargo, con dónde vive cada una.

### Fases 1–6 · Fundación

| # | Fase | Estado | Dónde |
| --- | --- | --- | --- |
| 1 | Capacidades de proveedor | ✅ | `modules/capacidades/catalogo.ts` (`MEMBEGO_SUPPLIER`, `MEMBEGO_SUPPLY_FULFILLMENT`), nacen apagadas |
| 2 | Supplier agreements | ✅ | `SupplyAcuerdo`, `modules/supply/contrato.ts`, `procurement.ts` |
| 3 | Purchase orders con aprobación | ✅ | `SupplyOrden`, `SupplyOrdenLinea`; aprobador ≠ creador |
| 4 | Modalidades de pago | ✅ | `SupplyModalidadPago` (4 valores) + ledger financiero |
| 5 | Purchased entitlement lot | ✅ | `SupplyLote` con 11 campos `snapshot*` congelados |
| 6 | Entitlement ledger | ✅ | `SupplyMovimiento`, `modules/supply/ledger.ts`, `movimientos.ts` |

### Fases 7–10, 39 · Pool y asignación

| # | Fase | Estado | Dónde |
| --- | --- | --- | --- |
| 7 | Supply pool | ✅ | `/superadmin/supply` + `pool.ts:resumenPool` |
| 8 | Allocation engine | ✅ | `SupplyAsignacion`, `asignaciones.ts` |
| 9 | Concurrencia | ✅ | `FOR UPDATE` + validación + `CHECK` (ADR-0005) |
| 10 | FEFO configurable | ✅ | `fefo.ts`, 4 estrategias |
| 39 | Expiration engine | ✅ | `vencimientos.ts`, umbrales 30/14/7/3/1, `/superadmin/supply/vencimientos` |

### Fases 11–13, 16, 57, 58 · Cliente

| # | Fase | Estado | Dónde |
| --- | --- | --- | --- |
| 11 | Customer entitlements | ✅ | `SupplyDerecho`, 10 orígenes |
| 12 | Vouchers (≠ cupón) | ✅ | `SupplyVoucher`, 24 bytes `randomBytes` |
| 13 | QR dinámico | ✅ | `SupplyQrSesion`, 5 min, nonce único, antireplay |
| 16 | Experiencia del consumidor | ✅ | `/cliente/beneficios` |
| 57 | Elegibilidad previa | ✅ | `elegibilidad.ts`, 12 motivos de rechazo |
| 58 | Hold temporal | ✅ | estado `RETENIDO` + barrido en el cron |

### Fases 14–15, 17–20, 29–30, 59–60 · Comercio

| # | Fase | Estado | Dónde |
| --- | --- | --- | --- |
| 14 | Merchant scanner | ✅ | `/admin/supply/escaner`, dos pasos |
| 15 | Redemption atómica | ✅ | `redencion.ts`, 9 motivos de rechazo |
| 17 | Reserva / pickup | ✅ | `SupplyReserva`, `reservas.ts` |
| 18 | Capacity engine | ✅ | `capacidad.ts`, genérico por contrato (ADR-0007) |
| 19 | Merchant supply portal | ✅ | `/admin/supply`, solo lectura |
| 20 | Contract amendments | ✅ | `SupplyEnmienda` con antes/después/motivo/aprobador |
| 29 | Fulfillment incidents | ✅ | `SupplyIncidencia`, 8 tipos |
| 30 | Disputes | ✅ | 6 estados, la operación original no se borra |
| 59 | Extras | ✅ | `extrasMonto` separado de `aporteClienteComercio` |
| 60 | Cancelaciones | ✅ | `cancelarDerecho(devolverAlPool)` distingue los dos casos |

### Fases 21–28, 55–56 · Distribución

| # | Fase | Estado | Dónde |
| --- | --- | --- | --- |
| 21 | Regalos | ✅ | `distribucion.ts:regalar` + `/cliente/beneficios/disponibles` |
| 22 | Venta con descuento | ⚠️ | modelo listo; el **cobro** depende del puerto (Fase 23) |
| 23 | Checkout Membego | ⚠️ | `PuertoCobroMembego` declarado, `COBRO_MEMBEGO_DISPONIBLE = false` |
| 24 | Subsidized offers | ✅ | `SUBSIDIO` separado, `desglosarSubsidio` lanza si se confunde (ADR-0003) |
| 25 | Membresías | ✅ | `porMembresia(clienteId, asignacionId, periodo)` |
| 26 | Rewards | ✅ | `porRecompensa(clienteId, canjeId, …)` |
| 27 | Referidos | ✅ | `porReferido(clienteId, recompensaId, …)` |
| 28 | Cross-selling | ✅ | `recorridoDelCliente` registra la conversión cruzada |
| 55 | Integración marketplace | ✅ | `ofertasDisponibles` sin exponer costo ni contrato |
| 56 | Experiencia marketplace | ✅ | `TarjetaOferta` con disponibilidad real |

### Fases 31–38, 47–54, 62 · Dinero y analítica

| # | Fase | Estado | Dónde |
| --- | --- | --- | --- |
| 31 | Supplier scorecard | ✅ | `economia.ts:scorecard`, fórmula explicable |
| 32 | Reconciliation | ✅ | `conciliacion.ts`, 10 tipos de hallazgo con id de fila |
| 33 | Supplier payments | ✅ | `SupplyPago`, 7 tipos |
| 34 | Supplier financial ledger | ✅ | `SupplyAsientoFinanciero` (ADR-0008) |
| 35 | Unit economics | ✅ | `economiaUnidad`, CAC solo si el ingreso fue 0 |
| 36 | Campaign economics | ✅ | `economiaCampana`, tres costos separados |
| 37 | Customer acquisition | ✅ | `metricasAdquisicion`, CAC alcanzado y activado |
| 38 | LTV vs CAC | ✅ | `ltvVsCac` con GMV registrado, sin proyecciones |
| 47 | Dashboard superadmin | ✅ | 12 vistas bajo `/superadmin/supply` |
| 48 | 12 reportes obligatorios | ✅ | pantallas + `/superadmin/supply/exportar` (CSV compartido) |
| 49 | Reporte proveedor | ✅ | `/superadmin/supply/proveedores/[id]` |
| 50 | Reporte de lote | ✅ | columna «Cuadra» comparando suma vs comprado |
| 51 | Reporte campaña | ✅ | `/superadmin/supply/economia` |
| 52 | Reporte vencimiento | ✅ | ordenado por dinero en riesgo, no por fecha |
| 53 | Reconciliation report | ✅ | herramienta operativa con botón de recálculo |
| 54 | Supply risk | ✅ | `senalesDeRiesgo`, reglas deterministas, mínimo 10 entregas |
| 62 | Costos separados | ✅ | `costosDeLote` devuelve siete costos distintos |

### Fases 40–46, 61, 63–65, 67–70 · Transversales

| # | Fase | Estado | Nota |
| --- | --- | --- | --- |
| 40 | Notificaciones | ✅ completo salvo «producto listo» | Diez avisos por `Notificacion`, todos deduplicados: tres de barrido y siete de evento. Falta «producto listo» porque no existe el concepto de *pedido preparado* en el modelo |
| 41 | Roles y permisos | ✅ | Los 8 permisos del encargo resueltos contra el RBAC existente |
| 42 | Multi-tenancy | ✅ | `conEmpresa` + `where` explícito + `proveedorId` denormalizado; prueba automática |
| 43 | Auditoría | ✅ | 19 acciones `SUPPLY_*` con etiqueta y filtro |
| 44 | Idempotencia | ✅ | Clave única en derechos, redenciones y pagos; nonce de un solo uso |
| 45 | Database integrity | ✅ | 6 `CHECK` + 3 únicos parciales + FKs |
| 46 | Performance | ✅ | Índices por proveedor, lote, cliente, estado y vencimiento |
| 61 | Redención vs emisión | ✅ | Sostenido en ledger, economía y toda pantalla (ADR-0004) |
| 63 | No eliminar histórico | ✅ | `onDelete: Restrict` en lo contractual; prueba que prohíbe `delete` |
| 64 | Migraciones | ✅ | Solo creación, idempotente, sellada, con rollback documentado |
| 65 | Testing | ✅ | 99 pruebas en 6 archivos |
| 67 | Quality gates | ✅ | typecheck + lint + test tras cada release |
| 68 | Estado de implementación | ✅ | este documento |
| 69 | Matriz de trazabilidad | ✅ | `docs/membego-supply-requirements-traceability.md` |
| 70 | ADRs | ✅ | `docs/adr/0001`–`0008` |

---

## Archivos

| Qué | Cuántos | Líneas |
| --- | ---: | ---: |
| Dominio (`src/modules/supply/`) | 26 | 7.841 |
| Pantallas (`app/**/supply`, `cliente/beneficios`) | 21 | — |
| Componentes (`src/components/supply/`) | 12 | — |
| Pruebas (`tests/supply-*.test.ts`) | 6 | 2.060 |
| Esquema (`prisma/schema/supply.prisma`) | 1 | ~950 |
| Migración | 1 | ~1.190 |

**Modificados fuera del módulo (9):** el catálogo de capacidades, el catálogo de
secciones del RBAC, sus etiquetas, la clasificación de conceptos de plataforma,
las etiquetas de la bitácora, la navegación, cuatro archivos de esquema (solo
relaciones inversas) y `vercel.json` (el cron).

---

## Pruebas

| Archivo | Pruebas | Qué protege |
| --- | ---: | --- |
| `supply-ledger.test.ts` | 22 | El invariante, el no-sobregiro y los traslados ilegales |
| `supply-procurement.test.ts` | 28 | Máquinas de estado sin atajos, reglas del contrato, códigos |
| `supply-distribucion.test.ts` | 32 | FEFO, capacidad y elegibilidad |
| `supply-economia.test.ts` | 17 | Unit economics con los números del encargo |
| `supply-contratos.test.ts` | 18 | Las promesas estructurales del módulo |
| `supply-e2e.test.ts` | 7 | La cadena completa, paso a paso |

**Lo que NO cubren:** la escritura real en Postgres, el bloqueo de fila y los
`CHECK`. Eso exige base de datos; su forma la vigila `supply-contratos`.

---

## Riesgos abiertos

1. **Sin cobro a nombre de la plataforma.** La venta de supply (Fases 22-23)
   necesita cobrar a nombre de Membego, no de cada empresa. El puerto está
   declarado y `COBRO_MEMBEGO_DISPONIBLE = false` lo dice en voz alta: la
   vitrina no publica precios que nadie puede cobrar. **El camino que funciona
   hoy de punta a punta es el regalo.**
2. **«Producto listo» sin implementar** (único hueco de la fase 40). El modelo
   no tiene el concepto de *pedido preparado*: `SupplyReserva` guarda la hora
   acordada, pero nadie en el comercio marca «ya está hecho». Implementarlo es
   añadir un estado a la reserva y un botón en el portal del proveedor, no un
   aviso. Los avisos de MEMBEGO ADMIN que quedan (proveedor con muchas
   incidencias, riesgo de presupuesto, problema de capacidad global) son
   analíticos: salen del scorecard y de la economía, no de un evento.
3. **Políticas RLS.** El módulo usa `conEmpresa` en todo lo de empresa, y una
   prueba vigila que el portal del proveedor no lea fuera de la suya, así que no
   hay fuga hoy — pero es UNA capa donde el resto del proyecto tiene dos. Las
   políticas de `supply_*` no están escritas.

## Riesgos cerrados

- ~~Migración sin aplicar contra base real~~ · **cerrado el 25-09-2026.** El
  check `Esquema de base de datos` del CI levanta su propio PostgreSQL 16 y
  replica las 155 migraciones desde cero en cada PR; la migración está además
  aplicada en producción. Los seis `CHECK` se probaron uno a uno contra PG 16:
  lote que no cuadra, cubeta negativa, movimiento de cantidad cero, movimiento
  negativo y asiento que no traslada nada → los cinco RECHAZADOS; el lote que
  cuadra, aceptado.
- ~~Sin prueba de carrera real~~ · **cerrado el 25-09-2026.** Dos clientes
  simultáneos contra PG 16 peleando por la última unidad con el patrón de
  `bloquearLote`: A se la llevó (`UPDATE 1`), B esperó el bloqueo, leyó el
  estado ya comprometido y no hizo nada (`UPDATE 0`). Final `disponibles=0`,
  `emitidas=1000`, y `compradas` seguía cuadrando. Se probó el PATRÓN sobre la
  base, no `registrarMovimientos` entero: para eso hace falta Prisma contra una
  base, que la suite no tiene. Lo que estaba en duda era si el bloqueo
  serializa, y serializa.

## Los diez avisos (Fase 40) · 25-09-2026

`avisos.ts` (puro) decide qué se dice y con qué clave; `notificar.ts`
(server-only) escribe. La separación existe porque **la parte que se rompe en
silencio son las claves de deduplicación**: el cron corre a diario, y una clave
inestable no da error ni sale en ningún log — simplemente, al mes hay treinta
avisos del mismo lote y nadie vuelve a mirar la campanita.

| aviso | quién | clave | cuándo repite |
|---|---|---|---|
| Supply por vencer | superadmins | `supply-vence\|lote\|umbral` | al cruzar cada umbral (30, 14, 7, 3, 1) |
| Tu compromiso vence | admins del proveedor | la misma `\|proveedor` | igual |
| Descuadre CRÍTICA/ALTA | superadmins | `supply-descuadre\|tipo\|entidad\|id\|semanaISO` | una vez por semana mientras siga ahí |
| Beneficio por vencer | cliente | `supply-beneficio-vence\|derecho\|umbral` | 7, 3 y 1 días (barrido) |
| Beneficio nuevo | cliente | `supply-beneficio\|derecho` | nunca: un hecho, un aviso |
| Reserva confirmada | cliente | `supply-reserva\|reserva` | nunca |
| Entrega completada | cliente | `supply-entrega\|redención` | nunca |
| Voucher nuevo | admins del proveedor | `supply-voucher-nuevo\|derecho` | nunca |
| Cupo del día al 80% | admins del proveedor | `supply-capacidad\|proveedor\|día` | una vez por día |
| Incidencia | superadmins **y** proveedor, con mensajes distintos | `supply-incidencia\|id\|destinatario` | nunca |
| Liquidación confirmada | admins del proveedor | `supply-liquidacion\|pago` | nunca |

Los de evento se enganchan en las funciones de DOMINIO (`entregar`, `reservar`,
`redimir`, `abrirIncidencia`, `confirmarPago`), no en las actions: `entregar` es
el embudo de todos los canales —regalo, oferta, membresía, recompensa,
referido—, y colgar el aviso de la action habría dejado sin avisar a casi todos.
Cada gancho va **después de que cierre la transacción**: avisar abre la suya, y
dentro sería una transacción anidada. Hay una prueba que lo comprueba leyendo la
fuente, y el guardia del CI también.

El aviso de entrega es el **recibo del cliente**, no una cortesía: si un comercio
marca entregado algo que no entregó, esto se lo enseña el mismo día en vez del
mes siguiente, cuando vaya a usar su beneficio y ya no esté.

Lo que NO viaja: al proveedor nunca se le manda el nombre del cliente (lo verá
al escanear, en el mostrador) ni el texto libre de una incidencia (lo escribe
una persona enfadada, puede llevar nombres y teléfonos, y esto entra en la
campanita de un tercero). Dos pruebas lo vigilan.

Decisiones: a Membego se le dice el **dinero primero** («RD$51.000 en 170
unidades») porque «170 unidades» se lee como inventario y la cifra se lee como
pérdida. Al proveedor **nunca** se le dice el costo unitario —es información de
contrato y su portal no la enseña; hay una prueba que lo vigila—. Los hallazgos
`MEDIA` no llegan a la campanita: están en la pantalla de conciliación, y avisar
de todo es la forma más segura de que no se lea nada. El envío va **al final del
cron y dentro de un `try`**: soltar holds y cerrar lo vencido mueven el ledger y
no se quedan a medias porque falle un aviso.

## Deuda técnica consciente

- `SupplyAsignacion.destinoId` no tiene FK: los destinos viven en cinco tablas
  distintas y una FK obligaría a cinco columnas nulables que nadie mantendría al
  añadir la sexta.
- `sucursalIds` se copia como array en lugar de tabla puente: es una lista corta
  de solo lectura que se congela en el lote.
- La conciliación recorre lotes de uno en uno (tope 200). Con miles de lotes
  habrá que paginarla o moverla a un trabajo en cola.
