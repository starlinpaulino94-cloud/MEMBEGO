# Auditoría del módulo de inventario (Commerce Core · Fase 2)

> Fecha: 2026-10-13 · Alcance: `prisma/schema/inventario.prisma`, `src/modules/inventory/*`, las pantallas de
> `/admin/inventario`, sus consumidores (pedidos, checkout, POS, ofertas), el cron, las pruebas y la documentación.
> Se compara con el inventario del Car Wash (`ProductoInventario`), que es OTRO módulo.
>
> Estado de este documento: la auditoría es de antes de INV-1; cada hallazgo dice si **INV-1, INV-2a, INV-2b, INV-2c o INV-3a ya lo cerraron** (ver §5, §7, §9, §11 y §13).

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

No hay proveedores ni órdenes de compra en Commerce Core (el Car Wash sí: `Proveedor`, `OrdenCompra`, y recibir la orden
genera la entrada — es el modelo a seguir), ni punto de reorden, ni «qué comprar». La alerta de stock bajo es una lista
de problemas, no una propuesta de compra. → INV-3.

### 3.3 Valor del inventario

`CatalogVariant.cost` es un costo fijo; los movimientos no llevaban costo, así que no había costo promedio, valor del
inventario por sucursal, costo de ventas (COGS) ni mermas valorizadas. → **INV-3a ✔** (costo promedio ponderado, valor del
inventario, costo de ventas del mes y corrección de costo; ver §13). Sigue pendiente, en INV-4, el kardex valorizado y las
mermas valoradas por motivo.

### 3.4 Historial y reportes

| Falta | Hoy | Fase |
|---|---|---|
| Movimientos de toda la empresa | Solo había historial por variante | **INV-1 ✔** |
| Filtros del historial (tipo, fecha, sucursal, persona) | Solo «cargar más» | **INV-1 ✔** |
| Exportar | Nada se exportaba | **INV-1 ✔** (CSV) |
| Reservas vivas de la empresa | Solo por variante, máximo 50 | **INV-1 ✔** |
| Kardex valorizado, rotación, stock sin movimiento, mermas por motivo | `modules/reportes` tiene 20 reportes y ninguno es de inventario | INV-4 |

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
| INV-3b · Proveedores y órdenes de compra | Proveedores; orden de compra `OC-AAAA-NNNNNN` (Borrador → Pedida → Recibida en parte → Recibida, o Cancelada); recibir una orden crea una entrada con los costos de la orden; vínculo producto-proveedor con último costo y días de entrega | Proveedores/OC de Commerce Core | M | pendiente |
| INV-3c · Reposición | «Llenar hasta» por producto y sucursal; pantalla «Qué comprar» con la cantidad sugerida (descontando lo pedido y lo que va en camino), agrupada por proveedor, que crea órdenes en borrador | Campo en el saldo | S | pendiente |
| INV-4 · Reportes | Kardex valorizado, rotación y días de inventario, stock sin movimiento, mermas por motivo codificado, margen real; tarjeta de dashboard | Catálogo de motivos | M | pendiente |
| INV-5 · Trazabilidad | Lotes y vencimiento con FEFO; series; kits que descuentan componentes; API v1; rol de bodega | Lotes, kits | L por pieza | pendiente |

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

