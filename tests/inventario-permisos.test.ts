import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CAPACIDAD_DE_SECCION, CAPACIDADES_BASE, SECCIONES_POR_CAPACIDAD } from '../src/modules/capacidades/catalogo'
import { ADMIN_SECTIONS, adminSectionForPath, seccionPermitida } from '../src/lib/auth/permissions'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'

/**
 * COMMERCE CORE · inventario — sección, guardias y aislamiento (Fase 2).
 *
 * El inventario NO tiene capacidad propia: cuelga de CATALOGO_UNIFICADO (el
 * Plan Maestro lo activa con el catálogo). Aquí se comprueba el cableado y que
 * cada acción autoriza ANTES de tocar la base; el comportamiento contra la base
 * está en `tests/postgres/inventory.db.test.ts`.
 */

test('la sección «inventario» existe, cuelga de la capacidad del catálogo y /admin/inventario resuelve a ella', () => {
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('inventario'))
  assert.ok(SECCIONES_POR_CAPACIDAD.CATALOGO_UNIFICADO?.includes('inventario'))
  assert.equal(CAPACIDAD_DE_SECCION.inventario, 'CATALOGO_UNIFICADO')
  assert.equal(adminSectionForPath('/admin/inventario'), 'inventario')
  assert.equal(adminSectionForPath('/admin/inventario/abc123'), 'inventario')
  // El inventario del Car Wash (insumos) vive bajo `app` y no se confunde con éste.
  assert.notEqual(adminSectionForPath('/admin/app/carwash/inventario'), 'inventario')
})

test('sin capacidad propia: la que lo gobierna (el catálogo) está encendida de serie en todas las categorías', () => {
  for (const [categoria, base] of Object.entries(CAPACIDADES_BASE)) {
    assert.ok((base as readonly string[]).includes('CATALOGO_UNIFICADO'), `${categoria} no la enciende de serie`)
  }
})

test('los roles acotados (Marketing, Supervisión) no ven el inventario; los plenos sí', () => {
  assert.equal(seccionPermitida('MARKETING', 'inventario', null), false)
  assert.equal(seccionPermitida('SUPERVISOR', 'inventario', null), false)
  assert.equal(seccionPermitida('ADMINISTRADOR', 'inventario', null), true)
})

const src = readFileSync('src/modules/inventory/actions.ts', 'utf8')
const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('las funciones de permiso son «ajustar» y «transferir», y las dos se exigen de verdad', () => {
  const funciones = (FUNCIONES_POR_SECCION.inventario ?? []).map((f) => f.codigo)
  assert.deepEqual(funciones.sort(), ['ajustar', 'transferir'])
  const usadas = new Set([...sinComentarios.matchAll(/contexto\('(\w+)'\)/g)].map((m) => m[1]))
  for (const m of sinComentarios.matchAll(/operar\(\s*'(\w+)'/g)) usadas.add(m[1])
  for (const f of funciones) assert.ok(usadas.has(f), `la función «${f}» está en el catálogo de permisos y ninguna acción la pide`)
})

test('todas las acciones exportadas autorizan ANTES de tocar la base', () => {
  const exportadas = [...sinComentarios.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), [
    'ajustarInventario',
    'cargarMasHistorialInventario',
    'contarInventario',
    'fijarUmbralInventario',
    'registrarDanoInventario',
    'registrarDevolucionInventario',
    'registrarEntradaInventario',
    'resolverDanadoInventario',
    'transferirInventario',
  ])
  for (const nombre of exportadas) {
    const desde = sinComentarios.indexOf(`export async function ${nombre}`)
    const resto = sinComentarios.slice(desde)
    const cuerpo = resto.slice(0, resto.indexOf('\n}\n') + 3)
    // Las que delegan en `operar` heredan su guardia; el resto la piden aquí.
    if (/return operar\(/.test(cuerpo)) continue
    const guardia = cuerpo.indexOf('await contexto(')
    const base = cuerpo.indexOf('conEmpresa(')
    assert.ok(guardia >= 0, `${nombre} no pide contexto()`)
    assert.ok(base < 0 || guardia < base, `${nombre} toca la base antes de autorizar`)
    assert.match(cuerpo, /if \('error' in c\) return \{ ok: false, error: c\.error \}/, `${nombre} no corta si la guardia falla`)
  }
  const operar = sinComentarios.slice(sinComentarios.indexOf('async function operar('))
  const cuerpoOperar = operar.slice(0, operar.indexOf('\n}\n') + 3)
  assert.ok(cuerpoOperar.indexOf('await contexto(funcion)') < cuerpoOperar.indexOf('conEmpresa('), 'operar() toca la base antes de autorizar')
})

test('contexto() exige la sección «inventario» y saca la empresa de la sesión, no de la entrada', () => {
  assert.match(sinComentarios, /requireSection\('inventario', funcion\)/)
  assert.match(sinComentarios, /resolveCompanyId\(user\)/)
  assert.doesNotMatch(sinComentarios, /companyId:\s*entrada/)
  assert.doesNotMatch(sinComentarios, /\bprisma\./, 'las acciones no usan el cliente global: todo va por conEmpresa')
  // Lo que cruza al servicio es la empresa de la sesión, jamás una de la entrada.
  assert.doesNotMatch(sinComentarios, /e\.companyId|entrada\.companyId/)
})

test('el navegador no puede vender ni reservar: esas operaciones no son acciones del panel', () => {
  for (const prohibida of ['venderEnTx', 'reservarEnTx', 'consumirReservaEnTx', 'liberarReservaEnTx', 'vencerReservasEnTx']) {
    assert.doesNotMatch(sinComentarios, new RegExp(`\\b${prohibida}\\b`), `${prohibida} no debe llamarse desde una acción de panel`)
  }
})

test('el servicio y las lecturas filtran SIEMPRE por companyId (con la Capa 2 apagada es lo único que separa empresas)', () => {
  for (const archivo of ['service.ts', 'queries.ts']) {
    const s = readFileSync(`src/modules/inventory/${archivo}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const consultas = [...s.matchAll(/tx\.(?:inventory\w+|catalogVariant|sucursal)\.(findFirst|findFirstOrThrow|findMany|count|updateMany|aggregate)\(\{([\s\S]*?)\}\)\n/g)]
    assert.ok(consultas.length > 3, `${archivo}: la expresión ya no encuentra consultas; revisa esta prueba`)
    for (const [llamada, , cuerpo] of consultas) {
      assert.match(cuerpo, /companyId/, `${archivo}: una consulta no filtra por empresa → ${llamada.slice(0, 80)}…`)
    }
  }
  const service = readFileSync('src/modules/inventory/service.ts', 'utf8')
  assert.match(service, /"companyId" = \$\{companyId\}/, 'el SELECT … FOR UPDATE debe filtrar por empresa')
  assert.match(service, /n\.companyId !== companyId/, 'obtenerNivel debe verificar la empresa del saldo')
})

test('toda escritura al saldo pasa por escribirMovimiento: nadie más toca onHand, reserved ni damaged', () => {
  const s = readFileSync('src/modules/inventory/service.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const escrituras = [...s.matchAll(/tx\.inventoryLevel\.(update|updateMany|upsert)\(\{([\s\S]*?)\}\)/g)]
  const tocanSaldo = escrituras.filter(([, , cuerpo]) => /onHand|reserved|damaged/.test(cuerpo))
  assert.equal(tocanSaldo.length, 1, 'solo escribirMovimiento actualiza los contadores')
  const dentro = s.slice(s.indexOf('async function escribirMovimiento'), s.indexOf('async function cerrarReserva'))
  assert.match(dentro, /tx\.inventoryLevel\.update\(\{ where: \{ id: nivelId \}, data: \{ onHand/)
  assert.doesNotMatch(s, /inventoryMovement\.(update|updateMany|delete|deleteMany|upsert)/, 'el ledger es append-only')
})

test('Commerce Core no importa de supply-v2, y el catálogo no importa del inventario (la dependencia va en una sola dirección)', () => {
  for (const archivo of readdirSync('src/modules/inventory').filter((f) => f.endsWith('.ts'))) {
    const s = readFileSync(`src/modules/inventory/${archivo}`, 'utf8')
    for (const m of s.matchAll(/from\s+'([^']+)'/g)) assert.doesNotMatch(m[1], /supply/i, `${archivo} importa de ${m[1]}`)
  }
  for (const archivo of readdirSync('src/modules/catalog').filter((f) => f.endsWith('.ts'))) {
    const s = readFileSync(`src/modules/catalog/${archivo}`, 'utf8')
    for (const m of s.matchAll(/from\s+'([^']+)'/g)) assert.doesNotMatch(m[1], /modules\/inventory/, `catalog/${archivo} importa del inventario: ${m[1]}`)
  }
})

test('el cron del inventario existe, está programado y exige el secreto', () => {
  const ruta = readFileSync('src/app/api/cron/inventario/route.ts', 'utf8')
  assert.match(ruta, /autorizarCron\(req\)/)
  assert.ok(ruta.indexOf('autorizarCron(req)') < ruta.indexOf('barridoInventario()'), 'barre antes de autorizar')
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[] }
  assert.ok(vercel.crons.some((c) => c.path === '/api/cron/inventario'))
})

test('la entrada de menú existe, detrás de la capacidad, y va junto al catálogo en el grupo Comercio del hub', () => {
  const nav = readFileSync('src/components/layout/nav-config.ts', 'utf8')
  assert.match(nav, /href: '\/admin\/inventario',[\s\S]{0,500}capacidad: 'CATALOGO_UNIFICADO'/)
  assert.match(nav, /deAdmin\(\s*'\/admin\/catalogo', '\/admin\/inventario',/)
})

// ── Interfaz ─────────────────────────────────────────────────────────────────

test('los componentes de cliente del inventario NO importan el dominio, el servicio ni las lecturas (arrastrarían Prisma al navegador)', () => {
  const dir = 'src/components/inventario'
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.tsx'))
  assert.ok(archivos.length >= 3)
  for (const f of archivos) {
    const s = readFileSync(`${dir}/${f}`, 'utf8')
    const imports = [...s.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    for (const origen of imports) {
      assert.doesNotMatch(origen, /modules\/inventory\/(domain|service|queries|auditoria|errores|barrido)$/, `${f} importa ${origen}`)
      assert.doesNotMatch(origen, /^@prisma\/client$|lib\/prisma$|lib\/commerce-primitives|modules\/catalog\//, `${f} importa ${origen}`)
    }
  }
})

test('las pantallas de /admin/inventario se guardan por sección en el layout y por empresa en cada página', () => {
  const layout = readFileSync('src/app/(admin)/admin/inventario/layout.tsx', 'utf8')
  assert.match(layout, /guardarSeccion\('inventario'\)/)
  for (const pagina of ['page.tsx', '[varianteId]/page.tsx']) {
    const s = readFileSync(`src/app/(admin)/admin/inventario/${pagina}`, 'utf8')
    assert.match(s, /requireRole\(ADMIN_ROLES\)/, `${pagina} sin guardia de rol`)
    assert.match(s, /requireCompanyContext\(user\)/, `${pagina} no resuelve la empresa de la sesión`)
    assert.doesNotMatch(s, /\bprisma\./, `${pagina} usa el cliente global`)
  }
  const detalle = readFileSync('src/app/(admin)/admin/inventario/[varianteId]/page.tsx', 'utf8')
  assert.match(detalle, /notFound\(\)/, 'una variante ajena debe verse como inexistente')
  // Las formas se ocultan a quien no tiene la función (la acción igual lo rechazaría).
  assert.match(detalle, /puedeFuncion\('inventario', 'ajustar'\)/)
  assert.match(detalle, /puedeFuncion\('inventario', 'transferir'\)/)
})

test('la sucursal de la URL solo vale si es de esta empresa', () => {
  const lista = readFileSync('src/app/(admin)/admin/inventario/page.tsx', 'utf8')
  assert.match(lista, /sucursales\.find\(\(s\) => s\.id === sp\.sucursal\)/)
})
