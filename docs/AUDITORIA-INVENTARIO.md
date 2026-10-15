# Auditoría del módulo de inventario (Commerce Core · Fase 2)

> Fecha: 2026-10-13 · Alcance: `prisma/schema/inventario.prisma`, `src/modules/inventory/*`, las pantallas de
> `/admin/inventario`, sus consumidores (pedidos, checkout, POS, ofertas), el cron, las pruebas y la documentación.
> Se compara con el inventario del Car Wash (`ProductoInventario`), que es OTRO módulo.
>
> Estado de este documento: la auditoría es de antes de INV-1; cada hallazgo dice si **INV-1, INV-2a, INV-2b, INV-2c, INV-3a, INV-3b, INV-3c, INV-4a, INV-4b o INV-4c ya lo cerraron** (ver §5, §7, §9, §11, §13, §15, §17, §19, §21 y §23).

## 1. Veredicto

**El núcleo es sólido; lo que falta es la capa operativa de un negocio real.** El ledger inmutable, las reservas con
vencimiento, los candados de concurrencia, la idempotencia y el aislamiento por empresa están bien hechos y bien
probados. Cumple todo lo que el Plan Maestro pidió para la Fase 2. Pero un encargado de tienda no podía: recibir una
factura de 30 productos de una vez, cargar existencias iniciales desde un archivo, hacer el conteo de toda una
sucursal, saber cuánto vale lo que tiene, saber qué comprar, ni ver qué se movió ayer en toda la empresa. Eso es lo que
separa un «control de stock» de un módulo de inventario profesional.

## 2. Lo que ya tiene (y está bien)

| Área | Estado |
|---|---|
| Modelo | Saldo por variante × sucursal con tres cubetas (disponible, apartado, dañado); ledger append-only con existencia antes/después; reservas con TTL. CHECKs y triggers en la base impiden saldos negativos y editar el historial (`20261038_inventory_core`). |
| Operaciones manuales | Entrada, devolución, conteo físico, ajuste sobrante/faltante, daño, resolver dañado (vendible o baja), transferencia entre sucursales, umbral de aviso. Motivo obligatorio en ajustes y daños. |
| Integración | Los pedidos reservan al crear, consumen al cerrar con QR, liberan al cancelar y devuelven al reembolsar (`orders/service.ts`). POS y checkout pasan por ahí. |
| Seguridad | Sección `inventario` con funciones `ajustar` y `transferir`; la empresa sale siempre de la sesión; bitácora `AuditLog` de lo manual; eventos `inventario.*` para automatizaciones. |
| Público | El cliente nunca ve cantidades: solo Disponible / Pocas unidades / Agotado. |
| Pruebas | Dominio (13), guardias de permisos (15), PostgreSQL (37, incluidas carreras y las 144 combinaciones del CHECK) y un E2E del panel. |

## 3. Hallazgos por área

### 3.1 Trabajar en volumen — el vacío más grande

| Falta | Hoy | Por qué importa | Fase |
|---|---|---|---|
| Recepción de mercancía múltiple | Una variante, una sucursal, un formulario por vez | Una factura trae 20–50 líneas: son 20–50 envíos | **INV-2a ✔** |
| Importar existencias (CSV) | No existe | Abrir una tienda con 300 SKU es imposible a mano | **INV-2a ✔** |
| Sesión de conteo físico por sucursal | Conteo de una variante a la vez | Un inventario real recorre toda la tienda y necesita informe de varianza | **INV-2b ✔** |
| Transferencias con estado | Inmediatas (salen y entran en la misma transacción) | Entre sucursales reales pasan horas o días: falta «enviada → recibida» y recepción parcial | **INV-2c ✔** |
| Búsqueda por código de barras | La lista buscaba por nombre y SKU; la variante ya tiene `barcode` | El lector es la forma normal de encontrar un producto en bodega | **INV-1 ✔** |

### 3.2 Compras y reposición

No había proveedores ni órdenes de compra en Commerce Core (el Car Wash sí: `Proveedor`, `OrdenCompra`, y recibir la orden
genera la entrada — es el modelo que se siguió), ni punto de reorden, ni «qué comprar». → **Proveedores y órdenes de compra:
INV-3b ✔** (ver §15). **Punto de reorden y «qué comprar»: INV-3c ✔** (ver §17): el umbral que ya existía más un «llenar hasta» por
producto y sucursal; la pantalla Reposición propone lo que falta para llegar, descontando lo ya pedido y lo que va en camino,
agrupado por proveedor, y crea borradores de orden. Sigue sin haber pronóstico de ventas ni carga masiva de objetivos.

### 3.3 Valor del inventario

`CatalogVariant.cost` es un costo fijo; los movimientos no llevaban costo, así que no había costo promedio, valor del
inventario por sucursal, costo de ventas (COGS) ni mermas valorizadas. → **INV-3a ✔** (costo promedio ponderado, valor del
inventario, costo de ventas del mes y corrección de costo; ver §13). **El kardex con sus entradas y salidas valoradas: INV-4a ✔**
(ver §19). **Las mermas valoradas por motivo: INV-4b ✔** (ver §21). **El margen real, precio contra costo congelado: INV-4c ✔** (ver §23).

### 3.4 Historial y reportes

| Falta | Hoy | Fase |
|---|---|---|
| Movimientos de toda la empresa | Solo había historial por variante | **INV-1 ✔** |
| Filtros del historial (tipo, fecha, sucursal, persona) | Solo «cargar más» | **INV-1 ✔** |
| Exportar | Nada se exportaba | **INV-1 ✔** (CSV) |
| Reservas vivas de la empresa | Solo por variante, máximo 50 | **INV-1 ✔** |
| Kardex, rotación, stock sin movimiento | `modules/reportes` tiene 20 reportes y ninguno es de inventario | **INV-4a ✔** (kardex con entradas y salidas valoradas, stock sin ventas, rotación y cobertura) |
| Motivos codificados y mermas por motivo | Los motivos eran texto libre, imposibles de sumar | **INV-4b ✔** (catálogo de motivos en el ledger e informe «Mermas por motivo») |
| Margen real, tarjeta de dashboard | No se cruzaba costo con precio; el dashboard no enseñaba inventario más que el stock bajo | **INV-4c ✔** (informe «Margen real» y tarjeta «Inventario» del dashboard) |

### 3.5 Avisos

| Hallazgo | Detalle | Fase |
|---|---|---|
| El aviso de stock bajo solo sonaba en ventas del marketplace | `avisarStockBajo` se llamaba desde checkout, pedido móvil y cierre con QR. **No** tras una venta de POS, un ajuste faltante, un daño ni una transferencia: un daño que agotaba un producto no avisaba a nadie | **INV-1 ✔** |
| «Agotado» quedaba callado tras «Stock bajo» | La clave de aviso era una por nivel y día: si por la mañana avisó «Stock bajo», por la tarde el «Agotado» no avisaba | **INV-1 ✔** (la clave lleva el estado) |
| Umbral uno por uno | El umbral es por variante × sucursal | **INV-1 ✔** (aplicar a las otras sucursales con saldo) |
| Solo in-app | `notificarAdmins` es la campanita; sin correo ni WhatsApp; a todos los administradores, sin rol de «compras» | pendiente |

### 3.6 Trazabilidad avanzada (según el negocio)

Lotes y vencimiento (el algoritmo FEFO ya existe en `lib/commerce-primitives/fefo.ts`, lo usa Supply V2 y el inventario
no), números de serie, kits/bundles (el tipo `BUNDLE` existe y no descuenta componentes), unidades de medida y
decimales (hoy solo enteros, decisión documentada en el esquema: el cambio más caro porque toca el ledger) y ubicaciones
internas (`Sucursal` no distingue tienda de almacén). → INV-5, o fuera de la hoja de ruta.

### 3.7 Integración y acceso

No hay API de inventario (`/api/v1` solo tiene `auth` y `cliente`); los eventos `inventario.*` sí salen por
automatizaciones. No existe un rol de «bodega» que mueva stock sin ver finanzas. → INV-5.

### 3.8 Coherencia del producto

- **Dos inventarios con el mismo nombre.** El de Commerce Core cuelga de `CATALOGO_UNIFICADO`; el del Car Wash, de la
  capacidad `INVENTARIO` (`modules/carwash/inventario*.ts`), usa decimales y tiene proveedores y órdenes de compra. Una
  empresa de Car Wash puede ver dos «Inventario» con reglas distintas. **Decisión pendiente:** converger, o renombrar el
  del Car Wash a «Insumos».
- **Dos fuentes de «agotado» — y la manual MANDA.** *(Corrección a la primera redacción de esta auditoría, que decía que
  solo causaba confusión en el panel.)* Una variante marcada «Agotada» a mano **no se puede vender aunque haya
  existencias**: los pedidos la rechazan (`orders/service.ts`, `v.status !== 'ACTIVE'`), el checkout también
  (`checkout/service.ts`) y la vitrina la enseña «Agotado» (`catalog/publico-nucleo.ts`). Reponer mercancía no la
  reactiva: hay que volver a ponerla «Activa» en el catálogo. **INV-1 ✔** lo advierte en la lista, en la ficha y en el
  formulario de variante, sin tocar datos. No se sincroniza automáticamente a propósito: pisaría a quien pausa una
  variante deliberadamente.

## 4. Hoja de ruta

| Fase | Contenido | Esquema | Tamaño | Estado |
|---|---|---|---|---|
| **INV-1 · Visibilidad** | Movimientos de toda la empresa con filtros y CSV; búsqueda y salto por código de barras; avisos de stock bajo en POS y movimientos manuales; reservas vivas de la empresa; umbral en varias sucursales; estado manual advertido | Sin cambios | S | **Hecha** |
| **INV-2a · Entradas en volumen** | Documento de entrada con varias líneas, número `ENT-AAAA-NNNNNN`, factura y nota; captura con lector; importación CSV todo o nada (hasta 1.000 filas) con revisión previa y plantilla; lista, detalle y CSV de cada entrada | `InventoryReceipt`, `InventoryReceiptLine` (migración `20261056`) | M | **Hecha** (este documento, §7) |
| **INV-2b · Conteo físico por sucursal** | Sesión de conteo (una abierta por sucursal), a ciegas, captura por lector o por hoja CSV, informe de diferencias con CSV, ajuste por la diferencia (no por el número), todo o nada | `InventoryCountSession`, `InventoryCountLine` (migración `20261057`) | M | **Hecha** (este documento, §9) |
| **INV-2c · Transferencias con estado** | «Con envío»: enviada → parcial/recibida o cancelada; recepción parcial; cerrar con faltante y motivo; en tránsito visible en la ficha; aviso a los administradores al enviar. La transferencia directa actual se conserva | `InventoryTransfer`, `InventoryTransferLine` (migración `20261058`) | M | **Hecha** (este documento, §11) |
| **INV-3a · Costo y valor del inventario** | Costo unitario en las líneas de entrada (manual, CSV y entrada de un producto); costo promedio ponderado por producto; ventas, devoluciones, daños y ajustes valorados con el promedio de su instante; pantalla «Valor del inventario» por sucursal y producto (con CSV); costo de ventas del mes; corregir el costo con motivo. Función de permiso nueva `costos` | `unitCost` en movimientos y líneas de entrada; `InventoryVariantCost`, `InventoryCostAdjustment` (migración `20261059`) | M | **Hecha** (este documento, §13) |
| **INV-3b · Proveedores y órdenes de compra** | Proveedores; orden de compra `OC-AAAA-NNNNNN` (Borrador → Pedida → Recibida en parte → Recibida, o Cancelada) con el costo de cada línea; recibir en tandas crea una entrada con los costos de la orden (nunca más de lo pedido; cerrar con faltante exige motivo); vínculo producto-proveedor con código, último costo, días de entrega y preferido; CSV de la orden. Función de permiso nueva `comprar` | `InventorySupplier`, `InventoryPurchaseOrder`, `InventoryPurchaseOrderLine`, `InventoryVariantSupplier`; `purchaseOrderId` en las entradas (migración `20261060`) | M | **Hecha** (este documento, §15) |
| **INV-3c · Reposición** | «Llenar hasta» por producto y sucursal (junto al umbral que ya existía; tiene que quedar por encima de él); pestaña «Reposición» con la cantidad sugerida —lo disponible más lo pedido que no ha llegado más lo que va en camino se descuentan; un borrador no—, agrupada por proveedor y sucursal, con filtros y CSV, que crea borradores de orden con el último costo de cada proveedor. Sin función nueva (`comprar` para ver y crear, `ajustar` para fijar el objetivo) | `targetStock` en el saldo (migración `20261066`) | S | **Hecha** (este documento, §17) |
| **INV-4a · Informes de existencias** | Kardex de un producto (entradas, salidas y saldo, con lo que valieron si se tiene la función `costos`), stock sin ventas (qué tiene existencias y no se vende, y cuánto dinero tiene parado), rotación y cobertura (cuánto se vende, cuántas veces rota, para cuántos días alcanza; costo de ventas y días de inventario con `costos`), todos con filtros y CSV. Sin función de permiso nueva | Sin cambios (todo se lee del ledger) | M | **Hecha** (este documento, §19) |
| **INV-4b · Motivos codificados** | Catálogo de 14 motivos (vencido, robo, pérdida, muestra, consumo interno, devuelto al proveedor, diferencia de conteo, apareció mercancía, error de captura, golpe, mal almacenamiento, daño en el transporte, defecto de fábrica y «otro») que el ajuste, el daño y la baja **exigen** elegir; el texto libre queda como detalle. Los conteos escriben solos «diferencia de conteo». Informe «Mermas por motivo» (lo perdido, los sobrantes y lo dañado, cada uno por motivo, con unidades y —con `costos`— lo que valieron), con filtros y CSV; el motivo se ve en Movimientos, en el historial de la ficha y en el kardex (pantalla y CSV). Sin función de permiso nueva | `reasonCode` en el movimiento (migración `20261067`) | M | **Hecha** (este documento, §21) |
| **INV-4c · Margen real** | Informe «Margen real» (solo con la función `costos`): por producto, lo cobrado (precio de la línea del pedido menos su descuento) contra el costo que el ledger congeló al vender, con margen y porcentaje; lo que no se puede comparar (sin costo, reembolsado, en otra moneda, sin pedido) se enseña aparte, nunca como cero; filtros, cinco órdenes y CSV. Tarjeta «Inventario» en el dashboard: valor, margen del mes y lo perdido (unidades para quien no tiene `costos`). Sin función de permiso nueva | **Ninguno** (todo se lee del ledger y de los pedidos) | S | **Hecha** (este documento, §23) |
| **INV-5a · Lotes y vencimiento** | Un producto puede LLEVAR LOTES (se activa por producto, de un solo sentido): cada unidad es de un lote con su código y, si lo tiene, su día de vencimiento; lo que ya había pasa al lote «SIN LOTE»; se vende, se aparta y se saca **primero lo que antes vence** (FEFO) y **lo vencido no se vende**; las devoluciones vuelven a su lote; dañar, ajustar, dar de baja y recuperar por lote; mover unidades entre lotes (corregir uno mal capturado, sin que cuente como merma); el barrido diario saca lo vencido de lo vendible. La base mantiene los saldos por lote y vigila que los lotes sumen lo que hay | `InventoryLotTracking`, `InventoryLot`, `InventoryLotBalance`, `InventoryLotOpening`, `InventoryMovementLot` (migración `20261068`) | L | **Hecha** (este documento, §25) |
| **INV-5b1 · Vence pronto** | Informe «Vence pronto» (los lotes con existencias que ya vencieron o vencen en 7 a 90 días, por sucursal, de lo que antes vence a lo que después, con lo vendible, lo apartado y lo dañado, filtros, páginas y CSV), una cifra en la tarjeta de inventario del dashboard y un aviso a los administradores desde el barrido diario (una vez por semana y nivel de urgencia, y una vez por día lo que venció) | — (sin migración) | S | **hecha** |
| INV-5b2 · Lotes en órdenes de compra | Recibir una orden de compra con los lotes de lo que llega (hoy se niega para un producto con lotes) | — | S | pendiente |
| INV-5b3 · Lotes en conteos | Contar por lote y aplicar la diferencia lote por lote | Conteo por lote | M | pendiente |
| INV-5b4 · Lotes en transferencias | Que el lote viaje con lo que se transfiere (directa y con envío) | Lotes de la línea | M | pendiente |
| INV-5b5 · Corregir y desactivar | Corregir el vencimiento de un lote con su historia y desactivar los lotes de un producto | Historia del vencimiento | M | pendiente |
| INV-5c · Series | Número de serie por unidad | Series | L | pendiente |
| INV-5d · Kits | Kits que descuentan componentes | Kits | L | pendiente |
| INV-5e · API v1 y rol de bodega | API pública del inventario; un rol que mueve stock sin ver finanzas | — | M | pendiente |

## 5. INV-1 · qué se hizo

- **Movimientos de la empresa** — `/admin/inventario/movimientos`. Filtros por tipo, sucursal, persona (o «Sistema»),
  rango de fechas en días locales de la empresa y producto (nombre, SKU o código de barras). Paginación por cursor en la
  URL. Los filtros se leen con `modules/inventory/filtros.ts` (puro) y se aplican en `movimientosEmpresaEnTx`.
- **Exportar CSV** — `/admin/inventario/movimientos/exportar`: los **mismos filtros** que la pantalla (misma función de
  lectura de la URL), hasta 5.000 filas, con bloque de alcance (filtros, zona horaria, si el tope cortó el archivo) y
  textos libres neutralizados contra fórmulas de hoja de cálculo. Un route handler no pasa por el layout de la sección:
  se guarda solo con `requireSection('inventario')` y la empresa sale de la sesión.
- **Reservas vivas** — `/admin/inventario/reservas`: lo apartado ahora, con vencimiento y pedido enlazado; las vencidas
  que el barrido aún no recogió no cuentan.
- **Código de barras** — la lista busca también por `barcode`; un SKU o código **exacto** y único salta a la ficha (lo
  que hace un lector). Si dos productos coinciden de forma exacta, no salta a ninguno.
- **Avisos** — `avisarStockBajo` ahora también tras una venta de mostrador, el cobro en caja de un pedido y los movimientos
  manuales que bajan lo vendible (daño, faltante, transferencia en el origen, conteo a la baja). La clave de aviso lleva
  el estado: «Agotado» avisa aunque «Stock bajo» ya avisara hoy. Sigue siendo un aviso por estado y día.
- **Umbral en varias sucursales** — casilla en la tarjeta de sucursal: aplica el mismo umbral a las demás sucursales
  **activas donde el producto ya tiene saldo** (no crea saldos en cero ni toca sucursales cerradas).
- **Estado manual de la variante** — advertencia en la lista, la ficha y el formulario de variante (ver §3.8).
- **Menú de tres vistas** — Existencias · Movimientos · Reservas.

Archivos principales: `src/modules/inventory/{filtros,exportacion,queries,actions,service,avisos,formato}.ts`,
`src/app/(admin)/admin/inventario/{movimientos,reservas}/`, `src/components/inventario/NavegacionInventario.tsx`,
`src/modules/pos/actions.ts`.

## 6. Verificación de INV-1 (2026-10-13)

Local, sobre PostgreSQL 16 desechable (clúster nuevo en `127.0.0.1`, con collation ICU `en-US` y las migraciones
aplicadas desde vacío; no se tocó ninguna base real). Sin Supabase, Vercel, lector de código de barras ni dispositivos
reales: **no verificados**.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (los avisos son preexistentes y ninguno está en los archivos tocados) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; entrada compartida 855/1000 KB (86 %), trozo mayor 409/600 KB |
| Unitarias (`bun run test`) | 4191 pruebas: 4184 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | 666/666, cero omitidas |
| Pruebas nuevas | 15 puras (`inventario-inv1.test.ts`), 9 guardias nuevas (`inventario-permisos.test.ts`), 5 contra PostgreSQL de inventario (38 a 42) y 1 de escalada de avisos (`comercio-experiencia` 6b) |
| E2E (`bun run e2e:limpio`, escritorio) | 48/48 sobre la compilación final: `inventario-admin` (5, con el recorrido nuevo), `comercio-experiencia` (9), `pedidos-membego` (15), `pos-membego` (7), `carrito-checkout` (12) |
| Mutaciones de las guardias y pruebas nuevas | 17 de 17 detectadas: aviso quitado de la transferencia, exportación sin `requireSection('inventario')`, clave de aviso sin estado, usuarios sin `companyId`, pantalla sin guardia de rol, fórmulas sin neutralizar, rango de fechas al revés, texto de la advertencia, fin del día inclusivo, aviso del POS quitado, `companyId` fuera de los movimientos, cursor fuera, «Sistema» mal mapeado, reservas vencidas contadas, salto con varias coincidencias exactas, umbral en sucursales cerradas, clave de aviso en la prueba contra la base |

Hallazgos de la propia verificación:

- La suite unitaria completa cazó **dos** errores míos antes de entregar: el botón de exportar escrito a mano (el
  repositorio exige `BotonExportar`) y la tabla de rutas del documento (`bun run docs:rutas`, ya regenerada).
- Los avisos nuevos se programan con `after()` de Next, no con `void`: el propio repositorio documenta que un aviso
  suelto puede perderse cuando termina la respuesta.
- `tests/e2e/separacion-invariantes.spec.ts` («el cliente entra a su casa…») falla en este entorno **de la misma forma
  sobre `main` sin estos cambios** (`/cliente/explorar` termina en `/cliente/planes`): es previo e independiente de
  INV-1 y no se tocó.
- `after()` se ejercitó en un servidor de producción local (`next start`); su comportamiento sobre el runtime de Vercel
  no se verificó.

## 7. INV-2a · qué se hizo

> INV-2 se entrega en tres partes, cada una con su migración, su commit y su verificación: **2a** entradas en volumen
> (esta), **2b** conteo físico por sucursal y **2c** transferencias con estado. Decisiones aprobadas: sin borradores (se
> registra todo junto o nada), documentos inmutables (un error se corrige con otro movimiento), importación todo o nada
> con tope de 1.000 filas, y las mismas funciones de permiso (`ajustar` para entradas e importación; `transferir` para los
> envíos de 2c), sin funciones nuevas. Los costos quedan fuera (INV-3).

- **Entrada de mercancía como documento** — `/admin/inventario/entradas/nueva`. Una entrada es UN documento con número
  `ENT-AAAA-NNNNNN` (correlativo por empresa y año, sin huecos), sucursal que recibe, factura o referencia y nota. Cada
  línea es un producto con su cantidad, y apunta al movimiento `PURCHASE` que la causó (el movimiento apunta de vuelta a
  la entrada). Se captura con lector de código de barras: el código exacto se añade solo, escanear otra vez suma una
  unidad, y un SKU o código inexistente —o un servicio— no entra. Hasta 200 productos a mano.
- **Todo o nada, idempotente, sin interbloqueos** — `registrarEntradaMultipleEnTx` valida, crea los saldos que falten
  (en orden fijo), bloquea **todos** los saldos juntos y en orden de id, comprueba la clave de idempotencia **ya con los
  candados** (cinco envíos idénticos a la vez crean una sola entrada), aplica el ledger puro a cada línea y escribe todo
  con `escribirMovimientosPorLote` (un `INSERT … RETURNING` y un `UPDATE … FROM (VALUES …)`), la segunda puerta de escritura
  de saldos junto a `escribirMovimiento` (una guardia prohíbe una tercera). Mil líneas caben en una transacción.
- **Inmutable en la base** — las tablas `inventory_receipts` y `inventory_receipt_lines` no admiten UPDATE, DELETE ni
  TRUNCATE (disparadores), con CHECK de forma (cantidades, número, longitudes) y claves foráneas compuestas por empresa.
  Efecto colateral conocido: como las líneas apuntan al ledger, un `TRUNCATE` a secas del ledger ya lo frena PostgreSQL por
  la clave foránea (antes que el disparador); vaciarlo junto con las líneas, o con `CASCADE`, lo frena el disparador. La
  prueba 12 de `inventory.db.test.ts` se ajustó a eso y prueba las tres formas.
- **Lista, detalle y CSV** — `/admin/inventario/entradas` (filtros: número o factura, sucursal, días locales de la
  empresa; paginación por cursor), `/entradas/[id]` (líneas con existencia antes → después; una entrada de otra empresa o
  inventada se ve idéntica: 404) y `/entradas/[id]/exportar` (CSV con las fórmulas neutralizadas).
- **Importar CSV** — `/admin/inventario/importar`: dos pasos. «Revisar archivo» lee y valida **sin escribir nada** y
  explica fila por fila (número de fila como en la hoja); «Registrar» solo aparece con el archivo limpio y el servidor
  **vuelve a leerlo y validarlo** (no se fía de la revisión que viajó por el navegador). Reconoce `sku` y/o
  `codigo_de_barras`, `cantidad`, separador `;` o `,`, BOM y alias comunes; rechaza códigos en notación científica (Excel),
  SKU ambiguos por mayúsculas, SKU y código de productos distintos, productos sin control de inventario y duplicados;
  avisa de los descontinuados. Hasta 1.000 filas y 2 MB; con un solo error no se registra nada. Plantilla descargable con
  filas de ejemplo que no pueden pasar por producto real (`EJEMPLO-BORRAR-…`). Envíos limitados a 20 por minuto.
- **Degradación** — si la migración aún no está aplicada, las pantallas nuevas dicen exactamente eso en lugar de fallar
  (`describirFalloDeCarga`), y `/api/health` lo reporta (`inventory_receipts.esquema`).

Archivos principales: `prisma/schema/inventario.prisma`, `prisma/migrations/20261056_inventory_receipts/`,
`src/modules/inventory/{entradas,importacion,importar,errores-pantalla}.ts` (+ `service`, `queries`, `filtros`,
`exportacion`, `actions`), `src/components/inventario/{EntradaMultipleForm,ImportarForm}.tsx`,
`src/app/(admin)/admin/inventario/{entradas,importar}/`.

### Cómo aplicar la migración (obligatorio y en este orden)

1. **SQL primero**: copiar `prisma/migrations/20261056_inventory_receipts/migration.sql` al SQL Editor de Supabase y
   ejecutarlo (es aditivo e idempotente: se puede correr dos veces). Solo crea objetos nuevos; no toca los existentes.
2. **Después el código** (despliegue en Vercel). Un código desplegado antes de la migración deja las pantallas nuevas
   con un mensaje claro y el resto del inventario intacto, pero registrar una entrada fallaría.
3. Verificar con `npm run db:doctor` y con `/api/health` (debe listar `inventory_receipts.esquema` en verde).

## 8. Verificación de INV-2a (2026-10-14)

Local, sobre PostgreSQL 16 desechable (clúster nuevo en `127.0.0.1`, collation ICU `en-US`, las 213 migraciones aplicadas
desde vacío con `prisma migrate deploy`, la nueva dos veces seguidas sin error y `prisma migrate diff` sin diferencias;
no se tocó ninguna base real). Sin Supabase real, Vercel, lector de código de barras, Excel ni dispositivos móviles/Safari:
**no verificados**.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (los avisos son preexistentes; ninguno en los archivos tocados) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; entrada compartida 855/1000 KB (86 %), trozo mayor 409/600 KB |
| Unitarias (`bun run test`) | 4221 pruebas: 4214 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | 680/680, cero omitidas |
| Pruebas nuevas | 21 puras (`inventario-entradas.test.ts`), 9 guardias nuevas (`inventario-permisos.test.ts`, ya 33), 14 contra PostgreSQL (`inventory-entradas.db.test.ts`) y un recorrido E2E nuevo |
| E2E (`bun run e2e:limpio`, escritorio) | 67/67 sobre la compilación final: 49 en `inventario-admin` (6, con el recorrido nuevo), `comercio-experiencia`, `pedidos-membego`, `pos-membego` y `carrito-checkout`, y 18 en `catalogo-admin`, `catalogo-api` y `catalogo-publico` (comparten el arnés que ganó el campo `barcode`) |
| Mutaciones | 41 de 43 detectadas (ver abajo) |

Hallazgos de la propia verificación (importa que se sepan):

- **Un interbloqueo real, cazado por la suite completa de PostgreSQL y no por mi prueba aislada.** Dos entradas con los
  mismos productos *nuevos* en distinto orden se interbloqueaban al crear los saldos que faltan (un
  `INSERT … ON CONFLICT` fila a fila espera a la fila que la otra transacción acaba de insertar). Mi prueba de carrera
  pasaba de suerte con pocos productos; con 30 rondas × 20 productos fallaba 3 de 3. Corregido creando los saldos en
  orden fijo; la prueba ahora hace 25 rondas × 20 productos con productos nuevos en cada ronda (sin el arreglo falla 4 de
  4) y hay una guardia estática del orden. **Esto vale para INV-2c**: toda escritura nueva que cree o bloquee saldos de
  varios productos debe hacerlo en orden fijo.
- **Una prueba preexistente cambió de mensaje**: `inventory.db.test.ts` (12) esperaba que `TRUNCATE inventory_movements`
  lo rechazara el disparador del ledger; ahora lo rechaza antes PostgreSQL por la clave foránea de las líneas de entrada.
  El ledger sigue protegido (sin `CASCADE`, con `CASCADE` y junto con las líneas); la prueba cubre las tres formas.
- **Mutaciones**: 5 sobrevivieron al principio y obligaron a reforzar pruebas: los topes (200 / 1.000) no estaban fijados,
  la guardia de «la empresa sale de la sesión» no comprobaba lo que decía su título, el origen `MANUAL` podía venir del
  navegador sin que nada lo notara, y el filtro por empresa de las dos consultas de la búsqueda de productos no lo veía la
  guardia general (van dentro de un `Promise.all`); además `entradaToCsv` no tenía prueba unitaria directa (solo el E2E).
  Las 2 que siguen vivas son comprobaciones defensivas que no tienen forma de dispararse desde fuera
  (`LOTE_INCOMPLETO` y `NIVEL_NO_ENCONTRADO`: con los saldos bloqueados y las claves foráneas compuestas, el `UPDATE` o el
  `INSERT` fallarían antes).
- **Una prueba ajena es intermitente**: `supply-v2-slice9` («B2·G §8 caso 1», arriendo del *outbox*) falló una vez en la
  suite completa y pasó 3 de 3 aislada y en la siguiente corrida completa. No toca el inventario; no se modificó.
- En esta máquina el servidor de E2E imprime muchos `fetch failed … 127.0.0.1:54329`: son llamadas de Supabase Auth a un
  servidor que no existe en el arnés (las sesiones se firman localmente). Ruido previo, no afecta a los resultados.

## 9. INV-2b · qué se hizo

> Segunda de las tres partes de INV-2. Decisiones aprobadas que aplican aquí: lo no contado no se toca; un conteo
> abierto por sucursal; los ajustes se aplican como DIFERENCIA contra lo que decía el sistema al contar, y se rechazan
> las líneas que dejarían menos de lo apartado; documentos inmutables una vez aplicados; importación todo o nada con
> tope de 1.000 filas; y la misma función de permiso `ajustar`, sin funciones nuevas.

- **Un conteo es un documento** — `/admin/inventario/conteos`. Número `CNT-AAAA-NNNNNN`, sucursal, nota, quién lo abrió.
  Estados **Abierto → Aplicado / Cancelado**. Solo puede haber UNO abierto por sucursal (índice único parcial en la
  base); abrirlo de nuevo la misma persona devuelve el suyo (un doble clic no abre dos) y otra recibe el aviso con el
  número que está abierto. Mientras está abierto es un borrador de trabajo (se captura, se corrige, se quita una línea);
  desde que se aplica o se cancela queda congelado **en la base**, no solo en el servicio.
- **A ciegas de verdad** — en la pantalla de captura no hay una sola cifra del sistema: `conteoDetalleEnTx(…, { conEsperado:
  false })` ni siquiera la lee, la búsqueda para contar no pide sucursal (devuelve `disponible: null`) y la hoja en
  blanco solo lista productos. Una guardia comprueba esto en el código; una prueba E2E, en la pantalla. Lo esperado
  aparece solo en «Revisar y aplicar» y en el conteo ya cerrado.
- **Captura** — con lector de código de barras: cada escaneo SUMA (con «unidades por escaneo» para contar por cajas) y
  entra en una **cola** que se atiende en orden, así que una ráfaga de escaneos no pierde ninguno y el campo nunca se
  bloquea; escribir el número en la lista lo FIJA (y retoma la foto de lo esperado, porque es un recuento de ese
  momento). Cada línea guarda lo contado y lo que decía el sistema **en ese momento**. Hasta 1.000 productos por
  conteo; para seguir, se aplica y se abre otro.
- **Hoja en blanco y CSV** — `/conteos/[id]/hoja` baja SKU, código de barras y nombre de cada producto con existencias
  y una columna «contado» vacía (sin decir cuántos hay). Se cuenta en papel o en Excel, se llena «contado» y se sube en
  `/conteos/[id]/importar`: dos pasos, **todo o nada**, el servidor vuelve a validar al cargar. Una celda vacía significa
  «no se contó» y no se toca; un 0 es «lo busqué y no hay». El apóstrofo con que la hoja neutraliza un SKU que Excel
  evaluaría como fórmula se quita al leerla de vuelta. El tope de 1.000 se mide sobre las filas con algo contado, no
  sobre las miles de la hoja.
- **Revisar** — `/conteos/[id]/revisar`: resumen (contados, coinciden, sobrantes y faltantes en líneas y en unidades,
  con existencias y sin contar) y cada producto con esperado, contado y diferencia, de lo que más descuadra a lo que
  menos. Avisa de antemano qué líneas **hoy no se podrían aplicar**. El informe baja en CSV.
- **Aplicar** — `aplicarConteoEnTx`, todo o nada y en una transacción: bloquea el conteo, crea los saldos que falten
  (en orden fijo) y los bloquea juntos en orden de id, y ajusta cada producto por la **diferencia** (contado − esperado
  al contar) aplicada a lo que hay AHORA. Ejemplo medido: el sistema decía 10, se contó 8 y mientras tanto se
  vendieron 3 → hay 7 y queda en 5, no en 8; el número contado no pisa las ventas. Antes de rechazar un faltante por
  reservas se vencen las caducadas que nadie ha barrido. Si alguna línea dejaría menos de lo apartado, **no se aplica
  ninguna** y se muestran todas las que fallan (se recuentan o se quitan). Cada ajuste es un movimiento `ADJUSTMENT` con
  el motivo «Conteo físico CNT-…» enlazado a su línea; lo que bajó pasa por el aviso de stock bajo después de
  confirmar. Aplicar dos veces —también a la vez— no repite nada.
- **Cancelar** — descarta el conteo sin tocar existencias y guarda quién y por qué.
- **Degradación** — con la migración sin aplicar, las pantallas dicen exactamente eso (`describirFalloDeCarga`) y
  `/api/health` lo reporta (`inventory_count_sessions.esquema`).

Archivos principales: `prisma/schema/inventario.prisma`, `prisma/migrations/20261057_inventory_counts/`,
`src/modules/inventory/{conteos,importar,importacion}.ts` (+ `service`, `queries`, `filtros`, `exportacion`, `actions`),
`src/components/inventario/{IniciarConteoForm,CapturaConteo,FilaConteoEditable,ImportarConteoForm,AplicarConteoForm,InformeDiferencias}.tsx`,
`src/app/(admin)/admin/inventario/conteos/`.

### Cómo aplicar la migración (obligatorio y en este orden)

1. **SQL primero**: copiar `prisma/migrations/20261057_inventory_counts/migration.sql` al SQL Editor de Supabase y
   ejecutarlo (aditivo e idempotente: se puede correr dos veces). Solo crea objetos nuevos y no depende de `20261056`.
2. **Después el código**. Un código desplegado antes deja las pantallas de conteos con un mensaje claro y el resto
   intacto, pero abrir un conteo fallaría.
3. Verificar con `npm run db:doctor` y `/api/health` (debe listar `inventory_count_sessions.esquema` en verde).

## 10. Verificación de INV-2b (2026-10-14)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`, las 214 migraciones aplicadas desde vacío, la nueva dos
veces seguidas sin error y `prisma migrate diff` sin diferencias; no se tocó ninguna base real). Sin Supabase real,
Vercel, lector de código de barras físico, Excel, móvil ni Safari: **no verificados**.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (los avisos son preexistentes; ninguno en los archivos tocados) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; entrada compartida 856/1000 KB (86 %), trozo mayor 409/600 KB |
| Unitarias (`bun run test`) | 4248 pruebas: 4241 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | 696/696, cero omitidas |
| Pruebas nuevas | 18 puras (`inventario-conteos.test.ts`), 9 guardias nuevas (`inventario-permisos.test.ts`, ya 42), 16 contra PostgreSQL (`inventory-conteos.db.test.ts`) y un recorrido E2E nuevo |
| E2E (`bun run e2e:limpio`, escritorio) | 68/68 sobre la compilación final: `inventario-admin` (7, con el recorrido nuevo), `comercio-experiencia`, `pedidos-membego`, `pos-membego`, `carrito-checkout`, `catalogo-admin`, `catalogo-api` y `catalogo-publico` |
| Mutaciones | 43 de 45 detectadas (ver abajo) |
| Rendimiento (local, sin latencia de red) | 1.000 líneas: importar ≈ 0,2 s, aplicar ≈ 0,6–0,9 s, frente a los 45 s de una transacción |

Qué cubre el recorrido E2E: pestaña vacía → abrir el conteo → pantalla a ciegas (sin cifras del sistema ni cantidades en
«por contar») → escaneo por código de barras y por SKU con «unidades por escaneo», código inexistente, ráfaga de tres
escaneos seguidos → corregir escribiendo el número → una venta mientras se cuenta → hoja en blanco → importar un archivo
con errores (no entra nada) y uno limpio → revisar (esperado, contado, diferencia, resumen) y CSV → aplicar (la venta se
conserva: 17 + 5 = 22) → conteo aplicado no se captura ni se revisa → historial con «Conteo físico» → un faltante bajo
lo apartado se avisa de antemano, se rechaza TODO sin mover nada, se corrige y se aplica → cancelar con motivo → id
inventado, sin sesión y empresa sin la capacidad.

Hallazgos de la propia verificación:

- **Mutaciones que sobrevivieron al principio y obligaron a reforzar pruebas**: leer «existencia antes/después» a ciegas
  de un conteo ya aplicado (no había aserción), la foto de «esperado» al importar una hoja, y quitar el cerrojo que
  serializa las aperturas de una sucursal (la prueba aceptaba el error de la base de la misma persona; ahora la misma
  persona nunca falla). Las 2 que siguen vivas son equivalentes: el `TRUNCATE` propio del disparador de sesiones (como
  las líneas apuntan a la sesión, vaciarla exige vaciar también las líneas, cuyo disparador lo frena) y el
  `.sort()` de los saldos al aplicar (las líneas ya salen ordenadas por producto; queda como cinturón y lo fija una
  guardia estática).
- **El orden de bloqueo se tuvo en cuenta desde el diseño** por lo aprendido en INV-2a: los saldos nuevos se crean en
  orden fijo y hay una prueba de carrera de «aplicar un conteo mientras llegan entradas de los mismos productos»
  (12 rondas × 16 productos nuevos). Esa prueba no distingue el orden de creación por sí sola (las entradas, mucho más
  cortas, ganan la carrera antes de que el conteo llegue a crear saldos); el orden lo protege la guardia estática y
  la de INV-2a lo protege en las entradas.
- **La prueba del ledger** (`inventory.db.test.ts`, 12) se actualizó de nuevo: al apuntar también las líneas de conteo
  al ledger, vaciarlo junto con las líneas de entrada y de conteo sigue frenado por su disparador.
- Medido contra la base local, no contra Supabase: la latencia de red por consulta no está en esos tiempos (el número de
  consultas de aplicar no crece con las líneas).

## 11. INV-2c · qué se hizo

> Tercera y última de las partes de INV-2. Decisiones aprobadas que aplican aquí: la transferencia directa de siempre se
> CONSERVA y se añade la «con envío»; lo enviado queda **en tránsito** (no disponible en ninguna sucursal) hasta que se
> recibe; recepciones parciales; cancelar devuelve al origen lo que sigue en camino; cerrar con faltante exige motivo; el
> destino se entera al enviar; documentos inmutables una vez cerrados; y la misma función de permiso `transferir`, sin
> funciones nuevas. El costo sigue fuera (INV-3).

- **Una transferencia con envío es un documento** — `/admin/inventario/transferencias`. Número `TRF-AAAA-NNNNNN`, sucursal
  que envía y que recibe, nota, quién la envió y hasta 200 productos. Estados **En camino → Recibida en parte → Recibida**,
  o **Cancelada**; ninguno se salta (la tabla de transiciones está en el código y, igual, en un disparador de la base).
- **Enviar** — `enviarTrasladoEnTx`, todo o nada y en una transacción: bloquea los saldos del origen en orden de id, vence
  las reservas caducadas que nadie ha barrido y comprueba que cada línea tenga lo vendible. Lo **apartado no se envía**. Si
  alguna línea no alcanza, **no sale ninguna** y el error lista todas las que fallan (y no se gasta un número). Cada
  línea es un movimiento `TRANSFER_OUT` del ledger enlazado a su línea. El destino tiene que estar activo. Enviar dos veces
  lo mismo —también a la vez— crea UNA transferencia; la misma clave con otro contenido se rechaza.
- **En tránsito** — las unidades salieron del origen y no están en el destino: no son disponibles en ninguna parte, ni
  suman en los totales. Se ven en la lista («En camino ahora»), en el detalle de la transferencia y en una tarjeta aparte
  de la **ficha del producto** («En camino entre sucursales») con un enlace a cada transferencia. Las unidades se
  conservan: sucursales + en camino + perdidas = lo que había (lo comprueban las pruebas tras cada operación).
- **Recibir** — `recibirTrasladoEnTx`: el destino indica cuántas llegaron de cada línea (o «recibir todo lo pendiente»).
  Cada recepción es un movimiento `TRANSFER_IN` y la transferencia pasa a «Recibida en parte» o, al llegar lo último, a
  «Recibida». No se puede recibir más de lo que falta. Si el destino se cerró, el mensaje manda a cancelar. Una recepción
  repetida (misma clave) no suma dos veces, ni siquiera con la transferencia ya cerrada.
- **Cerrar con faltante** — lo que no llegó se da por **perdido**, con un **motivo obligatorio** (queda en el documento y en
  el historial); las unidades perdidas no vuelven a ningún saldo. Recibida con faltante es un estado final.
- **Cancelar** — lo que sigue en camino **vuelve al origen** (aunque el origen se haya cerrado); lo ya recibido se queda
  donde está. Cancelar dos veces no repite nada; recibir y cancelar a la vez: gana uno, el otro recibe «cerrada».
- **Avisos** — al enviar se avisa a los administradores de la empresa («Transferencia en camino», con el número, las
  unidades, el origen y el destino, y un enlace), después de responder y sin bloquear el envío; un reintento idéntico no
  avisa dos veces (clave de deduplicación por transferencia). Es un aviso a toda la administración de la empresa, no
  solo a quien atiende la sucursal que recibe: el modelo de permisos no distingue a los encargados por sucursal.
- **CSV** — `/transferencias/[id]/exportar`: encabezado, líneas (enviado, recibido, devuelto, perdido, en camino) y los
  movimientos del ledger que produjo; con la defensa contra fórmulas de Excel de los demás CSV.
- **La transferencia directa no cambia** — sigue saliendo y entrando en el mismo instante desde la ficha. Lo único que
  cambió es que ahora crea los saldos que falten **en orden fijo** (ver §12: un interbloqueo que ya existía y se encontró
  al probar las cruzadas).
- **Degradación** — con la migración sin aplicar, las pantallas dicen exactamente eso (`describirFalloDeCarga`), la ficha
  del producto sigue funcionando sin su tarjeta de «en camino» (se lee en su propia transacción, con su propio `try`) y
  `/api/health` lo reporta (`inventory_transfers.esquema`).

Archivos principales: `prisma/schema/inventario.prisma`, `prisma/migrations/20261058_inventory_transfers/`,
`src/modules/inventory/traslados.ts` (puro) + `service`, `queries`, `filtros`, `exportacion`, `actions`,
`src/components/inventario/{EnviarTransferenciaForm,RecibirTransferenciaForm}.tsx`,
`src/app/(admin)/admin/inventario/transferencias/` y la tarjeta de la ficha `src/app/(admin)/admin/inventario/[varianteId]/page.tsx`.

### Cómo aplicar la migración (obligatorio y en este orden)

1. **SQL primero**: copiar `prisma/migrations/20261058_inventory_transfers/migration.sql` al SQL Editor de Supabase y
   ejecutarlo (aditivo e idempotente: se puede correr dos veces). Solo crea objetos nuevos; requiere que ya existan las
   tablas del ledger y las de catálogo y sucursales (las de INV-2a e INV-2b NO son necesarias).
2. **Después el código**. Un código desplegado antes deja las pantallas de transferencias con un mensaje claro y el resto
   intacto, pero enviar una transferencia con envío fallaría.
3. Verificar con `npm run db:doctor` y `/api/health` (debe listar `inventory_transfers.esquema` en verde).

## 12. Verificación de INV-2c (2026-10-14)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`; la migración nueva aplicada con `prisma migrate deploy`
sobre las 214 anteriores —215 en total—, re-ejecutada decenas de veces sobre una base ya migrada sin error —es lo que
restauró cada mutación— y `prisma migrate diff` contra el esquema sin diferencias; no se tocó ninguna base real). Sin Supabase
real, Vercel, lector de código de barras físico, móvil ni Safari: **no verificados**.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (los avisos son preexistentes) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; las 4 rutas nuevas compiladas; entrada compartida 856/1000 KB (86 %), trozo mayor 409/600 KB (sin cambio frente a INV-2b) |
| Unitarias (`bun run test`) | 4267 pruebas: 4260 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | 715/715, cero omitidas |
| Pruebas nuevas | 11 puras (`inventario-traslados.test.ts`), 8 guardias nuevas (`inventario-permisos.test.ts`, ya 50), 19 contra PostgreSQL (`inventory-traslados.db.test.ts`) y un recorrido E2E nuevo |
| E2E (`bun run e2e:limpio`, escritorio) | 69/69 sobre la compilación final: `inventario-admin` (8, con el recorrido nuevo), `comercio-experiencia`, `pedidos-membego`, `pos-membego`, `carrito-checkout`, `catalogo-admin`, `catalogo-api` y `catalogo-publico` |
| Mutaciones | 74 de 76 detectadas (ver abajo) |
| Rendimiento (local, sin latencia de red) | 200 líneas: enviar ≈ 0,16–0,23 s, recibir en parte ≈ 0,11–0,13 s, cerrar ≈ 0,13 s, frente a los 45 s de una transacción |

Qué cubre el recorrido E2E: pestaña vacía → «Nueva transferencia» con un lector (se ve lo que hay en el origen y no deja
pasar de ahí) → enviar: queda «En camino», el origen baja y el destino no sube → la ficha del producto muestra «En camino
entre sucursales» aparte de los totales → aviso a los administradores → la lista («En camino ahora») → recibir una parte
(«Recibida en parte»; más de lo que falta no deja) → cerrar con faltante (sin motivo no deja; con motivo queda «Recibida» y
lo perdido) → su CSV → cancelar otra (lo que seguía en camino vuelve al origen) → recibir todo de una vez → la lista y sus
filtros → id inventado, CSV de un id inventado, sin sesión y empresa sin la capacidad.

Qué cubren las 19 pruebas contra PostgreSQL: envío que saca del origen sin sumar en el destino ni en ningún disponible;
todo o nada (una línea que no alcanza no deja salir ninguna y no gasta número); lo apartado no se envía (ni una reserva
vencida que nadie barrió); mismo envío 5 veces a la vez = una transferencia; recibir en partes; cerrar con faltante con
motivo; cancelar devolviendo solo lo pendiente; recepción repetida; destino cerrado; dos recepciones a la vez y recibir
contra cancelar a la vez (las unidades se conservan); envíos cruzados A→B y B→A con saldos nuevos (12 rondas) y la
transferencia directa cruzada (25 rondas); los estados, los contadores y las columnas que identifican a una transferencia
o a una línea (una por una); las claves únicas y las claves foráneas compuestas escritas por fuera del servicio; la lista
con sus filtros y sin cruzar empresas; y 200 líneas dentro del tiempo de una transacción.

Hallazgos de la propia verificación (importa que se sepan):

- **Un interbloqueo que ya existía, en la transferencia DIRECTA.** Al probar los envíos cruzados con saldos que aún no
  existen, la transferencia directa de siempre (A→B contra B→A) también se interbloqueaba: cada una insertaba primero el
  saldo de SU origen y se esperaban entre sí (el mismo mecanismo que en INV-2a). Pasaba desapercibido porque la prueba
  existente cruzaba productos que ya tenían saldo en las dos sucursales. Corregido creando los dos saldos en orden fijo
  de sucursal; la prueba nueva (13b, 25 rondas) falla **3 de 3** sin ese orden y pasa con él. Es un cambio al código
  de la transferencia que ya estaba en producción: no cambia ningún resultado, solo el orden en que se crean los saldos
  que faltan.
- **Mutaciones**: 76 en total, 74 detectadas. Al principio sobrevivían **13** que no eran equivalentes y obligaron a reforzar pruebas: la base no
  tenía probadas sus claves únicas (número, clave de idempotencia, movimiento de salida, producto por transferencia), ni
  sus claves foráneas compuestas (producto de otra empresa, línea de otra empresa), ni que los contadores de devuelto y
  perdido no bajan (solo se probaba el de recibido), ni que cada columna que identifica a la transferencia o a la línea
  esté protegida (se probaban dos), ni que «recibida en parte» no vuelve a «enviada», ni que el `DELETE` falla por su
  propio motivo (fallaba por otro de la misma familia sin que nadie lo notara), ni el mensaje de una transferencia
  cancelada. Las 2 que siguen vivas son equivalentes: el `TRUNCATE` propio del disparador de la cabecera (como las líneas
  apuntan a ella, vaciarla exige vaciar también las líneas, cuyo disparador lo frena) y el filtro de estado abierto en
  «en camino» (una transferencia cerrada siempre tiene 0 pendiente).
- **Los mensajes de Prisma no traen el nombre de la restricción en las violaciones de unicidad** (`Key (…) already
  exists`, código 23505), solo en las de clave foránea: las pruebas de unicidad reconocen la columna, no el índice.
- **La prueba del ledger** (`inventory.db.test.ts`, 12) se actualizó otra vez: al apuntar también las líneas de
  transferencia al ledger, vaciarlo junto con las líneas de entrada, de conteo y de transferencia sigue frenado por su
  disparador.
- **El orden de bloqueo se tuvo en cuenta desde el diseño** por lo aprendido en INV-2a: se bloquea primero el documento,
  luego los saldos por id; los saldos que faltan se crean en orden fijo; la idempotencia se comprueba DESPUÉS de los
  candados; y una guardia estática lo comprueba en el código del servicio.
- **Una limitación de diseño, a propósito**: el aviso al enviar llega a toda la administración de la empresa, no a un
  encargado concreto de la sucursal que recibe, porque el modelo de permisos no distingue encargados por sucursal. Si
  hace falta, es un cambio de INV-5 (rol de bodega).
- Medido contra la base local, no contra Supabase: la latencia de red por consulta no está en esos tiempos (el número de
  consultas de enviar, recibir y cancelar no crece con las líneas: son lotes).
- En esta máquina el servidor de E2E imprime muchos `fetch failed … 127.0.0.1:54329` (Supabase Auth inexistente en el
  arnés): ruido previo, no afecta a los resultados.

## 13. INV-3a · qué se hizo

> Primera de las tres partes de INV-3 (el orden se cambió respecto a la hoja de ruta original: primero el costo y después
> las compras, para que las órdenes de compra nazcan ya sabiendo de costos). Decisiones aprobadas que aplican aquí: UN costo
> promedio por producto para toda la empresa (las transferencias no lo cambian); el costo es opcional en las entradas y una
> entrada sin costo no lo mueve; lo que no tiene costo se dice, no se cuenta como cero; devoluciones y sobrantes se valoran
> con el promedio del momento; sin historial hacia atrás; costo sin impuestos y en la moneda de la empresa; permiso nuevo
> `costos`; corrección de costo con motivo y auditada; nada de Car Wash.

- **Costo en las entradas** — cada línea de una entrada acepta un costo unitario (hasta cuatro decimales, con punto, sin
  comas ni signos; cero es un costo válido, una celda vacía es «sin costo»). Vale igual en la entrada de varias líneas, en la
  importación CSV (columna opcional `costo`; la plantilla la trae solo para quien puede registrar costos) y en la entrada de
  UN producto de su ficha. Se guarda en la línea (`inventory_receipt_lines.unitCost`) y en el movimiento del ledger.
- **Costo promedio ponderado** — `inventory_variant_costs`, uno por producto. Una entrada CON costo lo recalcula con
  TODO lo que la empresa tiene del producto (vendible + apartado + dañado, en todas las sucursales):
  `(existencias × promedio + entrada × costo) / (existencias + entrada)`, en aritmética entera (diezmilésimas) y redondeando la
  mitad hacia arriba. Sin existencias previas, el costo nuevo reemplaza al viejo. Si el producto no tenía promedio pesa el
  `cost` de referencia de su ficha del catálogo; si no tenía ninguno, las unidades viejas se valoran al costo de la entrada
  (no se diluyen con ceros). Una entrada sin costo no lo toca.
- **Lo que sale queda valorado** — ventas (directas y por reserva consumida), devoluciones, daños y ajustes —también los de un
  conteo aplicado— guardan en su movimiento el promedio de ESE instante (`inventory_movements.unitCost`) y ya no cambia:
  el costo de ventas de un mes no se mueve porque el promedio cambie después. Las reservas y las transferencias no se
  valoran. Un producto sin promedio ni referencia deja el movimiento sin costo (NULL), no en cero.
- **Valor del inventario** — `/admin/inventario/valor` (pestaña «Valor», solo con la función `costos`): valor total,
  existencias, costo de ventas del mes, lo que va en camino entre sucursales (aparte: no está en ninguna), valor por
  sucursal, y cada producto con su costo, de dónde sale (promedio o referencia del catálogo) y su valor, de más a menos.
  Filtros por producto, sucursal, solo sin costo y mes del costo de ventas; 50 por página; CSV con los mismos filtros
  (números planos que se suman, «Sin costo» sin cifra, tope de 20.000 filas con aviso si corta).
- **Lo que no tiene costo no se esconde** — un aviso dice cuántos productos y unidades no suman al valor, con el enlace para
  verlos, y cuántas unidades vendidas del mes no tenían costo conocido (las ventas de antes de esta fase, y las de productos sin
  costo). El costo de ventas empieza a contar desde que se aplica la migración.
- **Corregir el costo** — en la ficha del producto («Costo y valor»): costo nuevo + motivo obligatorio. Cambia el promedio
  desde ahora (valor del inventario y próximas salidas); no toca el ledger. Deja una fila inmutable en
  `inventory_cost_adjustments` (de cuánto a cuánto, con cuántas unidades, quién, por qué) y una en la bitácora. También es
  la forma de fijar el costo de lo que ya había antes de llevar costos. Solo para productos que ya tuvieron existencias.
- **Permisos** — función nueva `costos` («Ver y fijar costos, y ver el valor del inventario»). Exige: la pantalla y el CSV
  del valor, la tarjeta de costo de la ficha, corregir el costo, registrar un costo en cualquier entrada y subir un CSV con
  costos. Sin ella, la consulta ni LEE el costo de una entrada (no solo lo esconde), el CSV de la entrada no trae costos, la
  pestaña «Valor» no aparece, la plantilla no trae la columna y un archivo con costos se rechaza —no se ignoran en silencio—.
  **Cómo funciona el permiso hoy (importa):** el motor de Permisos de este sistema concede por defecto toda función que no
  se haya negado. Por eso, quien ya tiene la sección Inventario (administradores y gerentes) tiene `costos` desde que se
  despliega esto. Para quitárselo a alguien: Permisos del empleado → Inventario → desmarcar «Ver y fijar costos…».
  Hacerlo al revés (que nadie lo tenga hasta concederlo) exigiría cambiar el motor de Permisos, y no se hizo.
- **Concurrencia** — el orden de bloqueo es documento → saldos (por id) → renglón de costo (por producto); los renglones
  que faltan se crean en ese orden fijo (la lección de INV-2a). Las ventas solo LEEN el costo (nunca esperan a una entrada;
  hay una prueba que lo demuestra reteniendo el candado). Una aproximación asumida: las existencias que pesan se leen sin
  bloquear las otras sucursales, así que una venta que confirme en el mismo instante en otra sucursal puede mover el peso de lo
  viejo en, como mucho, sus unidades.
- **Degradación** — `/api/health` avisa (`inventory_variant_costs.esquema`, `inventory_movements.unitCost`) si el código llega
  antes que el SQL. La tarjeta de costo de la ficha se lee en su propia transacción con su propio `try`.

Archivos principales: `prisma/schema/inventario.prisma`, `prisma/migrations/20261059_inventory_costs/`,
`src/modules/inventory/{costos,valor}.ts` (+ `service`, `entradas`, `importacion`, `importar`, `filtros`, `exportacion`,
`queries`, `actions`), `src/components/inventario/{CorregirCostoForm,EntradaMultipleForm,ImportarForm,SucursalInventarioCard,NavegacionInventario}.tsx`,
`src/app/(admin)/admin/inventario/valor/` y la tarjeta de la ficha `src/app/(admin)/admin/inventario/[varianteId]/page.tsx`.

### Cómo aplicar la migración (obligatorio y en este orden — esta vez el orden SÍ importa)

1. **SQL primero**: copiar `prisma/migrations/20261059_inventory_costs/migration.sql` al SQL Editor de Supabase y ejecutarlo
   (aditivo e idempotente: se puede correr dos veces). Solo añade dos columnas NULL a `inventory_movements` y a
   `inventory_receipt_lines` (sin valor por defecto: PostgreSQL no reescribe la tabla) y dos tablas nuevas; los CHECK de las
   tablas viejas se crean `NOT VALID` y se validan aparte.
2. **Después el código.** **A diferencia de INV-2a/2b/2c, desplegar el código SIN el SQL rompe el inventario y los pedidos:**
   esta migración toca `inventory_movements`, que escribe cada venta, y el código nuevo lee y escribe `unitCost` en todos sus
   movimientos. Con el SQL aplicado y el código viejo todavía en producción no pasa nada (la columna se ignora).
3. Verificar con `npm run db:doctor` y `/api/health` (debe listar `inventory_variant_costs.esquema` e
   `inventory_movements.unitCost` en verde).

## 14. Verificación de INV-3a (2026-10-14)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`; la migración nueva aplicada con `prisma migrate deploy` sobre
las 215 anteriores —216 en total—, re-ejecutada varias veces sobre una base ya migrada sin error —es lo que restauró cada
mutación— y `prisma migrate diff` contra el esquema sin diferencias; no se tocó ninguna base real). Sin Supabase real,
Vercel, lector de código de barras físico, Excel con la columna de costo, móvil ni Safari: **no verificados**.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (190 avisos, los mismos de antes: ninguno nuevo) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; las 2 rutas nuevas compiladas; entrada compartida 856/1000 KB (86 %), trozo mayor 409/600 KB (sin cambio) |
| Unitarias (`bun run test`) | 4310 pruebas: 4303 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | 739/739, cero omitidas |
| Pruebas nuevas | 33 puras (`inventario-costos.test.ts`, incluidas dos propiedades al azar), 10 guardias nuevas (`inventario-permisos.test.ts`, ya 60), 24 contra PostgreSQL (`inventory-costos.db.test.ts`) y un recorrido E2E nuevo |
| E2E (`bun run e2e:limpio`, escritorio) | 70/70 sobre la compilación final: `inventario-admin` (9, con el recorrido nuevo), `comercio-experiencia`, `pedidos-membego`, `pos-membego`, `carrito-checkout`, `catalogo-admin`, `catalogo-api` y `catalogo-publico` |
| Mutaciones | 96 distintas, 94 detectadas (ver abajo) |
| Rendimiento (local, sin latencia de red) | entrada de 1.000 líneas con costo: ≈0,6–0,8 s la primera y ≈0,6–0,7 s la que pondera sobre promedios ya existentes, frente a los 45 s de una transacción; la venta, con la lectura del promedio añadida: ≈19–24 ms frente a ≈20–21 ms sin ella (dentro del ruido) |

Qué cubre el recorrido E2E: la pestaña «Valor» (los vasos valen por su costo de referencia; el plato sin costo se dice, con su
aviso) → una entrada con un costo con coma (se rechaza con un mensaje que dice qué hacer) y con punto (el detalle enseña lo que
costó) → otra, en otra sucursal, con una línea sin costo (no mueve el promedio) → la ficha: 10 a 5 más 10 a 7 es 6 → el valor
por producto y por sucursal, «solo sin costo», búsqueda y una URL manipulada → fijar el costo de lo que ya había (sin motivo no
deja) → la entrada de un producto desde su ficha con costo (20 a 6 con 5 a 10 = 6.80) → importar un CSV con columna de costo
(una coma rechaza TODO el archivo; el limpio dice cuántas líneas traen costo) → el costo de ventas del mes con el costo que
cada venta congeló y el aviso de lo vendido sin costo → los archivos (números sin separador de miles) → y, con la función
`costos` negada, nada de nada: ni la pestaña, ni la pantalla, ni la tarjeta, ni el campo de costo, ni el costo de la entrada ni
su CSV; la descarga del valor da 403 y un archivo con costos se rechaza.

Qué cubren las 24 pruebas contra PostgreSQL: el promedio con las existencias de todas las sucursales (10 a 5 + 10 a 7 = 6) y con
lo dañado; la entrada sin costo que no lo mueve ni lo inventa; el costo de referencia que pesa mientras no hay promedio; ventas,
reservas consumidas, devoluciones, daños, ajustes y un conteo aplicado valorados con el promedio de su instante y que NO cambian
cuando el promedio cambia después; reservas y transferencias sin valorar; corregir (historia inmutable, ledger intacto, motivo
obligatorio, producto sin existencias, servicio, otra empresa); la entrada de un producto y la de varias líneas, repetidas con la
misma clave (con otro costo, o sin él, es otra operación); tres entradas a la vez sobre un promedio ya existente sin perder
ninguna, otras en sucursales distintas, las cruzadas con productos nuevos en distinto orden (sin interbloqueo), y una venta que
no espera al candado del costo mientras que una entrada sí; la base (rangos, correcciones inmutables, renglón de costo que no
se borra ni cambia de producto o empresa, claves foráneas compuestas, un costo por producto); una propiedad de 200 operaciones
al azar contra un modelo puro; el valor por producto/sucursal/en tránsito/paginado y el costo de ventas por mes.

Hallazgos de la propia verificación (importa que se sepan):

- **El motor de Permisos concede por defecto.** Una función nueva se le concede a todo el que ya tenga la sección (la
  negación es la excepción), y solo `SUPERADMIN` está exento de los permisos por empleado —los administradores no—. Se
  respetó el modelo (negar `costos` a alguien funciona y está probado de punta a punta), pero significa que los gerentes verán
  costos desde que se despliega esto. Ver el recuadro de permisos en §13.
- **Mis propias pruebas de carrera no mordían el candado del costo.** Las cuatro primeras usaban productos nuevos, y para un
  producto nuevo el `INSERT … ON CONFLICT` del renglón ya serializa a las entradas: quitar el `FOR UPDATE` no rompía nada. La
  mutación que lo quitó sobrevivió, y obligó a una prueba sobre un promedio YA existente (tres entradas a la vez en tres
  sucursales, 12 rondas): sin el candado se pierde una entrada.
- **Mutaciones**: 96 distintas (21 del servicio, 28 de lo puro —costos, líneas, importación, filtros, archivos—, 31 de las
  lecturas del valor y de las guardias de permiso, 16 de los objetos de la base), 94 detectadas. Al principio sobrevivían 6 reales
  y obligaron a reforzar pruebas: el candado del costo (arriba); el límite inferior del mes en el costo de ventas (no había una
  venta de un mes anterior); el valor de lo que va en camino ante una recepción parcial; la ficha de un producto con solo costo de
  referencia; que la importación PASE el permiso al servicio (una guardia solo miraba que se calculara); y que el renglón de costo
  no cambie de `id`. Además, una revisión mía encontró que la prueba de la línea de entrada con costo negativo fallaba por usar un
  movimiento ya enlazado y no por el CHECK (su expresión aceptaba cualquier mensaje de esa tabla): se corrigió antes de medir.
  Las 2 que siguen vivas son equivalentes: valorar «todo» en lugar de solo ventas, devoluciones, daños y ajustes (el filtro por
  tipo está además en la consulta que lee el promedio, así que se protege dos veces) y no tratar aparte el caso de cero existencias
  previas (la fórmula da exactamente el costo de la entrada).
- **Una guardia vieja no veía los imports «de efecto»** (`import '@/modules/...'` sin `from`): un componente de cliente podía
  arrastrar un módulo de servidor sin que ninguna prueba lo notara. Ahora los mira.
- **Cambios a pruebas que no son de esta fase**: al ofrecer un campo de costo en cada línea de la entrada, `getByRole('textbox')`
  de la prueba E2E de INV-2a dejó de ser único (cantidad y costo); sus 6 usos ahora piden la cantidad por su etiqueta. La
  etiqueta de la bitácora `INVENTORY_CONFIGURED` pasó de «umbral de stock bajo modificado» a «configuración modificada (umbral
  de stock bajo o costo de un producto)», porque la corrección de costo se registra con esa acción (añadir una nueva exigiría
  modificar un tipo de PostgreSQL).
- **El orden de despliegue es distinto esta vez**: el SQL tiene que ir ANTES que el código (§13). `/api/health` lo avisa si no.
- Medido contra la base local, no contra Supabase: la latencia de red por consulta no está en esos tiempos. La entrada en lote
  hace cinco consultas más que antes (crear los renglones, bloquearlos, leer existencias, leer referencias y actualizar), no una por línea.
- En esta máquina el servidor de E2E imprime muchos `fetch failed … 127.0.0.1:54329` (Supabase Auth inexistente en el
  arnés): ruido previo, no afecta a los resultados.


## 15. INV-3b · qué se hizo

> Segunda de las tres partes de INV-3. Decisiones aprobadas que aplican aquí: la recepción de una orden NO es un camino nuevo
> hacia el stock —crea una entrada de mercancía normal—; el costo de cada línea es obligatorio en la orden (cero es válido);
> nunca se recibe más de lo pedido; lo que no llega se cierra como faltante CON motivo; un proveedor se desactiva, no se
> borra; un producto tiene un solo proveedor preferido; permiso nuevo `comprar`; nada de Car Wash. El punto de reorden y «qué
> comprar» quedan para INV-3c.

- **Proveedores** — `/admin/inventario/proveedores` (pestaña «Proveedores», solo con la función `comprar`): nombre (único por
  empresa sin distinguir mayúsculas), RNC/cédula, contacto, teléfono, correo, días de crédito (0 = de contado) y notas. Se
  desactiva y se reactiva; no se borra. Un proveedor inactivo no puede recibir órdenes nuevas ni vínculos nuevos, pero sus
  órdenes abiertas se siguen pudiendo recibir (lo pedido llega igual). La ficha muestra sus productos y sus órdenes.
- **Orden de compra** — `/admin/inventario/compras`: número `OC-AAAA-NNNNNN` por empresa, proveedor, sucursal que recibe,
  referencia, fecha prevista, nota y hasta 200 líneas (producto, cantidad y costo unitario). Estados: **Borrador** (las líneas
  se editan, se puede cancelar sin motivo) → **Pedida** (desde aquí el contenido queda congelado, también en la base) →
  **Recibida en parte** → **Recibida**, o **Cancelada**. Lista con filtros por estado, proveedor, sucursal, fechas y texto,
  y CSV de la orden completa (encabezado, resumen, cada línea y cada entrada que produjo).
- **Recibir** — cada recepción crea UNA entrada de mercancía (`ENT-…`, enlazada a la orden) con los costos de la orden; por
  eso mueve el stock y el costo promedio exactamente como cualquier entrada (INV-3a) y no hay un segundo camino al ledger.
  Se puede recibir en tandas. **Nunca más de lo pendiente** (el formulario no deja enviar y el servicio lo rechaza con
  `RECIBE_MAS_DE_LO_PEDIDO`). Se puede **cerrar con faltante**: lo que no llegó queda como «cerrado», exige un motivo, y la
  orden termina Recibida; cerrarla sin haber recibido nada se rechaza (`NADA_RECIBIDO`: eso es cancelar).
- **Cancelar** — un borrador se cancela sin motivo; una orden Pedida (nada recibido) exige motivo y sus líneas quedan como
  cerradas; una Recibida en parte NO se cancela (se cierra con faltante). Una orden Recibida o Cancelada no cambia más.
- **Proveedores por producto** — en la ficha del producto: la tarjeta «Proveedores de este producto» (código del proveedor,
  último costo, días de entrega, preferido —uno solo por producto— y desvincular) y la tarjeta «Pedido a proveedores» (lo que
  está pedido y aún no llega, por orden). El último costo de cada vínculo lo escribe cada recepción; comprarle a un proveedor
  un producto que no tenía vinculado crea el vínculo.
- **Entradas** — el detalle de una entrada enlaza a su orden. El enlace se lee aparte y solo con `comprar`, de modo que la
  guardia que impide leer costos sin `costos` sigue intacta.
- **Permisos** — función nueva `comprar` («Proveedores y órdenes de compra»). Exige: ver las pestañas «Compras» y
  «Proveedores», crear y editar proveedores, vincularlos a productos y crear, pedir, recibir, cancelar y exportar órdenes.
  **Cómo funciona hoy (importa, igual que con `costos`):** el motor de Permisos concede por defecto toda función no negada, así
  que quien ya tiene la sección Inventario tiene `comprar` desde que se despliega. Dos consecuencias a tener presentes:
  `comprar` implica **ver y escribir los costos de las órdenes** (sin necesitar `costos`), y **recibir una orden mueve el stock
  y el costo promedio sin necesitar `ajustar` ni `costos`** —es el camino normal de mercancía que llega—. Para quitarlo:
  Permisos del empleado → Inventario → desmarcar «Proveedores y órdenes de compra».
- **La base lo impone, no solo el código** — triggers: ninguna orden se borra; una orden terminada (Recibida/Cancelada) queda
  congelada; identidad (`id`, empresa, número) inmutable; los datos pedidos no cambian después del borrador; las transiciones
  de estado permitidas son una tabla (Borrador→Borrador|Pedida|Cancelada, Pedida→Parcial|Recibida|Cancelada,
  Parcial→Recibida); los contadores de las líneas (recibido y cerrado) solo suben. CHECK por estado: cada estado exige lo
  suyo (una Pedida trae quién y cuándo pidió, una Cancelada de una Pedida trae motivo, una Recibida no tiene faltante sin
  motivo, etc.) y lo que no le corresponde no puede estar. Claves foráneas compuestas `(id, companyId)` (una orden no
  puede mezclar productos, proveedores ni sucursales de otra empresa) y `TRUNCATE` bloqueado.
- **Concurrencia** — orden de bloqueo: la orden (`SELECT … FOR UPDATE`) → los saldos (por id) → los renglones de costo
  (por producto). La clave de idempotencia se revisa DESPUÉS de bloquear la orden y ANTES de mirar el estado: repetir una
  recepción ya aplicada devuelve la misma entrada aunque la orden ya esté terminada; con otra cantidad, es otra operación.
  Crear un borrador con la misma clave de idempotencia bajo concurrencia toma antes un candado de asesor sobre la clave y no
  duplica. Los contadores de las líneas se actualizan antes que el estado de la cabecera (lo exige el trigger).
- **Degradación** — `/api/health` avisa (`inventory_purchase_orders.esquema`, `inventory_receipts.purchaseOrderId`) si el
  código llega antes que el SQL. Las dos tarjetas nuevas de la ficha del producto se leen cada una en su propio `try`.

Archivos principales: `prisma/schema/{inventario,identidad,catalogo}.prisma`, `prisma/migrations/20261060_inventory_purchasing/`,
`src/modules/inventory/{compras,compras-service,compras-queries}.ts` (+ `service`, `filtros`, `exportacion`, `auditoria`,
`queries`, `actions`), `src/lib/auth/funciones.ts`,
`src/components/inventario/{ProveedorForm,OrdenCompraForm,AccionesOrdenCompra,RecibirOrdenCompraForm,ProveedoresDeProductoCard,NavegacionInventario}.tsx`,
`src/app/(admin)/admin/inventario/{compras,proveedores}/` y las tarjetas de la ficha `src/app/(admin)/admin/inventario/[varianteId]/page.tsx`.

### Cómo aplicar la migración (obligatorio y en este orden)

1. **SQL primero**, y en este orden: `prisma/migrations/20261059_inventory_costs/migration.sql` (INV-3a, 176 líneas; si aún
   no se aplicó) y después `prisma/migrations/20261060_inventory_purchasing/migration.sql` (374 líneas). Ambas son aditivas e
   idempotentes (se pueden correr dos veces). Copiar el archivo **completo** con «Copy raw file» de GitHub: un pegado cortado
   a la mitad da `unterminated dollar-quoted string` en el SQL Editor, y no es un fallo del SQL. Antes del código se puede
   comprobar con `select to_regclass('public.inventory_variant_costs'), to_regclass('public.inventory_purchase_orders');`
   (ninguna debe ser `null`).
2. **Después el código.** El código de INV-3b depende también del SQL de INV-3a (la recepción escribe `unitCost`): sin
   `20261059` aplicado, no desplegar. Con el SQL aplicado y el código viejo todavía en producción no pasa nada.
3. Verificar con `npm run db:doctor` y `/api/health` (debe listar `inventory_purchase_orders.esquema` e
   `inventory_receipts.purchaseOrderId` en verde, además de los dos de INV-3a).

## 16. Verificación de INV-3b (2026-10-14)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`; las migraciones nuevas aplicadas con `prisma migrate deploy` sobre
las anteriores —227 en total tras traer lo último de `main`—, la de INV-3b re-ejecutada varias veces sobre una base ya
migrada sin error —es lo que restauró cada mutación de la base— y `prisma migrate diff` contra el esquema sin diferencias en
las dos bases de prueba; no se tocó ninguna base real). Sin Supabase real, Vercel, lector de código de barras físico, móvil
ni Safari: **no verificados**. Tampoco se midió el tiempo de recibir una orden de 200 líneas (INV-3a midió la entrada de 1.000
líneas; la recepción usa esa misma entrada, pero no hay una medición propia).

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (189 avisos, ninguno nuevo) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; las 7 rutas nuevas compiladas; entrada compartida 859/1000 KB (86 %), trozo mayor 409/600 KB (sin cambio) |
| Unitarias (`bun run test`) | 4388 pruebas: 4381 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | 803/803, cero omitidas |
| Pruebas nuevas | 26 puras (`inventario-compras.test.ts`), 12 guardias nuevas (`inventario-permisos.test.ts`, ya 72), 38 contra PostgreSQL (`inventory-compras.db.test.ts`) y un recorrido E2E nuevo |
| E2E (`bun run e2e:limpio`, escritorio) | 71/71 en la corrida combinada final sobre la compilación final: `inventario-admin` (10, con el recorrido nuevo), `comercio-experiencia`, `pedidos-membego`, `pos-membego`, `carrito-checkout`, `catalogo-admin`, `catalogo-api` y `catalogo-publico` |
| Mutaciones | 279 distintas, 276 detectadas, 3 equivalentes (ver abajo) |

Qué cubre el recorrido E2E: la pestaña «Compras» y «Proveedores» (solo con `comprar`) → un proveedor con crédito y contacto, y
el mismo nombre en mayúsculas rechazado con su mensaje → una orden nueva (sin proveedor no se puede hacer; el costo es
obligatorio) → editar el borrador (conserva el número) y pedirla (desde ahí las líneas no se editan) → recibir en tandas con el
costo de la orden (el estado pasa a «Recibida en parte»; más de lo pendiente deshabilita el botón y marca el campo; la tarjeta
«Lo que está pedido a proveedores» de la ficha se actualiza con lo que aún no llega) → cerrar con faltante (sin motivo no deja) → cancelar una orden
pedida (sin motivo no deja) → la lista y sus filtros → el detalle del proveedor, desactivarlo (ya no recibe pedidos nuevos, pero
su orden en curso se sigue recibiendo) → vincular un proveedor desde la ficha del producto (código, días de entrega, preferido) y
quitarlo → el CSV de la orden → la entrada que creó la recepción enlaza a su orden → una orden inventada no existe (ni su
descarga: 404) → y con la función `comprar` negada: ni las pestañas, ni las órdenes (cada pantalla dice que no hay permiso y no
enseña ni una cifra), ni las tarjetas de la ficha, ni el enlace de la entrada; la descarga de la orden da 403. Lo que NO ejerce este
recorrido (lo cubren las pruebas contra PostgreSQL): que no se pueda pedir lo que no controla inventario, las carreras y la base
escrita por fuera.

Qué cubren las 38 pruebas contra PostgreSQL: el proveedor (datos normalizados, nombre único sin mayúsculas ni espacios de más,
otra empresa puede repetirlo, desactivar y reactivar); el borrador (numeración sin huecos con seis a la vez, líneas con costo,
no mueve nada, editar solo el borrador); pedir (congela, dos veces no hace nada); recibir en tandas (una entrada por tanda con el
costo de la línea, el promedio ponderado con lo que ya había, el último costo del proveedor, nunca más de lo pedido ni un producto
ajeno, «todo»); cerrar con faltante y cancelar (motivo, todo-o-nada, la parcial no se cancela); la misma recepción repetida ocho
veces a la vez o con la orden ya cerrada no suma dos veces; cinco recepciones de 20 sobre 90 pendientes (ganan cuatro);
dos órdenes con los mismos productos en distinto orden sin interbloqueo; recibir y cancelar a la vez (una sola gana); el preferido
(dos a la vez dejan uno); el rastro en la bitácora; la base escrita por fuera (estados saltados, lo pedido y lo cerrado
inmutables, contadores que no bajan, formas imposibles, claves repetidas, mezcla de empresas, una prueba por cláusula de cada
CHECK); las lecturas (lista, filtros, paginación, detalle, búsqueda de productos, ficha) y el aislamiento entre empresas.

Hallazgos de la propia verificación (importa que se sepan):

- **El E2E encontró una diferencia real entre la base de producción y la del E2E/CI.** El E2E arma su base con `prisma db push`,
  que no trae lo que el esquema de Prisma no puede expresar: aquí, el índice único `(companyId, lower(name))` de proveedores. Sin
  él, «DISTRIBUIDORA NORTE» se creó junto a «Distribuidora Norte» y la regla del nombre único dependía por completo de un índice que
  no existe en esa base. Se añadió una comprobación en el servicio (`exigirNombreLibre`, antes de escribir; el índice sigue siendo la
  garantía contra dos altas a la vez) y una prueba que quita el índice dentro de una transacción que se deshace (la 38). Los demás
  objetos solo-SQL (índice parcial del preferido, triggers, CHECK) son respaldo de reglas que el servicio ya aplica por su cuenta; el
  preferido, por ejemplo, desmarca al anterior en el servicio y la prueba 26 lo ejerce.
- **Mis mutaciones de la base se volvieron falsamente «detectadas» por un error mío.** Una edición tardía de la prueba 8 (una orden
  más por la réplica con menos líneas) rompió su conteo; desde entonces cualquier mutación del servicio «moría» por eso y no por lo
  que mutaba. Se arregló la prueba y se rehicieron las del servicio desde cero.
- **Mutaciones**: 279 distintas (67 del servicio, 54 de lo puro, 55 de las lecturas y 103 de los objetos de la base), 276
  detectadas. En algún momento sobrevivieron 42 (3 de ellas equivalentes; las otras 39 eran reales y obligaron a reforzar pruebas), las más instructivas: reenviar un borrador con MENOS líneas
  que la primera vez (la réplica comparaba solo el número de líneas); que el motivo de cierre se guardara aunque no faltara nada;
  cerrar sin faltante con una orden ya agotada; el orden de las listas (proveedores por id, órdenes del proveedor más nuevas
  primero); lo pendiente cuando el faltante se subió por fuera del servicio; el preferido que no sea el primero alfabéticamente; los
  campos `id`/`companyId` de una orden y de sus líneas, y las transiciones Pedida→Borrador y Parcial→Borrador, que el trigger
  prohibía pero ninguna prueba exigía; y 21 cláusulas de los CHECK que ninguna prueba ejercía por sí sola (la prueba 37 ahora pone una
  desviación mínima por cláusula; las líneas se insertan con los triggers desactivados en esa sesión para que el trigger no tape
  al CHECK). Un CHECK acepta el NULL, así que cada brazo tiene su `IS NOT NULL`
  explícito y una mutación lo comprobó.
  Los 3 que siguen vivos son equivalentes: no ordenar los vínculos que crea la recepción (los saldos ya se bloquearon en orden
  fijo antes, así que dos recepciones que se pisarían en un vínculo nunca llegan ahí a la vez); el detalle sin ordenar las líneas
  (el índice por `(orderId, position)` ya las devuelve en ese orden); y quitar el índice único `(companyId, name)` exacto (lo cubre
  el de `lower(name)`; está porque el esquema de Prisma lo declara).
- **E2E**: la primera ejecución real del recorrido nuevo falló por mi suposición de que una orden inexistente da 404 en la página;
  con streaming responde 200 con `noindex`, como en las demás pantallas de inventario (la descarga sí da 404). Se alineó la prueba.
  El botón de recibir ya estaba deshabilitado ante cantidades de más; la prueba ahora lo comprueba en vez de intentar un clic.
- **Fallos que NO se pudieron atribuir ni reproducir** (dos): (1) en la primera corrida combinada de E2E,
  `comercio-experiencia` falló una vez («Ofertas destacadas» no apareció en `/cliente/inicio`); no se reprodujo ni sola (9/9) ni en
  otra corrida combinada completa (71/71), y no hay rastro en el servidor; esa pantalla no depende de lo de esta fase y no se tocó.
  (2) en la primera ejecución completa de `test:db`, hecha mientras corrían a la vez el lint y las unitarias, falló
  `supply-v2-slice9` («el worker reclama y muere…», sobre un arriendo con reloj); pasa en solitario (85/85) y en la repetición de
  la suite completa sobre una máquina libre (802/802, y 803/803 en la final). Lo más probable es carga de la máquina, pero es una
  suposición.
- **El permiso `comprar` se concede por defecto** (igual que `costos`; ver §13): los administradores y gerentes con la sección
  Inventario pueden crear y recibir órdenes y ver sus costos desde el despliegue. Hay una guardia que exige que cada acción nueva
  pase por `contexto('comprar')` y cada ruta por `requireSection('inventario','comprar')`.
- **Orden de despliegue**: igual que en INV-3a, el SQL va antes que el código y `20261059` antes que `20261060` (§15). `/api/health`
  lo avisa si falta.
- Esta máquina imprime `fetch failed … 127.0.0.1:54329` y `The destination stream closed early` en el servidor de E2E (Supabase
  Auth inexistente en el arnés; ruido previo, visible también en las verificaciones anteriores).

## 17. INV-3c · qué se hizo

> Última de las tres partes de INV-3: la alerta de stock bajo deja de ser una lista de problemas y pasa a ser una propuesta de
> compra. Decisiones que se tomaron aquí (no había una aprobación previa más fina que la hoja de ruta): el objetivo vive en el
> saldo, junto al umbral que ya existía; lo pedido y lo que va en camino se descuentan, un borrador NO; crear el borrador no pide
> nada; la máquina no elige entre varios proveedores; nada de Car Wash.

- **«Llenar hasta»** — un número más por producto y sucursal (`inventory_levels.targetStock`; 0 = sin objetivo). Se fija en la
  ficha del producto, en la tarjeta de cada sucursal, con «aplicar también a las otras sucursales donde ya tiene existencias»
  (igual que el umbral: no se crean saldos en cero donde el producto nunca estuvo). Es configuración del saldo: lo pide la misma
  función que el umbral (`ajustar`), no deja movimientos en el ledger, se audita con su antes y su después y repetirlo no
  hace nada. **Tiene que quedar por encima del umbral de aviso** (y el umbral por debajo del objetivo): con un umbral igual o
  mayor, «pedir hasta llegar» no pediría nada. El mensaje dice en qué sucursal; si al aplicar a las otras alguna lo impide, todo
  se deshace.
- **La posición y la sugerencia** — la posición de un producto en una sucursal es lo disponible (existencias − apartado) **más** lo
  pedido a proveedores que no ha llegado (órdenes pedidas o recibidas en parte, solo las que reciben en ESA sucursal, sin lo cerrado
  como faltante) **más** lo que va en camino hacia ella desde otra (transferencias enviadas o recibidas en parte, sin lo devuelto
  ni lo perdido). Con umbral se repone cuando la posición baja AL umbral (igual o menos, como la alerta); sin umbral, en cuanto
  queda por debajo del objetivo. Se sugiere exactamente lo que falta para llegar al objetivo. Recibir, cancelar o cerrar con
  faltante mueve la sugerencia sola, porque se calcula en cada lectura: no hay nada guardado que se desactualice.
- **Un borrador no es un compromiso** — la pantalla lo enseña («En borrador N») y avisa en el grupo que ya hay uno de ese
  proveedor para esa sucursal (con su enlace), pero no lo descuenta: hasta que se pida, la mercancía no viene. Ese aviso es la
  protección contra duplicar a ciegas; no hay restricción en la base (dos borradores iguales son legítimos).
- **Qué comprar** — pestaña «Reposición» (`/admin/inventario/reposicion`, solo con `comprar`): resumen (productos y grupos por
  reponer, unidades, valor sugerido, cuántos sin proveedor), filtros (producto/SKU/código de barras, sucursal, proveedor o «sin
  proveedor»), y un grupo por proveedor Y sucursal —una orden tiene un proveedor y recibe en una sucursal—. Cada línea trae lo
  que hay, lo pedido, lo que va en camino, lo que está en borrador, el objetivo, el umbral y la cantidad sugerida, y se puede
  corregir o dejar fuera. **«Crear borrador de orden»** abre un borrador normal (nota «Borrador creado desde Reposición.», con el
  costo y la cantidad de cada línea) y lleva a su pantalla: no pide nada ni mueve existencias; pedirlo es otra decisión, en la
  pantalla de la orden. Es la misma acción de órdenes de INV-3b (`comprar`, idempotente), no una puerta nueva. Una orden admite
  200 productos: si el grupo trae más, vienen marcados los primeros 200 y la pantalla lo dice.
- **El proveedor de cada producto** — el preferido, si está activo; si no hay preferido activo pero solo tiene UN proveedor
  activo, ese; con varios sin preferido o con ninguno, «sin proveedor» (elegir entre varios es una decisión de compra: la
  pantalla manda a la ficha del producto a vincular uno). Un proveedor desactivado nunca se elige. El costo sugerido es el
  **último costo de ESE proveedor para ese producto**; sin él, la línea sale sin costo y hay que escribirlo (el borrador exige costo
  en cada línea) —no se inventa uno—. A propósito NO se usa el costo promedio ni el de referencia: son información de la
  función `costos`, y esta pantalla solo exige `comprar`.
- **Lo que explica por qué algo no sale** — un aviso cuenta las alertas de stock bajo que no tienen «llenar hasta» (no hay hasta
  cuánto proponer) con el enlace a ellas, y la alerta de la página de existencias ofrece «Ver qué comprar» a quien puede comprar.
  Sin ningún objetivo, la pantalla dice cómo fijarlo; con todo al día, lo dice. Si hay más de 5.000 saldos con objetivo, la
  lista se corta y lo avisa.
- **Archivo** — CSV con los mismos filtros: resumen (con los filtros aplicados y el aviso de corte) y una fila por producto y
  sucursal; números planos que se suman, textos neutralizados contra fórmulas, y la celda de costo y de valor VACÍA —nunca cero—
  cuando no se sabe.
- **Qué cuenta** — solo productos que controlan inventario, no descontinuados ni archivados, en sucursales activas y de esa
  empresa. Todo se lee dentro de la empresa de la sesión, sin bloquear nada (es una lectura puntual: dos personas que miren a la
  vez ven lo mismo, y una venta que ocurra mientras tanto aparece en la siguiente lectura).
- **Permisos** — sin función nueva: ver la propuesta, descargarla y crear borradores es `comprar` (la etiqueta del permiso ahora
  dice «y reposición»); fijar «llenar hasta» es `ajustar`, como el umbral. Como todo permiso de este sistema, `comprar` se concede
  por defecto a quien ya tiene la sección Inventario (ver §13 y §15).
- **Degradación** — `/api/health` avisa (`inventory_levels.targetStock`) si el código llega antes que el SQL.

### Lo que NO hace (a propósito, o pendiente)

- **No pronostica**: no mira cuánto se vende ni cuánto tarda el proveedor (aunque el vínculo ya guarda los días de entrega); el
  objetivo lo fija una persona. Tampoco redondea a cajas o múltiplos de compra ni respeta mínimos del proveedor.
- **No elige entre varios proveedores**, ni parte una propuesta en varias órdenes cuando un grupo pasa de 200 productos (avisa y
  se hace en dos veces).
- **No hay carga masiva de objetivos**: se fijan producto por producto (con «aplicar a las otras sucursales»). Con cientos de
  productos eso es lento; una importación CSV de umbrales y objetivos, como la de existencias, queda como mejora.
- **No pide sola**: nada de pedidos automáticos ni de avisos por correo cuando algo entra en la propuesta (hoy hay que abrir la
  pantalla o ver la alerta).

Archivos principales: `prisma/schema/inventario.prisma`, `prisma/migrations/20261066_inventory_reorder/`,
`src/modules/inventory/{reposicion,reposicion-queries}.ts` (+ `service` —`configurarObjetivoEnTx` y la regla en el umbral—,
`filtros`, `exportacion`, `queries`, `actions`), `src/lib/auth/funciones.ts`,
`src/components/inventario/{ReposicionGrupoCard,SucursalInventarioCard,NavegacionInventario}.tsx` y
`src/app/(admin)/admin/inventario/reposicion/` (+ `exportar/`).

### Cómo aplicar la migración (obligatorio y en este orden)

1. **SQL primero**, y en este orden si faltara alguno: `20261059_inventory_costs` (INV-3a), `20261060_inventory_purchasing`
   (INV-3b) y por último `prisma/migrations/20261066_inventory_reorder/migration.sql`. Es aditiva e idempotente (se puede correr dos
   veces): una columna entera en `inventory_levels` con valor por defecto constante (PostgreSQL 11 o superior no reescribe la
   tabla), su CHECK creado `NOT VALID` y validado aparte, y un índice parcial. Copiar el archivo **completo** con «Copy raw file».
   Se puede comprobar con
   `select column_name from information_schema.columns where table_name = 'inventory_levels' and column_name = 'targetStock';`
   (debe devolver una fila).
2. **Después el código.** **Como en INV-3a, desplegar el código SIN el SQL rompe el inventario y los pedidos**: Prisma pide todas
   las columnas del saldo en cada lectura, y las ventas leen saldos. Con el SQL aplicado y el código viejo todavía en producción no
   pasa nada (la columna se ignora).
3. Verificar con `npm run db:doctor` y `/api/health` (debe listar `inventory_levels.targetStock` en verde).

## 18. Verificación de INV-3c (2026-10-15)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`; la migración nueva aplicada con `prisma migrate deploy` sobre las
227 anteriores —228 en total, con lo último de `main`—, re-ejecutada dos veces sobre una base ya migrada sin error y
`prisma migrate diff` contra el esquema sin diferencias en las dos bases de prueba; no se tocó ninguna base real). Sin Supabase real,
Vercel, lector de código de barras físico, móvil ni Safari: **no verificados**. Tampoco se midió la propuesta con miles de saldos
con objetivo: se probó que corta al tope (5.000) y lo dice, no cuánto tarda con ese volumen ni con la latencia de una base remota.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (189 avisos, ninguno nuevo) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; las 2 rutas nuevas compiladas; entrada compartida 859/1000 KB (86 %), trozo mayor 409/600 KB (sin cambio) |
| Unitarias (`bun run test`) | 4427 pruebas: 4420 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | 826/826, cero omitidas |
| Pruebas nuevas | 29 puras (`inventario-reposicion.test.ts`), 10 guardias nuevas (`inventario-permisos.test.ts`, ya 82), 23 contra PostgreSQL (`inventory-reposicion.db.test.ts`) y un recorrido E2E nuevo |
| E2E (`bun run e2e:limpio`, escritorio) | 72/72 en la corrida combinada final sobre la compilación final: `inventario-admin` (11, con el recorrido nuevo), `comercio-experiencia`, `pedidos-membego`, `pos-membego`, `carrito-checkout`, `catalogo-admin`, `catalogo-api` y `catalogo-publico` |
| Mutaciones | 217 distintas, 210 detectadas, 7 equivalentes (ver abajo) |

Qué cubre el recorrido E2E: la pestaña Reposición vacía explica cómo empezar → en la ficha, «Llenar hasta» 20 (un umbral de 25 se
rechaza por quedar sobre el objetivo, uno de 5 vale, y bajar el objetivo al umbral también se rechaza) → la propuesta agrupa por
proveedor y sucursal con lo que falta (20 − 3 = 17), el último costo de ese proveedor y, donde nunca se le compró, el costo VACÍO;
lo que no tiene proveedor se manda a su ficha y no tiene botón → crear el borrador exige el costo, deja corregir la cantidad, lleva
su nota y no mueve existencias → de vuelta, el borrador se avisa pero no se descuenta → pedirlo lo vuelve compromiso y el grupo
desaparece → filtros (sin proveedor, sin resultados, sucursal y proveedor ajenos que no filtran) → el CSV → y con `comprar`
negada no hay pestaña, ni enlace, ni cifras, y la descarga da 403, pero «llenar hasta» sigue disponible (es de `ajustar`).

Qué cubren las 23 pruebas contra PostgreSQL: fijar el objetivo (crea el saldo si no existe, se audita con su antes y su después,
repetirlo no deja otra huella, el rango y los productos/sucursales que no valen, una sucursal desactivada admite configuración);
que no se deje chocar con el umbral ni al fijarlo ni al mover el umbral, con el mensaje que dice la sucursal; aplicar a las otras
sucursales (solo con saldo y activas, nunca la de origen, repetirlo no cambia nada, un choque deshace todo); el CHECK de la base y su
índice parcial; la sugerencia (disponible sin lo apartado, una venta la sube, con y sin umbral); lo pedido (pedida, recibida en
parte, cerrada con faltante, cancelada, de otra sucursal, y los contadores subidos por fuera del servicio); lo que va en camino
(recibir en partes, cerrar con faltante, devuelto y perdido); el borrador que se enseña y no se descuenta; el borrador creado desde
la propuesta y su idempotencia; la elección del proveedor (preferido, único activo, varios, ninguno, desactivado) y del costo; los
filtros y la búsqueda (nombre, SKU, código de barras y nombre de la variante); el orden de los grupos; qué cuenta (descontinuados,
archivados, sin control de inventario, sucursal cerrada, otra empresa); las alertas sin objetivo; el corte por tope; y una carrera
de 12 rondas entre fijar un umbral y fijar un objetivo incompatibles a la vez (solo uno gana y nunca quedan cruzados).

Hallazgos de la propia verificación (importa que se sepan):

- **Dos guardias de diseño que ya existían saltaron**: mi pantalla escribía a mano el botón de exportar (hay un componente común,
  `BotonExportar`) y mis avisos de «ya tienes un borrador» usaban clases de color propias (+12 sobre el techo de deuda de diseño).
  Se cambiaron por los componentes comunes (`BotonExportar`, `Alert`) en vez de subir el techo.
- **Mi cambio rompió, sin querer, una guardia vieja**: la de INV-1 que comprueba que aplicar el umbral a otras sucursales no crea
  saldos en cero cortaba el código hasta el final del archivo, y mi función nueva (que sí usa `obtenerNivel`, a propósito) quedaba
  dentro del corte. Se acotó a la función. Y el `tsc` encontró un error de tipos en mi propio recorrido E2E (`sucursalSembrada`
  devuelve un objeto, no un texto).
- **Una guardia mía pasaba aunque faltara el candado.** La que comprueba que `configurarObjetivoEnTx` bloquea el saldo ANTES de
  escribir comparaba posiciones con `<` y no exigía que existieran: si el `bloquear` desaparecía, `indexOf` daba −1 y la prueba
  seguía en verde. Las mutaciones lo mostraron; ahora exige que cada paso exista, que el objetivo vigente se lea DESPUÉS de
  bloquear, y hay una carrera real contra la base que falla si el candado se quita (también si se lee el umbral sin bloquear).
- **Mutaciones**: 217 distintas (67 de lo puro, 35 del CSV y los filtros de la URL, 74 del servicio y las lecturas contra PostgreSQL
  y 41 de las guardias, la migración y el esquema), 210 detectadas. En algún momento sobrevivieron 28; 7 eran equivalentes y 21
  eran pruebas débiles que se reforzaron: el desempate del orden (variante, SKU, id, sucursal), el resumen con varias líneas sin
  proveedor, las alertas sin objetivo (la prueba terminaba con 0 alertas, así que «0 en Norte» era cierto aunque el filtro por
  sucursal no existiera: ahora cuenta exacto y mira antes de apagar nada), la sucursal de origen al aplicar a las otras, validar
  cuando no hay otras donde aplicar, buscar por el nombre de la variante, que un borrador ya pedido deje de contar como borrador, y
  los contadores de lo cerrado, devuelto y perdido (el servicio no los deja en una orden o transferencia abierta, así que solo se
  alcanzan escribiendo por fuera). Las 7 equivalentes: dos reescrituras del chequeo del objetivo contra el umbral que dan el mismo
  resultado en cada caso (con un 0 el otro operando ya basta), `Number.isFinite` rechaza el texto aunque se le quite el
  `typeof`, pedir `<=` en lugar de `<` al objetivo sin umbral (la sugerencia sería 0 y la propia regla la descarta), el desempate de
  borradores por una clave que nunca existe para «sin proveedor», quitar el `HAVING … > 0` de las sumas (solo reduce filas), y la
  resta de lo recibido en la suma de un borrador (un borrador no recibe nada).
- **Una simplificación por el camino**: el lector de filtros trataba `sin` como un caso aparte, pero `sin` ya es un id válido; el caso
  era redundante (la mutación que lo quitaba sobrevivía) y se quitó.
- **El orden de despliegue es el de INV-3a**: SQL antes que el código (§17). `/api/health` lo avisa si no.
- Medido contra la base local, no contra Supabase: la propuesta hace cinco consultas (saldos, lo pedido, lo que va en camino, los
  borradores y los proveedores de lo que se repone) más la de las alertas sin objetivo, no una por línea.
- En esta máquina el servidor de E2E imprime `fetch failed … 127.0.0.1:54329` y `The destination stream closed early`
  (Supabase Auth inexistente en el arnés): ruido previo, no afecta a los resultados.

## 19. INV-4a · qué se hizo

> Primera de las tres partes de INV-4. **No hay migración ni SQL que aplicar y no hay función de permiso nueva**: los tres informes se
> calculan de lo que el ledger ya guardaba (los movimientos, con la existencia antes y después de cada uno y, desde INV-3a, el costo
> con que se valoró). Se partió INV-4 en tres entregas para no mezclar lo que solo lee con lo que toca el ledger: **4a** informes de
> existencias (esta), **4b** motivos codificados y mermas por motivo (necesita una columna y un catálogo: SQL primero) y **4c** margen
> real y la tarjeta del dashboard.

Una pestaña nueva, «Reportes» (`/admin/inventario/reportes`), visible para todo el que tiene la sección Inventario (no pide `costos`
ni `comprar`), con tres informes. Cada uno tiene sus filtros en la URL, su botón de CSV con los **mismos** filtros y, si hay
dinero de por medio, solo lo lee y lo enseña quien tiene la función `costos`:

- **Kardex de un producto** (`/reportes/kardex`). Se busca el producto (nombre, SKU o código de barras; incluye descontinuados, su
  historia sigue ahí) o se llega con un clic desde su ficha («Kardex»). Muestra, para un rango de días y una sucursal (o todas), la
  existencia al empezar, cada movimiento que **entró o salió** con el saldo que dejó, y la existencia al terminar. Por defecto, los
  últimos 30 días de la empresa. *La existencia que se sigue es la física*: vendible + apartada + dañada, lo que la empresa tiene y
  todavía no ha dado de baja. Un movimiento la cambia solo si entra desde fuera (una entrada, una devolución, la pata de llegada de
  una transferencia) o sale del inventario (una venta, la pata de salida, una baja de lo dañado); apartar, dañar y recuperar solo
  cambian la mercancía de cubeta y se muestran sin mover el saldo («de vendible a dañado»). Las reservas y sus liberaciones no
  aparecen: no mueven nada. *Cómo se calcula el saldo*: la existencia física de hoy menos lo que cambió después del final del
  rango (el cierre) y después del comienzo (la apertura); no se guarda ningún saldo aparte que pueda desactualizarse, y las pruebas
  comprueban que apertura + entradas − salidas = cierre en cualquier rango y que el cierre de un rango que llega a hoy es la existencia
  que hay. Con `costos`: lo que valió lo que entró y lo que salió (con el costo que cada movimiento congeló) y, aparte, cuántas
  unidades no tenían costo —nunca como cero—. Máximo 1.000 movimientos en pantalla y 20.000 en el archivo; si se corta, enseña el
  comienzo del periodo, lo dice, y la existencia al terminar sigue siendo la del periodo completo.
- **Stock sin ventas** (`/reportes/sin-ventas`). Los saldos (producto y sucursal) con existencia que llevan 30, 60, 90, 180 o 365 días
  (90 por defecto) sin una venta —o que nunca vendieron—, de lo que más dinero tienen parado a lo que menos (sin `costos`, por
  unidades). Cuenta como venta el movimiento de venta (caja, pedido o a mano); una devolución, una entrada o una transferencia no.
  **Un saldo creado dentro del periodo no aparece**: todavía no tuvo tiempo de venderse. Muestra la última venta («hace 106
  días», o «nunca se ha vendido»), la última entrada y, con `costos`, el costo y el valor de cada uno y el dinero parado en total
  (a costo promedio, con el costo de referencia del catálogo si no hay promedio), con las unidades sin costo contadas aparte.
- **Rotación y cobertura** (`/reportes/rotacion`). Por producto (todas las sucursales o una), para un periodo de 30 a 365 días: lo
  vendido **menos lo devuelto**, la venta por día, la existencia promedio, cuántas veces rotó y para cuántos días alcanza lo que se
  puede vender hoy (vendible sin lo apartado) a ese ritmo. Estados: *agotado con ventas* (había ventas y no queda nada), *se agota
  pronto* (14 días o menos), *normal*, *exceso* (más de 180 días) y *sin ventas* (no hay ritmo, así que **no se inventa una cobertura
  infinita**: se dice «sin ventas»). Primero lo más urgente; el exceso y lo que no vende, al final; los chips por estado cuentan todo
  lo que cumple los filtros de sucursal y texto. La existencia al empezar el periodo sale de restar a la de hoy lo que cambió desde
  entonces (el ledger lo guarda), y el promedio es el de esos dos puntos —una aproximación, no un promedio día a día; la pantalla lo
  dice—. Con `costos`: el costo de lo vendido en el periodo, lo que vale todo el inventario y los **días de inventario** (el valor
  del inventario entre lo que cuesta vender un día; «—» si no hubo costo de ventas). Si hay más de 5.000 productos con existencias
  o ventas se leen primero los que más vendieron y la pantalla lo dice.
- **Archivos.** Tres CSV (`kardex`, `stock-sin-ventas-N-dias`, `rotacion-N-dias`) con los mismos filtros, un bloque de resumen
  —con los filtros aplicados y si el archivo está completo—, números planos que se suman, textos neutralizados contra fórmulas de hoja
  de cálculo, y las celdas de costo y valor **vacías** —nunca cero— cuando no se sabe. Sin `costos`, ni las columnas existen.
- **Permisos y aislamiento.** Las descargas piden la sección (no `costos`); lo que `costos` decide es si el archivo y la pantalla
  traen dinero. Sin la función **el costo ni siquiera se lee**: el movimiento se pide sin su costo, en SQL el costo es un `NULL`
  constante y la tabla de costos no se une, y el costo de ventas y el valor del inventario no se calculan. Todo se lee dentro de la
  empresa de la sesión, con la empresa escrita en cada consulta; una sucursal de la URL que no es de la empresa no filtra, y un
  producto que no es de la empresa responde 404 en el archivo y «no existe en tu empresa» en la pantalla.

### Lo que NO hace (a propósito, o pendiente)

- **No hay saldo valorizado histórico.** Un kardex «valorizado» clásico enseña, en cada fila, cuánto vale la existencia en ese
  instante. Aquí el costo promedio solo se guarda vigente (INV-3a), así que reconstruir ese saldo hacia atrás no se puede hacer sin
  inventarlo. Lo que sí hay: lo que valió cada entrada y cada salida con el costo que congeló, y el valor de hoy en «Valor». Un saldo
  valorizado exacto pediría guardar el promedio resultante en cada movimiento (una columna y un barrido): queda anotado, no hecho.
- **Orden de movimientos concurrentes.** El orden del kardex es el de la fecha del movimiento (el comienzo de su transacción) y, si
  empatan, el del id. Dos movimientos del mismo producto confirmados casi al mismo tiempo pueden aparecer en el orden contrario al
  que se aplicaron, y entonces un saldo intermedio podría diferir de lo que se vio en ese instante; **la apertura, el cierre y los
  totales son exactos** (no dependen del orden).
- **Rotación aproximada**: existencia promedio de dos puntos, sin estacionalidad ni pronóstico; la cobertura asume que el ritmo del
  periodo seguirá igual. No hay clasificación ABC, ni rotación por categoría o marca, ni gráficas.
- **Un solo producto por kardex.** No hay un kardex de toda la empresa (para eso está «Movimientos», con filtros y CSV).
- **No hay mermas por motivo ni margen real ni tarjeta en el dashboard**: son INV-4b e INV-4c.
- **Los días de inventario se alargan con las ventas sin costo** (el costo de ventas las deja fuera); la pantalla lo avisa.
- Observación que no se tocó: la búsqueda de productos de las entradas, las transferencias y los conteos (INV-2) trata un `%` como
  «todo» (Prisma no neutraliza los comodines); solo devuelve los primeros diez de la propia empresa, sin fuga. La búsqueda del kardex sí
  los neutraliza, con prueba.

Archivos principales: `src/modules/inventory/{reportes,reportes-queries}.ts` (lo puro y las lecturas), `valor.ts`
(`costoDeVentasEnRangoEnTx` y `valorTotalEnTx`, que ahora comparten la pantalla de Valor y la rotación), `filtros.ts`,
`exportacion.ts`, `src/components/inventario/NavegacionInventario.tsx` y
`src/app/(admin)/admin/inventario/reportes/{,kardex,sin-ventas,rotacion}/` (+ `exportar/`).

### Cómo desplegar

No hay migración. Con el código desplegado la pestaña «Reportes» funciona sobre lo que ya hay; los costos del kardex y del costo de
ventas de la rotación solo aparecen para quien tiene `costos` y desde que se aplicó `20261059` (INV-3a). Si esa migración no se hubiera
aplicado, las pantallas muestran el aviso de «necesita una actualización de la base de datos» en lugar de fallar.

## 20. Verificación de INV-4a (2026-10-15)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`; **no hay migración nueva**, así que no se tocó el esquema ni ninguna base
real). Sin Supabase real, Vercel, lector de código de barras físico, móvil ni Safari: **no verificados**. **Tampoco se miró cómo
se ven las tres pantallas** (el recorrido E2E comprueba qué dicen y qué hacen, no su aspecto: ni capturas ni revisión visual en
móvil). **Tampoco se midió con un ledger grande**: el kardex y la rotación leen el ledger por rango de fechas con los índices que ya
existen (`inventoryLevelId + createdAt` y `companyId + createdAt`), y la rotación lee hasta 5.000 productos por pantalla; se probó que
corta y lo dice, no cuánto tarda con millones de movimientos ni con la latencia de una base remota.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (189 avisos, ninguno nuevo) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; las 7 rutas nuevas compiladas (4 páginas y 3 descargas); entrada compartida 859/1000 KB (86 %), trozo mayor 409/600 KB (sin cambio). El indicador general de JavaScript de cliente marca 8.900/9.200 KB (97 %, con aviso amarillo: es un indicador, no un tope duro; antes de INV-4a, con la misma rama pero sin la fusión con `main`, 8.639 KB) |
| Unitarias (`bun run test`) | 4460 pruebas: 4453 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | 852/853: ver «un fallo ajeno» abajo |
| Pruebas nuevas | 28 puras (`inventario-reportes.test.ts`), 5 guardias nuevas (`inventario-permisos.test.ts`, ya 87), 27 contra PostgreSQL (`inventory-reportes.db.test.ts`) y un recorrido E2E nuevo |
| E2E (`bun run e2e:limpio`, escritorio) | 73/73 en la corrida combinada final (los 72 de antes más el recorrido nuevo): `inventario-admin` (12), `comercio-experiencia`, `pedidos-membego`, `pos-membego`, `carrito-checkout`, `catalogo-admin`, `catalogo-api` y `catalogo-publico`. En la primera corrida el recorrido nuevo falló por un selector mío ambiguo (`getByLabel('Producto')` también encontraba el formulario «Buscar el producto del kardex»); se corrigió con un selector de rol y repitió completo |
| Mutaciones | 217 distintas: 213 detectadas, 3 equivalentes y 1 que era un error de mi código, no de la prueba (ver abajo) |

Qué cubre el recorrido E2E: la pestaña Reportes con sus tres informes → el kardex (se busca el producto, +100 con lo que valió y −30
con su costo, el saldo de cada movimiento, un rango sin movimientos que conserva la existencia de partida, un producto que no existe,
el enlace desde la ficha) y su CSV (400 sin producto, 404 si no existe) → el stock sin ventas (lo que nunca se vendió con su dinero
parado, lo sin costo contado aparte, un periodo más largo que los saldos que no lista nada, sucursal ajena y periodo raro que no
filtran) y su CSV → la rotación (venta por día, para cuántos días alcanza, chips por estado, costo de ventas y días de inventario)
y su CSV con y sin filtro → y con `costos` negada las tres pantallas y los tres archivos siguen funcionando **sin una sola cifra de
dinero ni columna de costo**.

Qué cubren las 27 pruebas contra PostgreSQL: el kardex contra el ledger real (cada tipo de movimiento: entrada, venta, daño, baja,
devolución, transferencia con sus dos patas, ajuste), apertura + entradas − salidas = cierre en cualquier rango y sucursal
(barrido de 3 × 55 rangos), que el cierre de hoy es la existencia física (vendible + apartada + dañada, también con dañadas que
siguen en la sucursal), que las reservas y sus liberaciones no aparecen, el orden a igual hora, el corte por tope, el día LOCAL de
la empresa y el primer y último día del rango, sin costos y con ellos, un producto o sucursal ajenos o sin saldo; el stock sin ventas
(qué cuenta y qué no: saldo nuevo, saldo vacío, devolución, entrada, transferencia recibida; costo de referencia sin promedio;
orden por dinero o por unidades; búsqueda por nombre, SKU y código de barras; páginas y archivo de más de 50 filas); la rotación
(vendidas menos devueltas, existencia de partida, cobertura, cada estado y sus límites, ventas netas negativas, filtros, conteos por
estado, corte por tope, páginas y archivo, costo de ventas y días de inventario por periodo y por sucursal); lo que vale todo el
inventario (dañadas, costo de referencia, sin costo); la búsqueda del producto del kardex (exacta primero, descontinuados, comodines,
tope); y el aislamiento entre empresas.

Hallazgos de la propia verificación (importa que se sepan):

- **Las pruebas encontraron tres errores míos antes de que llegaran a nadie.** (1) La búsqueda del kardex trataba un `%` como «todo»:
  Prisma no neutraliza los comodines ni en `contains` ni en un `equals` insensible (que es un `ILIKE`); se escapan, con prueba.
  (2) Un kardex de una sucursal donde el producto nunca tuvo saldo salía con el nombre de la sucursal VACÍO; ahora se lee la
  sucursal aparte. (3) La rotación listaba productos sin existencia cuyas ventas netas del periodo eran negativas (más devoluciones
  que ventas) como «sin ventas»; ahora solo entran los que tienen existencia o ventas positivas.
- **Mutaciones: 217 distintas.** Se ejecutaron 229 en tres capas (92 de lo puro, el CSV y los filtros de la URL; 103 de las lecturas
  contra PostgreSQL —sin contar dos mal escritas que se rehicieron—; y 34 de las guardias y las pantallas); 12 de ellas son la misma
  mutación probada contra dos capas. **En algún momento sobrevivieron 43** (3 del CSV, 33 de las lecturas y 7 de las guardias). De
  ellas, 3 son equivalentes, 1 destapó un error de mi código (abajo) y el resto eran pruebas débiles que se reforzaron:
  - *CSV (3)*: la prueba comprobaba que el producto con `=`/`+` iba neutralizado, pero lo hacía mirando el título del archivo, que
    también lo lleva; y ninguna cifra pasaba de 1.000, así que quitar el «sin separador de miles» no se notaba. Ahora el resumen se
    comprueba con su línea exacta y hay una prueba con montos de millones en los tres archivos.
  - *Lecturas contra PostgreSQL (33: 22 con un caso nuevo; 7 que quitan la empresa de una consulta o el filtro de costo y que cubren
    las guardias estáticas, porque el resultado no cambia mientras el id del saldo ya sea de la empresa —por eso la guardia las
    comprueba una a una—; 3 equivalentes; y 1 que era mi código)*: el ledger de prueba terminaba sin unidades dañadas y sin movimientos justo en el primer día del
    rango; no había una reserva liberada, ni dos movimientos a la misma hora, ni una devolución o una entrada «reciente» en el stock
    sin ventas, ni costo de referencia sin promedio, ni un producto buscado por código de barras, ni más de 50 filas (así que «el
    archivo trae todo» y «la página 2» no se distinguían de una sola página), ni una venta fuera del periodo en el costo de ventas, ni
    una sucursal que acotara el costo y el valor, ni dañadas en lo que vale todo el inventario. Cada uno tiene ya su caso.
  - *Guardias (7)*: la ventana de 140 caracteres con que la guardia buscaba la empresa en cada consulta **se comía la consulta
    siguiente** si estaban pegadas (una de las consultas del kardex no se revisaba nunca); `conCostos: true` pasaba la misma
    expresión que `conCostos`; y «el dinero va detrás de una condición» se comprobaba por cercanía de palabras. Ahora la ventana no
    consume, el costo tiene que ser el de la persona (no un `true` fijo) y cada bloque de dinero se comprueba con su condición.
  - *Las 3 equivalentes*: pedir `>=` en lugar de `>` al inicio del rango en la suma de efectos (solo cambia si un movimiento cae
    exactamente en el instante de la medianoche), y quitar dos desempates de la rotación en JavaScript (por ventas y por id), que ya
    vienen resueltos por el `ORDER BY` de la consulta y por un orden estable.
- **Un fallo ajeno en `test:db`**: `supply-v2-slice9` («el worker reclama y muere antes de entregar; el arriendo lo rescata») falló
  una vez en la corrida completa; aislado, el mismo archivo pasa 3 de 3 (85/85). Ya había fallado alguna vez bajo carga en una
  verificación anterior y sigue **sin explicación**; no toca nada de inventario ni de esta entrega.
- **Una guardia de diseño que ya existía mandó**: el hub y las tres pantallas usan `BotonExportar`, `Alert` y los colores de tema, sin
  subir el techo de deuda de diseño.
- **La tabla de rutas del documento de separación se regeneró** (`bun run docs:rutas`): +4 páginas y +3 descargas del panel.
- Medido contra la base local, no contra Supabase: cada informe son de dos a seis consultas (no una por fila), y el kardex lee los
  efectos con una suma, no trayendo los movimientos.
- En esta máquina el servidor de E2E imprime `fetch failed … 127.0.0.1:54329` y `The destination stream closed early` (Supabase Auth
  inexistente en el arnés): ruido previo, no afecta a los resultados.

## 21. INV-4b · qué se hizo

> Segunda de las tres partes de INV-4. **Sí hay SQL que aplicar** (`prisma/migrations/20261067_inventory_reason_codes`), **antes de
> desplegar el código** (ver «Cómo aplicar la migración»). No hay función de permiso nueva: el motivo lo elige quien ya puede
> ajustar (`ajustar`) y el informe lo ve quien ya tiene la sección Inventario; el dinero sigue detrás de `costos`.

**El problema.** Hasta INV-4a, el «por qué» de un ajuste, un daño o una baja era texto libre (`inventory_movements.reason`). Sirve para
leer un movimiento, no para sumar: «vencido», «venció», «caducado» y «se venció el lote 12» son lo mismo para una persona y cuatro
cosas para un informe. Para saber cuánto se perdió y por qué hace falta un código estable.

**Lo que hay ahora.**

- **Un código de motivo en el ledger.** `inventory_movements.reasonCode` (texto, nulo). El texto libre se conserva como **detalle**
  (`reason`, que la base sigue exigiendo en ajustes y daños: si la persona no escribe nada se guarda la etiqueta del motivo, así
  que el texto nunca queda vacío ni miente). Solo un ajuste o un daño puede llevar código (una venta con «motivo: robo» sería un
  dato que nadie sabría leer); lo comprueban el servicio y un `CHECK` de la base.
- **Un catálogo de 14 motivos, en el código** (`src/modules/inventory/motivos.ts`), no en una tabla: añadir un motivo no exige una
  migración. Cada motivo vale solo para lo que explica, en cuatro clases: **faltante** (un ajuste que resta), **sobrante** (un ajuste
  que suma), **dañado** (vendible → dañado) y **baja** (lo dañado sale del inventario). *Vencido* explica un faltante, un daño o una
  baja; *robo*, *pérdida*, *muestra o regalo* y *consumo interno*, un faltante; *devuelto al proveedor*, un faltante o una baja;
  *diferencia de conteo*, un faltante o un sobrante; *apareció mercancía* y *error de captura*, un sobrante; *golpe*, *mal
  almacenamiento*, *transporte* y *defecto de fábrica*, un daño o una baja; y *otro*, cualquiera, **pero exige detalle**. Un motivo
  de otra clase se rechaza (no se puede explicar un sobrante con «robo»).
- **Las pantallas lo exigen.** El formulario de la ficha del producto (ajustar, dañar, dar de baja) trae un selector de motivo
  obligatorio —solo con los motivos de esa clase— y un «Detalle» opcional (obligatorio con «otro»); las acciones del servidor lo
  vuelven a exigir, así que una petición hecha a mano sin motivo también falla con «Elige el motivo.». **Recuperar** lo dañado
  (vuelve a vendible) no es una pérdida: no lleva motivo del catálogo y el servicio lo rechaza si se le manda uno.
- **Los procesos que no eligen un motivo siguen funcionando como antes** (la API de servicio y las pruebas pueden escribir solo
  texto; el código queda nulo). **Los conteos físicos escriben solos «diferencia de conteo»** en cada diferencia —el conteo manual
  de una variante y el que aplica una sesión de conteo—: nadie lo elige y es la verdad.
- **Se ve donde se mira el ledger.** Un renglón «Motivo: …» (y el detalle debajo, si dice algo distinto de la etiqueta) en
  Movimientos, en el historial de la ficha y en el kardex; y dos columnas nuevas en los CSV de Movimientos y de Kardex: «Motivo
  (catalogo)» y «Detalle del motivo» (la columna «Motivo» de antes no se quitó para no romper hojas que ya la usan). Lo anterior a
  esta migración, y lo que escribieron procesos que no eligen motivo, sale como **«Sin motivo codificado»**: el ledger es inmutable
  y no se reescribe, así que no se inventa un motivo para lo histórico.
- **Informe «Mermas por motivo»** (`/admin/inventario/reportes/mermas`, cuarta tarjeta del hub «Reportes»). Para un rango de días
  (por defecto los últimos 30, días LOCALES de la empresa, ambos incluidos), con filtros de motivo (o «Sin motivo codificado»),
  sucursal y producto (nombre, SKU o código de barras), tres grupos:
  - **Lo perdido** = faltantes + bajas de lo dañado: lo que salió del inventario sin venderse;
  - **Sobrantes**: ajustes que sumaron (no son una pérdida, pero se ven al lado porque suelen ser la otra cara del mismo descuadre);
  - **Dañado**: vendible → dañado. **No se suma a lo perdido**: sigue en la sucursal (y en el valor del inventario) hasta que se dé
    de baja, y una pieza que se daña hoy y se da de baja mañana sería, si no, dos pérdidas. Recuperar lo dañado no cuenta en nada.

  Cada grupo se desglosa **por motivo** (movimientos, unidades y, con `costos`, lo que valieron y qué parte del grupo es), de lo
  que más pesa a lo que menos, con un clic para filtrar por ese motivo; debajo, el detalle movimiento por movimiento (producto,
  sucursal, persona, motivo, detalle, y con `costos` su costo y valor), del más reciente al más antiguo, 50 por página. Valor =
  unidades × el costo que el propio movimiento congeló (INV-3a): **lo que no tiene costo se cuenta aparte, nunca como cero**, y la
  pantalla lo avisa. Sin `costos`, **el costo ni siquiera se lee** (en SQL es un `NULL` constante): ni la pantalla ni el archivo
  traen una cifra de dinero ni una columna de costo. CSV con los mismos filtros (hasta 20.000 movimientos, con un resumen que dice
  si el archivo está completo y los filtros aplicados), números planos, textos neutralizados contra fórmulas de hoja de cálculo.
- **Aislamiento.** Todo se lee dentro de la empresa de la sesión, con la empresa escrita en cada consulta y en cada unión; una
  sucursal de la URL que no es de la empresa no filtra; un código de motivo que el catálogo no conoce no filtra (se ignora). La
  descarga pide la sección Inventario (no `costos`): `costos` decide solo si el archivo trae dinero.

### Lo que NO hace (a propósito, o pendiente)

- **No se reescribe el ledger.** Los movimientos anteriores no ganan motivo: aparecen como «Sin motivo codificado». No hay un
  barrido que intente adivinar el motivo desde el texto libre (sería inventar datos en un registro inmutable).
- **Las pérdidas en tránsito de una transferencia (cerrar con faltante, INV-2c) no están en el informe**: se registran en el
  documento de la transferencia con su propio motivo en texto, no como un ajuste del ledger. Es una limitación conocida; si se quiere
  verlas por motivo, el siguiente paso sería darles también un código.
- **El catálogo es único para todas las empresas** y vive en el código: no hay motivos propios por empresa ni se pueden desactivar
  los de fábrica desde la pantalla. Un motivo que un día se retire del catálogo seguiría mostrándose con su código (nunca se oculta).
- **No hay un tope de «merma aceptable», alertas por merma ni comparación contra el periodo anterior**; es un informe, no un
  control.
- **Una devolución de un cliente (`RETURN`), una venta o una entrada no son ajustes ni daños**: no llevan motivo del catálogo y no
  entran al informe (siguen en el kardex y en Movimientos). Solo cuentan los ajustes (manuales, de conteo o de baja) y los daños.
- Observación que no se tocó: la búsqueda de productos de INV-2 (entradas, transferencias y conteos) sigue tratando un `%` como
  «todo»; el informe de mermas sí neutraliza los comodines.

Archivos principales: `prisma/migrations/20261067_inventory_reason_codes/`, `prisma/schema/inventario.prisma` (`reasonCode`),
`src/modules/inventory/{motivos,mermas,mermas-queries}.ts` (catálogo y reglas puras, informe puro y lecturas), `service.ts` (las
dos únicas puertas de escritura del ledger, `escribirMovimiento` y `escribirMovimientosPorLote`, y los cuatro movimientos manuales),
`actions.ts`, `filtros.ts`, `exportacion.ts`, `src/components/inventario/{SucursalInventarioCard,HistorialMovimientos}.tsx`,
`src/app/(admin)/admin/inventario/{movimientos,reportes/kardex,reportes/mermas}/` y el centinela `inventory_movements.reasonCode`
de `/api/health`.

### Cómo aplicar la migración (obligatorio y en este orden)

1. **SQL primero.** En el editor SQL de Supabase, ejecutar `prisma/migrations/20261067_inventory_reason_codes/migration.sql`
   (es aditiva e idempotente: se puede repetir sin daño). Añade una columna nula sin valor por defecto —PostgreSQL no reescribe la
   tabla: es instantáneo aunque el ledger sea enorme— y dos `CHECK` que se crean `NOT VALID` y se validan aparte. No crea índices.
2. **Código después.** Con el SQL aplicado y el código viejo no pasa nada (la columna se ignora). **Con el código nuevo y SIN el SQL,
   el inventario y los pedidos fallan**: Prisma pide todas las columnas del movimiento en cada lectura y cada venta escribe uno. Por
   eso `/api/health` tiene un centinela nuevo (`inventory_movements.reasonCode`): si el despliegue se adelanta, el health lo dice.
3. Dependencia: `20261059` (INV-3a) ya tiene que estar aplicada (ahí nació `unitCost`, que el informe valora). Si las migraciones
   pendientes de las entregas anteriores (`20261059`, `20261060`, `20261066`) todavía no se aplicaron, se aplican primero y en su orden.

## 22. Verificación de INV-4b (2026-10-15)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`). La migración `20261067` se aplicó **solo** a esas bases desechables
(dos veces seguidas, para comprobar que es idempotente, y sin diferencias de esquema contra `schema.prisma`); **no se aplicó a
ninguna base real: eso lo hace el dueño en Supabase, antes de desplegar**. Sin Supabase real, Vercel, lector de código de barras
físico, móvil ni Safari: **no verificados**. **Tampoco se miró cómo se ven las pantallas** (el formulario con el selector de motivo,
el cuarto informe y el hub): el recorrido E2E comprueba qué dicen y qué hacen, no su aspecto; ni capturas ni revisión visual en móvil.
**Tampoco se midió con un ledger grande**: el informe lee los ajustes y daños de un rango de fechas con el índice `(companyId,
createdAt)` que ya existía (a propósito no se creó ninguno), y se probó que el archivo trae todos los movimientos y que las páginas
no repiten ni pierden ninguno, no cuánto tarda con millones de movimientos ni con la latencia de una base remota.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (189 avisos, ninguno nuevo) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; 2 rutas nuevas compiladas (una página y una descarga); entrada compartida 859/1000 KB (86 %), trozo mayor 409/600 KB (sin cambio). Indicador general de JavaScript de cliente 8.905/9.200 KB (97 %, aviso amarillo, no un tope duro; 8.900 en INV-4a) |
| Unitarias (`bun run test`) | 4492 pruebas: 4485 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | **874/874** (en esta corrida el archivo que a veces falla bajo carga, `supply-v2-slice9`, pasó) |
| Pruebas nuevas | 12 puras del catálogo y las reglas de motivo (`inventario-motivos.test.ts`), 12 puras del informe y su CSV (`inventario-mermas.test.ts`), 7 guardias nuevas (`inventario-permisos.test.ts`, ya 94), 10 contra PostgreSQL de los escritores (`inventory-motivos.db.test.ts`), 11 contra PostgreSQL del informe (`inventory-mermas.db.test.ts`) y un recorrido E2E nuevo; además se actualizaron `inventario-inv1`, `inventario-reportes` y el recorrido principal de `inventario-admin` (el formulario ahora exige el motivo) |
| E2E (`bun run e2e:limpio`, escritorio) | **74/74** en la corrida combinada final: `inventario-admin` (13: los 12 de antes más el de mermas), `comercio-experiencia`, `pedidos-membego`, `pos-membego`, `carrito-checkout`, `catalogo-admin`, `catalogo-api` y `catalogo-publico`. Ver «la primera corrida» abajo |
| Mutaciones | 138 en tres capas: 125 detectadas a la primera, 13 sobrevivieron (1 estaba mal escrita, 9 eran pruebas débiles y 3 son equivalentes o inalcanzables); ver abajo |

Qué cubre el recorrido E2E: el formulario de la ficha exige el motivo del catálogo (solo los de su clase: no ofrece «Apareció
mercancía» en un faltante), «Otro» pide detalle (vacío lo frena el navegador; solo espacios, el aviso de la pantalla) y nada se
escribe → un ajuste, un daño y una baja con su motivo y su detalle, el historial de la ficha enseña «Motivo: …» solo en lo que lo
lleva (la entrada, la transferencia y el conteo —que pone «Diferencia de conteo» solo— se comprueban contra el ledger real) → el
cuarto informe del hub → el resumen (lo perdido no incluye lo dañado ni los sobrantes; el costo de A y los 5 sin costo de B contados
aparte), cada grupo por motivo de lo que más vale a lo que menos, el detalle sin ventas, entradas ni recuperar, el filtro por motivo
con un clic, el CSV con los mismos filtros → y con `costos` negada el informe y el archivo siguen funcionando **sin una sola
cifra de dinero ni columna de costo**.

Qué cubren las pruebas contra PostgreSQL: que el código llega al ledger por las DOS puertas (un movimiento y un lote), solo en
ajustes y daños; que un motivo de otra clase, inventado, «Otro» sin detalle o ninguno cuando se exige se rechaza SIN escribir ni mover
el saldo; que el texto nunca queda vacío (sin detalle, la etiqueta); la distinción entre daño y baja («devuelto al proveedor» sirve para
dar de baja, no para dañar); que recuperar no lleva motivo aunque se exija; el conteo manual y el de una sesión; la idempotencia y
la bitácora; lo que vigila la base (formato, tipo, inmutabilidad); y en el informe: qué cuenta como merma y qué no, el valor con el costo
congelado y lo sin costo aparte, que sin `costos` no se lee ni uno, el orden, el rango en el calendario de la empresa (primer y último
día), los filtros (motivo, «sin motivo», sucursal, producto por nombre, SKU y código de barras), el orden fijo cuando dos movimientos
caen a la misma hora, las páginas y el archivo, que la clase que calcula el SQL es la que calcula el código para cada ajuste y daño, y el
aislamiento entre empresas.

Hallazgos de la propia verificación (importa que se sepan):

- **La primera corrida del E2E combinado falló, y era mi prueba.** El recorrido principal esperaba el aviso de la pantalla al
  registrar «Otro» sin detalle, pero el campo es `required` y el navegador frena el envío antes (el aviso nunca llega a mostrarse).
  La app hacía lo correcto: se corrigió la prueba para cubrir los dos caminos (vacío → navegador; solo espacios → aviso de la
  pantalla). El spec repitió completo (13/13) y después la combinada (74/74). En esa primera corrida 62 pasaron, 1 falló y 11 no
  llegaron a correr porque dependían de ese recorrido.
- **Mutaciones: 138 ejecutadas** (66 de lo puro, el CSV y los filtros; 44 de los escritores y las lecturas contra PostgreSQL; 28 de
  las guardias estáticas y la migración). 125 detectadas a la primera; **13 sobrevivieron**:
  - *1 mal escrita* («ordena el arreglo recibido»): mi mutación copiaba el arreglo, que es lo mismo que el original. Rehecha de
    verdad (`filas.sort` en sitio) se detecta.
  - *9 eran pruebas débiles, ya reforzadas y detectadas*: la prueba del catálogo comparaba el catálogo **contra sí mismo** (si «vencido»
    dejaba de poder darse de baja nadie lo notaba): ahora la lista exacta de cada clase está escrita en la prueba; un código inventado se
    rechazaba, pero con el mensaje de otra causa («no sirve para esto» en vez de «no está en el catálogo»); un valor desconocido y un
    cero conocido se ordenaban igual; la prueba del CSV sin costos nunca traía un movimiento con costo, así que mostrar las columnas
    de costo siempre pasaba; y contra PostgreSQL faltaban: daño frente a baja (la clase de cada una), recuperar cuando se exige motivo,
    buscar por código de barras y el orden fijo cuando dos movimientos caen a la misma hora.
  - *3 equivalentes o inalcanzables*: (1) incluir `SALE` en el `IN` de tipos del informe no cambia nada, porque la clase de una venta
    es nula y se descarta después; (2) la clase «daño» sin mirar las cubetas no cambia nada, porque la base ya obliga a que todo
    `DAMAGE` vaya de vendible a dañado (`CHECK` de `20261038`); (3) quitar la guarda `MOTIVO_NO_APLICA` de `escribirMovimiento`: ninguna
    función pública puede pasarle un código con un tipo que no sea ajuste o daño, así que es defensa en profundidad que hoy no se
    alcanza; la respalda el `CHECK` de la base, que sí se prueba directo (prueba 9).
- **Las pruebas encontraron errores míos antes de que llegaran a nadie** (aritmética de un caso, un campo de la bitácora que se
  llama `accion`, expresiones de las guardias que se tragaban la siguiente consulta, una guardia de «sin dinero» que confundía el
  encabezado `Concepto;Valor` con dinero): todos corregidos en el momento, ninguno llegó a producción.
- **Una guardia de diseño que ya existía mandó**: el informe usa `BotonExportar`, `Alert` y los colores de tema, sin subir el techo de
  deuda de diseño.
- **La tabla de rutas del documento de separación se regeneró** (`bun run docs:rutas`): +1 página y +1 descarga del panel.
- En esta máquina el servidor de E2E imprime `TypeError: fetch failed` (Supabase Auth inexistente en el arnés): ruido previo, no
  afecta a los resultados.

### Lo que NO se verificó

Aspecto visual y móvil; un ledger grande; Supabase real (incluida la aplicación real del SQL y el comportamiento del `/api/health`
contra esa base); lector de código de barras físico; Safari. El informe **no incluye** las pérdidas en tránsito de las
transferencias ni motivos propios por empresa (ver §21), y lo anterior a la migración sale «Sin motivo codificado».

## 23. INV-4c · qué se hizo

> Última parte de INV-4. **No hay migración ni SQL que aplicar y no hay función de permiso nueva**: el margen se calcula de lo que ya
> estaba guardado —los movimientos de venta del ledger, con el costo que congelaron (INV-3a), y las líneas de los pedidos, con su
> precio—. Se puede desplegar sin tocar la base. Lo único: la tarjeta del dashboard usa lo perdido (INV-4b, SQL `20261067`) y el costo
> (INV-3a, `20261059`); mientras alguno falte, la tarjeta no aparece —y el dashboard sigue funcionando— y el informe de margen dice que
> «necesita una actualización de la base de datos» en vez de fallar.

**El problema.** El inventario sabía lo que costaba cada venta (INV-3a) y los pedidos sabían a cuánto se vendió, pero nadie los cruzaba:
no había forma de ver «de este producto cobré tanto y me costó tanto» ni de ver, de un vistazo, cómo va el inventario en el
dashboard.

**Lo que hay ahora.**

- **Informe «Margen real»** (`/admin/inventario/reportes/margen`, quinta tarjeta del hub «Reportes»). Para un rango de días (por
  defecto los últimos 30, días LOCALES de la empresa, ambos incluidos), producto por producto: unidades vendidas, **ingresos**, **costo**,
  **margen** (ingresos menos costo; negativo si se vendió por debajo del costo) y **margen %** (el margen entre lo cobrado). Con
  filtros de sucursal y de producto (nombre, SKU o código de barras), cinco órdenes (más margen, **menos margen primero** —lo que se vende
  bajo el costo—, mejor porcentaje, más ingresos, más unidades), 50 productos por página y CSV con los mismos filtros (hasta 20.000
  productos, con un resumen que dice si el archivo está completo).
  - *Ingresos* = el precio de cada línea del pedido menos su descuento (`lineTotal`). **No incluye impuestos ni el ajuste del pedido**
    (que no se reparte entre líneas). Solo cuentan pedidos **completados**.
  - *Costo* = el costo promedio que el ledger congeló en el movimiento de venta, no el de hoy.
  - *De dónde se unen*: la venta es un movimiento `SALE` cuya referencia es el pedido; se agrupa por (pedido, variante) y se une a la
    línea de ese pedido para esa variante. Si el ledger vendió solo una parte de la línea, el ingreso es esa parte (nunca la línea
    entera ni más).
  - ***Lo que NO entra al margen* —y se enseña aparte, con el porqué—**: (1) **las unidades sin costo conocido**: ni con costo cero, que
    inflaría el margen al 100 %; se cuentan con lo que se cobró por ellas, y el margen y el porcentaje se calculan solo sobre lo que
    tiene costo; (2) **los pedidos reembolsados**, devuelvan o no la mercancía al inventario (lo cobrado se devolvió: no fue una
    venta); (3) **los pedidos en otra moneda** que la de la empresa (el costo del inventario está en la moneda de la empresa; comparar
    sería inventar un margen); (4) **las ventas sin pedido** que diga a cuánto se vendieron (una venta a mano, o una que cita un
    pedido que no existe, que no es de ese tipo o donde ese producto no tiene línea).
- **Solo con la función `costos`.** Un margen es costo contra precio: sin la función no hay una versión «sin dinero» que enseñar. La
  pantalla lo dice («No tienes permiso para ver costos ni el margen»), **la lectura ni se ejecuta**, el botón de descarga no existe, el
  archivo responde 403 (`requireSection('inventario', 'costos')`, antes de tocar la base) y el hub no ofrece la tarjeta del informe.
  Los otros cuatro informes siguen enseñando unidades y días sin ella.
- **Tarjeta «Inventario» en el dashboard.** Debajo de «Comercio Membego»: **valor del inventario** (con las unidades y las que no tienen
  costo), **margen del mes** (con su porcentaje, las unidades vendidas y cuántas no entran por no tener costo) y **perdido este mes**
  (faltantes y bajas de lo dañado: unidades, movimientos y lo que valieron). Cada cifra lleva a su informe. Es la misma cuenta de
  «Valor», «Margen real» y «Mermas por motivo», no una estimación aparte; el mes es el calendario de la empresa. **Quien puede ver la
  sección Inventario pero no tiene `costos` ve «Unidades en existencia» y «Perdido este mes» en unidades**: ni el valor, ni el margen,
  ni lo que costó lo perdido (con la función apagada no se lee ni un costo). Quien no puede ver la sección no ve la tarjeta, y si la
  lectura falla el dashboard sigue (la tarjeta simplemente no sale).
- **Un refactor pequeño de 4b** para no duplicar SQL: `mermas-queries.ts` expone `perdidoEnRangoEnTx` (el total de lo perdido en un
  rango) con la misma agregación del informe de mermas; las pruebas de mermas siguen intactas.

### Lo que NO hace (a propósito, o pendiente)

- **No es una utilidad contable.** El margen es bruto sobre el producto: no resta la comisión del marketplace, las comisiones de
  cobro, los impuestos ni los gastos. Y no tiene por qué coincidir con el «costo de ventas» de la pantalla de Valor (que incluye
  devoluciones sueltas y ventas sin precio) ni con «Ventas Membego del mes» del dashboard (que suma el total de los pedidos con
  impuestos): son cuentas distintas (la pantalla del margen lo explica respecto a «Valor»).
- **Un reembolso sin devolver la mercancía al inventario** sale del margen y queda visible como «Pedidos reembolsados»; no es una merma
  en el informe de mermas (el ledger no tiene un ajuste para eso). Quien necesite verlo como pérdida tiene que dar de baja la mercancía.
- **El margen de un periodo pasado puede cambiar** si después se reembolsa un pedido de ese periodo (en ese momento deja de ser venta).
- **No hay conversión de monedas**: lo vendido en otra moneda queda fuera, con sus unidades y su costo a la vista.
- **No hay margen por categoría, por cliente ni por canal, ni comparación contra el periodo anterior, ni precio sugerido.** El margen
  es por producto (variante) y por rango.
- **Las ventas anteriores a INV-3a no tienen costo congelado**: salen como «sin costo» (no se reconstruyen).
- La búsqueda de productos del informe neutraliza los comodines (`%`, `_`); la de INV-2 sigue sin hacerlo (observación que no se tocó).

Archivos principales: `src/modules/inventory/{margen,margen-queries,dashboard}.ts` (lo puro, las lecturas y el resumen del dashboard),
`mermas-queries.ts` (`perdidoEnRangoEnTx`), `filtros.ts`, `exportacion.ts` (`margenToCsv`),
`src/app/(admin)/admin/inventario/reportes/{page.tsx,margen/}` (+ `margen/exportar/`), `src/components/admin/TarjetaInventario.tsx` y
`src/app/(admin)/admin/dashboard/page.tsx`.

### Cómo desplegar

No hay migración: el código se despliega solo. Las SQL pendientes de entregas anteriores (`20261059`, `20261060`, `20261066`,
`20261067`) siguen siendo necesarias si aún no se aplicaron; la tarjeta del dashboard y el margen necesitan `20261059` (costos) y la tarjeta
además `20261067` (motivos, para lo perdido).

## 24. Verificación de INV-4c (2026-10-15)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`). **No hay migración nueva**, así que no se tocó el esquema ni ninguna base
real. Sin Supabase real, Vercel, móvil ni Safari: **no verificados**. **Tampoco se miró cómo se ven las pantallas** (el informe, la
tarjeta del dashboard y el hub): el recorrido E2E comprueba qué dicen y qué hacen, no su aspecto; ni capturas ni revisión visual en
móvil. **Tampoco se midió con un ledger grande**: el informe cruza los movimientos de venta de un rango con las líneas de sus pedidos
(índices `(companyId, createdAt)` en el ledger y `orderId` en las líneas, que ya existían; no se creó ninguno) y la tarjeta hace unas
pocas consultas agregadas (valor, margen del mes y lo perdido) por visita al dashboard; se probó que cuentan bien, no cuánto tardan con millones de movimientos ni con la latencia de una
base remota.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (189 avisos, ninguno nuevo) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; 2 rutas nuevas compiladas (una página y una descarga); entrada compartida 859/1000 KB (86 %), trozo mayor 409/600 KB; indicador general 8.905/9.200 KB (97 %), igual que en INV-4b |
| Unitarias (`bun run test`) | 4514 pruebas: 4507 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest` como en CI) | **893/893** (en esta corrida también pasó el archivo que a veces falla bajo carga, `supply-v2-slice9`). Las pruebas de margen y de mermas se repitieron después del último retoque de pantalla: 30/30 |
| Pruebas nuevas | 19 puras (`inventario-margen.test.ts`), 3 guardias nuevas (`inventario-permisos.test.ts`, ya 97; y una de 4b que se adaptó al refactor, más estricta), 19 contra PostgreSQL (`inventory-margen.db.test.ts`) y un recorrido E2E nuevo; el recorrido de `inventario-admin` ya cuenta 14 y su aserción del hub pasó de 4 a 5 informes (y a 4 sin `costos`) |
| E2E (`bun run e2e:limpio`, escritorio) | **75/75** en la corrida combinada final: `inventario-admin` (14), `comercio-experiencia`, `pedidos-membego`, `pos-membego`, `carrito-checkout`, `catalogo-admin`, `catalogo-api` y `catalogo-publico`. La primera corrida falló en el recorrido nuevo (ver abajo) |
| Mutaciones | 122 en tres capas: 114 detectadas a la primera y 8 sobrevivieron (5 pruebas o guardas débiles, 1 código muerto, 1 equivalente y 1 que solo ve la capa estática); ver abajo |

Qué cubre el recorrido E2E: el hub ofrece «Margen real» → el resumen (ingresos 600, costo 440 —lo vendido sin costo no suma—, margen
−40 con signo menos de verdad, −10,0 % y el aviso de las 5 unidades sin costo con lo que se cobró por ellas) → producto por producto de
lo que más margen dejó a lo que menos (con «Bajo el costo» y «5 sin costo») → lo reembolsado fuera del margen y a la vista → ordenar por
«menos margen primero» y buscar un producto → el CSV (el negativo como número, el filtro por producto, lo reembolsado) → la tarjeta del
dashboard (valor 2.620 con las 7 unidades sin costo, margen del mes, 3 unidades perdidas por 180) y su enlace al informe → y con
`costos` negada el informe avisa sin ninguna cifra, el archivo da 403 y la tarjeta enseña solo unidades.

Qué cubren las 19 pruebas contra PostgreSQL, **con el flujo real de pedidos** (crear → listo → completar por QR → reembolsar): el margen de
cada producto con descuento de línea, dos sucursales, bajo el costo, centavos y costos de cuatro decimales (exactos); lo vendido sin costo
(aparte, no como cero); los totales (la base excluye lo sin costo; el porcentaje sale del total, no del promedio de porcentajes); lo que no
entra —reembolsado devolviendo o sin devolver la mercancía, otra moneda, venta sin pedido, venta que cita un pedido con otro tipo de
referencia o donde el producto no tiene línea— y que la clase más informativa decide primero; una línea que el ledger vendió a medias; los
cinco órdenes y el orden fijo con empates; el rango (por defecto exactamente 30 días: hace 29 entra, hace 30 no; primer y último día en el
calendario de la empresa); los filtros (sucursal, nombre, SKU, código de barras, comodines, sucursal ajena); páginas y archivo con 52
productos; que los totales son exactamente la suma de las filas con cualquier filtro; el cambio de moneda de la empresa; el aislamiento
entre empresas; y la tarjeta del dashboard (valor, margen del mes, lo perdido, con y sin la función de costos; el límite del mes; una
empresa vacía).

Hallazgos de la propia verificación (importa que se sepan):

- **La primera corrida del E2E encontró un defecto real de la pantalla, no de la prueba**: el margen en dinero usaba el signo menos de verdad
  (`−40.00`) y el porcentaje negativo salía con un guion corto (`-10.0 %`), así que el mismo margen se leía distinto en una cifra y en la
  otra. Se corrigió con un formateador compartido (`formatearPorcentaje`) en la pantalla y en la tarjeta, con sus pruebas y sus mutaciones.
  En esa corrida 72 pasaron, 1 falló y 2 no llegaron a correr (iban detrás en el mismo archivo).
- **Mutaciones: 122.** Se ejecutaron 116 en tres capas (41 de lo puro, el CSV y los filtros; 48 de las lecturas contra PostgreSQL; 27 de las
  guardias estáticas, las pantallas y la tarjeta) y, al analizar los sobrevivientes, 6 más (el formateador del porcentaje y una de las
  guardias), que se detectaron todas. **Sobrevivieron 8 de las 116** (las pruebas de margen pasaron a la primera, y precisamente por eso se
  les buscó el hueco):
  - *5 eran pruebas o guardas débiles, ya reforzadas y detectadas*: nada probaba el orden de los empates (con empates idénticos el orden
    dependía de la base: ahora seis productos iguales creados al revés salen siempre por SKU en los cinco órdenes); el borde del rango por
    defecto (hace 29 días entra, hace 30 no: «31 días» pasaba); un pedido reembolsado que además está en otra moneda (la clase la decide el
    orden de las condiciones del SQL: ahora hay prueba y guarda); la moneda del archivo sin neutralizar contra fórmulas; y una guarda cuyo
    ancla («la lectura va dentro de `if (puedeCostos)`») se daba por buena aunque el ancla desapareciera.
  - *1 era código muerto*: el SQL de las filas calculaba una columna `base` que nadie leía (el margen y el porcentaje se calculan aparte).
    Se eliminó.
  - *1 equivalente*: quitar `o."id" IS NULL OR` de la clasificación no cambia nada, porque una línea no puede existir sin su pedido (clave
    foránea): si el pedido no existe tampoco hay línea, y esa otra condición ya lo manda a «ventas sin pedido». Se dejó como defensa.
  - *1 que solo ve la capa estática*: leer el costo en el total de lo perdido del dashboard «siempre» da el mismo resultado en ejecución
    (el valor se enmascara una segunda vez sin permiso), pero la guarda estática lo detecta y se comprobó en esa capa.
- **Una guarda de 4b se adaptó** al refactor de `mermas-queries.ts` (el `FROM` y el costo salieron a funciones que comparten el informe y la
  tarjeta): busca lo mismo en el sitio nuevo y ahora también exige que el total de lo perdido pida SU `conCostos`.
- **Una guardia de diseño que ya existía mandó**: la página, la tarjeta y el hub usan `BotonExportar`, `Alert`, `Badge` y los colores de
  tema, sin subir el techo de deuda de diseño.
- **La tabla de rutas del documento de separación se regeneró** (`bun run docs:rutas`): +1 página y +1 descarga del panel.
- En esta máquina el servidor de E2E imprime `TypeError: fetch failed` (Supabase Auth inexistente en el arnés): ruido previo, no afecta a los
  resultados.

### Lo que NO se verificó

Aspecto visual y móvil; un ledger grande; Supabase real; un pedido de otra moneda **cerrado de verdad** (la prueba lo completa en pesos y
cambia su moneda por SQL, porque cerrar un pedido en otra moneda depende de la cuenta Membego, que no es el asunto); la línea vendida a medias
(se fabrica por SQL: la aplicación no la produce); ventas del POS y de otros orígenes (siguen el mismo camino que las del marketplace, pero las
pruebas solo recorren el marketplace); y la tarjeta del dashboard en el E2E se alimenta sembrando filas, no con una venta real (el flujo real
sí está en las pruebas de PostgreSQL). Quedan fuera del margen, a propósito, las comisiones del marketplace, los impuestos y los gastos
(ver §23).

## 25. INV-5a · qué se hizo

> Primera parte de INV-5 (trazabilidad). **Lleva una migración, `20261068_inventory_lots`, y va ANTES que el código**: ESTE SQL PRIMERO en
> el SQL Editor de Supabase, después el despliegue. Con el SQL aplicado y el código viejo no pasa nada (los disparadores no hacen nada
> sobre un producto sin lotes y nadie activa lotes sin la pantalla nueva); con el código nuevo y **sin** el SQL, el inventario y los
> pedidos **fallan** (cada movimiento pregunta si el producto lleva lotes). `/api/health` avisa («DRIFT») si falta la tabla de repartos.
> Es aditiva, idempotente y de **una sola transacción** (todo o nada) con `lock_timeout = 5 s`: si no consigue un bloqueo falla sin dejar
> nada a medias y se reintenta. **Construye un índice único sobre `inventory_movements`** (destino de una clave foránea compuesta), que
> bloquea las ESCRITURAS del ledger mientras dura —segundos aun con cientos de miles de movimientos—: aplícala fuera de hora punta.
> Siguen pendientes de aplicar, si no lo están ya, `20261059`, `20261060`, `20261066` y `20261067`.

**El problema.** El inventario sabía CUÁNTO hay de cada producto en cada sucursal, no DE QUÉ LOTE es ni CUÁNDO VENCE. Para un producto
perecedero (cosméticos, alimentos, medicinas) eso es exactamente lo que importa: qué se vende primero, qué ya no se puede vender, y de qué
lote salió lo que un cliente devolvió.

**El modelo.** Un producto **lleva lotes** si se activan (por producto; una fila en `inventory_lot_tracking`). Entonces:

- **Lotes** (`inventory_lots`): un código por producto (sin distinguir mayúsculas: «lote a» y «LOTE A» son el mismo) y, si lo tiene, el
  **día** en que vence (fecha de calendario, sin hora ni zona: «vence el 31» es el 31). Un lote **no se edita**: ni su código ni su
  vencimiento. Cada producto con lotes tiene además **«SIN LOTE»**, que recibe lo que ya había al activar y lo que llega sin etiquetar.
- **Saldos por lote** (`inventory_lot_balances`): cuánto hay de cada lote en cada sucursal, en las mismas tres cubetas que el saldo de la
  sucursal (disponible+apartado, apartado, dañado).
- **Aperturas** (`inventory_lot_openings`): lo que había al activar, siempre en «SIN LOTE»: el saldo de partida.
- **Repartos** (`inventory_movement_lots`): cómo se reparte CADA movimiento del ledger entre lotes (un movimiento de 10 unidades puede
  salir 7 de un lote y 3 de otro). Append-only, como el ledger.

**La regla de oro: los saldos por lote los mantiene la BASE, no la aplicación.** Un saldo por lote nace en cero y solo se mueve con una
apertura o con un reparto: un disparador `AFTER INSERT` aplica cada uno con el mismo traslado de cubetas que usa el saldo de la sucursal
(`inventory_lot_efecto`, comprobada contra el dominio para los 13 traslados permitidos). Cualquier otro `UPDATE` de un contador se rechaza.
Así **saldo por lote = apertura + efecto de sus repartos**, siempre, y un error del servicio no puede hacerlos divergir.

**Y los lotes suman lo que hay.** Disparadores diferidos —se comprueban al terminar la transacción— vigilan que (a) la suma de los saldos
por lote de cada saldo de sucursal es igual a ese saldo, en las tres cubetas; (b) cada movimiento nuevo de un producto con lotes está
repartido por completo (la suma de su reparto es su cantidad); (c) un producto sin lotes no tiene saldos por lote; (d) un producto con
lotes tiene su «SIN LOTE»; (e) borrar la activación de un producto (solo se permite sin historial) no deja lotes atrás. Un script o una
puerta nueva que mueva stock sin repartirlo hace fallar la transacción. Cada comprobación RELEE
el saldo y suma con `COALESCE` (una suma `NULL` ni acepta ni rechaza: lo dejaría pasar).

**Cómo se comporta cada operación con un producto con lotes** (todo lo demás sigue igual para un producto sin lotes):

| Operación | De qué lote |
|---|---|
| **Entrada** (de varias líneas o de un producto) | Cada línea trae sus lotes: código, vencimiento (obligatorio si el producto lo exige) y cantidad; suman la de la línea. Los lotes que faltan se crean; «SIN LOTE» para lo que no trae. Un lote que ya existe con **otro vencimiento** se rechaza. Sin decir el lote, se rechaza |
| **Vender** | **FEFO**: primero el que antes vence, después los que no vencen; **lo vencido no se vende** (el último día todavía sí; el siguiente, no). Si no alcanza lo vendible, dice cuánto hay vencido |
| **Apartar** (reservar) | Por FEFO, igual que vender |
| **Liberar / vencer una reserva** | Vuelve a los **mismos** lotes de que se apartó (se deriva del ledger: no hay otra tabla que pueda contradecirlo) |
| **Cobrar una reserva** (completar un pedido) | Sale de los lotes en que se apartó. Si alguno **venció entretanto** no se entrega vencido: se libera y se aparta de nuevo del siguiente lote vigente; si no hay con qué reponerlo, la venta no se completa |
| **Devolver** (reembolso con devolución) | A los lotes de que salió **ese pedido**; lo que las ventas del pedido no explican (un pedido anterior a los lotes) va a «SIN LOTE» |
| **Dañar / dar de baja / recuperar / faltante** | El lote elegido (aunque esté vencido) o, sin elegir, el que antes vence |
| **Sobrante** | El lote que se diga (se crea si es nuevo) o «SIN LOTE» |
| **Mover entre lotes** | Un par de ajustes con el motivo del SISTEMA «Reasignación de lote» (`LOT_REASSIGN`): dejan rastro, valen lo mismo y **no cuentan como merma** (el informe de mermas los excluye y el motivo no sale en ningún selector) |
| **Barrido diario** (cron) | Las unidades **disponibles** de un lote vencido pasan a dañado con el motivo «Vencido». Lo apartado se resuelve al cobrar o al vencer su reserva |

**«Hoy» es el día de la EMPRESA**, no el del servidor: se calcula con la zona horaria de la empresa (a las 22:00 en Santo Domingo ya es el
día siguiente en UTC, y el lote que vence ese día todavía se vende). Las fechas viajan como texto `AAAA-MM-DD` de punta a punta.

**Concurrencia.** Cada operación sobre un saldo toma un candado de empresa **compartido** (muchas a la vez, sin estorbarse) **antes** de
bloquear los saldos; activar los lotes de un producto toma el **exclusivo**: espera a que terminen las operaciones en curso y no deja
entrar otras hasta confirmar. Sin él, una venta que decidió «este producto no lleva lotes» y una activación recién confirmada se
cruzarían. El orden es siempre el mismo (candado de empresa, saldos en orden de id): no hay ciclos.

**Activar es de UN SOLO SENTIDO** (decisión de esta parte; desactivar con historial dejaría repartos y saldos que ya no cuadran con nada). La
pantalla lo pide en dos pasos y lo dice. **No se activa** con un conteo abierto, una transferencia en tránsito o una orden de compra sin
cerrar que incluya el producto, ni con lo apartado descuadrado respecto a sus reservas vivas. Las reservas caducadas que nadie ha barrido se
vencen al activar, **después** de crear la activación y ya con su reparto (§26: hacerlo antes hacía fallar la activación). Lo que ya había (en todas las sucursales y las
tres cubetas) pasa íntegro a «SIN LOTE» como apertura. Un producto que NUNCA tuvo movimientos sí se limpia entero al borrar su variante.

**Lo que 5a NO hace (a propósito, para 5b).** Un producto con lotes **no se puede contar, transferir, pedir en una orden de compra ni
importar por CSV**: esos flujos todavía no reparten por lote y se niegan con un mensaje claro (en vez de descuadrarlo); se recibe con una
entrada de mercancía, que sí trae lotes. No hay informe ni aviso de «lo que vence pronto»; no se corrige el vencimiento de un lote (se mueven
sus unidades a otro); no se desactivan los lotes; no hay series, kits, API v1 ni rol de bodega.

**Pantallas.** *La ficha del producto*: si no lleva lotes y puedes ajustar, la tarjeta «Lotes y vencimiento» ofrece activarlos (con la casilla
«Exigir fecha de vencimiento en cada lote nuevo»); si los lleva, una **tabla de lotes por sucursal** de lo que antes vence a lo que no
(estado Vencido / Por vencer —30 días— / Vigente / No vence, con «Vence en 12 días»), y el formulario de movimientos pide el lote de lo que
entra (con sugerencias de los lotes que ya existen y el vencimiento bloqueado si el lote ya existe) y ofrece «De qué lote» en lo que sale
(automático por defecto), más el formulario «Mover unidades de un lote a otro». *La entrada de varias líneas*: cada producto con lotes trae
sus filas de lote (código, vencimiento, cantidad) y su total; el formulario aplica las mismas reglas del servidor antes de enviar. *El
historial de la ficha y el detalle de una entrada* dicen «Lotes: A-1 ×4, B ×2».

**Archivos.** Migración `prisma/migrations/20261068_inventory_lots/` (sellada en `SUMAS.txt`) y los cinco modelos en
`prisma/schema/inventario.prisma`; `modules/inventory/lotes.ts` (reglas puras) y `lotes-queries.ts` (lecturas); el servicio
(`service.ts`: `activarLotesEnTx`, `moverEntreLotesEnTx`, `vencerLotesEnTx`, el candado, las dos puertas del ledger y cada operación),
`barrido.ts`, `importar.ts`, `compras-service.ts` y `catalog/service.ts` (limpieza al borrar); las acciones y las pantallas
(`ActivarLotesCard`, `LotesDeSucursal`, `SucursalInventarioCard`, `EntradaMultipleForm`, la ficha, el historial y el detalle de entrada);
`scripts/e2e/base-limpia.mjs` (la base de E2E recibe los disparadores de lotes: sin ellos los saldos por lote no se moverían).

## 26. Verificación de INV-5a (2026-10-15)

Local, sobre PostgreSQL 16 desechable (collation ICU `en-US`). La migración `20261068` se aplicó **solo a bases desechables** (`supplytest`,
`membego_inv2` y las `membego_e2e_*`) con `psql`, como se hará a mano en Supabase; **no se tocó ninguna base real**. Sin Supabase real,
Vercel, móvil ni Safari: **no verificados**. **Tampoco se miró cómo se ven las pantallas** (la tabla de lotes, la tarjeta de activar, el
formulario de entrada con lotes): el E2E comprueba qué dicen y qué hacen, no su aspecto; ni capturas ni revisión visual en móvil.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (189 avisos, ninguno nuevo: son de `apps/client`) |
| `bun run build` (Turbopack) y `bun run presupuesto` | verdes; entrada compartida 859/1000 KB (86 %), trozo mayor 409/600 KB; indicador general 8.928/9.200 KB (97 %; 8.905 antes de 5a) |
| Unitarias (`bun run test`) | 4558 pruebas: 4551 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest`) | **937/937** con el código final |
| Pruebas nuevas | 27 puras (`inventario-lotes-puro.test.ts`), 14 guardias (`inventario-lotes.test.ts`), 3 más en archivos que ya existían (2 en `inventario-entradas.test.ts` —las líneas con lotes y su fusión— y 1 en `inventario-motivos.test.ts` —el motivo del sistema—), 13 del esquema contra PostgreSQL (`inventory-lotes-esquema.db.test.ts`), 31 del servicio (`inventory-lotes.db.test.ts`) y 3 recorridos E2E (`inventario-lotes.spec.ts`) |
| E2E (`node scripts/e2e/correr.mjs`, escritorio) | **17/17** con el build final: `inventario-admin` (14) y `inventario-lotes` (3). La primera corrida dio 16/17 (ver abajo) |
| Mutaciones | 162 en tres capas (ver abajo): 157 detectadas y 5 que sobreviven, todas explicadas |

Qué cubren las pruebas contra PostgreSQL. **Esquema (sin pasar por el servicio, a mano):** activar deja «SIN LOTE», saldos por lote en cero
y una apertura, y todo cuadra al cerrar; los saldos por lote solo los mueve la base, y se mueven igual que el saldo de la sucursal **para
cada uno de los 13 traslados de cubetas que el dominio permite**; los lotes suman lo que hay en las tres cubetas (un movimiento sin repartir,
de menos o de más, un saldo que cambia solo —disponible, dañado o apartado— o un reparto añadido después a un movimiento viejo hacen fallar
el cierre); ningún saldo por lote queda negativo ni con más apartado que existencias; las claves compuestas por producto y por empresa; la
inmutabilidad de repartos, aperturas y lotes; y la limpieza de un producto solo sin historial. **Servicio (con el flujo real de pedidos
incluido: crear → listo → completar por QR → reembolsar con devolución):** FEFO en cada operación, con una prueba de propiedades con
semilla que compara lo que hace la base con el plan puro; el último día vende y el siguiente no; apartar, liberar, vencer y cobrar una
reserva, también cuando su lote venció entretanto; devoluciones al lote de que salió el pedido (sin depender del nombre ni del orden de
creación de los lotes); daño, baja, ajuste y recuperar por lote; mover entre lotes con su clave de idempotencia; el barrido (y que vence
antes las reservas caducadas); «hoy» en la zona horaria de la empresa; los flujos que todavía no admiten lotes; las lecturas; y la
concurrencia: ventas simultáneas de la última unidad, activar mientras se vende, entradas simultáneas del mismo lote y el **candado de
empresa con compuertas** (sin depender de la suerte de una carrera).

Qué cubre el recorrido E2E: la ficha de un producto sin lotes los ofrece y su formulario no pide ninguno → activar se pide en dos pasos
(cancelar lo cierra) y desde ahí no hay conteo suelto ni transferencia → recibir exige el lote y con uno nuevo guarda su vencimiento; escribir
un lote que ya existe bloquea la fecha y dice cuándo vence → la tabla sale de lo que antes vence a lo que no, con su estado → dañar sin
decir el lote saca del que antes vence y no está vencido, y un faltante de más de lo que tiene el lote elegido avisa sin mover nada →
mover unidades entre lotes → el historial dice de qué lotes es cada movimiento y la reasignación **no** aparece en «Mermas por motivo» → una
entrada de varias líneas con un producto con lotes y otro sin ellos.

Hallazgos de la propia verificación (importa que se sepan):

- **Un defecto real, encontrado por una mutación sobreviviente: activar los lotes fallaba si el producto tenía una reserva caducada que
  nadie había barrido.** Al intentar matar la mutación «activar no vence las reservas caducadas» se escribió la prueba 31 (reservar con una
  hora de vida, activar una semana después) y falló con el código real: `activarLotesEnTx` vencía esa reserva ANTES de crear la activación,
  y el movimiento de liberación quedaba sin reparto; la base lo comprueba al cerrar, con el producto ya con lotes, y rechazaba toda la
  activación. Se corrigió venciendo las reservas **después** de crear la activación (su liberación ya trae su reparto y devuelve lo apartado
  a vendible). En producción lo habría visto quien activara un producto con una reserva abandonada.
- **Un hueco de idempotencia, también de una mutación:** mover entre lotes con la misma clave, la misma cantidad y el mismo origen pero OTRO
  destino se tomaba por un reintento. Ahora compara también el destino (y hay una prueba por cada combinación: otro origen, otro destino e
  intercambiados).
- **Un hueco del SQL, de otra mutación:** borrar solo la fila de activación de un producto sin historial dejaba sus lotes y saldos por lote
  de un producto «sin lotes» y ningún disparador lo veía (ninguno se dispara al borrar la activación). La migración lleva ahora un
  disparador diferido (`inventory_lot_tracking_sin_lotes_huerfanos`) que lo rechaza al cerrar; limpiar el producto entero, en cualquier orden
  dentro de la transacción, sigue pasando. Se incorporó a la misma migración, que no estaba aplicada en ninguna base real, y se volvió a sellar.
- **La primera corrida del E2E falló en el recorrido nuevo, por un error del spec y no del producto:** la entrada de varias líneas llega a
  la sucursal que el formulario trae elegida («Norte») y el spec miraba la tabla de «Principal». Con la sucursal correcta pasó, y se añadió que
  esos lotes **no** aparecen en la otra sucursal.
- **Mutaciones: 162.** Se ejecutaron 159 en tres capas (54 de las reglas puras, 45 de la migración —cada una aplicada a una base limpia
  de lo de lotes y probada con las dos pruebas de PostgreSQL— y 60 del servicio) y, al analizar los sobrevivientes, 3 más. De las 159,
  **132 se detectaron a la primera, 26 sobrevivieron y 1 estaba mal armada** (el reemplazo no era válido dentro de un bloque `DO`; se rehízo
  y se detectó). Lo que pasó con los 26:
  - *14 eran pruebas débiles y se reforzaron* (cada una con una prueba que antes no existía y que se comprobó contra su mutación): el
    disparador del reparto (solo lo ve un reparto añadido después que deja los saldos cuadrados), lo apartado en el cuadre, el legado con
    vencimiento, el saldo por lote negativo y con más apartado que existencias, el renglón de cantidad cero junto a uno bueno, el saldo por
    lote de otro producto o de otra empresa, el empate de FEFO (a igual día y antigüedad decide el código y luego el id), los dos candados de
    empresa, el orden de salida de las devoluciones, la clave de mover entre lotes, lotes indicados a un producto que no los lleva, el
    barrido con reservas caducadas y activar con reservas caducadas.
  - *6 las detecta solo una guardia que lee el texto del código*, no una ejecución: las dos «puertas» del ledger (`escribirMovimiento` y
    `escribirMovimientosPorLote`: exigen el reparto a un producto con lotes y lo prohíben a uno sin lotes; son funciones internas que ninguna
    ruta pública puede alimentar mal, y la base lo rechazaría igual al cerrar, como prueban las pruebas del esquema), el reparto de una
    reserva que resta lo ya liberado (hoy nada lo lee con liberaciones previas: se escribe y se consume en la misma transacción) y el límite
    «vence hoy» del barrido (con `<=` el barrido solo mira filas de más y el plan las descarta: igual de correcto en ejecución).
  - *1 la mata otra suite*, no la de lotes: la comprobación de stock al reservar un producto sin lotes (`inventory.db.test.ts`).
  - *5 son equivalentes o redundantes y se dejaron como defensa*: el **índice parcial que impide dos «SIN LOTE»** (la regla `legado` obliga a
    que el legado sea justo ese código y el índice único por producto y código ya impide un segundo); **un producto sin lotes con repartos**
    y **un saldo sin seguimiento con lotes** (inalcanzables: un reparto necesita un movimiento, y con movimientos la activación no se
    puede borrar; un saldo por lote necesita un lote y un lote no se crea sin activación; el disparador nuevo cierra el único camino que
    quedaba); que `asegurarLotes` vuelva a validar el código de un lote nuevo (ya lo validó `validarLotesDeLinea` antes de llegar); y la
    memoria por transacción de «este producto lleva lotes» (es solo rendimiento: sin ella se pregunta cada vez y el resultado es el mismo).
  - Las 3 mutaciones añadidas (los dos del disparador nuevo y el destino de la clave de mover) se detectaron todas.
- **Tres pruebas que ya existían se adaptaron** de forma legítima a lo que 5a añade, sin aflojarlas: la lista de acciones exportadas de
  `inventario-permisos.test.ts` (las dos acciones nuevas, `activarLotesInventario` y `moverEntreLotesInventario`), su línea de importación de
  `compras-service.ts` (ahora trae también el guardia `exigirSinLotes`) y la prueba de `inventory.db.test.ts` que intenta vaciar el ledger con
  `TRUNCATE` (ahora incluye la tabla de repartos, que también lo referencia).
- En esta máquina el servidor de E2E imprime `TypeError: fetch failed … 127.0.0.1:54329` (Supabase Auth inexistente en el arnés): ruido
  previo, no afecta a los resultados. El build imprime errores de conexión a `127.0.0.1:5432` al generar páginas estáticas (no hay base en
  esa dirección durante la compilación): también previos.

### Lo que NO se verificó

Aspecto visual y móvil. **Una base real**: ni Supabase ni el rol `membego_app` con las políticas de seguridad por fila sobre las tablas
nuevas (el mecanismo genérico de capas existe, pero no se probó contra ellas). **Cuánto tarda la migración con un ledger grande**: el índice
único sobre `inventory_movements` bloquea las escrituras mientras se construye y solo se probó con bases desechables. **Concurrencia real**:
las pruebas usan un solo proceso y una sola base local, no varias instancias del servidor ni la latencia de Supabase. **Las unidades
vencidas que el barrido diario aún no ha sacado cuentan como disponibles** en las cifras de existencia hasta que corra el cron (FEFO ya no
las vende, pero «disponible» las incluye). **Activar es de un solo sentido** (no hay «desactivar»): es una decisión de esta parte, no una
omisión. Para un producto con lotes siguen negados el conteo, la transferencia, la orden de compra y la importación por CSV (son 5b). El
E2E se corrió solo en escritorio. La API v1, la app móvil y el POS no usan todavía nada específico de lotes (las ventas del POS siguen el
mismo camino del servicio, pero las pruebas solo recorren el marketplace y el servicio).

## 27. INV-5b1 · qué se hizo

> Primera entrega de INV-5b («Lotes II»), que se parte en entregas más chicas (ver la hoja de ruta, §4). **Sin migración y sin permiso nuevo**:
> solo LEE las tablas de lotes de 5a, así que no hay SQL que aplicar antes de desplegar. Eso sí, **da por hecho que `20261068` ya está
> aplicada** (si no lo está, el informe no encuentra las tablas y la pantalla lo dice en vez de reventar).

**El problema.** Con 5a la empresa sabe de qué lote es cada unidad y cuándo vence, pero para enterarse de qué se le va a vencer tenía que
abrir la ficha de cada producto. Lo que una tienda necesita es la pregunta de arriba abajo: *qué se me vence y cuándo*.

**El informe «Vence pronto»** (`/admin/inventario/reportes/vencimientos`, en el hub de reportes). Cada fila es **un lote en una sucursal** con
existencias cuyo vencimiento ya pasó o cae dentro de la ventana que se elija (7, 15, **30**, 60 o 90 días; el último día de la ventana
entra). Va de lo que antes vence a lo que después (lo ya vencido, primero; a igual día, por nombre, SKU, lote y sucursal: el orden no
depende de la base). Cada fila dice el producto (con enlace a su ficha), la sucursal, el lote y su día, «Vence en 5 días» / «Vence hoy» /
«Venció hace 10 días» con su marca (vencido, urgente —7 días o menos— o por vencer) y tres cifras: lo **vendible** (lo que hay menos lo
apartado), lo **apartado** y lo **dañado**.

- *Qué cuenta y qué no.* Entran los lotes con existencias vendibles o apartadas. **No** entra lo que ya está dañado (ya salió de lo
  vendible: el barrido de 5a lo pasó ahí), ni un lote sin fecha de vencimiento, ni uno que vence más allá de la ventana. Un lote que vence
  **hoy** todavía se vende: sale como «por vencer», no como vencido (las mismas reglas con que vende el servicio).
- *«Hoy».* Es el día de la **empresa** (su zona horaria), no el del servidor: de noche en Santo Domingo ya es otro día en UTC.
- *Filtros.* La ventana, el estado (todos / por vencer / vencidos), el producto o el lote (nombre, SKU, código de barras o código de lote;
  los comodines del texto son texto) y la sucursal (si no es de la empresa, no filtra). Paginado de 50; los totales son de todo lo que cumple
  los filtros, no de la página: lotes distintos (un lote en dos sucursales cuenta una vez), cuántos ya vencieron y unidades vendibles.
- *Costos.* **Solo con la función `costos`**: con ella, cuánto dinero hay en riesgo (lo vendible por el costo promedio) y, aparte, las
  unidades sin costo conocido (no valen cero: no se sabe); sin ella la tabla de costos ni se une a la consulta y la pantalla no enseña dinero.
- *El archivo.* `exportar` descarga los lotes con **los mismos filtros** (misma función de lectura de la URL), hasta 20.000, con un bloque
  de alcance (ventana, filtros, zona horaria, «Datos completos: NO» si el tope lo cortó), los días restantes en negativo si ya venció, las
  celdas de costo vacías si no hay costo y los textos libres neutralizados contra fórmulas de hoja de cálculo. Se guarda solo
  (`requireSection('inventario')`): la función `costos` no es requisito para descargar, solo decide si el archivo lleva dinero.

**La tarjeta «Inventario» del dashboard** gana una cuarta cifra, «Vence pronto»: cuántos lotes (distintos) vencen en 30 días, cuántos de ellos
en 7 o menos, y cuántos ya vencieron y siguen con existencias; se pinta en aviso si hay urgentes o vencidos, y lleva al informe (directo a
los vencidos si los hay). **Solo se ofrece si la empresa lleva lotes** en algún producto; son conteos, no dinero, así que la ve quien ve
la tarjeta, con o sin `costos`.

**El aviso (`avisarVencimientos`, desde el barrido diario del cron).** Dos avisos a los administradores de la empresa, los dos sin repetirse:

| Aviso | Cuándo | Clave (no se repite) |
|---|---|---|
| **Lotes por vencer** | Hay lotes con existencias vendibles que vencen dentro de 30 días | Una vez por **semana ISO y nivel**: `lotes-por-vencer:empresa:2027-W24:normal` o `:urgente` |
| **Mercancía vencida** | El barrido acaba de sacar de lo vendible unidades de lotes vencidos | Una vez por **día**: `lotes-vencidos:empresa:2027-06-15` |

El nivel va en la clave a propósito, igual que el estado en el aviso de stock bajo: si el lunes avisó «por vencer» y el jueves un lote pasa a
vencer en menos de una semana, esa escalada tiene que avisar otra vez. Una empresa que no lleva lotes no recibe nada. Para que el aviso de
«por vencer» llegue **antes** de que algo venza, el barrido recorre ahora también las empresas con lotes dentro de la ventana de aviso (antes
solo las que ya tenían alguno vencido o una reserva caducada). Es best-effort y fuera de cualquier transacción de inventario: nunca lanza.

**Archivos.** `modules/inventory/vencimientos.ts` (reglas puras: la ventana, las clases, la urgencia, la semana ISO, los textos de los
avisos), `vencimientos-queries.ts` (el informe y el resumen: solo lecturas), `filtros.ts` y `exportacion.ts` (la URL y el CSV, junto a los
demás informes), `avisos.ts` y `barrido.ts` (el aviso), `dashboard.ts` y `components/admin/TarjetaInventario.tsx` (la cifra), y la página y
la descarga bajo `app/(admin)/admin/inventario/reportes/vencimientos/`. La tabla de rutas del documento de separación se regeneró
(`bun run docs:rutas`): +1 página y +1 descarga del panel.

**Lo que 5b1 NO hace (a propósito, para las siguientes entregas de 5b).** No corrige el vencimiento de un lote ni desactiva lotes; no
deja contar, transferir ni pedir en una orden de compra un producto con lotes (siguen negados con su mensaje); no manda correo ni push
(el aviso es la campana de siempre); y no hay ventana ni días de aviso configurables por empresa (30 días y 7 de urgencia, en el código).

## 28. Verificación de INV-5b1 (2026-10-15)

Local, sobre PostgreSQL 16 desechable. **INV-5b1 no trae migración ni SQL que aplicar**: lee las tablas de la `20261068` (INV-5a), que
sigue pendiente de aplicarse a mano en Supabase antes de desplegar este código. Se probó contra bases desechables (`supplytest`,
`membego_inv2`, `membego_e2e_inv2`); **no se tocó ninguna base real**. Sin Supabase real, Vercel, móvil ni Safari: **no verificados**.
**Tampoco se miró cómo se ven las pantallas** (el informe, la tarjeta del dashboard): el E2E comprueba qué dicen y qué hacen, no su
aspecto; ni capturas ni revisión visual en móvil.

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` / `bun run lint` | limpio / 0 errores (189 avisos, ninguno nuevo: son de `apps/client`) |
| `bun run build` y `bun run presupuesto` | verdes; entrada compartida 859/1000 KB (86 %), trozo mayor 409/600 KB; indicador general 8.928/9.200 KB (97 %, igual que tras 5a) |
| Unitarias (`bun run test`) | 4573 pruebas: 4566 pasan, 0 fallan, 7 omitidas heredadas |
| PostgreSQL (`bun run test:db`, base `supplytest`) | **948/948** (937 de antes + 11 nuevas) |
| Pruebas nuevas | 15 de reglas puras y guardias (`inventario-vencimientos.test.ts`), 11 contra PostgreSQL (`inventory-vencimientos.db.test.ts`) y 1 recorrido E2E (en `inventario-lotes.spec.ts`); el hub de reportes pasó de 5 a 6 informes en `inventario-admin.spec.ts` |
| E2E (`node scripts/e2e/correr.mjs`, escritorio) | **18/18** con el build final: `inventario-admin` (14) y `inventario-lotes` (4) |
| Mutaciones | 72 en dos capas (reglas y guardias rápidas, y PostgreSQL): 70 detectadas y 2 que sobreviven, ambas equivalentes |

Qué cubren las pruebas contra PostgreSQL: solo entran lotes con existencias (vendibles o apartadas) y con fecha, vencidos o dentro de la
ventana (el último día entra; el día siguiente, no; un lote sin fecha o «SIN LOTE» nunca); las unidades son lo vendible (lo dañado no
cuenta y lo apartado se enseña aparte); el orden va de lo que antes vence a lo que después, con desempate estable; los filtros de estado,
ventana, producto/SKU/código de barras/lote y sucursal; que el total y la paginación cuentan lotes por sucursal y no filas repetidas; que
una sucursal o un lote de **otra empresa** nunca entra, ni por filtro ni por un identificador ajeno en la URL; que **sin la función `costos` no se
lee ningún costo** (ni el valor, ni el promedio, ni la tabla de costos se une a la consulta) y con ella el valor sale de
`COALESCE(promedio del producto, costo del lote)` y lo que no tiene costo se cuenta aparte en vez de valer cero; el resumen del dashboard y
del aviso; y que «hoy» es el día de la zona horaria de la empresa.

Qué cubre el recorrido E2E: el hub de reportes ofrece «Vence pronto» → la lista saca de lo que antes vence a lo que después, con el estado,
los días («Venció hace 10 días», «Vence en 10 días»), la sucursal y lo vendible, apartado y dañado de cada lote → el producto lleva a su
ficha → los filtros acotan (estado, ventana, producto o lote, sucursal; «Quitar filtros» conserva la ventana) y una sucursal inventada no
filtra → el archivo trae lo mismo, con los días en negativo para lo vencido, el filtro dicho en su cabecera, y solo lo descarga quien
tiene permiso → la tarjeta de inventario del dashboard resume «2 lotes en 30 días, 1 ya vencido» y lleva directo a los vencidos.

Hallazgos de la propia verificación (importa que se sepan):

- **Un defecto real del producto, que encontró el E2E: tras «Quitar filtros» el formulario conservaba lo que se había elegido antes.** El
  enlace está dentro del formulario y navega de forma suave: React reutilizaba los campos y no aplicaba el nuevo valor por defecto, así que
  la lista volvía a mostrar todo pero el campo seguía diciendo «Vencidos» (o el texto buscado), y el siguiente «Filtrar» los volvía a
  mandar. Se corrigió con una `key` en el formulario (la consulta ya normalizada), para que se monte de nuevo cuando cambian los filtros.
  **Los demás informes de inventario (mermas, rotación, sin ventas, margen) y otras listas con el mismo patrón no se tocaron**: nacieron con
  el mismo formulario y es probable que tengan el mismo defecto; queda anotado para una entrega aparte.
- **Dos fallos del propio spec (no del producto):** leer la lista justo al cambiar la URL, cuando aún no había pintado nada (se pasó a
  esperas con reintento), y encadenar un formulario con el «Quitar filtros» anterior sin esperar a que terminara de navegar, con lo que el
  formulario viejo mandaba el texto de la búsqueda anterior (se añadieron las esperas a que el formulario vuelva a su valor vacío).
- **Pruebas mías que fallaron por equivocaciones de las pruebas:** el CSV usa `;` y no `,` como separador, el costo sale con dos
  decimales (`12.50`) y una ruta de importación estaba mal escrita. Ninguna era del código.
- **Mutaciones: 72, 70 detectadas.** Las 2 que sobreviven son equivalentes: quitar el recorte de espacios de la ventana (`Number(' 7 ')` ya
  vale 7, el recorte no cambia nada) y quitar `expiresOn IS NOT NULL` de la consulta (`NULL <= límite` ya excluye la fila: el filtro es
  redundante y se deja por claridad).

**Qué NO se verificó:** cómo se ve nada (ni escritorio con capturas, ni móvil); Supabase real, RLS o permisos de la base real (todo se
probó con el rol de la base desechable); el rendimiento con un ledger grande (las consultas leen los saldos por lote con los índices de
5a, pero no se midió con millones de filas); que el cron del barrido **corra de verdad en producción** y que el aviso llegue a la
campana de un administrador real (se probó llamando al barrido y leyendo la notificación, no con el cron desplegado); y el aviso de
correo o push, que no existe (es la campana de siempre).
