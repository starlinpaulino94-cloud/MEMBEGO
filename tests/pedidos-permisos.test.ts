import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CAPACIDAD_DE_SECCION, CAPACIDADES, CAPACIDADES_BASE, SECCIONES_POR_CAPACIDAD } from '../src/modules/capacidades/catalogo'
import { ADMIN_SECTIONS, adminSectionForPath, seccionPermitida } from '../src/lib/auth/permissions'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'
import { FUNCIONES_EMPRESA } from '../src/modules/plataforma/conceptos'

/**
 * COMMERCE CORE · pedidos Membego — sección, guardias y aislamiento (Fase 3).
 *
 * Aquí se comprueba el cableado y que cada acción autoriza ANTES de tocar la
 * base; el comportamiento contra la base está en `tests/postgres/orders.db.test.ts`.
 */

test('la capacidad PEDIDOS_MEMBEGO existe, gobierna la sección «pedidos-membego» y está encendida de serie en todas las categorías', () => {
  assert.ok((CAPACIDADES as readonly string[]).includes('PEDIDOS_MEMBEGO'))
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('pedidos-membego'))
  assert.deepEqual(SECCIONES_POR_CAPACIDAD.PEDIDOS_MEMBEGO, ['pedidos-membego', 'facturacion-membego', 'resultados-membego'], 'la misma capacidad gobierna «Mi cuenta Membego» (Fase 4)')
  assert.equal(CAPACIDAD_DE_SECCION['pedidos-membego'], 'PEDIDOS_MEMBEGO')
  assert.ok((FUNCIONES_EMPRESA as readonly string[]).includes('PEDIDOS_MEMBEGO'), 'una función de empresa se puede encender por override')
  for (const [categoria, base] of Object.entries(CAPACIDADES_BASE)) {
    assert.ok((base as readonly string[]).includes('PEDIDOS_MEMBEGO'), `${categoria} no la enciende de serie`)
  }
})

test('/admin/pedidos-membego resuelve a su sección, y los roles acotados (Marketing, Supervisión) no la ven; los plenos sí', () => {
  assert.equal(adminSectionForPath('/admin/pedidos-membego'), 'pedidos-membego')
  assert.equal(adminSectionForPath('/admin/pedidos-membego/abc123'), 'pedidos-membego')
  assert.equal(seccionPermitida('MARKETING', 'pedidos-membego', null), false)
  assert.equal(seccionPermitida('SUPERVISOR', 'pedidos-membego', null), false)
  assert.equal(seccionPermitida('ADMINISTRADOR', 'pedidos-membego', null), true)
})

const src = readFileSync('src/modules/orders/actions.ts', 'utf8')
const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('las funciones de permiso son gestionar, cancelar y reembolsar, y las tres se exigen de verdad', () => {
  const funciones = (FUNCIONES_POR_SECCION['pedidos-membego'] ?? []).map((f) => f.codigo)
  assert.deepEqual(funciones.sort(), ['cancelar', 'gestionar', 'reembolsar'])
  const usadas = new Set([...sinComentarios.matchAll(/contexto\('(\w+)'\)/g)].map((m) => m[1]))
  for (const f of funciones) assert.ok(usadas.has(f), `la función «${f}» está en el catálogo de permisos y ninguna acción la pide`)
})

test('todas las acciones del panel autorizan ANTES de tocar la base', () => {
  const exportadas = [...sinComentarios.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), [
    'aceptarPedido',
    'ajustarMontoPedido',
    'cancelarPedidoComoEmpresa',
    'marcarPedidoListo',
    'reembolsarPedido',
    'registrarPagoPedido',
  ])
  for (const nombre of exportadas) {
    const desde = sinComentarios.indexOf(`export async function ${nombre}`)
    const resto = sinComentarios.slice(desde)
    const cuerpo = resto.slice(0, resto.indexOf('\n}\n') + 3)
    const guardia = cuerpo.indexOf('await contexto(')
    const base = cuerpo.indexOf('conEmpresa(')
    assert.ok(guardia >= 0, `${nombre} no pide contexto()`)
    assert.ok(base < 0 || guardia < base, `${nombre} toca la base antes de autorizar`)
    assert.match(cuerpo, /if \('error' in c\) return \{ ok: false, error: c\.error \}/, `${nombre} no corta si la guardia falla`)
  }
})

test('contexto() exige la sección «pedidos-membego» y saca la empresa de la sesión, no de la entrada', () => {
  assert.match(sinComentarios, /requireSection\('pedidos-membego', funcion\)/)
  assert.match(sinComentarios, /resolveCompanyId\(user\)/)
  assert.doesNotMatch(sinComentarios, /companyId:\s*entrada/)
  assert.doesNotMatch(sinComentarios, /\bprisma\./, 'las acciones no usan el cliente global: todo va por conEmpresa')
  assert.doesNotMatch(sinComentarios, /e\.companyId|entrada\.companyId/)
  // El actor sale de la sesión: la empresa nunca puede hacerse pasar por el cliente.
  assert.match(sinComentarios, /actor: 'EMPRESA'/)
})

test('el panel de la empresa no crea pedidos, no confirma por el cliente ni cierra con el QR (esas puertas son del cliente y del escáner)', () => {
  for (const prohibida of ['crearPedidoEnTx', 'confirmarMontoEnTx', 'completarPorQrEnTx', 'renovarQrEnTx']) {
    assert.doesNotMatch(sinComentarios, new RegExp(`\\b${prohibida}\\b`), `${prohibida} no debe llamarse desde una acción del panel de la empresa`)
  }
})

test('el servicio filtra SIEMPRE por companyId (con la Capa 2 apagada es lo único que separa empresas)', () => {
  const s = readFileSync('src/modules/orders/service.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const consultas = [...s.matchAll(/tx\.(?:membego\w+|cliente|sucursal|catalogVariant|orderAttribution|customerConfirmation|paymentEvidence)\.(findFirst|findFirstOrThrow|findMany|count|updateMany|aggregate)\(\{([\s\S]*?)\}\)\n/g)]
  assert.ok(consultas.length >= 6, 'la expresión ya no encuentra consultas; revisa esta prueba')
  for (const [llamada, , cuerpo] of consultas) {
    assert.match(cuerpo, /companyId/, `una consulta no filtra por empresa → ${llamada.slice(0, 90)}…`)
  }
  assert.match(s, /"companyId" = \$\{companyId\}/, 'el SELECT … FOR UPDATE debe filtrar por empresa')
  assert.match(s, /FOR UPDATE/, 'toda mutación toma el candado de la fila')
})

test('el estado del pedido solo lo escribe el servicio de pedidos (nadie más hace `status:` sobre membego_orders)', () => {
  const recorrer = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? recorrer(`${dir}/${d.name}`) : /\.(ts|tsx)$/.test(d.name) ? [`${dir}/${d.name}`] : []))
  for (const archivo of recorrer('src')) {
    if (archivo === 'src/modules/orders/service.ts') continue
    const s = readFileSync(archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(s, /membegoOrder\.(update|updateMany|upsert|delete|deleteMany)\(/, `${archivo} escribe pedidos sin pasar por el servicio`)
    assert.doesNotMatch(s, /membegoOrderLine\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/, `${archivo} escribe líneas de pedido sin pasar por el servicio`)
    assert.doesNotMatch(s, /(?:orderAttribution|customerConfirmation|paymentEvidence)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/, `${archivo} escribe evidencia de pedidos sin pasar por el servicio`)
  }
})

test('Commerce Core no importa de supply-v2 ni del puente (la dependencia va en una sola dirección)', () => {
  for (const archivo of readdirSync('src/modules/orders').filter((f) => f.endsWith('.ts'))) {
    const s = readFileSync(`src/modules/orders/${archivo}`, 'utf8')
    for (const m of s.matchAll(/from\s+'([^']+)'/g)) assert.doesNotMatch(m[1], /supply/i, `orders/${archivo} importa de ${m[1]}`)
  }
})

test('el servicio usa el ledger de inventario para apartar, vender y liberar (nadie escribe el saldo directamente)', () => {
  const s = readFileSync('src/modules/orders/service.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(s, /inventoryLevel\.|inventoryMovement\.|inventoryReservation\./, 'los pedidos no tocan las tablas de inventario')
  for (const f of ['reservarEnTx', 'consumirReservaEnTx', 'liberarReservaEnTx', 'venderEnTx', 'devolverEnTx']) {
    assert.match(s, new RegExp(`\\b${f}\\b`), `el servicio no usa ${f}`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// F3.2 · interfaz, acciones del cliente, escáner y crons
// ═════════════════════════════════════════════════════════════════════════════

const leer = (f: string) => readFileSync(f, 'utf8')
const limpio = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('las entradas de menú existen: «Pedidos Membego» detrás de su capacidad (y en el hub de Comercio) y «Mis pedidos» para el cliente', () => {
  const nav = leer('src/components/layout/nav-config.ts')
  assert.match(nav, /href: '\/admin\/pedidos-membego',[\s\S]{0,600}capacidad: 'PEDIDOS_MEMBEGO'/)
  assert.match(nav, /deAdmin\(\s*'\/admin\/catalogo', '\/admin\/inventario', '\/admin\/pedidos-membego', '\/admin\/deals'/)
  assert.match(nav, /href: '\/cliente\/pedidos',\s*label: 'Mis pedidos'/)
  assert.match(leer('src/modules/navegacion/contexto.ts'), /'PEDIDOS_MEMBEGO'/)
  // «Mis pedidos» se oculta mientras ni la empresa recibe pedidos ni la persona tiene alguno.
  const nd = leer('src/modules/cliente/navDisponible.ts')
  assert.match(nd, /!activas\.has\('PEDIDOS_MEMBEGO'\) && pedidos === 0/)
})

test('las pantallas de /admin/pedidos-membego se guardan por sección en el layout y por empresa en cada página', () => {
  assert.match(leer('src/app/(admin)/admin/pedidos-membego/layout.tsx'), /guardarSeccion\('pedidos-membego'\)/)
  for (const pagina of ['page.tsx', '[pedidoId]/page.tsx']) {
    const s = limpio(`src/app/(admin)/admin/pedidos-membego/${pagina}`)
    assert.match(s, /requireRole\(ADMIN_ROLES\)/, `${pagina} sin guardia de rol`)
    assert.match(s, /requireCompanyContext\(user\)/, `${pagina} no resuelve la empresa de la sesión`)
    assert.doesNotMatch(s, /\bprisma\./, `${pagina} usa el cliente global`)
  }
  const detalle = limpio('src/app/(admin)/admin/pedidos-membego/[pedidoId]/page.tsx')
  assert.match(detalle, /notFound\(\)/, 'un pedido ajeno debe verse como inexistente')
  for (const f of ['gestionar', 'cancelar', 'reembolsar']) assert.match(detalle, new RegExp(`puedeFuncion\\('pedidos-membego', '${f}'\\)`))
})

test('los componentes de cliente de pedidos y el escáner NO importan el dominio, el servicio ni las lecturas (arrastrarían Prisma al navegador)', () => {
  const archivos = [...readdirSync('src/components/pedidos').map((f) => `src/components/pedidos/${f}`), 'src/components/scanner/ConfirmPedido.tsx']
  assert.ok(archivos.length >= 4)
  for (const f of archivos) {
    const imports = [...leer(f).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    for (const origen of imports) {
      assert.doesNotMatch(origen, /modules\/orders\/(domain|service|queries|cliente-queries|auditoria|errores|barrido|publico)$/, `${f} importa ${origen}`)
      assert.doesNotMatch(origen, /^@prisma\/client$|lib\/prisma$|lib\/commerce-primitives|modules\/catalog\/|modules\/inventory\/(?!actions)/, `${f} importa ${origen}`)
    }
  }
})

test('las acciones del cliente exigen sesión de cliente, deducen la empresa de la base y no aceptan canales de atribución verificables', () => {
  const s = limpio('src/modules/orders/cliente-actions.ts')
  assert.match(s, /async function clienteAutenticado/)
  assert.match(s, /user\.metadata\.role !== 'CLIENTE'/)
  const exportadas = [...s.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), ['cancelarMiPedido', 'confirmarMontoPedido', 'crearPedidoComoCliente', 'renovarQrDeMiPedido'])
  // La empresa sale de la variante pedida o del pedido propio; jamás de lo que mande el navegador.
  assert.doesNotMatch(s, /entrada\.companyId|\be\.companyId|companyId:\s*texto\(/)
  assert.match(s, /empresaRecibePedidos\(variante\.companyId\)/)
  // Solo canales sin dato que verificar.
  const canales = [...s.matchAll(/:\s*'(MARKETPLACE_BROWSE|MARKETPLACE_SEARCH|DIRECT|REFERRAL|CAMPAIGN|PROMOTION_CLAIM|QR_SCAN|SUPPLY_OFFER)'/g)].map((m) => m[1])
  assert.deepEqual([...new Set(canales)].sort(), ['DIRECT', 'MARKETPLACE_BROWSE', 'MARKETPLACE_SEARCH'])
  // Cada acción sobre un pedido ya existente lo busca entre MIS fichas antes de tocarlo.
  assert.match(s, /misClienteIds\(supabaseId\)/)
  assert.match(s, /customerId: \{ in: ids \}/)
  assert.doesNotMatch(s, /\bprisma\./)
})

test('crear un pedido desde la vitrina tiene tope de pedidos abiertos por cliente y empresa (freno contra apartar el stock sin recogerlo)', () => {
  const s = limpio('src/modules/orders/cliente-actions.ts')
  assert.match(s, /contarPedidosAbiertosEnTx\(tx, companyId, ficha\.clienteId\)\) >= MAX_PEDIDOS_ABIERTOS_POR_CLIENTE/)
  assert.match(s, /DEMASIADOS_PEDIDOS_ABIERTOS/)
  // El reintento del MISMO envío no cuenta contra el tope.
  assert.match(s, /!yaCreado &&/)
})

test('las lecturas del cliente filtran SIEMPRE por los ids de sus fichas', () => {
  const s = limpio('src/modules/orders/cliente-queries.ts')
  const consultas = [...s.matchAll(/tx\.membegoOrder\.(findFirst|findMany)\(\{([\s\S]*?)\n\s{4}\}\)/g)]
  assert.ok(consultas.length >= 2)
  for (const [, , cuerpo] of consultas) assert.match(cuerpo, /customerId: \{ in: \[\.\.\.clienteIds\] \}/)
  for (const pagina of ['page.tsx', '[id]/page.tsx']) {
    const p = limpio(`src/app/(cliente)/cliente/pedidos/${pagina}`)
    assert.match(p, /requireRole\('CLIENTE'\)/)
    assert.match(p, /misClienteIds\(user\.supabaseId\)/)
  }
  assert.match(limpio('src/app/(cliente)/cliente/pedidos/[id]/page.tsx'), /notFound\(\)/)
})

test('el QR del pedido solo cierra el pedido desde el escáner: rol de escáner, empresa del empleado y empresa del pedido sacada de la base', () => {
  const s = limpio('src/modules/orders/escaner-actions.ts')
  assert.match(s, /SCANNER_ROLES\.includes\(user\.metadata\.role\)/)
  assert.ok(s.indexOf('SCANNER_ROLES.includes') < s.indexOf('conEmpresa('), 'cierra antes de autorizar')
  // La empresa del pedido contra la de la sesión, FALLANDO CERRADO si la sesión no trae empresa (puedeOperarEnEmpresa).
  assert.match(s, /!puedeOperarEnEmpresa\(user, p\.companyId\)/)
  assert.match(s, /findUnique\(\{ where: \{ qrToken: limpio \}/)
  assert.doesNotMatch(s, /companyId:\s*(token|limpio|entrada)/)
  // Reconocer el QR en el escáner existente.
  const v = limpio('src/modules/visitas/actions.ts')
  assert.match(v, /buscarPedidoPorQr\(candidato\)/)
  assert.match(v, /!puedeOperarEnEmpresa\(user, encontrado\.companyId\)/)
  assert.match(leer('src/components/scanner/ScannerClient.tsx'), /<ConfirmPedido pedido=\{pedido\}/)
})

test('el cron de pedidos existe, está programado y exige el secreto antes de barrer', () => {
  const ruta = leer('src/app/api/cron/pedidos/route.ts')
  assert.ok(ruta.indexOf('autorizarCron(req)') >= 0 && ruta.indexOf('autorizarCron(req)') < ruta.indexOf('barridoPedidos()'))
  const vercel = JSON.parse(leer('vercel.json')) as { crons: { path: string; schedule: string }[] }
  assert.ok(vercel.crons.some((c) => c.path === '/api/cron/pedidos'))
})

test('la ficha pública ofrece «Pedir» solo para productos de la empresa y detrás de las capacidades; las ofertas de Supply van a su checkout', () => {
  // El cargador es uno solo y lo comparten la ficha de la landing y la de la app.
  const s = limpio('src/modules/comercio/ficha-item.ts')
  assert.match(s, /item\.origen === 'EMPRESA' \? await opcionesDePedidoPublico\(item\.company\.slug\) : null/)
  // La presentación solo pinta el bloque de compra si la empresa lo recibe; la compra de verdad es de la app.
  assert.match(limpio('src/components/catalogo/FichaDeItem.tsx'), /pedido\?\.habilitado && /)
  assert.match(limpio('src/components/catalogo/AccionesDeCompra.tsx'), /if \(!pedido\?\.habilitado\) return null/)
  const pub = limpio('src/modules/orders/publico.ts')
  assert.match(pub, /tieneCapacidad\(companyId, 'CATALOGO_UNIFICADO'\)/)
  assert.match(pub, /tieneCapacidad\(companyId, 'PEDIDOS_MEMBEGO'\)/)
  assert.match(pub, /isPublished: true, isActive: true, esDemo: false/)
})

test('el envoltorio de Supply vive en el puente (no en Commerce Core), solo lo corre el barrido y no toca la transacción de Supply', () => {
  const pedido = limpio('src/modules/supply-bridge/pedido.ts')
  assert.match(pedido, /from '@\/modules\/orders\/service'/)
  for (const m of pedido.matchAll(/from\s+'([^']+)'/g)) assert.doesNotMatch(m[1], /modules\/supply-v2/, `el envoltorio importa ${m[1]}`)
  const checkout = leer('src/modules/supply-v2/commerce/checkout.ts')
  assert.doesNotMatch(checkout, /supply-bridge|modules\/orders/, 'Supply no conoce el puente ni los pedidos')
  assert.match(limpio('src/modules/supply-bridge/barrido.ts'), /envolverCompraEnTx/)
})
