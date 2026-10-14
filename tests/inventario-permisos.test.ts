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
    'aplicarConteo',
    'aplicarImportacion',
    'buscarProductosParaConteo',
    'buscarProductosParaEntrada',
    'buscarProductosParaTransferencia',
    'cancelarConteo',
    'cancelarTransferencia',
    'cargarMasHistorialInventario',
    'contarInventario',
    'contarProductoEnConteo',
    'enviarTransferencia',
    'fijarUmbralInventario',
    'importarConteo',
    'iniciarConteo',
    'previsualizarConteoImportado',
    'previsualizarImportacion',
    'quitarProductoDelConteo',
    'recibirTransferencia',
    'registrarDanoInventario',
    'registrarDevolucionInventario',
    'registrarEntradaInventario',
    'registrarEntradaMultiple',
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

// ── INV-2a · entradas con varias líneas e importación CSV ────────────────────

test('INV-2a · las pantallas de entradas se guardan como las demás: rol, empresa de la sesión, nada de cliente global ni de empresa por la URL', () => {
  for (const pagina of ['entradas/page.tsx', 'entradas/nueva/page.tsx', 'entradas/[id]/page.tsx', 'importar/page.tsx']) {
    const s = sinComent(leer(`src/app/(admin)/admin/inventario/${pagina}`))
    assert.match(s, /requireRole\(ADMIN_ROLES\)/, `${pagina} sin guardia de rol`)
    assert.match(s, /requireCompanyContext\(user\)/, `${pagina} no resuelve la empresa de la sesión`)
    assert.match(s, /conEmpresa\(companyId/, `${pagina} no lee dentro de conEmpresa`)
    assert.doesNotMatch(s, /\bprisma\./, `${pagina} usa el cliente global`)
    assert.doesNotMatch(s, /sp\.companyId|sp\.empresa|params\.companyId/, `${pagina} toma la empresa de la URL`)
  }
  // Las que ESCRIBEN esconden la forma a quien no puede ajustar (la acción igual lo rechazaría).
  for (const pagina of ['entradas/page.tsx', 'entradas/nueva/page.tsx', 'importar/page.tsx']) {
    assert.match(leer(`src/app/(admin)/admin/inventario/${pagina}`), /puedeFuncion\('inventario', 'ajustar'\)/, pagina)
  }
  // Una entrada ajena o inventada se ve igual: 404.
  assert.match(leer('src/app/(admin)/admin/inventario/entradas/[id]/page.tsx'), /notFound\(\)/)
  // Y cuando la migración no está aplicada, la pantalla lo DICE en vez de pedir que reintenten.
  for (const pagina of ['entradas/page.tsx', 'entradas/nueva/page.tsx', 'entradas/[id]/page.tsx', 'importar/page.tsx']) {
    assert.match(leer(`src/app/(admin)/admin/inventario/${pagina}`), /describirFalloDeCarga\(/, `${pagina} no distingue una migración pendiente`)
  }
  assert.match(leer('src/modules/inventory/errores-pantalla.ts'), /SCHEMA_DRIFT/)
  assert.match(leer('src/app/(admin)/admin/inventario/entradas/page.tsx'), /<NavegacionInventario actual="entradas"/)
})

test('INV-2a · las descargas de entradas se guardan SOLAS (un route handler no pasa por el layout) y la empresa sale de la sesión', () => {
  const rutas: Array<[string, RegExp]> = [
    ['entradas/[id]/exportar/route.ts', /requireSection\('inventario'\)/],
    ['importar/plantilla/route.ts', /requireSection\('inventario', 'ajustar'\)/],
  ]
  for (const [ruta, guardia] of rutas) {
    const s = sinComent(leer(`src/app/(admin)/admin/inventario/${ruta}`))
    assert.match(s, guardia, ruta)
    assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/, ruta)
    assert.ok(s.indexOf('requireSection(') < (s.indexOf('conEmpresa(') < 0 ? Infinity : s.indexOf('conEmpresa(')), `${ruta} toca la base antes de autorizar`)
    assert.doesNotMatch(s, /\bprisma\./, ruta)
  }
  const exportar = sinComent(leer('src/app/(admin)/admin/inventario/entradas/[id]/exportar/route.ts'))
  assert.match(exportar, /resolveCompanyId\(user\)/)
  assert.match(exportar, /entradaDetalleEnTx\(tx, companyId, id\)/, 'el id de la URL solo identifica la entrada, dentro de la empresa de la sesión')
  assert.match(exportar, /status: 404/)
})

test('INV-2a · las acciones nuevas autorizan con la función «ajustar», limitan el envío de archivos y no toman la empresa de la entrada', () => {
  for (const nombre of ['registrarEntradaMultiple', 'buscarProductosParaEntrada', 'previsualizarImportacion', 'aplicarImportacion']) {
    const desde = sinComentarios.indexOf(`export async function ${nombre}`)
    const cuerpo = sinComentarios.slice(desde).split('\n}\n')[0]
    assert.match(cuerpo, /await contexto\('ajustar'\)/, `${nombre} no exige «ajustar»`)
    assert.ok(cuerpo.indexOf('await contexto(') < cuerpo.indexOf('conEmpresa('), `${nombre} toca la base antes de autorizar`)
    // La empresa sale de la sesión (`c.companyId`), nunca de lo que manda el navegador.
    assert.match(cuerpo, /conEmpresa\(c\.companyId,/, `${nombre} no abre la transacción con la empresa de la sesión`)
    assert.doesNotMatch(cuerpo, /\bentrada\b[^\n]*company/i, `${nombre} lee una empresa de la entrada`)
  }
  assert.match(sinComentarios, /registrarEntradaMultipleEnTx\(\s*tx,\s*c\.companyId,/, 'la entrada múltiple recibe la empresa de la sesión')
  for (const nombre of ['previsualizarImportacion', 'aplicarImportacion']) {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf(`export async function ${nombre}`)).split('\n}\n')[0]
    assert.match(cuerpo, /formSubmitLimiter\(`inv-importar:/, `${nombre} no limita las subidas`)
  }
  // El navegador solo manda sucursal, líneas y texto: lo demás lo decide el servidor.
  const entrada = sinComentarios.slice(sinComentarios.indexOf('export async function registrarEntradaMultiple')).split('\n}\n')[0]
  assert.match(entrada, /origen: 'MANUAL', idempotencyKey/, 'el origen no lo elige el navegador')
  // Aplicar NO reutiliza la revisión que viajó por el navegador: el texto se lee y se valida otra vez en el servidor.
  const imp = sinComent(leer('src/modules/inventory/importar.ts'))
  assert.match(imp, /const r = await informeDeImportacionEnTx\(tx, companyId, e\.texto\)/)
  assert.match(imp, /lineas: r\.informe\.lineas/)
  assert.doesNotMatch(sinComentarios, /informe\.lineas|lineas: entrada\.informe/, 'las líneas validadas nunca vienen del navegador')
})

test('INV-2a · la búsqueda de productos para una entrada escribe la empresa en CADA consulta (el guardia general no ve las que van dentro de un Promise.all)', () => {
  const q = sinComent(leer('src/modules/inventory/queries.ts'))
  const desde = q.indexOf('export async function buscarVariantesParaEntradaEnTx')
  assert.ok(desde >= 0)
  const cuerpo = q.slice(desde).split('\nexport ')[0]
  const llamadas = cuerpo.split('tx.catalogVariant.findMany(').slice(1)
  assert.equal(llamadas.length, 2, 'la búsqueda tiene dos consultas (exactas y parciales)')
  for (const l of llamadas) assert.match(l.slice(0, l.indexOf('select')), /companyId/, 'una consulta de la búsqueda no filtra por empresa')
  for (const nombre of ['entradasDeLaEmpresaEnTx', 'entradaDetalleEnTx']) {
    const f = q.slice(q.indexOf(`export async function ${nombre}`)).split('\nexport ')[0]
    assert.match(f, /companyId/, `${nombre} no filtra por empresa`)
  }
})

test('INV-2a · los saldos que faltan se crean en un orden fijo (si no, dos entradas con los mismos productos nuevos se interbloquean)', () => {
  const f = sinComent(leer('src/modules/inventory/service.ts'))
  const cuerpo = f.slice(f.indexOf('export async function registrarEntradaMultipleEnTx')).split('\nexport ')[0]
  assert.match(cuerpo, /inventoryLevel\.createMany\(\{ data: \[\.\.\.ids\]\.sort\(\)/, 'los saldos nuevos se insertan ordenados por producto')
  assert.ok(cuerpo.indexOf('.sort()') < cuerpo.indexOf('await bloquear('), 'primero se crean, ordenados; después se bloquean todos')
})

test('INV-2a · los saldos solo los escriben DOS puertas: escribirMovimiento y la escritura por lote, que exige saldos bloqueados', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  // Escrituras con el cliente de Prisma: una sola puerta (ya la vigila otra prueba). Con SQL crudo: solo el lote.
  const crudos = [...svc.matchAll(/UPDATE "inventory_levels"/g)]
  assert.equal(crudos.length, 1, 'solo la escritura por lote actualiza saldos con SQL crudo')
  const lote = svc.slice(svc.indexOf('async function escribirMovimientosPorLote'), svc.indexOf('export interface EntradaMultiple'))
  assert.match(lote, /UPDATE "inventory_levels"/)
  assert.match(lote, /l\."companyId" = \$\{companyId\}/, 'el UPDATE filtra por empresa')
  assert.match(lote, /actualizados !== items\.length\) fallo\('LOTE_INCOMPLETO'/, 'si no se actualizan todos los saldos, se deshace todo')
  assert.match(lote, /new Set\(items\.map\(\(i\) => i\.nivelId\)\)\.size !== items\.length\) fallo\('LOTE_INVALIDO'/, 'un saldo no puede repetirse en el lote')
  // Quien la llama bloquea ANTES todos los saldos y aplica el ledger puro a cada uno.
  const entrada = svc.slice(svc.indexOf('export async function registrarEntradaMultipleEnTx'))
  assert.ok(entrada.indexOf('await bloquear(tx, companyId, niveles.map') < entrada.indexOf('escribirMovimientosPorLote(tx, companyId, items)'), 'se bloquea antes de escribir')
  assert.ok(entrada.indexOf('aplicarMovimiento(cubetasDeSaldo(fila), movimiento)') > 0, 'cada línea pasa por el ledger puro')
  assert.ok(entrada.indexOf('if (clave) {') > entrada.indexOf('await bloquear('), 'la idempotencia se revisa con los candados puestos')
  // Las entradas y sus líneas son append-only también en el código.
  assert.doesNotMatch(svc, /inventoryReceipt(Line)?\.(update|updateMany|delete|deleteMany|upsert)\(/)
  assert.doesNotMatch(leer('src/modules/inventory/queries.ts'), /inventoryReceipt(Line)?\.(update|updateMany|delete|deleteMany|upsert|create|createMany)\(/, 'las lecturas no escriben')
})

test('INV-2a · lo que es PURO sigue siendo puro, y los componentes de cliente nuevos no arrastran el servidor', () => {
  for (const archivo of ['entradas.ts', 'importacion.ts']) {
    const s = leer(`src/modules/inventory/${archivo}`)
    assert.doesNotMatch(s, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, `${archivo} debe seguir siendo puro`)
  }
  for (const f of ['EntradaMultipleForm.tsx', 'ImportarForm.tsx']) {
    const s = leer(`src/components/inventario/${f}`)
    assert.match(s, /^'use client'/, f)
    for (const origen of [...s.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])) {
      assert.doesNotMatch(origen, /modules\/inventory\/(domain|service|queries|auditoria|errores|barrido|importar|errores-pantalla)$/, `${f} importa ${origen}`)
    }
  }
})

test('INV-2a · la migración es aditiva e idempotente: solo crea objetos nuevos, y las entradas son append-only en la base', () => {
  const sql = leer('prisma/migrations/20261056_inventory_receipts/migration.sql')
  const sinNotas = sql.replace(/^--.*$/gm, '')
  assert.doesNotMatch(sinNotas, /\bDROP\s+(TABLE|COLUMN|TYPE)\b|\bALTER\s+TABLE\s+"(?!inventory_receipt)/i, 'no toca ninguna tabla existente')
  assert.doesNotMatch(sinNotas, /\bTRUNCATE\s+TABLE|\bDELETE\s+FROM|\bUPDATE\s+"/i)
  for (const crea of sinNotas.matchAll(/CREATE\s+(TABLE|UNIQUE INDEX|INDEX)\s+(IF NOT EXISTS)?/gi)) assert.ok(crea[2], `«${crea[0]}» sin IF NOT EXISTS: no es idempotente`)
  assert.match(sql, /inventory_receipts_sin_cambios[\s\S]*BEFORE UPDATE OR DELETE/)
  assert.match(sql, /inventory_receipt_lines_sin_cambios[\s\S]*BEFORE UPDATE OR DELETE/)
  assert.match(sql, /BEFORE TRUNCATE/)
  assert.match(sql, /FOREIGN KEY \("catalogVariantId", "companyId"\) REFERENCES "catalog_variants"\("id", "companyId"\)/, 'la variante va con la empresa: FK compuesta')
  // Sellada: el sello de SUMAS.txt es el de este archivo.
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20261056_inventory_receipts/)
})

test('INV-2a · /api/health avisa si falta la tabla de entradas (despliegue adelantado a la base)', () => {
  assert.match(leer('src/app/api/health/route.ts'), /'inventory_receipts\.esquema', to_regclass\('public\.inventory_receipts'\) IS NOT NULL/)
})

// ── INV-2b · conteo físico por sucursal ──────────────────────────────────────

const CONTEOS = 'src/app/(admin)/admin/inventario/conteos'

test('INV-2b · las pantallas de conteos se guardan como las demás: rol, empresa de la sesión, nada de cliente global ni de empresa por la URL', () => {
  const paginas = ['page.tsx', '[id]/page.tsx', '[id]/revisar/page.tsx', '[id]/importar/page.tsx']
  for (const pagina of paginas) {
    const s = sinComent(leer(`${CONTEOS}/${pagina}`))
    assert.match(s, /requireRole\(ADMIN_ROLES\)/, `${pagina} sin guardia de rol`)
    assert.match(s, /requireCompanyContext\(user\)/, `${pagina} no resuelve la empresa de la sesión`)
    assert.match(s, /conEmpresa\(companyId/, `${pagina} no lee dentro de conEmpresa`)
    assert.doesNotMatch(s, /\bprisma\./, `${pagina} usa el cliente global`)
    assert.doesNotMatch(s, /sp\.companyId|sp\.empresa|params\.companyId/, `${pagina} toma la empresa de la URL`)
    assert.match(s, /describirFalloDeCarga\(/, `${pagina} no distingue una migración pendiente`)
    assert.match(s, /puedeFuncion\('inventario', 'ajustar'\)/, `${pagina} no esconde la forma a quien no puede ajustar`)
  }
  // Un conteo ajeno o inventado se ve igual: 404.
  for (const pagina of ['[id]/page.tsx', '[id]/revisar/page.tsx', '[id]/importar/page.tsx']) assert.match(leer(`${CONTEOS}/${pagina}`), /notFound\(\)/, pagina)
  assert.match(leer(`${CONTEOS}/page.tsx`), /<NavegacionInventario actual="conteos"/)
  assert.match(leer('src/components/inventario/NavegacionInventario.tsx'), /id: 'conteos'[\s\S]*href: '\/admin\/inventario\/conteos'/)
})

test('INV-2b · las descargas de conteos se guardan SOLAS y la empresa sale de la sesión; la hoja en blanco se lee A CIEGAS', () => {
  const rutas: Array<[string, RegExp]> = [
    ['[id]/hoja/route.ts', /requireSection\('inventario', 'ajustar'\)/],
    ['[id]/exportar/route.ts', /requireSection\('inventario'\)/],
  ]
  for (const [ruta, guardia] of rutas) {
    const s = sinComent(leer(`${CONTEOS}/${ruta}`))
    assert.match(s, guardia, ruta)
    assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/, ruta)
    assert.match(s, /resolveCompanyId\(user\)/, ruta)
    assert.ok(s.indexOf('requireSection(') < s.indexOf('conEmpresa('), `${ruta} toca la base antes de autorizar`)
    assert.doesNotMatch(s, /\bprisma\./, ruta)
    assert.match(s, /conteoDetalleEnTx\(tx, companyId, id,/, `${ruta}: el id de la URL solo identifica el conteo, dentro de la empresa de la sesión`)
    assert.match(s, /status: 404/, ruta)
  }
  const hoja = sinComent(leer(`${CONTEOS}/[id]/hoja/route.ts`))
  assert.match(hoja, /conEsperado: false/, 'la hoja en blanco no puede leer lo que decía el sistema')
  assert.doesNotMatch(hoja, /conEsperado: true/)
  assert.match(sinComent(leer(`${CONTEOS}/[id]/exportar/route.ts`)), /conEsperado: true/, 'el informe de diferencias sí lleva lo esperado')
})

test('INV-2b · CONTEO A CIEGAS: ni la captura, ni la importación, ni la búsqueda ven lo que decía el sistema', () => {
  // La pantalla del conteo lee primero a ciegas y solo relee con lo esperado si ya NO está abierto.
  const detalle = sinComent(leer(`${CONTEOS}/[id]/page.tsx`))
  const ciego = detalle.indexOf('conEsperado: false')
  const completo = detalle.indexOf('conEsperado: true')
  assert.ok(ciego >= 0 && completo > ciego, 'la lectura a ciegas va primero')
  assert.match(detalle, /ciego\.estado !== 'OPEN'\) return[\s\S]*conEsperado: true/, 'lo esperado solo se lee cuando el conteo ya no está abierto')
  assert.match(sinComent(leer(`${CONTEOS}/[id]/importar/page.tsx`)), /conEsperado: false/)
  assert.doesNotMatch(sinComent(leer(`${CONTEOS}/[id]/importar/page.tsx`)), /conEsperado: true/)
  // Los componentes de captura no saben que existe: ni el nombre del campo.
  for (const f of ['CapturaConteo.tsx', 'FilaConteoEditable.tsx', 'ImportarConteoForm.tsx', 'IniciarConteoForm.tsx']) {
    const s = sinComent(leer(`src/components/inventario/${f}`))
    assert.doesNotMatch(s, /esperado|expected|existenciaAntes|onHand/i, `${f} toca lo que decía el sistema`)
  }
  // La búsqueda para contar no pide sucursal: devuelve `disponible: null`.
  const accion = sinComent(sinComentarios.slice(sinComentarios.indexOf('export async function buscarProductosParaConteo'))).split('\n}\n')[0]
  assert.match(accion, /buscarVariantesParaEntradaEnTx\(tx, c\.companyId, q, null\)/)
})

test('INV-2b · las acciones del conteo autorizan con «ajustar» ANTES de tocar la base, limitan los archivos y no toman la empresa de la entrada', () => {
  const acciones = ['iniciarConteo', 'contarProductoEnConteo', 'quitarProductoDelConteo', 'buscarProductosParaConteo', 'previsualizarConteoImportado', 'importarConteo', 'aplicarConteo', 'cancelarConteo']
  for (const nombre of acciones) {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf(`export async function ${nombre}`)).split('\n}\n')[0]
    assert.match(cuerpo, /await contexto\('ajustar'\)/, `${nombre} no exige «ajustar»`)
    assert.ok(cuerpo.indexOf('await contexto(') < cuerpo.indexOf('conEmpresa('), `${nombre} toca la base antes de autorizar`)
    assert.match(cuerpo, /conEmpresa\(c\.companyId,/, `${nombre} no abre la transacción con la empresa de la sesión`)
    assert.doesNotMatch(cuerpo, /\bentrada\b[^\n]*company/i, `${nombre} lee una empresa de la entrada`)
  }
  for (const nombre of ['previsualizarConteoImportado', 'importarConteo']) {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf(`export async function ${nombre}`)).split('\n}\n')[0]
    assert.match(cuerpo, /formSubmitLimiter\(`inv-conteo-importar:/, `${nombre} no limita las subidas`)
  }
  // El lector dispara varias capturas por segundo: contar NO se limita (se perderían conteos).
  const contar = sinComentarios.slice(sinComentarios.indexOf('export async function contarProductoEnConteo')).split('\n}\n')[0]
  assert.doesNotMatch(contar, /formSubmitLimiter/)
  // Tras aplicar, lo que bajó pasa por el aviso de stock bajo FUERA de la transacción y de la respuesta.
  const aplicar = sinComentarios.slice(sinComentarios.indexOf('export async function aplicarConteo')).split('\n}\n')[0]
  assert.match(aplicar, /after\(\(\) => avisarStockBajo\(c\.companyId, bajadas\)\)/)
  assert.match(aplicar, /!r\.repetido/, 'un conteo ya aplicado no vuelve a avisar')
})

test('INV-2b · el servicio de conteos bloquea el conteo ANTES de leer sus líneas, crea los saldos en orden fijo y escribe los resultados ANTES de cerrarlo', () => {
  const f = sinComent(leer('src/modules/inventory/service.ts'))
  const desde = f.indexOf('export async function abrirConteoEnTx')
  assert.ok(desde > 0)
  const seccion = f.slice(desde)
  for (const nombre of ['registrarConteoProductoEnTx', 'quitarLineaDeConteoEnTx', 'importarConteoEnTx', 'aplicarConteoEnTx', 'cancelarConteoEnTx']) {
    const cuerpo = seccion.slice(seccion.indexOf(`export async function ${nombre}`)).split('\nexport ')[0]
    assert.match(cuerpo, /await bloquearConteo\(tx, companyId, e\.conteoId\)/, `${nombre} no bloquea el conteo`)
    const primeraLectura = cuerpo.search(/tx\.inventory(CountLine|Level|CountSession)\./)
    assert.ok(primeraLectura < 0 || cuerpo.indexOf('bloquearConteo(') < primeraLectura, `${nombre} lee antes de bloquear el conteo`)
  }
  const aplicar = seccion.slice(seccion.indexOf('export async function aplicarConteoEnTx')).split('\nexport ')[0]
  // Orden fijo para crear saldos: dos conteos con los mismos productos nuevos no se interbloquean (ver INV-2a).
  assert.match(aplicar, /inventoryLevel\.createMany\(\{ data: \[\.\.\.variantes\]\.sort\(\)/)
  assert.ok(aplicar.indexOf('.sort()') < aplicar.indexOf('await bloquear('), 'primero se crean, ordenados; después se bloquean todos')
  assert.ok(aplicar.indexOf('await bloquear(') < aplicar.indexOf('escribirMovimientosPorLote('), 'los saldos se bloquean antes de escribir')
  // El disparador de la base solo deja tocar las líneas mientras el conteo está abierto: el resultado de cada línea va primero.
  assert.ok(aplicar.indexOf('UPDATE "inventory_count_lines"') > 0 && aplicar.indexOf('UPDATE "inventory_count_lines"') < aplicar.indexOf("status: 'APPLIED'"), 'los resultados se escriben antes de pasar el conteo a «aplicado»')
  // Todo o nada: si hay rechazadas, no se escribe NADA.
  assert.ok(aplicar.indexOf('rechazadas.length > 0') < aplicar.indexOf('escribirMovimientosPorLote('), 'las rechazadas cortan antes de escribir')
  // Y el único que escribe contadores de saldo sigue siendo el par de siempre.
  assert.equal([...f.matchAll(/UPDATE "inventory_levels"/g)].length, 1, 'ninguna otra puerta escribe saldos')
})

test('INV-2b · las lecturas nuevas escriben la empresa en CADA consulta', () => {
  const q = sinComent(leer('src/modules/inventory/queries.ts'))
  for (const nombre of ['conteosDeLaEmpresaEnTx', 'conteoDetalleEnTx', 'conteoAbiertoDeSucursalEnTx', 'porContarEnTx', 'hojaDeConteoEnTx', 'saldosActualesDeConteoEnTx']) {
    const f = q.slice(q.indexOf(`export async function ${nombre}`)).split('\nexport ')[0]
    assert.match(f, /companyId/, `${nombre} no filtra por empresa`)
    // Cada `where: {…}` escrito en línea debe llevar la empresa a la vista; los `where: donde` apuntan a una constante que también se comprueba.
    for (const m of f.matchAll(/where: \{([^]{0,160})/g)) assert.match(m[1], /companyId/, `${nombre}: un where sin empresa → ${m[0].slice(0, 60)}`)
    for (const m of f.matchAll(/const donde = \{([^]{0,160})/g)) assert.match(m[1], /companyId/, `${nombre}: donde sin empresa`)
  }
})

test('INV-2b · lo PURO sigue siendo puro, y los componentes de cliente del conteo no arrastran el servidor', () => {
  for (const archivo of ['conteos.ts', 'entradas.ts', 'importacion.ts']) {
    const s = leer(`src/modules/inventory/${archivo}`)
    assert.doesNotMatch(s, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, `${archivo} debe seguir siendo puro`)
  }
  for (const f of ['CapturaConteo.tsx', 'FilaConteoEditable.tsx', 'ImportarConteoForm.tsx', 'IniciarConteoForm.tsx', 'AplicarConteoForm.tsx']) {
    const s = leer(`src/components/inventario/${f}`)
    assert.match(s, /^'use client'/, f)
    for (const origen of [...s.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])) {
      assert.doesNotMatch(origen, /modules\/inventory\/(domain|service|queries|auditoria|errores|barrido|importar|errores-pantalla)$/, `${f} importa ${origen}`)
    }
  }
  // El informe de diferencias NO es de cliente (solo pinta) y nunca se monta en la pantalla de captura.
  assert.doesNotMatch(leer('src/components/inventario/InformeDiferencias.tsx'), /^'use client'/)
  assert.doesNotMatch(sinComent(leer(`${CONTEOS}/[id]/page.tsx`).split('conteo.estado === \'CANCELLED\'')[0]), /<InformeDiferencias/, 'el informe solo aparece cuando el conteo ya no está abierto')
})

test('INV-2b · la migración es aditiva e idempotente, un solo conteo abierto por sucursal, y lo cerrado no cambia en la base', () => {
  const sql = leer('prisma/migrations/20261057_inventory_counts/migration.sql')
  const sinNotas = sql.replace(/^--.*$/gm, '')
  assert.doesNotMatch(sinNotas, /\bDROP\s+(TABLE|COLUMN|TYPE)\b|\bALTER\s+TABLE\s+"(?!inventory_count)/i, 'no toca ninguna tabla existente')
  assert.doesNotMatch(sinNotas, /\bTRUNCATE\s+TABLE|\bDELETE\s+FROM|\bUPDATE\s+"/i)
  for (const crea of sinNotas.matchAll(/CREATE\s+(TABLE|UNIQUE INDEX|INDEX)\s+(IF NOT EXISTS)?/gi)) assert.ok(crea[2], `«${crea[0]}» sin IF NOT EXISTS: no es idempotente`)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_sessions_un_abierto_por_sucursal"[\s\S]*WHERE "status" = 'OPEN'/)
  assert.match(sql, /inventory_count_sessions_sin_cambios[\s\S]*BEFORE UPDATE OR DELETE/)
  assert.match(sql, /inventory_count_lines_solo_abierta[\s\S]*BEFORE INSERT OR UPDATE OR DELETE/)
  assert.match(sql, /BEFORE TRUNCATE ON "inventory_count_sessions"/)
  assert.match(sql, /BEFORE TRUNCATE ON "inventory_count_lines"/)
  // Sellada: la suma de control del archivo está en SUMAS.txt.
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20261057_inventory_counts/)
})

test('INV-2b · /api/health avisa si falta la tabla de conteos (despliegue adelantado a la base)', () => {
  assert.match(leer('src/app/api/health/route.ts'), /inventory_count_sessions\.esquema', to_regclass\('public\.inventory_count_sessions'\) IS NOT NULL/)
})

// ── INV-2c · transferencias con envío ────────────────────────────────────────

const TRASLADOS = 'src/app/(admin)/admin/inventario/transferencias'

test('INV-2c · las pantallas de transferencias se guardan como las demás: rol, empresa de la sesión, nada de cliente global ni de empresa por la URL', () => {
  for (const pagina of ['page.tsx', 'nueva/page.tsx', '[id]/page.tsx']) {
    const s = sinComent(leer(`${TRASLADOS}/${pagina}`))
    assert.match(s, /requireRole\(ADMIN_ROLES\)/, `${pagina} sin guardia de rol`)
    assert.match(s, /requireCompanyContext\(user\)/, `${pagina} no resuelve la empresa de la sesión`)
    assert.match(s, /conEmpresa\(companyId/, `${pagina} no lee dentro de conEmpresa`)
    assert.doesNotMatch(s, /\bprisma\./, `${pagina} usa el cliente global`)
    assert.doesNotMatch(s, /sp\.companyId|sp\.empresa|params\.companyId/, `${pagina} toma la empresa de la URL`)
    assert.match(s, /describirFalloDeCarga\(/, `${pagina} no distingue una migración pendiente`)
    // Mover mercancía entre sucursales es la función «transferir», no «ajustar».
    assert.match(s, /puedeFuncion\('inventario', 'transferir'\)/, `${pagina} no esconde la forma a quien no puede transferir`)
    assert.doesNotMatch(s, /puedeFuncion\('inventario', 'ajustar'\)/, `${pagina} usa el permiso equivocado`)
  }
  assert.match(leer(`${TRASLADOS}/[id]/page.tsx`), /notFound\(\)/, 'una transferencia ajena o inventada se ve igual: 404')
  assert.match(leer(`${TRASLADOS}/page.tsx`), /<NavegacionInventario actual="transferencias"/)
  assert.match(leer('src/components/inventario/NavegacionInventario.tsx'), /id: 'transferencias'[\s\S]*href: '\/admin\/inventario\/transferencias'/)
})

test('INV-2c · la descarga de una transferencia se guarda SOLA y la empresa sale de la sesión', () => {
  const s = sinComent(leer(`${TRASLADOS}/[id]/exportar/route.ts`))
  assert.match(s, /requireSection\('inventario'\)/)
  assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/)
  assert.match(s, /resolveCompanyId\(user\)/)
  assert.ok(s.indexOf('requireSection(') < s.indexOf('conEmpresa('), 'toca la base antes de autorizar')
  assert.doesNotMatch(s, /\bprisma\./)
  assert.match(s, /trasladoDetalleEnTx\(tx, companyId, id\)/, 'el id de la URL solo identifica la transferencia, dentro de la empresa de la sesión')
  assert.match(s, /status: 404/)
})

test('INV-2c · las acciones de transferencia autorizan con «transferir» (no «ajustar») ANTES de tocar la base y no toman la empresa de la entrada', () => {
  for (const nombre of ['enviarTransferencia', 'buscarProductosParaTransferencia', 'recibirTransferencia', 'cancelarTransferencia']) {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf(`export async function ${nombre}`)).split('\n}\n')[0]
    assert.match(cuerpo, /await contexto\('transferir'\)/, `${nombre} no exige «transferir»`)
    assert.doesNotMatch(cuerpo, /contexto\('ajustar'\)/, `${nombre} usa el permiso equivocado`)
    assert.ok(cuerpo.indexOf('await contexto(') < cuerpo.indexOf('conEmpresa('), `${nombre} toca la base antes de autorizar`)
    assert.match(cuerpo, /conEmpresa\(c\.companyId,/, `${nombre} no abre la transacción con la empresa de la sesión`)
    assert.doesNotMatch(cuerpo, /\bentrada\b[^\n]*company/i, `${nombre} lee una empresa de la entrada`)
  }
  // Tras enviar: aviso de stock bajo en el origen y notificación al destino, FUERA de la transacción y de la respuesta; un reintento no repite el aviso.
  const enviar = sinComentarios.slice(sinComentarios.indexOf('export async function enviarTransferencia')).split('\n}\n')[0]
  assert.match(enviar, /if \(!r\.repetido\) \{[\s\S]*after\(\(\) => avisarStockBajo\(companyId, r\.variantes\)\)[\s\S]*after\(\(\) =>\s*notificarAdmins\(companyId/)
  assert.match(enviar, /dedupeKey: `traslado-enviado:\$\{r\.trasladoId\}`/)
})

test('INV-2c · el servicio de transferencias bloquea la transferencia ANTES de leer sus líneas, crea los saldos en orden fijo y escribe los contadores ANTES de cerrarla', () => {
  const f = sinComent(leer('src/modules/inventory/service.ts'))
  const desde = f.indexOf('export async function enviarTrasladoEnTx')
  assert.ok(desde > 0)
  const seccion = f.slice(desde)
  for (const nombre of ['recibirTrasladoEnTx', 'cancelarTrasladoEnTx']) {
    const cuerpo = seccion.slice(seccion.indexOf(`export async function ${nombre}`)).split('\nexport ')[0]
    assert.match(cuerpo, /await bloquearTraslado\(tx, companyId, e\.trasladoId\)/, `${nombre} no bloquea la transferencia`)
    const primeraLectura = cuerpo.search(/tx\.inventory(Transfer|TransferLine|Level|Movement)\.|lineasDeTraslado\(/)
    assert.ok(primeraLectura < 0 || cuerpo.indexOf('bloquearTraslado(') < primeraLectura, `${nombre} lee antes de bloquear la transferencia`)
  }
  // Los saldos que falten se crean siempre en un orden fijo (por producto): ver INV-2a.
  assert.match(f, /async function crearSaldosEnOrden[\s\S]*\[\.\.\.new Set\(variantes\)\]\.sort\(\)\.map/)
  const recibir = seccion.slice(seccion.indexOf('export async function recibirTrasladoEnTx')).split('\nexport ')[0]
  assert.ok(recibir.indexOf('crearSaldosEnOrden(') < recibir.indexOf('await bloquear('), 'primero se crean, ordenados; después se bloquean')
  assert.ok(recibir.indexOf('await bloquear(') < recibir.indexOf('escribirMovimientosPorLote('), 'los saldos se bloquean antes de escribir')
  // El disparador de la base solo deja tocar las líneas mientras la transferencia está abierta: los contadores van primero.
  assert.ok(recibir.indexOf('UPDATE "inventory_transfer_lines"') > 0 && recibir.indexOf('UPDATE "inventory_transfer_lines"') < recibir.indexOf("status: 'RECEIVED'"), 'recibir: contadores antes de cerrar')
  const cancelar = seccion.slice(seccion.indexOf('export async function cancelarTrasladoEnTx')).split('\nexport ')[0]
  assert.ok(cancelar.indexOf('UPDATE "inventory_transfer_lines"') > 0 && cancelar.indexOf('UPDATE "inventory_transfer_lines"') < cancelar.indexOf("status: 'CANCELLED'"), 'cancelar: contadores antes de cerrar')
  // Enviar: no crea saldos en el destino (hasta que algo llegue no hay nada allí) y la idempotencia se mira YA con los candados.
  const enviar = seccion.slice(0, seccion.indexOf('export async function recibirTrasladoEnTx'))
  assert.doesNotMatch(enviar, /crearSaldosEnOrden\(/, 'enviar no toca el destino')
  assert.ok(enviar.indexOf('await bloquear(') < enviar.indexOf('idempotencyKey: clave'), 'la idempotencia se revisa con los candados puestos')
  assert.ok(enviar.indexOf('noAlcanza.length > 0') < enviar.indexOf('siguienteNumero('), 'un envío que no alcanza no gasta un número')
  // La idempotencia de una recepción se mira ANTES de exigir que siga abierta: reintentar una que ya cerró la transferencia es inocuo.
  assert.ok(recibir.indexOf('startsWith:') > 0 && recibir.indexOf('startsWith:') < recibir.indexOf('exigirTrasladoAbierto(traslado)'))
  // La transferencia directa de siempre crea sus dos saldos en orden fijo (por sucursal): A→B y B→A a la vez no se interbloquean.
  const directa = f.slice(f.indexOf('export async function transferirEnTx')).split('\nexport ')[0]
  assert.match(directa, /for \(const sucursalId of \[origen\.id, destino\.id\]\.sort\(\)\) nivelesDe\.set/)
  assert.equal([...f.matchAll(/UPDATE "inventory_levels"/g)].length, 1, 'ninguna otra puerta escribe saldos')
})

test('INV-2c · las lecturas de transferencias escriben la empresa en CADA consulta', () => {
  const q = sinComent(leer('src/modules/inventory/queries.ts'))
  for (const nombre of ['trasladosDeLaEmpresaEnTx', 'trasladoDetalleEnTx', 'enTransitoDeVarianteEnTx']) {
    const f = q.slice(q.indexOf(`export async function ${nombre}`)).split('\nexport ')[0]
    assert.match(f, /companyId/, `${nombre} no filtra por empresa`)
    for (const m of f.matchAll(/where: \{([^]{0,160})/g)) assert.match(m[1], /companyId/, `${nombre}: un where sin empresa → ${m[0].slice(0, 60)}`)
  }
})

test('INV-2c · la ficha de un producto lee lo que va en camino en su PROPIA transacción y con su propio try: sin la migración, la ficha sigue funcionando', () => {
  const s = sinComent(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'))
  assert.match(s, /try \{\s*enTransito = await conEmpresa\(companyId, \(tx\) => enTransitoDeVarianteEnTx\(tx, companyId, varianteId\)\)\s*\} catch/)
  const principal = s.slice(s.indexOf('const datos = await conEmpresa'), s.indexOf('if (!datos) notFound()'))
  assert.doesNotMatch(principal, /enTransitoDeVarianteEnTx/, 'si estuviera en la transacción principal, un error la abortaría entera')
})

test('INV-2c · lo PURO sigue siendo puro, y los componentes de cliente de transferencias no arrastran el servidor', () => {
  const s = leer('src/modules/inventory/traslados.ts')
  assert.doesNotMatch(s, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, 'traslados.ts debe ser puro')
  for (const f of ['EnviarTransferenciaForm.tsx', 'RecibirTransferenciaForm.tsx']) {
    const c = leer(`src/components/inventario/${f}`)
    assert.match(c, /^'use client'/, f)
    for (const origen of [...c.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])) {
      assert.doesNotMatch(origen, /modules\/inventory\/(domain|service|queries|auditoria|errores|barrido|importar|errores-pantalla)$/, `${f} importa ${origen}`)
    }
  }
})

test('INV-2c · la migración es aditiva e idempotente, los estados no se saltan en la base, y lo cerrado no cambia', () => {
  const sql = leer('prisma/migrations/20261058_inventory_transfers/migration.sql')
  const sinNotas = sql.replace(/^--.*$/gm, '')
  assert.doesNotMatch(sinNotas, /\bDROP\s+(TABLE|COLUMN|TYPE)\b|\bALTER\s+TABLE\s+"(?!inventory_transfer)/i, 'no toca ninguna tabla existente')
  assert.doesNotMatch(sinNotas, /\bTRUNCATE\s+TABLE|\bDELETE\s+FROM|\bUPDATE\s+"/i)
  for (const crea of sinNotas.matchAll(/CREATE\s+(TABLE|UNIQUE INDEX|INDEX)\s+(IF NOT EXISTS)?/gi)) assert.ok(crea[2], `«${crea[0]}» sin IF NOT EXISTS: no es idempotente`)
  assert.match(sql, /inventory_transfers_sin_cambios[\s\S]*BEFORE UPDATE OR DELETE/)
  assert.match(sql, /inventory_transfer_lines_avance[\s\S]*BEFORE INSERT OR UPDATE OR DELETE/)
  assert.match(sql, /BEFORE TRUNCATE ON "inventory_transfers"/)
  assert.match(sql, /BEFORE TRUNCATE ON "inventory_transfer_lines"/)
  // La tabla de transiciones de la base es la misma que la del dominio.
  assert.match(sql, /OLD\."status" = 'SENT' AND NEW\."status" IN \('PARTIAL', 'RECEIVED', 'CANCELLED'\)/)
  assert.match(sql, /OLD\."status" = 'PARTIAL' AND NEW\."status" IN \('RECEIVED', 'CANCELLED'\)/)
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20261058_inventory_transfers/)
  assert.match(leer('src/app/api/health/route.ts'), /inventory_transfers\.esquema', to_regclass\('public\.inventory_transfers'\) IS NOT NULL/)
})
