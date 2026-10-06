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

test('la capacidad PEDIDOS_MEMBEGO existe, gobierna la sección «pedidos-membego» y está apagada de serie en todas las categorías', () => {
  assert.ok((CAPACIDADES as readonly string[]).includes('PEDIDOS_MEMBEGO'))
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('pedidos-membego'))
  assert.deepEqual(SECCIONES_POR_CAPACIDAD.PEDIDOS_MEMBEGO, ['pedidos-membego'])
  assert.equal(CAPACIDAD_DE_SECCION['pedidos-membego'], 'PEDIDOS_MEMBEGO')
  assert.ok((FUNCIONES_EMPRESA as readonly string[]).includes('PEDIDOS_MEMBEGO'), 'una función de empresa se puede encender por override')
  for (const [categoria, base] of Object.entries(CAPACIDADES_BASE)) {
    assert.ok(!(base as readonly string[]).includes('PEDIDOS_MEMBEGO'), `${categoria} la enciende de serie`)
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
