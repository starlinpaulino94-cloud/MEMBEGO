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

// ── INV-1 · visibilidad ──────────────────────────────────────────────────────

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinComent = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('INV-1 · las pantallas nuevas (movimientos, reservas) se guardan como las demás: rol, empresa de la sesión y nada de cliente global', () => {
  for (const pagina of ['movimientos/page.tsx', 'reservas/page.tsx']) {
    const s = sinComent(leer(`src/app/(admin)/admin/inventario/${pagina}`))
    assert.match(s, /requireRole\(ADMIN_ROLES\)/, `${pagina} sin guardia de rol`)
    assert.match(s, /requireCompanyContext\(user\)/, `${pagina} no resuelve la empresa de la sesión`)
    assert.match(s, /conEmpresa\(companyId/, `${pagina} no lee dentro de conEmpresa`)
    assert.doesNotMatch(s, /\bprisma\./, `${pagina} usa el cliente global`)
    assert.doesNotMatch(s, /searchParams[\s\S]{0,80}companyId|sp\.companyId|sp\.empresa/, `${pagina} toma la empresa de la URL`)
  }
  // Tres vistas, un solo menú: las tres pantallas de la empresa lo llevan.
  assert.match(leer('src/app/(admin)/admin/inventario/page.tsx'), /<NavegacionInventario actual="existencias"/)
  assert.match(leer('src/app/(admin)/admin/inventario/movimientos/page.tsx'), /<NavegacionInventario actual="movimientos"/)
  assert.match(leer('src/app/(admin)/admin/inventario/reservas/page.tsx'), /<NavegacionInventario actual="reservas"/)
})

test('INV-1 · la sucursal de la URL de movimientos solo vale si es de esta empresa', () => {
  const s = leer('src/app/(admin)/admin/inventario/movimientos/page.tsx')
  assert.match(s, /sucursales\.find\(\(s\) => s\.id === filtros\.sucursalId\)/)
})

test('INV-1 · la exportación se guarda SOLA (un route handler no pasa por el layout) y lee la URL igual que la pantalla', () => {
  const s = sinComent(leer('src/app/(admin)/admin/inventario/movimientos/exportar/route.ts'))
  assert.match(s, /requireSection\('inventario'\)/)
  assert.ok(s.indexOf("requireSection('inventario')") < s.indexOf('conEmpresa('), 'autoriza ANTES de tocar la base')
  assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/)
  assert.match(s, /resolveCompanyId\(user\)/, 'la empresa sale de la sesión')
  assert.doesNotMatch(s, /get\('companyId'\)|get\('empresa'\)|searchParams\.get\('company/, 'jamás de la URL')
  assert.match(s, /leerFiltrosMovimientos\(/, 'la MISMA función que la pantalla: el CSV exporta lo que se ve')
  assert.match(s, /limite: TOPE_FILAS_MOVIMIENTOS/)
  assert.match(s, /truncado: r\.pagina\.siguiente !== null/, 'si el tope corta, el archivo lo dice')
  assert.match(s, /sucursales\.find\(\(s\) => s\.id === filtros\.sucursalId\)/, 'una sucursal ajena no filtra')
  assert.doesNotMatch(s, /\bprisma\./)
})

test('INV-1 · las lecturas nuevas filtran por empresa, también las que el guardia general no ve', () => {
  const q = sinComent(leer('src/modules/inventory/queries.ts'))
  const usuarios = q.slice(q.indexOf('export async function usuariosParaFiltroEnTx'))
  assert.match(usuarios.slice(0, 400), /where: \{ companyId, role: \{ not: 'CLIENTE' \} \}/, 'solo el equipo de ESTA empresa, nunca clientes')
  const movs = q.slice(q.indexOf('export async function movimientosEmpresaEnTx'), q.indexOf('export interface UsuarioOpcion'))
  assert.match(movs, /where: \{\s*companyId,/, 'los movimientos se leen de esta empresa')
  assert.match(movs, /take: limite \+ 1/, 'se pide una de más para saber si hay otra página')
  assert.match(q, /Math\.min\(opciones\.limite \?\? POR_PAGINA_MOVIMIENTOS, 10_000\)/, 'el límite está acotado')
  const sucursales = q.slice(q.indexOf('export async function sucursalesDeLaEmpresaEnTx'))
  assert.match(sucursales, /where: \{ companyId \}/)
})

test('INV-1 · el aviso de stock bajo cubre el POS y todo movimiento manual que baja lo vendible', () => {
  // Acciones del panel: daño, ajuste faltante, transferencia (origen) y conteo a la baja.
  assert.match(sinComentarios, /import \{ avisarStockBajo \} from '\.\/avisos'/)
  assert.match(sinComentarios, /import \{ after \} from 'next\/server'/)
  assert.match(sinComentarios, /function avisarTrasBajar\(companyId: string, varianteId: unknown\)[\s\S]*?after\(\(\) => avisarStockBajo\(companyId, \[varianteId\]\)\)/, 'el aviso va en after(): no se pierde al terminar la respuesta')
  assert.doesNotMatch(sinComentarios, /void avisarStockBajo/, 'un `void` suelto puede perderse cuando la respuesta termina')
  const dano = sinComentarios.slice(sinComentarios.indexOf('export async function registrarDanoInventario'))
  assert.match(dano.slice(0, 700), /\(\) => true\n\s*\)/, 'un daño siempre baja lo vendible')
  const ajuste = sinComentarios.slice(sinComentarios.indexOf('export async function ajustarInventario'))
  assert.match(ajuste.slice(0, 700), /e\.cambio < 0/, 'un ajuste solo avisa si es faltante')
  const conteo = sinComentarios.slice(sinComentarios.indexOf('export async function contarInventario'))
  assert.match(conteo.slice(0, 900), /if \(r\.diferencia < 0\) avisarTrasBajar/, 'un conteo avisa solo si bajó')
  const transferencia = sinComentarios.slice(sinComentarios.indexOf('export async function transferirInventario'))
  assert.match(transferencia.slice(0, 1200), /if \(!r\.repetido\) avisarTrasBajar/, 'una transferencia repetida no avisa otra vez')
  // Una entrada, una devolución o resolver lo dañado NO bajan lo vendible: no llaman al aviso.
  for (const nombre of ['registrarEntradaInventario', 'registrarDevolucionInventario', 'resolverDanadoInventario']) {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf(`export async function ${nombre}`)).split('\n}\n')[0]
    assert.doesNotMatch(cuerpo, /avisar|=> true/, `${nombre} no baja lo vendible`)
  }
  // El aviso nunca se espera ni puede deshacer el movimiento.
  assert.doesNotMatch(sinComentarios, /await avisarStockBajo/)

  const pos = sinComent(leer('src/modules/pos/actions.ts'))
  assert.match(pos, /import \{ avisarStockBajo \} from '@\/modules\/inventory\/avisos'/)
  assert.match(pos, /import \{ after \} from 'next\/server'/)
  assert.match(pos, /if \(!venta\.repetido\) after\(\(\) => avisarStockBajo\(c\.companyId, lineas\.map\(\(l\) => l\.varianteId\)\)\)/, 'venta de mostrador')
  assert.match(pos, /after\(async \(\) => avisarStockBajo\(c\.companyId, await variantesDelPedido\(c\.companyId, cobro\.pedidoId\)\)\)/, 'cobro de un pedido en caja')
  assert.doesNotMatch(pos, /void avisarStockBajo|void \(async \(\) => avisarStockBajo/, 'un aviso suelto con void puede perderse al terminar la respuesta')
})

test('INV-1 · la clave del aviso lleva el estado, para que AGOTADO avise aunque «Stock bajo» ya avisara hoy', () => {
  const s = sinComent(leer('src/modules/inventory/avisos.ts'))
  assert.match(s, /dedupeKey: `stock-bajo:\$\{n\.id\}:\$\{dia\}:\$\{estado\}`/)
})

test('INV-1 · el umbral en varias sucursales extiende la acción existente (no hay acción nueva) y exige la misma función', () => {
  const umbral = sinComentarios.slice(sinComentarios.indexOf('export async function fijarUmbralInventario'))
  const cuerpo = umbral.slice(0, umbral.indexOf('\n}\n') + 3)
  assert.match(cuerpo, /await contexto\('ajustar'\)/)
  assert.match(cuerpo, /entrada\.aplicarAOtras === true/)
  assert.match(cuerpo, /configurarUmbralOtrasSucursalesEnTx\(tx, c\.companyId,/, 'todo en la MISMA transacción y con la empresa de la sesión')
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  const otras = svc.slice(svc.indexOf('export async function configurarUmbralOtrasSucursalesEnTx'))
  assert.match(otras, /where: \{ companyId, catalogVariantId: variante\.id, locationId: \{ not: e\.sucursalOrigenId \}, location: \{ activa: true \} \}/, 'solo sucursales activas con saldo, de esta empresa')
  assert.doesNotMatch(otras, /obtenerNivel\(/, 'no crea saldos en cero donde el producto nunca estuvo')
})

test('INV-1 · la lista salta a la ficha solo con coincidencia exacta, y el salto queda FUERA del try (redirect lanza)', () => {
  const s = sinComent(leer('src/app/(admin)/admin/inventario/page.tsx'))
  assert.match(s, /if \(q && datos\?\.lista\.varianteExacta\) redirect\(`\/admin\/inventario\/\$\{datos\.lista\.varianteExacta\}`\)/)
  assert.ok(s.indexOf('redirect(`/admin/inventario/') > s.lastIndexOf('} catch (e) {'), 'el redirect va después del catch')
  assert.match(s, /advertenciaEstadoManual\(f\.estadoVariante, f\.disponible\)/, 'la lista advierte del estado manual')
  assert.match(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'), /advertenciaEstadoManual\(detalle\.estadoVariante, total\.disponible\)/)
})

test('INV-1 · los componentes nuevos del inventario no arrastran el servidor al navegador', () => {
  const nav = leer('src/components/inventario/NavegacionInventario.tsx')
  assert.doesNotMatch(nav, /'use client'/, 'son tres enlaces: componente de servidor')
  assert.doesNotMatch(nav, /@prisma\/client|lib\/prisma|modules\/inventory/)
  // `formato.ts` y `filtros.ts` los importan las pantallas y las pruebas: tienen que seguir siendo puros.
  for (const archivo of ['formato.ts', 'filtros.ts', 'exportacion.ts']) {
    const s = leer(`src/modules/inventory/${archivo}`)
    assert.doesNotMatch(s, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'/, `${archivo} debe seguir siendo puro`)
  }
})
