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

test('las funciones de permiso son «ajustar», «comprar», «costos» y «transferir», y las cuatro se exigen de verdad', () => {
  const funciones = (FUNCIONES_POR_SECCION.inventario ?? []).map((f) => f.codigo)
  assert.deepEqual(funciones.sort(), ['ajustar', 'comprar', 'costos', 'transferir'])
  const usadas = new Set([...sinComentarios.matchAll(/contexto\('(\w+)'\)/g)].map((m) => m[1]))
  for (const m of sinComentarios.matchAll(/operar\(\s*'(\w+)'/g)) usadas.add(m[1])
  for (const f of funciones) assert.ok(usadas.has(f), `la función «${f}» está en el catálogo de permisos y ninguna acción la pide`)
})

test('todas las acciones exportadas autorizan ANTES de tocar la base', () => {
  const exportadas = [...sinComentarios.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), [
    'activarLotesInventario',
    'actualizarProveedor',
    'ajustarInventario',
    'aplicarConteo',
    'aplicarImportacion',
    'asignarSeriesInventario',
    'buscarCandidatosAKit',
    'buscarProductosParaConteo',
    'buscarProductosParaEntrada',
    'buscarProductosParaOrden',
    'buscarProductosParaTransferencia',
    'cambiarActivoProveedor',
    'cancelarConteo',
    'cancelarOrdenCompra',
    'cancelarTransferencia',
    'cargarMasHistorialInventario',
    'contarInventario',
    'contarProductoEnConteo',
    'corregirCostoInventario',
    'corregirVencimientoLote',
    'crearProveedor',
    'desactivarLotesInventario',
    'desvincularProveedorDeProducto',
    'enviarTransferencia',
    'fijarObjetivoInventario',
    'fijarUmbralInventario',
    'guardarOrdenCompra',
    'guardarRecetaDeKit',
    'importarConteo',
    'iniciarConteo',
    'lotesParaContarProducto',
    'lotesParaTransferir',
    'moverEntreLotesInventario',
    'pedirOrdenCompra',
    'previsualizarConteoImportado',
    'previsualizarImportacion',
    'quitarProductoDelConteo',
    'quitarRecetaDeKit',
    'recibirOrdenCompra',
    'recibirTransferencia',
    'registrarDanoInventario',
    'registrarDevolucionInventario',
    'registrarEntradaInventario',
    'registrarEntradaMultiple',
    'resolverDanadoInventario',
    'transferirInventario',
    'vincularProveedorDeProducto',
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
      assert.doesNotMatch(origen, /modules\/inventory\/(domain|service|queries|auditoria|errores|barrido|compras-service|compras-queries|reposicion-queries)$/, `${f} importa ${origen}`)
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
  const otras = svc.slice(svc.indexOf('export async function configurarUmbralOtrasSucursalesEnTx')).split('\nexport ')[0]
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
  assert.match(exportar, /entradaDetalleEnTx\(tx, companyId, id(, \{ conCostos \})?\)/, 'el id de la URL solo identifica la entrada, dentro de la empresa de la sesión')
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
  assert.match(imp, /const r = await informeDeImportacionEnTx\(tx, companyId, e\.texto(, \{ permitirCostos: e\.permitirCostos \})?\)/)
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

// ── INV-3a · costo y valor del inventario ────────────────────────────────────

const VALOR = 'src/app/(admin)/admin/inventario/valor'

test('INV-3a · la pantalla del valor se guarda como las demás y NO lee nada si quien llega no tiene la función «costos»', () => {
  const s = sinComent(leer(`${VALOR}/page.tsx`))
  assert.match(s, /requireRole\(ADMIN_ROLES\)/)
  assert.match(s, /requireCompanyContext\(user\)/)
  assert.match(s, /conEmpresa\(companyId/)
  assert.doesNotMatch(s, /\bprisma\./)
  assert.doesNotMatch(s, /sp\.companyId|sp\.empresa|params\.companyId/)
  assert.match(s, /describirFalloDeCarga\(/)
  assert.match(s, /puedeFuncion\('inventario', 'costos'\)/)
  // La lectura va dentro de `if (puedeCostos)`: sin la función, la consulta ni se hace.
  assert.match(s, /if \(puedeCostos\) \{\s*try \{\s*datos = await conEmpresa\(companyId/)
  assert.ok(s.indexOf("puedeFuncion('inventario', 'costos')") < s.indexOf('conEmpresa('))
  assert.match(s, /<NavegacionInventario actual="valor"/)
})

test('INV-3a · la descarga del valor exige la función «costos» ANTES de tocar la base y la empresa sale de la sesión', () => {
  const s = sinComent(leer(`${VALOR}/exportar/route.ts`))
  assert.match(s, /requireSection\('inventario', 'costos'\)/)
  assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/)
  assert.match(s, /resolveCompanyId\(user\)/)
  assert.ok(s.indexOf('requireSection(') < s.indexOf('conEmpresa('))
  assert.doesNotMatch(s, /\bprisma\./)
  assert.match(s, /valorDelInventarioEnTx\(tx, companyId, f,/)
})

test('INV-3a · «Valor» solo se ofrece a quien tiene «costos»; la plantilla, la entrada y su CSV llevan costos solo con esa función', () => {
  const nav = sinComent(leer('src/components/inventario/NavegacionInventario.tsx'))
  assert.match(nav, /export async function NavegacionInventario/)
  assert.match(nav, /const \[verValor, puedeComprar\] = await Promise\.all\(\[puedeFuncion\('inventario', 'costos'\), puedeFuncion\('inventario', 'comprar'\)\]\)/)
  assert.match(nav, /v\.id !== 'valor' \|\| verValor/)
  assert.match(nav, /id: 'valor'[\s\S]*href: '\/admin\/inventario\/valor'/)
  assert.match(sinComent(leer('src/app/(admin)/admin/inventario/importar/plantilla/route.ts')), /plantillaImportacionCsv\(await puedeFuncion\('inventario', 'costos'\)\)/)
  for (const ruta of ['src/app/(admin)/admin/inventario/entradas/[id]/page.tsx', 'src/app/(admin)/admin/inventario/entradas/[id]/exportar/route.ts']) {
    const r = sinComent(leer(ruta))
    assert.match(r, /const conCostos = await puedeFuncion\('inventario', 'costos'\)/, ruta)
    assert.match(r, /entradaDetalleEnTx\(tx, companyId, id, \{ conCostos \}\)/, ruta)
  }
  // La consulta ni LEE el costo cuando no se pide: lo que no se lee no puede filtrarse.
  assert.match(sinComent(leer('src/modules/inventory/queries.ts')), /\.\.\.\(opciones\.conCostos \? \{ unitCost: true \} : \{\}\)/)
  for (const ruta of ['src/app/(admin)/admin/inventario/entradas/nueva/page.tsx', 'src/app/(admin)/admin/inventario/importar/page.tsx']) {
    assert.match(sinComent(leer(ruta)), /puedeFuncion\('inventario', 'costos'\)/, ruta)
  }
})

test('INV-3a · corregir el costo exige «costos» ANTES de tocar la base; registrar o importar con costo también, y solo se pregunta si viene uno', () => {
  const corregir = sinComentarios.slice(sinComentarios.indexOf('export async function corregirCostoInventario')).split('\n}\n')[0]
  assert.match(corregir, /await contexto\('costos'\)/)
  assert.doesNotMatch(corregir, /contexto\('ajustar'\)/)
  assert.ok(corregir.indexOf('await contexto(') < corregir.indexOf('conEmpresa('))
  assert.match(corregir, /conEmpresa\(c\.companyId,/)
  for (const nombre of ['registrarEntradaInventario', 'registrarEntradaMultiple']) {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf(`export async function ${nombre}`)).split('\n}\n')[0]
    assert.match(cuerpo, /traeCosto\([^)]*\)[\s\S]*puedeFuncion\('inventario', 'costos'\)[\s\S]*SIN_PERMISO_DE_COSTOS/, `${nombre} no revisa «costos» cuando viene un costo`)
    assert.ok(cuerpo.indexOf("puedeFuncion('inventario', 'costos')") < cuerpo.indexOf('conEmpresa(') || cuerpo.indexOf('conEmpresa(') < 0 || cuerpo.indexOf('operar(') > cuerpo.indexOf("puedeFuncion('inventario', 'costos')"), `${nombre}: el permiso se mira después de tocar la base`)
  }
  for (const nombre of ['previsualizarImportacion', 'aplicarImportacion']) {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf(`export async function ${nombre}`)).split('\n}\n')[0]
    assert.match(cuerpo, /const permitirCostos = await puedeFuncion\('inventario', 'costos'\)/, nombre)
    assert.ok(cuerpo.indexOf('permitirCostos =') < cuerpo.indexOf('conEmpresa('), nombre)
    // …y se LE PASA al servicio tal cual (no `true`, no otra cosa).
    assert.match(cuerpo, nombre === 'aplicarImportacion' ? /idempotencyKey: clave\(entrada\.clave\), permitirCostos \}/ : /informeDeImportacionEnTx\(tx, c\.companyId, entrada\.texto, \{ permitirCostos \}\)/, `${nombre} no pasa el permiso al servicio`)
  }
})

test('INV-3a · el costo se escribe en las DOS puertas del ledger y en ninguna otra; un solo UPDATE de saldos sigue siendo el de siempre', () => {
  const f = sinComent(leer('src/modules/inventory/service.ts'))
  assert.equal([...f.matchAll(/tx\.inventoryMovement\.create(Many|ManyAndReturn)?\(/g)].length, 2, 'solo dos puertas escriben movimientos')
  assert.equal([...f.matchAll(/unitCost: costo === null \? null : costoADecimal\(costo\)/g)].length, 2, 'las dos puertas escriben unitCost')
  assert.equal([...f.matchAll(/UPDATE "inventory_levels"/g)].length, 1)
  // Las ventas LEEN el costo: ninguna lectura de costos bloquea.
  const lectura = f.slice(f.indexOf('async function costosVigentes')).split('\n}\n')[0]
  assert.doesNotMatch(lectura, /FOR UPDATE/, 'una venta nunca debe esperar al costo')
  assert.match(lectura, /"companyId" = \$\{companyId\}/)
  // El candado del renglón de costo solo lo pone quien lo mueve, y siempre en orden de producto.
  assert.equal([...f.matchAll(/FROM "inventory_variant_costs"[\s\S]{0,160}FOR UPDATE/g)].length, 2, 'solo aplicar-costos y corregir bloquean el renglón')
  const aplicar = f.slice(f.indexOf('async function aplicarCostosDeEntradaEnTx')).split('\n}\n')[0]
  assert.match(aplicar, /\.sort\(\(a, b\) =>/, 'ordena por producto antes de crear y bloquear')
  assert.match(aplicar, /ORDER BY "catalogVariantId"\s+FOR UPDATE/)
  assert.ok(aplicar.indexOf('createManyAndReturn') < aplicar.indexOf('FOR UPDATE'), 'primero se crean (ordenados), después se bloquean')
  assert.ok(aplicar.indexOf('FOR UPDATE') < aplicar.indexOf('FROM "inventory_levels"'), 'las existencias se leen YA con el candado puesto')
  // Orden de bloqueo: saldos → renglón de costo; el costo se mueve ANTES de escribir los movimientos (pesan las existencias de antes).
  const entrada = f.slice(f.indexOf('export async function registrarEntradaMultipleEnTx')).split('\nexport ')[0]
  assert.ok(entrada.indexOf('await bloquear(') < entrada.indexOf('aplicarCostosDeEntradaEnTx('), 'primero los saldos')
  assert.ok(entrada.indexOf('aplicarCostosDeEntradaEnTx(') < entrada.indexOf('escribirMovimientosPorLote('), 'el promedio se mueve antes de escribir')
  assert.ok(entrada.indexOf('idempotencyKey: clave') < entrada.indexOf('aplicarCostosDeEntradaEnTx('), 'un reintento no mueve el promedio otra vez')
  const simple = f.slice(f.indexOf('async function moverSimple')).split('\n}\n')[0]
  assert.ok(simple.indexOf('prepararNivel(') < simple.indexOf('aplicarCostosDeEntradaEnTx('))
  assert.ok(simple.indexOf('aplicarCostosDeEntradaEnTx(') < simple.indexOf('escribirMovimiento('))
  // Un conteo aplicado se valora con el promedio: su lote lleva el producto de cada línea.
  // (INV-5b3: el ajuste de una línea de lote además lleva su reparto; el producto sigue yendo en el item.)
  assert.match(f, /referencia: \{ tipo: 'STOCK_COUNT', id: conteo\.id \},\s*motivoCodigo: MOTIVO_DE_CONTEO,[\s\S]*?\},\s*varianteId: x\.l\.catalogVariantId/)
})

test('INV-3a · corregir el costo valida, bloquea el renglón y deja su rastro (historia inmutable y bitácora) en la misma transacción', () => {
  const f = sinComent(leer('src/modules/inventory/service.ts'))
  const c = f.slice(f.indexOf('export async function corregirCostoEnTx')).split('\nexport ')[0]
  assert.ok(c.indexOf('validarCorreccionDeCosto(') < c.indexOf('tx.'), 'valida antes de tocar la base')
  assert.match(c, /exigirVarianteControlada\(tx, companyId, e\.varianteId\)/)
  assert.match(c, /SIN_EXISTENCIAS_PREVIAS/)
  assert.ok(c.indexOf('FOR UPDATE') < c.indexOf('tx.inventoryCostAdjustment.create'), 'bloquea antes de escribir la historia')
  assert.match(c, /tx\.inventoryCostAdjustment\.create/)
  assert.match(c, /auditarInventario\(/)
  assert.doesNotMatch(c, /inventoryMovement/, 'una corrección no toca el ledger')
})

test('INV-3a · las lecturas del valor llevan la empresa en CADA consulta', () => {
  const v = sinComent(leer('src/modules/inventory/valor.ts'))
  const consultas = [...v.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)]
  assert.ok(consultas.length >= 6, 'se esperaban las consultas del valor, del costo de ventas y del tránsito')
  for (const m of consultas) assert.match(m[1], /"companyId" = \$\{companyId\}|\$\{hayExistencias\}|\$\{desde\}|\$\{agrupado\}/, `consulta sin empresa → ${m[1].slice(0, 80)}`)
  assert.match(v, /const hayExistencias = Prisma\.sql`l\."companyId" = \$\{companyId\}/)
  // Y los joins van por empresa: un producto de otra empresa nunca se cuela por la clave del producto.
  assert.match(v, /JOIN "catalog_variants" v ON v\."id" = l\."catalogVariantId" AND v\."companyId" = l\."companyId"/)
  assert.match(v, /LEFT JOIN "inventory_variant_costs" c ON c\."catalogVariantId" = v\."id" AND c\."companyId" = v\."companyId"/)
  // (La tabla de usuarios no es de una empresa: solo se leen los nombres de quienes ya aparecen en filas de ESTA empresa.)
  for (const m of v.matchAll(/tx\.(\w+)\.(findFirst|findMany|aggregate)\(\{\s*where: \{([^}]*)/g)) {
    if (m[1] === 'user') continue
    assert.match(m[3], /companyId/, `where sin empresa → ${m[0].slice(0, 60)}`)
  }
})

test('INV-3a · lo PURO sigue siendo puro, el servidor-solo no llega al navegador y los montos no son flotantes', () => {
  const costos = leer('src/modules/inventory/costos.ts')
  assert.doesNotMatch(costos, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, 'costos.ts debe ser puro')
  assert.doesNotMatch(sinComent(costos), /parseFloat|Number\(\s*(entero|decimales|t)\b|toFixed\(\s*2\s*\)/, 'los montos son enteros, no flotantes')
  for (const f of readdirSync('src/components/inventario').filter((n) => n.endsWith('.tsx'))) {
    const c = leer(`src/components/inventario/${f}`)
    if (!/^'use client'/.test(c)) continue
    // (También los imports «de efecto»: `import '@/modules/...'` sin `from`.)
    for (const origen of [...c.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1])) {
      assert.doesNotMatch(origen, /modules\/inventory\/(domain|service|queries|auditoria|errores|barrido|importar|errores-pantalla|valor)$/, `${f} importa ${origen}`)
    }
  }
})

test('INV-3a · la migración solo AÑADE: dos columnas NULL, dos tablas, y lo que no se reescribe lo impide la base', () => {
  const sql = leer('prisma/migrations/20261059_inventory_costs/migration.sql')
  const sinNotas = sql.replace(/^--.*$/gm, '')
  assert.doesNotMatch(sinNotas, /\bDROP\s+(TABLE|COLUMN|TYPE)\b|\bTRUNCATE\s+TABLE|\bDELETE\s+FROM|\bUPDATE\s+"|\bSET\s+NOT\s+NULL|\bALTER\s+COLUMN/i, 'no destruye ni reescribe nada')
  // Lo único que toca de las tablas viejas: añadirles la columna del costo y su CHECK.
  const alteradas = [...sinNotas.matchAll(/ALTER\s+TABLE\s+"(\w+)"\s+(ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL\(14,4\)|ADD CONSTRAINT|VALIDATE CONSTRAINT)/gi)].map((m) => m[1])
  for (const t of alteradas) assert.ok(['inventory_movements', 'inventory_receipt_lines', 'inventory_variant_costs', 'inventory_cost_adjustments'].includes(t), `toca ${t}`)
  assert.match(sinNotas, /ALTER TABLE "inventory_movements"\s+ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL\(14,4\);/)
  assert.match(sinNotas, /ALTER TABLE "inventory_receipt_lines" ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL\(14,4\);/)
  assert.doesNotMatch(sinNotas, /"unitCost"[^;]*(NOT NULL|DEFAULT)/i, 'la columna nueva es NULL y sin valor por defecto (no reescribe la tabla)')
  assert.match(sinNotas, /"inventory_movements_costo"[\s\S]{0,200}NOT VALID/)
  assert.match(sinNotas, /VALIDATE CONSTRAINT "inventory_movements_costo"/)
  for (const crea of sinNotas.matchAll(/CREATE\s+(TABLE|UNIQUE INDEX|INDEX)\s+(IF NOT EXISTS)?/gi)) assert.ok(crea[2], `«${crea[0]}» sin IF NOT EXISTS: no es idempotente`)
  assert.match(sql, /inventory_cost_adjustments_sin_cambios[\s\S]*BEFORE UPDATE OR DELETE/)
  assert.match(sql, /BEFORE TRUNCATE ON "inventory_cost_adjustments"/)
  assert.match(sql, /BEFORE TRUNCATE ON "inventory_variant_costs"/)
  assert.match(sql, /inventory_variant_costs_identidad[\s\S]*BEFORE UPDATE OR DELETE/)
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20261059_inventory_costs/)
  // Aviso de orden de despliegue: esta migración SÍ tiene que ir antes que el código.
  assert.match(sql, /AQUÍ ES OBLIGATORIO: ESTE SQL PRIMERO/)
})

test('INV-3a · /api/health avisa si falta la tabla o la columna del costo (despliegue adelantado a la base)', () => {
  const h = leer('src/app/api/health/route.ts')
  assert.match(h, /inventory_variant_costs\.esquema', to_regclass\('public\.inventory_variant_costs'\) IS NOT NULL/)
  assert.match(h, /inventory_movements\.unitCost'[\s\S]*column_name = 'unitCost'/)
})

// ── INV-3b · proveedores y órdenes de compra ─────────────────────────────────

const COMPRAS = 'src/app/(admin)/admin/inventario/compras'
const PROVEEDORES = 'src/app/(admin)/admin/inventario/proveedores'
const ACCIONES_COMPRAS = [
  'crearProveedor',
  'actualizarProveedor',
  'cambiarActivoProveedor',
  'guardarOrdenCompra',
  'pedirOrdenCompra',
  'cancelarOrdenCompra',
  'recibirOrdenCompra',
  'buscarProductosParaOrden',
  'vincularProveedorDeProducto',
  'desvincularProveedorDeProducto',
]

test('INV-3b · las pantallas de compras y proveedores se guardan como las demás y NO leen nada si quien llega no tiene «comprar»', () => {
  const paginas = [`${COMPRAS}/page.tsx`, `${COMPRAS}/nueva/page.tsx`, `${COMPRAS}/[id]/page.tsx`, `${COMPRAS}/[id]/editar/page.tsx`, `${PROVEEDORES}/page.tsx`, `${PROVEEDORES}/[id]/page.tsx`]
  for (const ruta of paginas) {
    const s = sinComent(leer(ruta))
    assert.match(s, /requireRole\(ADMIN_ROLES\)/, `${ruta} sin guardia de rol`)
    assert.match(s, /requireCompanyContext\(user\)/, `${ruta} no resuelve la empresa de la sesión`)
    assert.match(s, /conEmpresa\(companyId/, `${ruta} no lee dentro de conEmpresa`)
    assert.doesNotMatch(s, /\bprisma\./, `${ruta} usa el cliente global`)
    assert.doesNotMatch(s, /sp\.companyId|sp\.empresa|params\.companyId/, `${ruta} toma la empresa de la URL`)
    assert.match(s, /describirFalloDeCarga\(/, `${ruta} no distingue una migración pendiente`)
    // Las órdenes traen los costos pactados con el proveedor: sin «comprar» la pantalla ni lee (y tampoco se ofrece).
    assert.match(s, /puedeFuncion\('inventario', 'comprar'\)/, `${ruta} no pide la función «comprar»`)
    assert.ok(s.indexOf("puedeFuncion('inventario', 'comprar')") < s.indexOf('conEmpresa('), `${ruta} lee antes de comprobar «comprar»`)
    assert.doesNotMatch(s, /puedeFuncion\('inventario', '(ajustar|transferir)'\)/, `${ruta} usa el permiso equivocado`)
  }
  for (const ruta of [`${COMPRAS}/[id]/page.tsx`, `${COMPRAS}/[id]/editar/page.tsx`, `${PROVEEDORES}/[id]/page.tsx`]) {
    assert.match(leer(ruta), /notFound\(\)/, `${ruta}: una orden o proveedor ajeno o inventado se ve igual: 404`)
  }
  assert.match(leer(`${COMPRAS}/page.tsx`), /<NavegacionInventario actual="compras"/)
  assert.match(leer(`${PROVEEDORES}/page.tsx`), /<NavegacionInventario actual="proveedores"/)
  // La lista filtra por proveedor y sucursal de ESTA empresa: lo que llega por la URL solo vale si lo es.
  const lista = leer(`${COMPRAS}/page.tsx`)
  assert.match(lista, /sucursales\.find\(\(s\) => s\.id === filtros\.sucursalId\)/)
  assert.match(lista, /proveedores\.find\(\(p\) => p\.id === filtros\.proveedorId\)/)
})

test('INV-3b · «Compras» y «Proveedores» solo se ofrecen a quien tiene «comprar»', () => {
  const nav = sinComent(leer('src/components/inventario/NavegacionInventario.tsx'))
  assert.match(nav, /id: 'compras'[\s\S]*href: '\/admin\/inventario\/compras'/)
  assert.match(nav, /id: 'proveedores'[\s\S]*href: '\/admin\/inventario\/proveedores'/)
  assert.match(nav, /puedeFuncion\('inventario', 'comprar'\)/)
  // INV-3c: las tres vistas de compras comparten una sola lista de «requieren comprar», y el filtro la usa.
  assert.match(nav, /REQUIEREN_COMPRAR[^=]*= new Set\(\['reposicion', 'compras', 'proveedores'\]\)/)
  assert.match(nav, /\(!REQUIEREN_COMPRAR\.has\(v\.id\) \|\| puedeComprar\)/)
  assert.ok(FUNCIONES_POR_SECCION.inventario?.some((f) => f.codigo === 'comprar'))
})

test('INV-3b · la descarga de una orden exige «comprar» ANTES de tocar la base y la empresa sale de la sesión', () => {
  const s = sinComent(leer(`${COMPRAS}/[id]/exportar/route.ts`))
  assert.match(s, /requireSection\('inventario', 'comprar'\)/, 'el archivo trae los costos de la orden')
  assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/)
  assert.match(s, /resolveCompanyId\(user\)/)
  assert.ok(s.indexOf('requireSection(') < s.indexOf('conEmpresa('), 'toca la base antes de autorizar')
  assert.doesNotMatch(s, /\bprisma\./)
  assert.match(s, /ordenDetalleEnTx\(tx, companyId, id\)/, 'el id de la URL solo identifica la orden, dentro de la empresa de la sesión')
  assert.match(s, /status: 404/)
})

test('INV-3b · las acciones de compras autorizan con «comprar» (ni «ajustar» ni «costos») ANTES de tocar la base y no toman la empresa de la entrada', () => {
  for (const nombre of ACCIONES_COMPRAS) {
    const cuerpo = sinComentarios.slice(sinComentarios.indexOf(`export async function ${nombre}`)).split('\n}\n')[0]
    assert.match(cuerpo, /await contexto\('comprar'\)/, `${nombre} no exige «comprar»`)
    assert.doesNotMatch(cuerpo, /contexto\('(ajustar|costos|transferir)'\)|puedeFuncion\(/, `${nombre} usa el permiso equivocado`)
    assert.ok(cuerpo.indexOf('await contexto(') < cuerpo.indexOf('conEmpresa('), `${nombre} toca la base antes de autorizar`)
    assert.match(cuerpo, /conEmpresa\(c\.companyId,/, `${nombre} no abre la transacción con la empresa de la sesión`)
    assert.doesNotMatch(cuerpo, /\bentrada\b[^\n]*company/i, `${nombre} lee una empresa de la entrada`)
  }
  // Las entradas de una orden solo las crea el servicio de compras: ninguna acción puede enlazar una entrada a una orden.
  assert.doesNotMatch(sinComentarios, /ordenCompraId|purchaseOrderId/, 'el navegador no decide a qué orden responde una entrada')
})

test('INV-3b · el servicio de compras NO escribe el ledger ni los saldos: recibir delega en la entrada de mercancía de siempre', () => {
  const f = sinComent(leer('src/modules/inventory/compras-service.ts'))
  assert.doesNotMatch(f, /inventoryMovement|inventoryLevel|inventory_levels|inventory_movements|inventoryReceipt\.(create|update|delete)|escribirMovimiento|inventoryVariantCost|inventory_variant_costs/, 'compras-service no toca el ledger, los saldos ni los costos')
  // INV-5b2: lo único que trae del servicio de inventario es la entrada de mercancía (que ya reparte por lote); no hay guardia de lotes.
  assert.match(f, /import \{ registrarEntradaMultipleEnTx \} from '\.\/service'/)
  const recibir = f.slice(f.indexOf('export async function recibirOrdenEnTx')).split('\nexport ')[0]
  assert.match(recibir, /registrarEntradaMultipleEnTx\(\s*tx,\s*companyId,\s*\{[\s\S]*ordenCompraId: orden\.id[\s\S]*\},\s*ctx\s*\)/, 'la entrada lleva el id de la orden bloqueada')
  assert.match(recibir, /costo: costoADecimal\(costoDe\.get\(x\.varianteId\)!\)/, 'el costo de la entrada es el de la línea de la orden, no el que mande el navegador')
  // Y el servicio de entradas escribe el enlace, y lo compara al reconocer un reintento.
  const service = sinComent(leer('src/modules/inventory/service.ts'))
  assert.match(service, /purchaseOrderId: e\.ordenCompraId \?\? null/)
  assert.match(service, /previa\.purchaseOrderId === \(e\.ordenCompraId \?\? null\)/)
})

test('INV-3b · el servicio de compras bloquea la orden ANTES de leer sus líneas, mira la idempotencia con el candado y escribe los contadores ANTES de cerrarla', () => {
  const f = sinComent(leer('src/modules/inventory/compras-service.ts'))
  for (const nombre of ['pedirOrdenEnTx', 'cancelarOrdenEnTx', 'recibirOrdenEnTx']) {
    const cuerpo = f.slice(f.indexOf(`export async function ${nombre}`)).split('\nexport ')[0]
    assert.match(cuerpo, /await bloquearOrden\(tx, companyId, e\.ordenId\)/, `${nombre} no bloquea la orden`)
    const primeraLectura = cuerpo.search(/tx\.inventory(PurchaseOrder|PurchaseOrderLine|Receipt|Supplier)\.|lineasDeOrden\(/)
    assert.ok(primeraLectura < 0 || cuerpo.indexOf('bloquearOrden(') < primeraLectura, `${nombre} lee antes de bloquear la orden`)
  }
  const guardar = f.slice(f.indexOf('export async function guardarOrdenEnTx')).split('\nexport ')[0]
  assert.ok(guardar.indexOf('bloquearOrden(') > 0 && guardar.indexOf('bloquearOrden(') < guardar.indexOf('exigirBorrador('), 'editar: primero se bloquea, después se comprueba que siga siendo borrador')
  assert.ok(guardar.indexOf('bloquearOrden(') < guardar.indexOf('exigirProveedor('), 'editar: nada se lee antes de bloquear')
  // Crear con clave: el cerrojo de la clave va ANTES de buscar el borrador previo y de numerar.
  assert.ok(guardar.indexOf('bloquearClave(') > 0 && guardar.indexOf('bloquearClave(') < guardar.indexOf('inventoryPurchaseOrder.findFirst'), 'el cerrojo de la clave va antes de la idempotencia')
  assert.ok(guardar.indexOf('inventoryPurchaseOrder.findFirst') < guardar.indexOf('siguienteNumero('), 'un reintento no gasta un número')
  assert.ok(guardar.indexOf('exigirVariantesControladas(') < guardar.indexOf('siguienteNumero('), 'una orden inválida no gasta un número')
  // Recibir: idempotencia (con la orden bloqueada) → orden abierta → plan → entrada → contadores de líneas → vínculo → estado.
  const recibir = f.slice(f.indexOf('export async function recibirOrdenEnTx')).split('\nexport ')[0]
  const orden = ['bloquearOrden(', 'inventoryReceipt.findFirst', 'puedeRecibirse(orden.status)', 'planDeRecepcionOrden(', 'registrarEntradaMultipleEnTx(', 'UPDATE "inventory_purchase_order_lines"', 'inventoryVariantSupplier.createMany', "status: 'RECEIVED'"]
  const posiciones = orden.map((x) => recibir.indexOf(x))
  assert.ok(posiciones.every((p) => p >= 0), `falta un paso: ${orden.filter((_, i) => posiciones[i] < 0).join(', ')}`)
  assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, 'los pasos de recibir van en este orden')
  // Pedir y cancelar también escriben los contadores/estado en el orden que exige el disparador de la base.
  const cancelar = f.slice(f.indexOf('export async function cancelarOrdenEnTx')).split('\nexport ')[0]
  assert.ok(cancelar.indexOf('UPDATE "inventory_purchase_order_lines"') > 0 && cancelar.indexOf('UPDATE "inventory_purchase_order_lines"') < cancelar.indexOf("status: 'CANCELLED'"), 'cancelar: contadores antes de cerrar')
  // El vínculo producto↔proveedor se crea en orden de producto (si no, dos recepciones con los mismos productos nuevos se interbloquean).
  assert.match(recibir, /\[\.\.\.plan\.recibir\]\.sort\(/)
  assert.match(recibir, /inventoryVariantSupplier\.createMany\(\{ data: ordenadas\.map[\s\S]*skipDuplicates: true/)
})

test('INV-3b · el servicio y las lecturas de compras escriben la empresa en CADA consulta', () => {
  for (const archivo of ['compras-service.ts', 'compras-queries.ts']) {
    const f = sinComent(leer(`src/modules/inventory/${archivo}`))
    const lecturas = [...f.matchAll(/tx\.(\w+)\.(findFirst|findFirstOrThrow|findMany|count|updateMany|deleteMany|aggregate)\(\{\s*where: \{([\s\S]{0,110})/g)]
    assert.ok(lecturas.length >= 5, `${archivo}: la expresión ya no encuentra consultas; revisa esta prueba`)
    for (const [llamada, , , donde] of lecturas) assert.match(donde, /companyId/, `${archivo}: una consulta no filtra por empresa → ${llamada.slice(0, 90)}…`)
    // Lo que se escribe también lleva la empresa.
    for (const m of f.matchAll(/tx\.(\w+)\.(create|createMany)\(\{\s*data: ([\s\S]{0,140})/g)) assert.match(m[3], /companyId/, `${archivo}: una escritura sin empresa → ${m[0].slice(0, 90)}…`)
    // Todo UPDATE por clave primaria usa la clave compuesta (id, companyId): un id ajeno no encuentra nada.
    for (const m of f.matchAll(/tx\.(inventoryPurchaseOrder|inventorySupplier)\.update\(\{\s*where: \{([^}]*)/g)) assert.match(m[2], /id_companyId/, `${archivo}: un update sin la clave (id, empresa) → ${m[0].slice(0, 90)}…`)
  }
  const f = sinComent(leer('src/modules/inventory/compras-service.ts'))
  for (const sql of f.matchAll(/\$queryRaw[^`]*`([\s\S]*?)`|\$executeRaw`([\s\S]*?)`/g)) {
    const texto = sql[1] ?? sql[2] ?? ''
    if (/pg_advisory_xact_lock/.test(texto)) continue
    assert.match(texto, /"companyId" = \$\{companyId\}/, `un SQL a mano sin empresa → ${texto.trim().slice(0, 80)}…`)
  }
})

test('INV-3b · la ficha del producto y la entrada leen lo de compras en su PROPIA transacción y con su propio try: sin la migración siguen funcionando', () => {
  const ficha = sinComent(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx'))
  assert.match(ficha, /if \(puedeComprar && detalle\.controlaInventario\) \{\s*try \{\s*compras = await conEmpresa\(companyId, async \(tx\) => \(\{/)
  const principal = ficha.slice(ficha.indexOf('const datos = await conEmpresa'), ficha.indexOf('if (!datos) notFound()'))
  assert.doesNotMatch(principal, /proveedoresDeVarianteEnTx|pedidoEnCaminoDeVarianteEnTx|proveedoresActivosEnTx/, 'si estuviera en la transacción principal, un error la abortaría entera')
  const entrada = sinComent(leer('src/app/(admin)/admin/inventario/entradas/[id]/page.tsx'))
  assert.match(entrada, /if \(await puedeFuncion\('inventario', 'comprar'\)\) \{\s*try \{\s*orden = await conEmpresa\(companyId, \(tx\) => ordenDeEntradaEnTx\(tx, companyId, id\)\)/)
  assert.doesNotMatch(entrada.slice(entrada.indexOf('datos = await conEmpresa'), entrada.indexOf('if (fallo)')), /ordenDeEntradaEnTx/)
  // La lectura de la entrada no cambió: sus costos siguen detrás de «costos».
  assert.match(entrada, /entradaDetalleEnTx\(tx, companyId, id, \{ conCostos \}\)/)
})

test('INV-3b · lo PURO sigue siendo puro, el servidor-solo no llega al navegador y los montos no son flotantes', () => {
  const pura = leer('src/modules/inventory/compras.ts')
  assert.doesNotMatch(pura, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, 'compras.ts debe ser puro')
  assert.doesNotMatch(sinComent(pura), /parseFloat|Number\(.*costo|toFixed\(/, 'los costos viajan como enteros')
  for (const f of ['ProveedorForm.tsx', 'OrdenCompraForm.tsx', 'AccionesOrdenCompra.tsx', 'RecibirOrdenCompraForm.tsx', 'ProveedoresDeProductoCard.tsx']) {
    const c = leer(`src/components/inventario/${f}`)
    assert.match(c, /^'use client'/, f)
    for (const origen of [...c.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])) {
      assert.doesNotMatch(origen, /modules\/inventory\/(domain|service|queries|auditoria|errores|barrido|importar|errores-pantalla|compras-service|compras-queries|reposicion-queries)$/, `${f} importa ${origen}`)
      assert.doesNotMatch(origen, /^@prisma\/client$|lib\/prisma$|lib\/tenant$/, `${f} importa ${origen}`)
    }
  }
  assert.doesNotMatch(leer('src/modules/inventory/compras-queries.ts'), /parseFloat|Number\(.*(unitCost|lastCost)/, 'los costos de las lecturas viajan como enteros')
})

test('INV-3b · la migración solo AÑADE: tablas y tipo nuevos y UNA columna NULL, con la historia de las órdenes protegida en la base', () => {
  const sql = leer('prisma/migrations/20261060_inventory_purchasing/migration.sql')
  const sinNotas = sql.replace(/^--.*$/gm, '')
  assert.doesNotMatch(sinNotas, /\bDROP\s+(TABLE|COLUMN|TYPE|CONSTRAINT|INDEX)\b/i, 'no borra nada')
  assert.doesNotMatch(sinNotas, /\bTRUNCATE\s+TABLE|\bDELETE\s+FROM|\bUPDATE\s+"/i, 'no toca filas')
  for (const crea of sinNotas.matchAll(/CREATE\s+(TABLE|UNIQUE INDEX|INDEX)\s+(IF NOT EXISTS)?/gi)) assert.ok(crea[2], `«${crea[0]}» sin IF NOT EXISTS: no es idempotente`)
  // La única tabla existente que se toca es la de entradas: una columna NULL sin valor por defecto y su clave foránea.
  const alteraciones = [...sinNotas.matchAll(/ALTER\s+TABLE\s+"(\w+)"\s+([^;]*);/gi)]
  for (const [, tabla, resto] of alteraciones) {
    if (tabla !== 'inventory_receipts') {
      assert.match(tabla, /^inventory_(suppliers|purchase_orders|purchase_order_lines|variant_suppliers)$/, `toca la tabla existente «${tabla}»`)
      continue
    }
    assert.match(resto, /^ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT$|^ADD CONSTRAINT "inventory_receipts_purchaseOrderId_companyId_fkey"/, `inventory_receipts: ${resto.trim().slice(0, 80)}`)
  }
  assert.equal(alteraciones.filter(([, t]) => t === 'inventory_receipts').length, 2, 'la columna y su clave foránea')
  // Lo que la base impone.
  assert.match(sql, /inventory_purchase_orders_sin_cambios[\s\S]*BEFORE UPDATE OR DELETE/)
  assert.match(sql, /inventory_purchase_order_lines_avance[\s\S]*BEFORE INSERT OR UPDATE OR DELETE/)
  assert.match(sql, /BEFORE TRUNCATE ON "inventory_purchase_orders"/)
  assert.match(sql, /BEFORE TRUNCATE ON "inventory_purchase_order_lines"/)
  assert.match(sql, /inventory_variant_suppliers_preferido_key" ON "inventory_variant_suppliers" \("catalogVariantId"\) WHERE "preferred"/, 'a lo sumo un proveedor preferido por producto')
  assert.match(sql, /inventory_suppliers_companyId_name_lower_key" ON "inventory_suppliers" \("companyId", lower\("name"\)\)/, 'el nombre del proveedor no se repite por mayúsculas')
  // La tabla de transiciones de la base es la misma que la del dominio.
  assert.match(sql, /OLD\."status" = 'DRAFT' AND NEW\."status" IN \('DRAFT', 'ORDERED', 'CANCELLED'\)/)
  assert.match(sql, /OLD\."status" = 'ORDERED' AND NEW\."status" IN \('PARTIAL', 'RECEIVED', 'CANCELLED'\)/)
  assert.match(sql, /OLD\."status" = 'PARTIAL' AND NEW\."status" = 'RECEIVED'/)
  // Todas las claves foráneas entre tablas de la empresa son COMPUESTAS con la empresa.
  for (const fk of ['supplierId', 'locationId', 'orderId', 'catalogVariantId', 'purchaseOrderId']) assert.match(sql, new RegExp(`FOREIGN KEY \\("${fk}", "companyId"\\)`), `la clave de ${fk} no incluye la empresa`)
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20261060_inventory_purchasing/)
})

test('INV-3b · /api/health avisa si falta la tabla de órdenes o la columna de la entrada (despliegue adelantado a la base)', () => {
  const h = leer('src/app/api/health/route.ts')
  assert.match(h, /inventory_purchase_orders\.esquema', to_regclass\('public\.inventory_purchase_orders'\) IS NOT NULL/)
  assert.match(h, /inventory_receipts\.purchaseOrderId', EXISTS \([\s\S]*column_name = 'purchaseOrderId'\)/)
})

test('INV-3b · el catálogo de funciones documenta lo que «comprar» incluye, y la bitácora entiende las órdenes', () => {
  const comprar = FUNCIONES_POR_SECCION.inventario?.find((f) => f.codigo === 'comprar')
  assert.ok(comprar && /proveedores/i.test(comprar.label) && /costos/i.test(comprar.label), 'la etiqueta dice que incluye proveedores, órdenes y sus costos')
  const aud = leer('src/modules/inventory/auditoria.ts')
  for (const tipo of ['InventorySupplier', 'InventoryPurchaseOrder', 'InventoryVariantSupplier']) assert.match(aud, new RegExp(`'${tipo}'`), tipo)
  // Las acciones de bitácora siguen siendo las tres de siempre (una nueva exigiría una migración del tipo de PostgreSQL).
  assert.match(aud, /Extract<AuditAccion, 'INVENTORY_STOCK_CHANGED' \| 'INVENTORY_TRANSFERRED' \| 'INVENTORY_CONFIGURED'>/)
})

// ── INV-3c · Reposición ──────────────────────────────────────────────────────

const REPOSICION = 'src/app/(admin)/admin/inventario/reposicion'

test('INV-3c · la pantalla de reposición se guarda como las demás y NO lee nada si quien llega no tiene «comprar»', () => {
  const s = sinComent(leer(`${REPOSICION}/page.tsx`))
  assert.match(s, /requireRole\(ADMIN_ROLES\)/)
  assert.match(s, /requireCompanyContext\(user\)/)
  assert.match(s, /conEmpresa\(companyId/)
  assert.doesNotMatch(s, /\bprisma\./, 'usa el cliente global')
  assert.doesNotMatch(s, /sp\.companyId|sp\.empresa|params\.companyId/, 'toma la empresa de la URL')
  assert.match(s, /describirFalloDeCarga\(/, 'no distingue una migración pendiente')
  // Trae proveedores y el último costo de cada uno: sin «comprar» ni lee (y tampoco se ofrece).
  assert.match(s, /puedeFuncion\('inventario', 'comprar'\)/)
  assert.ok(s.indexOf("puedeFuncion('inventario', 'comprar')") < s.indexOf('conEmpresa('), 'lee antes de comprobar «comprar»')
  assert.match(s, /if \(!puedeComprar\) \{\s*return \(/, 'comprueba el resultado: sin «comprar» devuelve el aviso y no sigue')
  assert.doesNotMatch(s, /puedeFuncion\('inventario', '(ajustar|transferir|costos)'\)/, 'usa el permiso equivocado')
  assert.match(s, /<NavegacionInventario actual="reposicion" \/>\s*\{!datos \|\| !r \?/, 'la pestaña de la pantalla es la de reposición')
  // Lo que llega por la URL solo filtra si es de ESTA empresa.
  assert.match(s, /sucursales\.some\(\(s\) => s\.id === f\.sucursalId\)/)
  assert.match(s, /f\.proveedorId !== 'sin' && !proveedores\.some\(\(p\) => p\.id === f\.proveedorId\)/)
  // Al navegador solo cruzan textos y números (el costo, como el texto de su campo): nada de bigint ni de tipos del servidor.
  assert.match(s, /costo: l\.ultimoCosto === null \? '' : costoParaCampo\(l\.ultimoCosto\)/)
})

test('INV-3c · «Reposición» solo se ofrece a quien tiene «comprar», y la alerta de stock bajo lo ofrece solo a ellos', () => {
  const nav = sinComent(leer('src/components/inventario/NavegacionInventario.tsx'))
  assert.match(nav, /id: 'reposicion'[\s\S]*href: '\/admin\/inventario\/reposicion'/)
  const home = sinComent(leer('src/app/(admin)/admin/inventario/page.tsx'))
  assert.match(home, /const puedeComprar = await puedeFuncion\('inventario', 'comprar'\)/)
  assert.match(home, /\{puedeComprar && \(\s*<p[^>]*>\s*<Link href="\/admin\/inventario\/reposicion"/)
})

test('INV-3c · la descarga de reposición exige «comprar» ANTES de tocar la base, la empresa sale de la sesión y la URL solo filtra dentro de ella', () => {
  const s = sinComent(leer(`${REPOSICION}/exportar/route.ts`))
  assert.match(s, /requireSection\('inventario', 'comprar'\)/, 'el archivo trae proveedores y costos')
  assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/)
  assert.match(s, /resolveCompanyId\(user\)/)
  assert.ok(s.indexOf('requireSection(') < s.indexOf('conEmpresa('), 'toca la base antes de autorizar')
  assert.doesNotMatch(s, /\bprisma\./)
  assert.match(s, /const pedido = leerFiltrosReposicion\(crudo\)\n/, 'los mismos filtros que la pantalla, sin tocarlos')
  assert.match(s, /if \(!sucursal\) delete f\.sucursalId/, 'una sucursal ajena no filtra')
  assert.match(s, /if \(pedido\.proveedorId !== 'sin' && !proveedor\) delete f\.proveedorId/, 'un proveedor ajeno no filtra')
})

test('INV-3c · fijar «llenar hasta» autoriza con «ajustar» (como el umbral) ANTES de tocar la base, y aplicar a las otras sucursales va en la MISMA transacción', () => {
  const cuerpo = sinComentarios.slice(sinComentarios.indexOf('export async function fijarObjetivoInventario')).split('\n}\n')[0]
  assert.match(cuerpo, /await contexto\('ajustar'\)/)
  assert.doesNotMatch(cuerpo, /contexto\('(comprar|costos|transferir)'\)|puedeFuncion\(/, 'usa el permiso equivocado')
  assert.ok(cuerpo.indexOf('await contexto(') < cuerpo.indexOf('conEmpresa('), 'toca la base antes de autorizar')
  assert.match(cuerpo, /conEmpresa\(c\.companyId, async \(tx\) =>/)
  assert.match(cuerpo, /entrada\.aplicarAOtras === true/)
  assert.match(cuerpo, /configurarObjetivoOtrasSucursalesEnTx\(tx, c\.companyId,/, 'todo en la MISMA transacción y con la empresa de la sesión')
  assert.doesNotMatch(cuerpo, /\bentrada\b[^\n]*company/i, 'lee una empresa de la entrada')
  // Crear el borrador desde la propuesta NO es una acción nueva: pasa por la de órdenes, que ya exige «comprar».
  const lectura = sinComentarios
  assert.doesNotMatch(lectura, /reposicion-queries/, 'las acciones no leen la propuesta: eso lo hacen las pantallas, detrás de «comprar»')
  const grupo = leer('src/components/inventario/ReposicionGrupoCard.tsx')
  assert.match(grupo, /^'use client'/)
  assert.match(grupo, /guardarOrdenCompra\(\{ cabecera: \{ proveedorId: proveedor\.id, sucursalId: grupo\.sucursalId, nota: NOTA_BORRADOR_REPOSICION \}, lineas, clave: clave\.current \}\)/)
  assert.doesNotMatch(grupo, /pedirOrdenCompra|recibirOrdenCompra|cancelarOrdenCompra/, 'crear el borrador no pide nada: pedirlo es otra decisión, en la pantalla de la orden')
})

test('INV-3c · el servicio de «llenar hasta» valida, bloquea el saldo ANTES de escribir, no deja chocar con el umbral y deja su rastro', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  const objetivo = svc.slice(svc.indexOf('export async function configurarObjetivoEnTx')).split('\nexport ')[0]
  const en = (t: string) => {
    const i = objetivo.indexOf(t)
    assert.ok(i >= 0, `configurarObjetivoEnTx ya no contiene «${t}»`)
    return i
  }
  assert.ok(en('validarObjetivo(') < en('exigirVarianteControlada('), 'valida antes de tocar la base')
  assert.ok(en('bloquear(tx, companyId, [nivelId])') < en('inventoryLevel.update('), 'escribe sin bloquear el saldo')
  assert.ok(en('bloquear(tx, companyId, [nivelId])') < en('findUniqueOrThrow('), 'lee el objetivo vigente DESPUÉS de bloquear (si no, dos personas pasan la regla a la vez)')
  assert.match(objetivo, /errorObjetivoContraUmbral\(\{ umbral: fila\.lowStockThreshold, llenarHasta: o\.valor, sucursal: sucursal\.nombre \}\)/)
  assert.ok(en('errorObjetivoContraUmbral(') < en('inventoryLevel.update('), 'comprueba el umbral después de bloquear y antes de escribir')
  assert.match(objetivo, /if \(targetStock === o\.valor\) return/, 'repetir el mismo valor no escribe ni audita')
  assert.match(objetivo, /auditarInventario\(tx, ctx, companyId, 'INVENTORY_CONFIGURED', nivelId,/)
  // Mover el umbral también respeta el objetivo.
  const umbral = svc.slice(svc.indexOf('export async function configurarUmbralEnTx')).split('\nexport ')[0]
  assert.match(umbral, /errorObjetivoContraUmbral\(\{ umbral: u\.valor, llenarHasta: targetStock, sucursal: sucursal\.nombre \}\)/)
  assert.ok(umbral.indexOf('errorObjetivoContraUmbral(') >= 0 && umbral.indexOf('errorObjetivoContraUmbral(') < umbral.indexOf('inventoryLevel.update('))
  assert.ok(umbral.indexOf('bloquear(tx, companyId, [nivelId])') < umbral.indexOf('findUniqueOrThrow('), 'el umbral también lee el objetivo vigente DESPUÉS de bloquear')
  // Al aplicar a otras sucursales cada una pasa por la misma función (y por sus reglas).
  const otras = svc.slice(svc.indexOf('export async function configurarObjetivoOtrasSucursalesEnTx')).split('\nexport ')[0]
  assert.match(otras, /configurarObjetivoEnTx\(tx, companyId,/)
  assert.doesNotMatch(otras, /obtenerNivel\(/, 'no crea saldos en cero donde el producto nunca estuvo')
  assert.match(otras, /location: \{ activa: true \}/, 'solo sucursales activas')
  assert.match(otras, /locationId: \{ not: e\.sucursalOrigenId \}/)
})

test('INV-3c · las lecturas de reposición solo LEEN y escriben la empresa en CADA consulta', () => {
  const f = sinComent(leer('src/modules/inventory/reposicion-queries.ts'))
  assert.doesNotMatch(f, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM/i, 'una lectura no escribe')
  const lecturas = [...f.matchAll(/tx\.(\w+)\.(findFirst|findMany|count)\(\{\s*where: \{([\s\S]{0,120})/g)]
  assert.ok(lecturas.length >= 4, 'la expresión ya no encuentra consultas; revisa esta prueba')
  for (const [llamada, , , donde] of lecturas) assert.match(donde, /companyId/, `una consulta no filtra por empresa → ${llamada.slice(0, 90)}…`)
  const sqls = [...f.matchAll(/\$queryRaw<[^>]*>`([\s\S]*?)`/g)]
  assert.equal(sqls.length, 3, 'pedido, en camino y borradores')
  for (const [, texto] of sqls) assert.match(texto, /"companyId" = \$\{companyId\}/, `un SQL a mano sin empresa → ${texto.trim().slice(0, 80)}…`)
  // Las reglas de qué cuenta se escriben una vez y valen para la propuesta y para las alertas sin objetivo.
  assert.equal([...f.matchAll(/location: \{ activa: true \}, variant: variante/g)].length, 2)
  assert.match(f, /status: \{ not: 'DISCONTINUED' \}/)
  assert.match(f, /capabilities: \{ path: \['trackInventory'\], equals: true \}/)
  assert.match(f, /where: \{ companyId, status: 'DRAFT' \}/)
  assert.match(f, /o\."status" IN \('ORDERED', 'PARTIAL'\)/, 'pedido = órdenes pedidas o recibidas en parte')
  assert.match(f, /t\."status" IN \('SENT', 'PARTIAL'\)/, 'en camino = transferencias enviadas o recibidas en parte')
  assert.match(f, /o\."status" = 'DRAFT'/)
  assert.doesNotMatch(f, /parseFloat|toFixed\(\d\)\)\s*\*/, 'los montos no son flotantes')
})

test('INV-3c · lo PURO de reposición sigue siendo puro, y el componente de la propuesta no arrastra el servidor al navegador', () => {
  const pura = leer('src/modules/inventory/reposicion.ts')
  assert.doesNotMatch(pura, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, 'reposicion.ts debe ser puro')
  assert.doesNotMatch(sinComent(pura), /parseFloat|toFixed\(|Math\.round\(.*costo/, 'los costos viajan como enteros')
  const c = leer('src/components/inventario/ReposicionGrupoCard.tsx')
  for (const origen of [...c.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])) {
    assert.doesNotMatch(origen, /modules\/inventory\/(domain|service|queries|auditoria|errores|barrido|importar|errores-pantalla|compras-service|compras-queries|reposicion-queries)$/, `importa ${origen}`)
    assert.doesNotMatch(origen, /^@prisma\/client$|lib\/prisma$|lib\/tenant$/, `importa ${origen}`)
  }
})

test('INV-3c · la migración solo AÑADE una columna con valor por defecto constante, su CHECK sin bloquear la tabla y un índice parcial', () => {
  const sql = leer('prisma/migrations/20261066_inventory_reorder/migration.sql')
  const sinNotas = sql.replace(/^--.*$/gm, '')
  assert.doesNotMatch(sinNotas, /\bDROP\s+(TABLE|COLUMN|TYPE|CONSTRAINT|INDEX)\b/i, 'no borra nada')
  assert.doesNotMatch(sinNotas, /\bTRUNCATE\s+TABLE|\bDELETE\s+FROM|\bUPDATE\s+"/i, 'no toca filas')
  for (const crea of sinNotas.matchAll(/CREATE\s+(TABLE|UNIQUE INDEX|INDEX)\s+(IF NOT EXISTS)?/gi)) assert.ok(crea[2], `«${crea[0]}» sin IF NOT EXISTS: no es idempotente`)
  const alteraciones = [...sinNotas.matchAll(/ALTER\s+TABLE\s+"(\w+)"\s+([^;]*);/gi)]
  for (const [, tabla] of alteraciones) assert.equal(tabla, 'inventory_levels', `toca la tabla «${tabla}»`)
  assert.match(sinNotas, /ADD COLUMN IF NOT EXISTS "targetStock" INTEGER NOT NULL DEFAULT 0;/, 'una columna con DEFAULT constante: no reescribe la tabla')
  assert.match(sinNotas, /"targetStock" >= 0 AND "targetStock" <= 1000000\) NOT VALID;/, 'el CHECK se crea sin bloquear')
  assert.match(sinNotas, /VALIDATE CONSTRAINT "inventory_levels_objetivo"/, 'y se valida aparte')
  assert.match(sinNotas, /CREATE INDEX IF NOT EXISTS "inventory_levels_objetivo_idx" ON "inventory_levels" \("companyId"\) WHERE "targetStock" > 0;/, 'índice PARCIAL: las ventas no pagan por él')
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20261066_inventory_reorder/)
  // Y el esquema de Prisma declara lo mismo.
  assert.match(leer('prisma/schema/inventario.prisma'), /targetStock Int @default\(0\)/)
})

test('INV-3c · /api/health avisa si falta la columna de «llenar hasta» (despliegue adelantado a la base)', () => {
  const h = leer('src/app/api/health/route.ts')
  assert.match(h, /inventory_levels\.targetStock', EXISTS \([\s\S]*table_name = 'inventory_levels' AND column_name = 'targetStock'\)/)
})

test('INV-3c · el catálogo de funciones dice que «comprar» incluye la reposición, y la ficha de la sucursal ofrece «llenar hasta» solo a quien puede ajustar', () => {
  const comprar = FUNCIONES_POR_SECCION.inventario?.find((f) => f.codigo === 'comprar')
  assert.ok(comprar && /reposici/i.test(comprar.label), 'la etiqueta menciona la reposición')
  const card = leer('src/components/inventario/SucursalInventarioCard.tsx')
  const ajustar = card.slice(card.indexOf('{puedeAjustar ? ('))
  assert.match(ajustar, /aria-label=\{`Llenar hasta en \$\{saldo\.nombre\}`\}/, 'el formulario está dentro de la rama «puedeAjustar»')
  assert.ok(ajustar.indexOf('Llenar hasta en') < ajustar.indexOf('No tienes permiso para mover existencias'), 'va antes del mensaje de «sin permiso»')
})

// ── INV-4a · informes de existencias ─────────────────────────────────────────

const REPORTES = 'src/app/(admin)/admin/inventario/reportes'

test('INV-4a · las tres descargas se guardan ANTES de tocar la base, la empresa sale de la sesión y el costo solo se lee con «costos»', () => {
  for (const [informe, lectura] of [
    ['kardex', 'kardexEnTx'],
    ['sin-ventas', 'sinVentasEnTx'],
    ['rotacion', 'rotacionEnTx'],
  ] as const) {
    const s = sinComent(leer(`${REPORTES}/${informe}/exportar/route.ts`))
    assert.match(s, /requireSection\('inventario'\)/, informe)
    assert.doesNotMatch(s, /requireSection\('inventario', '/, `${informe}: la función «costos» NO es requisito para descargar: solo decide si el archivo lleva dinero`)
    assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/, informe)
    assert.match(s, /resolveCompanyId\(user\)/, informe)
    assert.ok(s.indexOf('requireSection(') < s.indexOf('conEmpresa('), `${informe} toca la base antes de autorizar`)
    assert.match(s, /const conCostos = await puedeFuncion\('inventario', 'costos'\)/, informe)
    assert.ok(s.indexOf("puedeFuncion('inventario', 'costos')") < s.indexOf('conEmpresa('), `${informe}: decide los costos antes de leer`)
    assert.match(s, new RegExp(`${lectura}\\(tx, companyId, [^)]*[{,]\\s*conCostos\\s*[,}]`), `${informe} no pasa SU conCostos a la lectura (ni un true fijo)`)
    assert.doesNotMatch(s, /\bprisma\./, informe)
    assert.match(s, /respuestaCsv\(/, informe)
    // La sucursal de la URL solo filtra si es de la empresa.
    assert.match(s, /sucursalesDeLaEmpresaEnTx\(tx, companyId\)/, informe)
    assert.match(s, /delete f\.sucursalId/, informe)
  }
  // El kardex además exige un producto y responde 404 si no es de la empresa.
  const k = sinComent(leer(`${REPORTES}/kardex/exportar/route.ts`))
  assert.match(k, /if \(!pedido\.varianteId\) return NextResponse\.json\(\{ error: 'Falta el producto del kardex\.' \}, \{ status: 400 \}\)/)
  assert.match(k, /if \(!r\.kardex\) return NextResponse\.json\(\{ error: 'Producto no encontrado\.' \}, \{ status: 404 \}\)/)
  // Las otras dos traen todo (hasta su tope), no solo una página.
  assert.match(sinComent(leer(`${REPORTES}/sin-ventas/exportar/route.ts`)), /todas: true/)
  assert.match(sinComent(leer(`${REPORTES}/rotacion/exportar/route.ts`)), /todas: true/)
})

test('INV-4a · las pantallas piden los costos a la función «costos», se los pasan a la lectura y enseñan dinero solo si la lectura lo trajo', () => {
  for (const [informe, lectura] of [
    ['kardex', 'kardexEnTx'],
    ['sin-ventas', 'sinVentasEnTx'],
    ['rotacion', 'rotacionEnTx'],
  ] as const) {
    const s = sinComent(leer(`${REPORTES}/${informe}/page.tsx`))
    assert.match(s, /const conCostos = await puedeFuncion\('inventario', 'costos'\)/, informe)
    assert.match(s, new RegExp(`${lectura}\\(tx, companyId, [^)]*[{,]\\s*conCostos\\s*[,}]`), `${informe} no pasa SU conCostos (ni un true fijo)`)
    assert.doesNotMatch(s, /\|\|\s*(true|1)\b/, `${informe}: una condición que siempre se cumple`)
    assert.match(s, /<NavegacionInventario actual="reportes"/, informe)
    assert.match(s, /<BotonExportar /, `${informe}: usa el botón compartido`)
    assert.doesNotMatch(s, /<a [^>]*exportar|download=/, `${informe}: sin botón de exportar a mano`)
    assert.match(s, /describirFalloDeCarga\(/, `${informe}: dice por qué no cargó`)
    // Cada montón de dinero va detrás de una condición que depende de los costos.
    for (const uso of s.matchAll(/formatear(?:Monto|Costo)\(/g)) {
      const antes = s.slice(Math.max(0, uso.index! - 400), uso.index!)
      assert.match(antes, /conCostos|v\.valorado|v\.resumen\.valor !== null|k\.conCostos/, `${informe}: dinero sin condición de costos → …${antes.slice(-120)}`)
    }
  }
  assert.match(sinComent(leer(`${REPORTES}/page.tsx`)), /puedeFuncion\('inventario', 'costos'\)/, 'el hub solo habla de dinero a quien puede verlo')
  // Cada bloque de dinero cuelga de SU condición, escrita junto a él (el tipo ya obliga en los que pueden ser null; en el kardex no).
  const kardexPagina = sinComent(leer(`${REPORTES}/kardex/page.tsx`))
  assert.match(kardexPagina, /\{conCostos && <p[^>]*>valieron \{formatearMonto\(k\.totales\.valorEntradas\)\}<\/p>\}/)
  assert.match(kardexPagina, /\{conCostos && <p[^>]*>costaron \{formatearMonto\(k\.totales\.valorSalidas\)\}<\/p>\}/)
  assert.match(kardexPagina, /\{conCostos && \(k\.totales\.entradasSinCosto > 0 \|\| k\.totales\.salidasSinCosto > 0\) && \(/)
  assert.match(kardexPagina, /\{conCostos && \(m\.entra > 0 \|\| m\.sale > 0\) && \(/)
  const sinVentasPagina = sinComent(leer(`${REPORTES}/sin-ventas/page.tsx`))
  assert.match(sinVentasPagina, /\{v\.resumen\.valor !== null && \(\s*<Card aria-label="Dinero parado">/)
  assert.match(sinVentasPagina, /\{conCostos && \(v\.resumen\.unidadesSinCosto \?\? 0\) > 0 && \(/)
  assert.match(sinVentasPagina, /\{conCostos &&\s*\(l\.valor === null \|\| l\.costo === null/)
  const rotacionPagina = sinComent(leer(`${REPORTES}/rotacion/page.tsx`))
  assert.match(rotacionPagina, /\{v\.valorado && \(\s*<>/)
  assert.match(rotacionPagina, /\{v\.valorado && v\.valorado\.unidadesSinCosto > 0 && \(/)
})

test('INV-4a · «Reportes» se ofrece a todo quien tiene el inventario (no pide «costos» ni «comprar»), y la ficha del producto enlaza a su kardex', () => {
  const nav = sinComent(leer('src/components/inventario/NavegacionInventario.tsx'))
  assert.match(nav, /id: 'reportes'[\s\S]*href: '\/admin\/inventario\/reportes'/)
  assert.match(nav, /export type VistaInventario = [^\n]*'reportes'/)
  assert.doesNotMatch(nav, /REQUIEREN_COMPRAR[^\n]*'reportes'/)
  assert.doesNotMatch(nav, /v\.id !== 'reportes'/)
  for (const ruta of ['/admin/inventario/reportes', '/admin/inventario/reportes/kardex', '/admin/inventario/reportes/sin-ventas/exportar']) assert.equal(adminSectionForPath(ruta), 'inventario', ruta)
  assert.match(sinComent(leer('src/app/(admin)/admin/inventario/[varianteId]/page.tsx')), /\/admin\/inventario\/reportes\/kardex\?variante=\$\{detalle\.varianteId\}/)
})

test('INV-4a · las lecturas de los informes solo LEEN, escriben la empresa en CADA consulta y no leen costos sin «conCostos»', () => {
  const f = sinComent(leer('src/modules/inventory/reportes-queries.ts'))
  assert.doesNotMatch(f, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM/i, 'una lectura no escribe')
  // Con `(?=…)` la ventana de 140 caracteres no se «come» la consulta siguiente: dos llamadas pegadas se revisan las dos.
  const lecturas = [...f.matchAll(/tx\.(\w+)\.(findFirst|findMany|count)\(\{\s*where: \{(?=([\s\S]{0,140}))/g)]
  assert.equal(lecturas.length, 6, 'producto, sucursal, saldos, movimientos y las dos búsquedas; si cambia, revisa esta prueba')
  for (const [llamada, , , donde] of lecturas) assert.match(donde, /companyId/, `una consulta no filtra por empresa → ${llamada.slice(0, 90)}…`)
  const sqls = [...f.matchAll(/\$queryRaw<[^>]*>`([\s\S]*?)`/g)]
  assert.equal(sqls.length, 4, 'efectos del kardex, resumen y filas de sin ventas, y rotación')
  // «Stock sin ventas» arma su FROM/WHERE una vez (`desde`) y lo usa el resumen y las filas: la empresa tiene que estar ahí.
  const desde = f.match(/const desde = Prisma\.sql`([\s\S]*?)`\n/)
  assert.ok(desde, 'ya no hay un fragmento `desde`; revisa esta prueba')
  assert.match(desde[1], /l\."companyId" = \$\{companyId\}/, 'el fragmento compartido de «sin ventas» no filtra por empresa')
  assert.match(desde[1], /m\."companyId" = l\."companyId"/, 'la subconsulta de ventas tampoco se sale de la empresa')
  for (const [, texto] of sqls) assert.ok(/"companyId" = \$\{companyId\}/.test(texto) || texto.includes('${desde}'), `un SQL a mano sin empresa → ${texto.trim().slice(0, 80)}…`)
  // La rotación junta tres tablas por producto (productos, saldos y movimientos): cada una acota por empresa, no basta con una.
  const rotacion = sqls.map(([, texto]) => texto).find((texto) => texto.includes('"vendidas"') && texto.includes('catalog_variants'))
  assert.ok(rotacion, 'ya no se encuentra el SQL de la rotación; revisa esta prueba')
  for (const alias of ['v', 'l', 'm']) assert.match(rotacion, new RegExp(`${alias}\\."companyId" = \\$\\{companyId\\}`), `la rotación no acota «${alias}» por empresa`)
  // Y el de los efectos del kardex, que mira movimientos por el id del saldo, también acota los movimientos.
  const efectos = sqls.map(([, texto]) => texto).find((texto) => texto.includes('"desdeInicio"'))
  assert.ok(efectos && /m\."companyId" = \$\{companyId\}/.test(efectos), 'los efectos del kardex no acotan los movimientos por empresa')
  // El costo del movimiento solo se selecciona con la función; en SQL es un NULL constante y la tabla de costos ni se une.
  assert.match(f, /\.\.\.\(opciones\.conCostos \? \{ unitCost: true \} : \{\}\)/)
  assert.match(f, /opciones\.conCostos \? Prisma\.sql`COALESCE\(c\."averageCost", v\."cost"\)` : Prisma\.sql`NULL::numeric`/)
  assert.match(f, /opciones\.conCostos \? Prisma\.sql`LEFT JOIN "inventory_variant_costs" c ON c\."catalogVariantId" = v\."id" AND c\."companyId" = v\."companyId"` : Prisma\.empty/)
  assert.match(f, /if \(opciones\.conCostos\) \{\s*const costoVentas = await costoDeVentasEnRangoEnTx/, 'el costo de ventas y el valor del inventario solo se leen con la función')
  // Las reservas no mueven existencias: fuera del kardex.
  assert.match(f, /type: \{ notIn: \['RESERVATION', 'RESERVATION_RELEASE'\] \}/)
  assert.doesNotMatch(f, /parseFloat|toFixed\(\d\)\)\s*\*/, 'los montos no son flotantes')
})

test('INV-4a · lo PURO de los informes sigue siendo puro', () => {
  const pura = leer('src/modules/inventory/reportes.ts')
  assert.doesNotMatch(pura, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, 'reportes.ts debe ser puro')
  assert.doesNotMatch(sinComent(pura), /parseFloat|Math\.round\(.*costo/, 'los costos viajan como enteros')
  // La exportación solo importa TIPOS de las lecturas (si no, arrastraría Prisma a quien la use en pruebas puras).
  const exp = leer('src/modules/inventory/exportacion.ts')
  assert.match(exp, /import type \{ KardexVista, RotacionVista, SinVentasVista \} from '\.\/reportes-queries'/)
})

// ── INV-4b · motivos codificados y mermas por motivo ─────────────────────────

test('INV-4b · la migración solo AÑADE una columna sin valor por defecto y dos CHECK sin bloquear la tabla; no crea índices ni toca filas', () => {
  const sql = leer('prisma/migrations/20261067_inventory_reason_codes/migration.sql')
  const sinNotas = sql.replace(/^--.*$/gm, '')
  assert.doesNotMatch(sinNotas, /\bDROP\s+(TABLE|COLUMN|TYPE|CONSTRAINT|INDEX)\b/i, 'no borra nada')
  assert.doesNotMatch(sinNotas, /\bTRUNCATE\s+TABLE|\bDELETE\s+FROM|\bUPDATE\s+"/i, 'no toca filas (el ledger no se reescribe)')
  assert.doesNotMatch(sinNotas, /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i, 'sin índice nuevo: la tabla que escribe cada venta no paga por un informe')
  const alteraciones = [...sinNotas.matchAll(/ALTER\s+TABLE\s+"(\w+)"\s+([^;]*);/gi)]
  assert.ok(alteraciones.length >= 3)
  for (const [, tabla] of alteraciones) assert.equal(tabla, 'inventory_movements', `toca la tabla «${tabla}»`)
  assert.match(sinNotas, /ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;/, 'una columna NULL sin DEFAULT ni NOT NULL: no reescribe la tabla')
  assert.doesNotMatch(sinNotas, /"reasonCode" TEXT\s+(NOT NULL|DEFAULT)/i)
  assert.match(sinNotas, /"reasonCode" ~ '\^\[A-Z\]\[A-Z0-9_\]\{1,39\}\$'\) NOT VALID;/, 'el formato del código, sin bloquear')
  assert.match(sinNotas, /"reasonCode" IS NULL OR "type" IN \('ADJUSTMENT', 'DAMAGE'\]?\)\) NOT VALID;|"reasonCode" IS NULL OR "type" IN \('ADJUSTMENT', 'DAMAGE'\)\) NOT VALID;/, 'solo los ajustes y los daños llevan código')
  assert.equal([...sinNotas.matchAll(/VALIDATE CONSTRAINT/g)].length, 2, 'cada CHECK se valida aparte')
  assert.equal([...sinNotas.matchAll(/duplicate_object/g)].length, 2, 'cada CHECK es idempotente')
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20261067_inventory_reason_codes/)
  assert.match(leer('prisma/schema/inventario.prisma'), /reasonCode String\?\n/)
})

test('INV-4b · /api/health avisa si falta la columna del motivo (despliegue adelantado a la base)', () => {
  const h = leer('src/app/api/health/route.ts')
  assert.match(h, /inventory_movements\.reasonCode', EXISTS \([\s\S]*table_name = 'inventory_movements' AND column_name = 'reasonCode'\)/)
})

test('INV-4b · el código del motivo se escribe en las DOS puertas del ledger y nada más lo escribe; solo un ajuste o un daño lo lleva', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  assert.equal([...svc.matchAll(/reasonCode:/g)].length, 2, 'una vez por puerta')
  assert.match(svc, /reasonCode: meta\.motivoCodigo \?\? null,/, 'escribirMovimiento')
  assert.match(svc, /reasonCode: i\.meta\.motivoCodigo \?\? null,/, 'escribirMovimientosPorLote')
  assert.match(svc, /if \(meta\.motivoCodigo && m\.type !== 'ADJUSTMENT' && m\.type !== 'DAMAGE'\) fallo\('MOTIVO_NO_APLICA'/, 'la puerta también lo vigila, no solo la base')
  // Ningún otro archivo del inventario escribe en el ledger con un código.
  for (const archivo of readdirSync('src/modules/inventory').filter((a) => a.endsWith('.ts') && a !== 'service.ts')) {
    const t = sinComent(leer(`src/modules/inventory/${archivo}`))
    assert.doesNotMatch(t, /reasonCode:\s+(?!true\b)/, `${archivo} escribe un código fuera de las dos puertas (leerlo con \`reasonCode: true\` sí vale)`)
  }
  // El código sale del motivo que se eligió, validado por clase, y el texto nunca queda vacío.
  assert.match(svc, /resolverMotivo\(\{ clase, codigo: e\.motivoCodigo, detalle: e\.motivo, exigirCodigo: e\.exigirMotivoCodificado === true, textoObligatorio: true \}\)/)
})

test('INV-4b · ajuste, daño y baja piden el motivo de su clase; recuperar lo dañado no; el conteo pone el suyo solo (en sus dos caminos)', () => {
  const svc = sinComent(leer('src/modules/inventory/service.ts'))
  assert.match(svc, /const m = motivoCodificado\(e, 'DANO'\)/)
  assert.match(svc, /const m = motivoCodificado\(e, sube \? 'SOBRANTE' : 'FALTANTE'\)/)
  assert.match(svc, /e\.destino === 'BAJA' \? motivoCodificado\(e, 'BAJA'\) : \{ codigo: null, texto: motivoValido\(e\.motivo, true\) \}/)
  assert.match(svc, /if \(e\.destino === 'VENDIBLE' && e\.motivoCodigo\) fallo\('MOTIVO_NO_APLICA'/)
  // Los dos conteos: el manual (una puerta) y el de una sesión (la del lote).
  assert.match(svc, /referencia: \{ tipo: 'STOCK_COUNT', id: randomUUID\(\) \}, motivoCodigo: MOTIVO_DE_CONTEO \}/)
  assert.match(svc, /meta: \{\s*userId: ctx\.actorId,\s*referencia: \{ tipo: 'STOCK_COUNT', id: conteo\.id \},\s*motivoCodigo: MOTIVO_DE_CONTEO,/)
  // Las pantallas lo EXIGEN (el servicio, para los procesos que no eligen uno, no).
  const acciones = sinComentarios
  for (const [funcion, destino] of [['registrarDanoInventario', null], ['ajustarInventario', null], ['resolverDanadoInventario', 'BAJA']] as const) {
    const cuerpo = acciones.slice(acciones.indexOf(`export async function ${funcion}`)).split('\n}\n')[0]
    assert.match(cuerpo, /exigirMotivoCodificado: true/, `${funcion} no exige el motivo`)
    assert.match(cuerpo, /motivoCodigo: e\.motivoCodigo as string \| null/, funcion)
    if (destino) assert.match(cuerpo, /e\.destino === 'BAJA' \? \{ motivoCodigo/, 'solo la baja pide motivo del catálogo, recuperar no')
  }
  for (const sinMotivo of ['registrarEntradaInventario', 'registrarDevolucionInventario']) {
    const cuerpo = acciones.slice(acciones.indexOf(`export async function ${sinMotivo}`)).split('\n}\n')[0]
    assert.doesNotMatch(cuerpo, /motivoCodigo|exigirMotivoCodificado/, `${sinMotivo} no se explica con un motivo del catálogo`)
  }
})

test('INV-4b · lo puro del catálogo sigue siendo puro (lo importa un componente del navegador) y el formulario no arrastra el servidor', () => {
  for (const archivo of ['motivos.ts', 'mermas.ts']) {
    const pura = leer(`src/modules/inventory/${archivo}`)
    assert.doesNotMatch(pura, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, `${archivo} debe ser puro`)
    assert.doesNotMatch(sinComent(pura), /parseFloat|Math\.round\(.*costo/, `${archivo}: los costos viajan como enteros`)
  }
  const form = leer('src/components/inventario/SucursalInventarioCard.tsx')
  for (const origen of [...form.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])) {
    assert.doesNotMatch(origen, /modules\/inventory\/(service|queries|auditoria|errores|barrido|importar|errores-pantalla|compras-service|compras-queries|reposicion-queries|reportes-queries|mermas-queries)$/, `importa ${origen}`)
    assert.doesNotMatch(origen, /^@prisma\/client$|lib\/prisma$|lib\/tenant$/, `importa ${origen}`)
  }
  assert.match(form, /name="motivoCodigo"\s+required/, 'el selector del motivo es obligatorio en el navegador también')
  assert.match(form, /def\.claseMotivo && motivoCodigo === ''/, 'y se comprueba antes de enviar')
})

test('INV-4b · la descarga de mermas se guarda ANTES de tocar la base, la empresa sale de la sesión y el costo solo se lee con «costos»', () => {
  const s = sinComent(leer(`${REPORTES}/mermas/exportar/route.ts`))
  assert.match(s, /requireSection\('inventario'\)/)
  assert.doesNotMatch(s, /requireSection\('inventario', '/, 'la función «costos» NO es requisito para descargar: solo decide si el archivo lleva dinero')
  assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/)
  assert.match(s, /resolveCompanyId\(user\)/)
  assert.ok(s.indexOf('requireSection(') < s.indexOf('conEmpresa('), 'toca la base antes de autorizar')
  assert.match(s, /const conCostos = await puedeFuncion\('inventario', 'costos'\)/)
  assert.ok(s.indexOf("puedeFuncion('inventario', 'costos')") < s.indexOf('conEmpresa('))
  assert.match(s, /mermasEnTx\(tx, companyId, f, \{[^}]*[{,]\s*conCostos\s*[,}]/, 'pasa SU conCostos (ni un true fijo)')
  assert.match(s, /todas: true/)
  assert.doesNotMatch(s, /\bprisma\./)
  assert.match(s, /sucursalesDeLaEmpresaEnTx\(tx, companyId\)/)
  assert.match(s, /delete f\.sucursalId/)
  // La pantalla pide los costos a la misma función y enseña dinero solo con ella.
  const p = sinComent(leer(`${REPORTES}/mermas/page.tsx`))
  assert.match(p, /const conCostos = await puedeFuncion\('inventario', 'costos'\)/)
  assert.match(p, /mermasEnTx\(tx, companyId, f, \{[^}]*[{,]\s*conCostos\s*[,}]/)
  assert.match(p, /<NavegacionInventario actual="reportes"/)
  assert.match(p, /<BotonExportar /)
  assert.match(p, /describirFalloDeCarga\(/)
  assert.doesNotMatch(p, /\|\|\s*(true|1)\b/, 'una condición que siempre se cumple')
  assert.match(p, /\{conCostos && \(v\.grupos\.PERDIDA\.total\.unidadesSinCosto \?\? 0\) > 0 && \(/)
  assert.match(p, /\{conCostos && \(m\.valor !== null && m\.costo !== null \?/)
  assert.match(p, /\{conCostos && fila\.valor !== null && ` · \$\{formatearMonto\(fila\.valor\)\}`\}/)
  assert.match(p, /\{t\.valor !== null && ` · \$\{formatearMonto\(t\.valor\)\}`\}/, 'el total solo trae valor si la lectura lo trajo')
  assert.match(sinComent(leer(`${REPORTES}/page.tsx`)), /\/admin\/inventario\/reportes\/mermas/, 'el hub ofrece el informe')
  assert.equal(adminSectionForPath('/admin/inventario/reportes/mermas'), 'inventario')
  assert.equal(adminSectionForPath('/admin/inventario/reportes/mermas/exportar'), 'inventario')
})

test('INV-4b · las lecturas de mermas solo LEEN, escriben la empresa en CADA consulta y no leen costos sin «conCostos»', () => {
  const f = sinComent(leer('src/modules/inventory/mermas-queries.ts'))
  assert.doesNotMatch(f, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM/i, 'una lectura no escribe')
  const sqls = [...f.matchAll(/\$queryRaw<[\s\S]*?>`([\s\S]*?)`\n/g)]
  assert.equal(sqls.length, 2, 'los agregados por motivo y el detalle')
  for (const [, texto] of sqls) assert.ok(/"companyId" = \$\{companyId\}/.test(texto) || texto.includes('${desdeSql}'), `un SQL a mano sin empresa → ${texto.trim().slice(0, 80)}…`)
  // INV-4c: el FROM/WHERE vive en UNA función que comparten el informe y el total del dashboard.
  const desde = f.match(/function desdeMermasSql\([^)]*\): Prisma\.Sql \{\s*return Prisma\.sql`([\s\S]*?)`\n\}/)
  assert.ok(desde, 'ya no hay una función `desdeMermasSql`; revisa esta prueba')
  for (const alias of ['l', 'v', 'i', 's']) assert.match(desde[1], new RegExp(`${alias}\\."companyId" = m\\."companyId"|${alias}\\."companyId" = l\\."companyId"|${alias}\\."companyId" = v\\."companyId"`), `el JOIN de «${alias}» no acota por empresa`)
  assert.match(desde[1], /m\."companyId" = \$\{companyId\}/, 'los movimientos se acotan por la empresa de la sesión')
  assert.match(desde[1], /m\."type" IN \('ADJUSTMENT', 'DAMAGE'\)/, 'solo ajustes y daños')
  // El costo del movimiento es un NULL constante sin la función: ni siquiera se lee.
  assert.match(f, /function costoDeMermasSql\(conCostos: boolean\): Prisma\.Sql \{\s*return conCostos \? Prisma\.sql`m\."unitCost"` : Prisma\.sql`NULL::numeric`\s*\}/)
  assert.equal([...f.matchAll(/unitCost/g)].length, 1, 'el costo solo se nombra en esa función')
  // Y los dos que la llaman le pasan lo que la persona puede ver, nunca un `true` fijo.
  assert.match(f, /const costoSql = costoDeMermasSql\(opciones\.conCostos\)/)
  assert.match(f, /costoDeMermasSql\(conCostos\), conCostos\)/, 'el total de lo perdido (dashboard) tampoco lee costos sin permiso')
  // La clase en SQL es la misma regla que `claseDeMovimiento`, en el mismo orden (la baja antes que el faltante).
  const clase = f.match(/const CLASE_SQL = Prisma\.sql`([\s\S]*?)`\n/)![1]
  assert.ok(clase.indexOf("'BAJA'") < clase.indexOf("'FALTANTE'"), 'la baja se decide antes que el faltante')
  assert.doesNotMatch(f, /parseFloat|toFixed\(\d\)\)\s*\*/, 'los montos no son flotantes')
})

// ── INV-4c · margen real y tarjeta del dashboard ─────────────────────────────

test('INV-4c · el margen es información de COSTOS: la pantalla solo lee con la función y la descarga se guarda con ella ANTES de tocar la base', () => {
  const r = sinComent(leer(`${REPORTES}/margen/exportar/route.ts`))
  assert.match(r, /requireSection\('inventario', 'costos'\)/, 'sin la función «costos» no hay archivo, ni uno sin costos')
  assert.match(r, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/)
  assert.match(r, /resolveCompanyId\(user\)/, 'la empresa sale de la sesión')
  assert.ok(r.indexOf('requireSection(') < r.indexOf('conEmpresa('), 'toca la base antes de autorizar')
  assert.doesNotMatch(r, /searchParams\.get\('(empresa|company|companyId)'\)/, 'la empresa no sale de la URL')
  assert.match(r, /margenEnTx\(tx, companyId, f, \{[^}]*todas: true/)
  assert.doesNotMatch(r, /\bprisma\./)
  assert.match(r, /sucursalesDeLaEmpresaEnTx\(tx, companyId\)/)
  assert.match(r, /delete f\.sucursalId/, 'una sucursal ajena no filtra')

  const p = sinComent(leer(`${REPORTES}/margen/page.tsx`))
  assert.match(p, /const puedeCostos = await puedeFuncion\('inventario', 'costos'\)/)
  // La lectura vive dentro de `if (puedeCostos)`: sin la función ni siquiera se pide.
  const lectura = p.indexOf('margenEnTx(tx, companyId, f')
  assert.ok(p.indexOf('if (puedeCostos) {') >= 0, 'la lectura se pide solo bajo `if (puedeCostos)`')
  assert.ok(lectura > p.indexOf('if (puedeCostos) {'), 'la lectura va dentro de la condición de costos')
  assert.equal([...p.matchAll(/margenEnTx\(/g)].length, 1, 'una sola lectura (la que está tras la condición)')
  assert.match(p, /!puedeCostos \?/, 'sin la función, la pantalla lo dice en vez de enseñar cifras')
  assert.match(p, /puedeCostos && datos && v \? <BotonExportar /, 'el botón de descarga solo existe con la función')
  assert.match(p, /<NavegacionInventario actual="reportes"/)
  assert.match(p, /describirFalloDeCarga\(/)
  assert.doesNotMatch(p, /\|\|\s*(true|1)\b/, 'una condición que siempre se cumple')
  assert.equal(adminSectionForPath('/admin/inventario/reportes/margen'), 'inventario')
  assert.equal(adminSectionForPath('/admin/inventario/reportes/margen/exportar'), 'inventario')

  // El hub ofrece el informe SOLO a quien tiene la función.
  const hub = sinComent(leer(`${REPORTES}/page.tsx`))
  assert.match(hub, /href: '\/admin\/inventario\/reportes\/margen'[\s\S]*?soloCostos: true/, 'el informe del margen está marcado «solo con costos»')
  assert.match(hub, /informes\.filter\(\(i\) => !i\.soloCostos \|\| verCostos\)/)
  assert.equal([...hub.matchAll(/soloCostos: true/g)].length, 1, 'solo el margen exige la función (los demás informes enseñan unidades sin ella)')
})

test('INV-4c · las lecturas del margen solo LEEN, escriben la empresa en CADA consulta y unión, y cuentan solo pedidos completados en la moneda de la empresa', () => {
  const f = sinComent(leer('src/modules/inventory/margen-queries.ts'))
  assert.doesNotMatch(f, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM/i, 'una lectura no escribe')
  const sqls = [...f.matchAll(/\$queryRaw<[\s\S]*?>`([\s\S]*?)`\n/g)]
  assert.equal(sqls.length, 2, 'los totales y las filas')
  for (const [, texto] of sqls) assert.ok(texto.includes('${ventasClasificadasSql('), `un SQL a mano → ${texto.trim().slice(0, 80)}…`)
  const base = f.match(/function ventasClasificadasSql\([^)]*\): Prisma\.Sql \{[\s\S]*?return Prisma\.sql`([\s\S]*?)`\n\}/)
  assert.ok(base, 'ya no hay una función `ventasClasificadasSql`; revisa esta prueba')
  const sql = base[1]
  // Cada tabla se acota por la empresa: los movimientos, las líneas, los pedidos y cada unión.
  assert.match(sql, /m\."companyId" = \$\{p\.companyId\}/)
  assert.match(sql, /ol\."companyId" = \$\{p\.companyId\}/)
  assert.match(sql, /o\."companyId" = \$\{p\.companyId\}/)
  for (const alias of ['l', 'v', 'i']) assert.match(sql, new RegExp(`${alias}\\."companyId" = (m|l|v)\\."companyId"`), `el JOIN de «${alias}» no acota por empresa`)
  // Solo ventas, y solo cuenta el pedido COMPLETADO, en la moneda de la empresa; el reembolsado va aparte.
  assert.match(sql, /m\."type" = 'SALE'/)
  assert.match(sql, /o\."status" NOT IN \('COMPLETED', 'REFUNDED'\) THEN 'SIN_INGRESO'/)
  assert.match(sql, /WHEN o\."status" = 'REFUNDED' THEN 'REEMBOLSADO'/)
  assert.match(sql, /WHEN o\."currency" <> \$\{p\.moneda\} THEN 'OTRA_MONEDA'/)
  assert.ok(sql.indexOf("'REEMBOLSADO'") < sql.indexOf("'MARGEN'"), 'lo reembolsado se decide antes que lo que entra')
  assert.ok(sql.indexOf("'REEMBOLSADO'") < sql.indexOf("'OTRA_MONEDA'"), 'un pedido reembolsado en otra moneda es un reembolso: la clase más informativa decide primero')
  assert.match(sql, /ln\."total" \* p\."cantidad" \/ NULLIF\(ln\."cantidad", 0\)/, 'el ingreso es la línea, en proporción a las unidades vendidas')
  // Las filas del informe solo traen lo que entra, y los ORDER BY son fragmentos fijos (la URL elige uno, no se concatena).
  assert.match(f, /WHERE c\."clase" = 'MARGEN'/)
  assert.match(f, /ORDER BY \$\{ORDEN_SQL\[f\.orden\]\}, x\."sku" ASC, x\."varianteId" ASC/)
  assert.doesNotMatch(f, /Prisma\.raw\(|\$queryRawUnsafe/, 'nada se concatena a mano')
  assert.match(f, /m\."createdAt" >= \$\{p\.gte\} AND m\."createdAt" < \$\{p\.lt\}/)
  assert.doesNotMatch(f, /parseFloat|toFixed\(\d\)\)\s*\*/, 'los montos no son flotantes')
})

test('INV-4c · la tarjeta del dashboard: sin la sección no se lee nada, sin «costos» no se lee ni un costo, y el dinero solo se pinta con ellos', () => {
  // Desde la fase 5 la tarjeta es un componente que carga solo (`InventarioResumen`, dentro de un <Suspense> del Resumen).
  const d = sinComent(leer('src/components/admin/resumen/InventarioResumen.tsx'))
  assert.match(d, /const user = await requireSection\('inventario'\)/)
  assert.match(d, /await usuarioPuedeFuncion\(user, 'inventario', 'costos'\)/)
  assert.match(d, /resumenInventarioEmpresa\(companyId, zonaHoraria, \{ conCostos \}\)/, 'con la sección, SU conCostos (no un true fijo)')
  assert.match(d, /if \(!user\) return null/, 'sin la sección no se pide nada')
  assert.match(d, /\.catch\(\(e\) => \{[\s\S]*?return null/, 'si la tarjeta falla, el Resumen sigue')
  assert.match(d, /<TarjetaInventario resumen=\{resumen\} company=\{company\} \/>/)
  const p = sinComent(leer('src/app/(admin)/admin/dashboard/page.tsx'))
  assert.match(p, /ve\('\/admin\/inventario'\)[\s\S]*?<InventarioResumen/, 'y la página ni la monta si no se puede abrir Inventario')

  const m = sinComent(leer('src/modules/inventory/dashboard.ts'))
  assert.doesNotMatch(m, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|\$queryRaw/, 'solo compone lecturas ya guardadas')
  const costos = m.slice(m.indexOf('if (opciones.conCostos) {'), m.indexOf('} else {'))
  assert.match(costos, /valorTotalEnTx\(tx, companyId\)/)
  assert.match(costos, /totalesDeMargenEnTx\(tx, companyId, rango\)/)
  const sinCostos = m.slice(m.indexOf('} else {'), m.indexOf('const perdido'))
  assert.doesNotMatch(sinCostos, /valorTotalEnTx|totalesDeMargenEnTx|inventoryVariantCost|averageCost|unitCost|cost\b/, 'sin costos no se toca nada de costos')
  assert.equal([...m.matchAll(/valorTotalEnTx\(/g)].length, 1)
  assert.equal([...m.matchAll(/totalesDeMargenEnTx\(/g)].length, 1)
  assert.match(m, /perdidoEnRangoEnTx\(tx, companyId, rango, opciones\.conCostos\)/, 'lo perdido tampoco lee costos sin permiso')

  // El componente enseña dinero solo si la lectura lo trajo (`conCostos`), y es del servidor, sin base de datos.
  const t = sinComent(leer('src/components/admin/TarjetaInventario.tsx'))
  assert.doesNotMatch(t, /from '@\/lib\/(prisma|tenant)'|@prisma\/client'|modules\/inventory\/(service|queries|\w+-queries)'/, 'es de presentación')
  assert.match(t, /\{resumen\.conCostos && resumen\.valor !== null \? \(/)
  assert.match(t, /\{resumen\.conCostos && m !== null \? \(/)
  assert.match(t, /resumen\.conCostos && resumen\.perdido\.valor !== null/)
  assert.equal([...t.matchAll(/dinero\(/g)].length, 3, 'las tres cifras de dinero (valor, margen y lo perdido) pasan por `dinero`, que solo se llama detrás de esas condiciones')
})
