# Auditoría del módulo de inventario (Commerce Core · Fase 2)

> Fecha: 2026-10-13 · Alcance: `prisma/schema/inventario.prisma`, `src/modules/inventory/*`, las pantallas de
> `/admin/inventario`, sus consumidores (pedidos, checkout, POS, ofertas), el cron, las pruebas y la documentación.
> Se compara con el inventario del Car Wash (`ProductoInventario`), que es OTRO módulo.
>
> Estado de este documento: la auditoría es de antes de INV-1; cada hallazgo dice si **INV-1 ya lo cerró** (ver §5).

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
| Recepción de mercancía múltiple | Una variante, una sucursal, un formulario por vez | Una factura trae 20–50 líneas: son 20–50 envíos | INV-2 |
| Importar existencias (CSV) | No existe | Abrir una tienda con 300 SKU es imposible a mano | INV-2 |
| Sesión de conteo físico por sucursal | Conteo de una variante a la vez | Un inventario real recorre toda la tienda y necesita informe de varianza | INV-2 |
| Transferencias con estado | Inmediatas (salen y entran en la misma transacción) | Entre sucursales reales pasan horas o días: falta «enviada → recibida» y recepción parcial | INV-2 |
| Búsqueda por código de barras | La lista buscaba por nombre y SKU; la variante ya tiene `barcode` | El lector es la forma normal de encontrar un producto en bodega | **INV-1 ✔** |

### 3.2 Compras y reposición

No hay proveedores ni órdenes de compra en Commerce Core (el Car Wash sí: `Proveedor`, `OrdenCompra`, y recibir la orden
genera la entrada — es el modelo a seguir), ni punto de reorden, ni «qué comprar». La alerta de stock bajo es una lista
de problemas, no una propuesta de compra. → INV-3.

### 3.3 Valor del inventario

`CatalogVariant.cost` es un costo fijo; los movimientos no llevan costo, así que no hay costo promedio, valor del
inventario por sucursal, costo de ventas (COGS) ni mermas valorizadas. → INV-3 / INV-4.

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
| INV-2 · Operación en volumen | Documento de entrada con varias líneas y referencia; importación CSV de existencias y conteos; sesión de conteo por sucursal con informe de varianza; transferencias con estado | `InventoryDocument`/líneas, `InventoryTransfer`, `InventoryCountSession` | L | pendiente |
| INV-3 · Compras y costo | Proveedores y órdenes de compra; costo unitario en entradas; costo promedio ponderado y valor del inventario; COGS; punto de reorden y lista de qué comprar | Proveedores/OC de Commerce Core; `unitCost` en movimientos | L | pendiente |
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
