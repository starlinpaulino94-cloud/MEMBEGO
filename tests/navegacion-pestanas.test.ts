import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  breadcrumbs,
  buscarModulos,
  destinosDe,
  ENLACES_ADMIN,
  GRUPOS_HUB_ADMIN,
  pestanasDeModulo,
  resolverRuta,
  rutasOfrecidas,
  visibleGroups,
  visibleWorkspaces,
  type CapacidadNav,
  type ContextoNav,
} from '../src/components/layout/nav-config'
import { adminSectionForPath, resolverPermisosUsuario } from '../src/lib/auth/permissions'
import type { AppRole } from '../src/types'

/**
 * MÓDULOS CON PESTAÑAS (auditoría admin · fase 6; 03 · C.2, C.3 y D).
 *
 * El menú de empresa pasó de 45 entradas a 24: pares como Pagos / Registros / Comprobantes / Conciliación son un módulo con
 * pestañas. Lo que esta fase NO puede hacer es perder una pantalla, abrirle una a quien no podía, ni cambiar una ruta o una
 * sección. Aquí se prueba eso, sin navegador: qué se ofrece a cada rol, a dónde aterriza, que cada pestaña tiene su sección y
 * que ninguna ruta de las de antes se quedó sin módulo.
 *
 * NADA de esto prueba autorización: ofrecer es cosmético, la barrera de cada ruta sigue siendo su guardia de servidor.
 */

const TODAS: CapacidadNav[] = [
  'CITAS', 'SEGUIMIENTO', 'RULETA', 'EXCURSIONES', 'CRM', 'PUBLICACIONES', 'MENSAJERIA',
  'CATALOGO_UNIFICADO', 'PEDIDOS_MEMBEGO', 'DEALS_MARKETPLACE', 'POS_CAJA', 'MEMBEGO_SUPPLIER',
]
/** Una empresa que vende en Membego pero no es proveedora: lo normal. */
const COMERCIO = TODAS.filter((c) => c !== 'MEMBEGO_SUPPLIER')

const de = (role: AppRole, extra: Partial<ContextoNav> = {}): ContextoNav => ({
  role,
  scope: 'COMPANY',
  capacidades: TODAS,
  ...extra,
})

/** Las entradas del hub que ve esta persona, en orden. */
const entradas = (ctx: ContextoNav) =>
  visibleWorkspaces(ctx)
    .filter((w) => w.id === 'empresa')
    .flatMap((w) => w.groups.flatMap((g) => g.items))

const etiquetas = (ctx: ContextoNav) => entradas(ctx).map((i) => i.label)
const pestanasDe = (ctx: ContextoNav, label: string) => entradas(ctx).find((i) => i.label === label)?.pestanas?.map((p) => p.label)

// ── De 45 a 24 ───────────────────────────────────────────────────────────────

test('el administrador con todo encendido ve 24 entradas; el catálogo de destinos sigue completo', () => {
  assert.equal(entradas(de('ADMINISTRADOR')).length, 24)
  // Los 45 destinos de antes siguen ofrecidos: ninguno desapareció, pasaron a ser pestañas.
  assert.ok(ENLACES_ADMIN.length >= 44, `el catálogo de destinos encogió: ${ENLACES_ADMIN.length}`)
  const ofrecidas = new Set(rutasOfrecidas(de('ADMINISTRADOR')))
  const perdidas = ENLACES_ADMIN.map((i) => i.href).filter((h) => !ofrecidas.has(h))
  assert.deepEqual(perdidas, [], 'Destinos que existían y el menú ya no ofrece:\n  ' + perdidas.join('\n  '))
})

test('una empresa que no es proveedora de Membego ve 23; sin comercio de Membego, menos', () => {
  assert.equal(entradas(de('ADMINISTRADOR', { capacidades: COMERCIO })).length, 23)
  // Sin ninguna capacidad: no hay Citas, Catálogo, Pedidos, Parques y Tours, Prospectos, Publicaciones, Caja ni Entregas.
  const sinNada = etiquetas(de('ADMINISTRADOR', { capacidades: [] }))
  for (const fuera of ['Citas', 'Catálogo', 'Pedidos Membego', 'Parques y Tours', 'Prospectos', 'Publicaciones', 'Caja', 'Entregas Membego']) {
    assert.ok(!sinNada.includes(fuera), `«${fuera}» se ofrece sin su capacidad`)
  }
})

test('los ocho grupos del hub conservan su orden y el panel arranca por el Resumen', () => {
  assert.deepEqual(GRUPOS_HUB_ADMIN.map((g) => g.label), [
    'Principal', 'App del cliente', 'Comercio', 'Operaciones', 'Clientes', 'Marketing', 'Analítica', 'Ajustes',
  ])
  assert.equal(entradas(de('ADMINISTRADOR'))[0]?.href, '/admin/dashboard')
})

// ── Qué ve cada rol (03 · C.3) ───────────────────────────────────────────────

test('Supervisor ve ocho entradas, y sin Comprobantes en Pagos', () => {
  const ctx = de('SUPERVISOR', { capacidades: COMERCIO })
  assert.deepEqual(etiquetas(ctx), [
    'Resumen', 'Canjes y QR', 'Citas', 'Pagos', 'Clientes', 'Fidelización', 'Reportes', 'Actividad',
  ])
  assert.deepEqual(pestanasDe(ctx, 'Pagos'), ['Por validar', 'Movimientos', 'Conciliación'])
  assert.deepEqual(pestanasDe(ctx, 'Clientes'), ['Directorio', 'Membresías', 'En riesgo'])
  assert.deepEqual(pestanasDe(ctx, 'Fidelización'), ['Seguimiento'])
})

test('Marketing ve seis entradas, con Clientes reducido a En riesgo y Segmentos', () => {
  const ctx = de('MARKETING', { capacidades: COMERCIO })
  assert.deepEqual(etiquetas(ctx), [
    'Resumen', 'Beneficios y regalos', 'Clientes', 'Comunicaciones', 'Publicaciones', 'Reportes',
  ])
  assert.deepEqual(pestanasDe(ctx, 'Clientes'), ['En riesgo', 'Segmentos'])
  assert.deepEqual(pestanasDe(ctx, 'Reportes'), ['Retención', 'Audiencia', 'Origen'])
  assert.deepEqual(pestanasDe(ctx, 'Comunicaciones'), ['Notificaciones', 'Automatizaciones', 'Campañas segmentadas', 'Campañas'])
})

test('el cajero y el gerente no ven lo que su paquete no trae', () => {
  const cajero = etiquetas(de('CAJERO', { capacidades: COMERCIO }))
  for (const fuera of ['Comunicaciones', 'Fidelización', 'Reportes', 'Equipo', 'Empresa', 'Editor de inicio']) {
    assert.ok(!cajero.includes(fuera), `el cajero ve «${fuera}»`)
  }
  assert.ok(cajero.includes('Pagos') && cajero.includes('Clientes') && cajero.includes('Caja'))
  assert.deepEqual(pestanasDe(de('CAJERO', { capacidades: COMERCIO }), 'Pagos'), ['Por validar', 'Movimientos', 'Comprobantes', 'Conciliación'])
  const gerente = etiquetas(de('GERENTE', { capacidades: COMERCIO }))
  assert.ok(!gerente.includes('Editor de inicio') && !gerente.includes('Comunicaciones'))
  assert.ok(gerente.includes('Equipo') && gerente.includes('Reportes'))
})

// ── Aterriza en la primera pestaña que se ve ─────────────────────────────────

test('una entrada aterriza en la primera pestaña VISIBLE, no en la primera que existe', () => {
  // Marketing no abre Clientes: su entrada de Clientes aterriza en «En riesgo».
  assert.equal(entradas(de('MARKETING')).find((i) => i.label === 'Clientes')?.href, '/admin/riesgo')
  // Supervisión solo tiene Seguimiento dentro de Fidelización.
  assert.equal(entradas(de('SUPERVISOR')).find((i) => i.label === 'Fidelización')?.href, '/admin/seguimiento')
  // A quien se le niega Pagos le queda Pagos con Movimientos, y aterriza ahí.
  const sinPagos = de('ADMINISTRADOR', { permisos: resolverPermisosUsuario({ v: 1, secciones: { pagos: false } }) })
  assert.equal(entradas(sinPagos).find((i) => i.label === 'Pagos')?.href, '/admin/registros')
  assert.deepEqual(pestanasDe(sinPagos, 'Pagos'), ['Movimientos', 'Comprobantes', 'Conciliación'])
})

test('una entrada sin ninguna pestaña visible desaparece entera', () => {
  const sinNada = resolverPermisosUsuario({ v: 1, secciones: { pagos: false, registros: false, facturas: false, conciliacion: false } })
  assert.ok(!etiquetas(de('ADMINISTRADOR', { permisos: sinNada })).includes('Pagos'))
})

test('negar una sección quita SOLO su pestaña; las demás siguen', () => {
  const sinConciliacion = resolverPermisosUsuario({ v: 1, secciones: { conciliacion: false } })
  const ctx = de('ADMINISTRADOR', { permisos: sinConciliacion })
  assert.deepEqual(pestanasDe(ctx, 'Pagos'), ['Por validar', 'Movimientos', 'Comprobantes'])
  assert.ok(!rutasOfrecidas(ctx).includes('/admin/conciliacion'))
})

test('«Finanzas» no se ofrece a quien no tiene `reportes › ver_financieros`', () => {
  const sin = resolverPermisosUsuario({ v: 1, funciones: { reportes: { ver_financieros: false } } })
  assert.ok(!(pestanasDe(de('SUPERVISOR', { permisos: sin }), 'Reportes') ?? []).includes('Finanzas'))
  assert.ok((pestanasDe(de('SUPERVISOR'), 'Reportes') ?? []).includes('Finanzas'))
  assert.ok((pestanasDe(de('ADMINISTRADOR'), 'Reportes') ?? []).includes('Finanzas'))
})

test('una pestaña con capacidad se apaga con ella, sin llevarse a las demás', () => {
  const sinRuleta = de('ADMINISTRADOR', { capacidades: TODAS.filter((c) => c !== 'RULETA') })
  assert.ok(!(pestanasDe(sinRuleta, 'Fidelización') ?? []).includes('Ruleta'))
  assert.ok((pestanasDe(sinRuleta, 'Fidelización') ?? []).includes('Regalos'))
  const sinMensajeria = de('ADMINISTRADOR', { capacidades: TODAS.filter((c) => c !== 'MENSAJERIA') })
  assert.deepEqual(pestanasDe(sinMensajeria, 'Soporte'), ['Tickets'])
})

// ── Cada pestaña tiene su sección, y ninguna ruta de antes se pierde ─────────

test('toda pestaña del hub declara una ruta con sección de permisos conocida', () => {
  for (const grupo of GRUPOS_HUB_ADMIN) {
    for (const entrada of grupo.items) {
      for (const p of entrada.pestanas ?? []) {
        assert.ok(p.href.startsWith('/admin/'), `${entrada.label} › ${p.label}: ${p.href} no es una ruta del panel`)
        assert.ok(
          adminSectionForPath(p.href),
          `${entrada.label} › ${p.label} (${p.href}) no resuelve a ninguna AdminSection: Permisos no podría ni concederla ni negarla.`
        )
      }
    }
  }
})

test('la primera pestaña ES la entrada, y ninguna ruta pertenece a dos módulos', () => {
  const dueño = new Map<string, string>()
  for (const grupo of GRUPOS_HUB_ADMIN) {
    for (const entrada of grupo.items) {
      if (!entrada.pestanas) continue
      assert.equal(entrada.href, entrada.pestanas[0]!.href, `${entrada.label}: su href no es el de su primera pestaña`)
      assert.ok(entrada.pestanas.length >= 2, `${entrada.label}: un módulo con una sola pestaña no es un módulo con pestañas`)
      for (const p of entrada.pestanas) {
        const previo = dueño.get(p.href)
        assert.ok(!previo, `${p.href} está en «${previo}» y en «${entrada.label}»`)
        dueño.set(p.href, entrada.label)
      }
    }
  }
})

test('toda ruta de antes —y cualquier subruta suya— sigue resolviendo a un módulo del menú', () => {
  const ctx = de('ADMINISTRADOR')
  for (const destino of ENLACES_ADMIN) {
    const m = resolverRuta(destino.href, ctx)
    assert.ok(m, `${destino.href} («${destino.label}») ya no resuelve a ningún módulo`)
    // Un enlace profundo (la edición de un plan, el detalle de un cliente) cae en el MISMO módulo que su lista.
    for (const hija of ['/nuevo', '/abc123', '/abc123/editar']) {
      assert.equal(resolverRuta(destino.href + hija, ctx)?.href, m!.href, `${destino.href + hija} cae en otro módulo`)
    }
  }
})

test('las rutas históricas siguen resolviendo (referidos, whatsapp, reportes hijos)', () => {
  const ctx = de('ADMINISTRADOR')
  assert.equal(resolverRuta('/admin/referidos', ctx)?.href, '/admin/invitaciones')
  assert.equal(resolverRuta('/admin/promociones/nuevo', ctx)?.href, '/admin/ofertas')
  assert.equal(resolverRuta('/admin/marketing/abc/editar', ctx)?.href, '/admin/ofertas')
  assert.equal(resolverRuta('/admin/ofertas/vip', ctx)?.href, '/admin/ofertas')
  assert.equal(resolverRuta('/admin/reportes/finanzas', ctx)?.href, '/admin/reportes')
  assert.equal(resolverRuta('/admin/integraciones/desarrolladores/claves', ctx)?.href, '/admin/integraciones')
})

// ── La barra del módulo ──────────────────────────────────────────────────────

const barra = (ruta: string, ctx: ContextoNav = de('ADMINISTRADOR')) => pestanasDeModulo(ruta, ctx)
const activa = (ruta: string, ctx: ContextoNav = de('ADMINISTRADOR')) => barra(ruta, ctx)?.pestanas.find((p) => p.activa)?.label

test('en cada pantalla de un módulo, la barra marca SU pestaña', () => {
  assert.equal(barra('/admin/pagos')?.modulo, 'Pagos')
  assert.equal(activa('/admin/pagos'), 'Por validar')
  assert.equal(activa('/admin/registros'), 'Movimientos')
  assert.equal(activa('/admin/facturas'), 'Comprobantes')
  assert.equal(activa('/admin/conciliacion'), 'Conciliación')
  // La misma barra en las cuatro: las pestañas son las mismas, solo cambia la activa.
  const rutas = ['/admin/pagos', '/admin/registros', '/admin/facturas', '/admin/conciliacion']
  const conjuntos = rutas.map((r) => barra(r)!.pestanas.map((p) => p.href).join())
  assert.equal(new Set(conjuntos).size, 1)
})

test('una subpantalla pertenece a la pestaña de su lista', () => {
  assert.equal(activa('/admin/clientes/abc123'), 'Directorio')
  assert.equal(activa('/admin/membresias/abc123'), 'Membresías')
  assert.equal(activa('/admin/planes/abc123/editar'), 'Planes')
  assert.equal(activa('/admin/empleados/nuevo'), 'Personas')
  assert.equal(activa('/admin/empleados/accesos'), 'Accesos')
  assert.equal(activa('/admin/reportes/finanzas'), 'Finanzas')
  assert.equal(activa('/admin/reportes/operacion'), 'Operación')
})

test('exactamente UNA pestaña activa, y ninguna barra donde no toca', () => {
  for (const ruta of ['/admin/pagos', '/admin/clientes', '/admin/reportes', '/admin/invitaciones', '/admin/metodos-pago']) {
    const b = barra(ruta)!
    assert.equal(b.pestanas.filter((p) => p.activa).length, 1, `${ruta}: debe haber una pestaña activa`)
  }
  // Sin barra: entradas sin pestañas, la pantalla que ya trae las suyas y las rutas que no son de ningún módulo.
  for (const ruta of ['/admin/dashboard', '/admin/scanner', '/admin/crm', '/admin/excursiones', '/admin/ofertas', '/admin/promociones', '/admin/nada']) {
    assert.equal(barra(ruta), null, `${ruta} no debería pintar la barra del módulo`)
  }
})

test('con una sola pestaña visible no hay barra (una pestaña no es una barra)', () => {
  assert.equal(barra('/admin/seguimiento', de('SUPERVISOR')), null)
  assert.ok(barra('/admin/riesgo', de('SUPERVISOR')))
})

test('la barra solo trae pestañas que esta persona puede abrir', () => {
  const b = barra('/admin/riesgo', de('MARKETING'))!
  assert.deepEqual(b.pestanas.map((p) => p.label), ['En riesgo', 'Segmentos'])
  assert.ok(!barra('/admin/pagos', de('SUPERVISOR'))!.pestanas.some((p) => p.label === 'Comprobantes'))
})

// ── Migas, buscador y paleta ─────────────────────────────────────────────────

test('las migas dicen el módulo y la pestaña: «Pagos › Conciliación»', () => {
  const c = de('ADMINISTRADOR')
  assert.deepEqual(breadcrumbs('/admin/conciliacion', c).map((m) => m.label), ['Empresa', 'Operaciones', 'Pagos', 'Conciliación'])
  assert.equal(breadcrumbs('/admin/conciliacion', c).at(-2)?.href, '/admin/pagos')
  // En la primera pestaña no se repite: «Pagos» es la entrada y es donde estás.
  assert.deepEqual(breadcrumbs('/admin/pagos', c).map((m) => m.label), ['Empresa', 'Operaciones', 'Pagos'])
  // Una subpantalla de una pestaña nombra la pestaña y luego lo suyo.
  assert.deepEqual(breadcrumbs('/admin/empleados/accesos', c).map((m) => m.label), ['Empresa', 'Ajustes', 'Equipo', 'Accesos'])
})

test('el buscador lleva DIRECTO a una pantalla que ya no tiene entrada de menú', () => {
  const c = de('ADMINISTRADOR')
  assert.equal(buscarModulos('conciliacion', c)[0]?.item.href, '/admin/conciliacion')
  assert.equal(buscarModulos('sinonimos', c)[0]?.item.href, '/admin/sinonimos')
  assert.equal(buscarModulos('metodos de pago', c)[0]?.item.href, '/admin/metodos-pago')
  assert.equal(buscarModulos('comprobantes', c)[0]?.item.href, '/admin/facturas')
  // Y el resultado dice dónde vive, no solo cómo se llama.
  assert.equal(buscarModulos('conciliacion', c)[0]?.item.label, 'Pagos › Conciliación')
})

test('todo lo que se escribía para llegar a una pantalla sigue llegando a ella', () => {
  const c = de('ADMINISTRADOR')
  for (const destino of ENLACES_ADMIN) {
    const hrefs = buscarModulos(destino.label, c, 25).map((r) => r.item.href)
    assert.ok(hrefs.includes(destino.href), `buscar «${destino.label}» ya no encuentra ${destino.href}`)
  }
})

test('el buscador nunca ofrece una pestaña que el menú esconde', () => {
  const c = de('SUPERVISOR')
  assert.deepEqual(buscarModulos('comprobantes', c).map((r) => r.item.href).filter((h) => h === '/admin/facturas'), [])
  assert.ok(buscarModulos('conciliacion', c).some((r) => r.item.href === '/admin/conciliacion'))
})

test('destinosDe lista la entrada y sus otras pestañas, sin repetir la primera', () => {
  const pagos = entradas(de('ADMINISTRADOR')).find((i) => i.label === 'Pagos')!
  assert.deepEqual(destinosDe(pagos).map((d) => d.href), ['/admin/pagos', '/admin/registros', '/admin/facturas', '/admin/conciliacion'])
  const dashboard = entradas(de('ADMINISTRADOR'))[0]!
  assert.equal(destinosDe(dashboard).length, 1)
})

// ── Caja y el menú sin modo equivocado ───────────────────────────────────────

test('Caja se ofrece a quien puede abrirla y con su capacidad (D-09)', () => {
  const ofrece = (role: AppRole, caps: CapacidadNav[] = TODAS) => etiquetas(de(role, { capacidades: caps })).includes('Caja')
  for (const role of ['ADMINISTRADOR', 'GERENTE', 'CAJERO'] as AppRole[]) assert.ok(ofrece(role), `${role} no ve Caja`)
  for (const role of ['MARKETING', 'SUPERVISOR'] as AppRole[]) assert.ok(!ofrece(role), `${role} ve una Caja que no puede abrir`)
  assert.ok(!ofrece('ADMINISTRADOR', COMERCIO.filter((c) => c !== 'POS_CAJA')), 'Caja se ofrece con la capacidad apagada')
})

test('el menú de plataforma y el del mostrador no cambian de forma', () => {
  const plataforma = visibleWorkspaces({ role: 'SUPERADMIN', scope: 'PLATFORM' })[0]!
  assert.deepEqual(plataforma.groups.map((g) => g.label), ['Resumen', 'Negocio', 'Operación', 'Sistema'])
  for (const g of plataforma.groups) for (const i of g.items) assert.equal(i.pestanas, undefined, `${i.label}: la plataforma no usa pestañas todavía`)
  // El mostrador: Escanear QR y, con la capacidad POS_CAJA, Caja. Sin capacidades, solo el escáner.
  const sinCaja: ContextoNav = { role: 'RECEPCION', capacidades: [] }
  const conCaja: ContextoNav = { role: 'RECEPCION', capacidades: ['POS_CAJA'] }
  const rutasMostrador = (c: ContextoNav) => visibleGroups(visibleWorkspaces(c)[0]!, c).flatMap((g) => g.items.map((i) => i.href))
  assert.deepEqual(rutasMostrador(sinCaja), ['/empleado/scanner'])
  assert.deepEqual(rutasMostrador(conCaja), ['/empleado/scanner', '/empleado/caja'])
})

// ── La carcasa ───────────────────────────────────────────────────────────────

test('la carcasa pinta la barra del módulo encima del contenido, y sin decidir nada por rol', () => {
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const shell = sinComentarios(readFileSync('src/components/layout/AppShell.tsx', 'utf8'))
  assert.match(shell, /<PestanasModulo ctx=\{ctx\} \/>\s*\{children\}/, 'la barra va justo encima del contenido')
  const barraTsx = sinComentarios(readFileSync('src/components/layout/PestanasModulo.tsx', 'utf8'))
  assert.match(barraTsx, /pestanasDeModulo\(pathname, ctx\)/, 'qué pestañas hay lo decide nav-config')
  assert.doesNotMatch(barraTsx, /role\s*===/, 'la barra no decide por rol')
  assert.match(barraTsx, /prefetch=\{false\}/, 'sin prefetch, como el menú: cada prefetch de una ruta dinámica cuesta consultas de sesión')
  assert.match(barraTsx, /<NavSeccion/, 'usa la primitiva del sistema de diseño, no una barra propia')
})
