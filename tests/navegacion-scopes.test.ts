import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATERRIZAJE_EMPRESA,
  ATERRIZAJE_PLATAFORMA,
  breadcrumbs,
  canSeeItem,
  CLAVES_BADGE,
  menuEnUnaColumna,
  ofreceEntradaAEmpresa,
  ofreceSalidaAPlataforma,
  visibleWorkspaces,
  workspaceLanding,
  workspaceOf,
  workspacesForRole,
  type ContextoNav,
} from '../src/components/layout/nav-config'
import type { AppRole } from '../src/types'

/**
 * SEPARACIÓN PLATAFORMA / EMPRESA.
 *
 * El superadministrador ve los dos mundos, pero NUNCA juntos: el ámbito del
 * contexto decide cuál se pinta. Estas pruebas vigilan que ningún cambio
 * futuro vuelva a mezclar módulos globales con módulos de una empresa en el
 * mismo riel, y que entrar al panel de una empresa no bloquee al superadmin.
 */

const PLATFORM: ContextoNav = { role: 'SUPERADMIN', scope: 'PLATFORM' }
const EMPRESA_COMO_SA: ContextoNav = { role: 'SUPERADMIN', scope: 'COMPANY' }
const ADMIN: ContextoNav = { role: 'ADMINISTRADOR', scope: 'COMPANY' }

const hrefsDe = (c: ContextoNav) =>
  visibleWorkspaces(c).flatMap((w) => w.groups.flatMap((g) => g.items.map((i) => i.href)))

test('en PLATFORM solo se ofrecen módulos globales', () => {
  const espacios = visibleWorkspaces(PLATFORM)
  assert.equal(espacios.length, 1)
  assert.equal(espacios[0].id, 'plataforma')
  const hrefs = hrefsDe(PLATFORM)
  assert.ok(hrefs.length > 0)
  for (const h of hrefs) {
    assert.ok(
      h.startsWith('/superadmin'),
      `el ámbito PLATFORM ofrece una ruta de empresa: ${h}`
    )
  }
})

test('en COMPANY el superadmin solo ve módulos de empresa', () => {
  const espacios = visibleWorkspaces(EMPRESA_COMO_SA)
  assert.equal(espacios.length, 9)
  const hrefs = hrefsDe(EMPRESA_COMO_SA)
  for (const h of hrefs) {
    assert.ok(h.startsWith('/admin'), `el ámbito COMPANY ofrece una ruta global: ${h}`)
  }
})

test('los dos ámbitos no comparten ni una ruta', () => {
  const plataforma = new Set(hrefsDe(PLATFORM))
  const empresa = new Set(hrefsDe(EMPRESA_COMO_SA))
  const mezcla = [...plataforma].filter((h) => empresa.has(h))
  assert.deepEqual(mezcla, [])
})

test('el superadmin en una empresa no queda bloqueado', () => {
  // Sin overrides de empleado que valgan: ve pagos, empleados y todo lo que
  // un administrador pleno abre.
  const hrefs = hrefsDe(EMPRESA_COMO_SA)
  for (const h of ['/admin/pagos', '/admin/empleados', '/admin/scanner', '/admin/reportes']) {
    assert.ok(hrefs.includes(h), `SUPERADMIN en COMPANY no ve ${h}`)
  }
})

test('sin ámbito no se filtra por ámbito (cliente y mostrador intactos)', () => {
  const cliente = visibleWorkspaces({ role: 'CLIENTE' })
  assert.ok(cliente.some((w) => w.id === 'mi-membego'))
  const mostrador = visibleWorkspaces({ role: 'EMPLEADO' })
  assert.ok(mostrador.some((w) => w.id === 'mostrador'))
})

test('la salida a Plataforma solo se ofrece al superadmin en empresa', () => {
  assert.equal(ofreceSalidaAPlataforma(EMPRESA_COMO_SA), true)
  assert.equal(ofreceSalidaAPlataforma(PLATFORM), false)
  assert.equal(ofreceSalidaAPlataforma(ADMIN), false)
  assert.equal(ofreceSalidaAPlataforma({ role: 'CLIENTE' }), false)
})

test('una ruta fuera de su ámbito no resuelve espacio', () => {
  assert.equal(workspaceOf('/admin/scanner', PLATFORM), null)
  assert.equal(workspaceOf('/superadmin/empresas', EMPRESA_COMO_SA), null)
  assert.equal(workspaceOf('/superadmin/dashboard', PLATFORM), 'plataforma')
  assert.equal(workspaceOf('/admin/scanner', ADMIN), 'operacion')
})

test('los aterrizajes nunca salen de su ámbito', () => {
  const plataforma = visibleWorkspaces(PLATFORM)[0]
  assert.equal(workspaceLanding(plataforma, PLATFORM), '/superadmin/dashboard')
  const marketing = visibleWorkspaces(ADMIN).find((w) => w.id === 'marketing')!
  // Campañas es el principal del espacio, no Prospectos.
  assert.equal(workspaceLanding(marketing, ADMIN), '/admin/campanas')
})

test('las migas de plataforma nombran el espacio único', () => {
  const m = breadcrumbs('/superadmin/tickets', PLATFORM)
  assert.deepEqual(
    m.map((x) => x.label),
    ['Plataforma', 'Operación', 'Tickets']
  )
})

test('Soporte y Administración están anclados al pie', () => {
  const espacios = workspacesForRole('ADMINISTRADOR')
  const pie = espacios.filter((w) => w.anclado).map((w) => w.id)
  assert.deepEqual(pie, ['administracion', 'soporte'])
})

test('Parques y Tours sigue gated por la capacidad EXCURSIONES', () => {
  const con = visibleWorkspaces({ role: 'ADMINISTRADOR', scope: 'COMPANY', capacidades: ['EXCURSIONES'] })
  const sin = visibleWorkspaces({ role: 'ADMINISTRADOR', scope: 'COMPANY', capacidades: [] })
  assert.ok(con.some((w) => w.id === 'tours'))
  assert.ok(!sin.some((w) => w.id === 'tours'))
})

test('/admin/crm se conserva y resuelve dentro de Marketing', () => {
  assert.ok(hrefsDe(ADMIN).includes('/admin/crm'))
  assert.equal(workspaceOf('/admin/crm', ADMIN), 'marketing')
})

test('roles acotados ven sus secciones también con ámbito', () => {
  const marketing = hrefsDe({ role: 'MARKETING', scope: 'COMPANY' } as ContextoNav)
  assert.ok(marketing.includes('/admin/campanas'))
  assert.ok(!marketing.includes('/admin/empleados'))
  const supervisor = hrefsDe({ role: 'SUPERVISOR', scope: 'COMPANY' } as ContextoNav)
  assert.ok(supervisor.includes('/admin/reportes'))
  assert.ok(!supervisor.includes('/admin/campanas'))
})

test('las claves de contador son exactamente las cinco reales', () => {
  assert.deepEqual([...CLAVES_BADGE], [
    'platformOpenTickets',
    'companyOpenTickets',
    'platformIncidents',
    'solicitudes',
    'colaAtascada',
  ])
})

test('platformIncidents existe pero no condiciona la visibilidad', () => {
  // Sin fuente de verdad, la insignia no se pinta; el módulo se ofrece igual.
  const item = workspacesForRole('SUPERADMIN')
    .flatMap((w) => w.groups)
    .flatMap((g) => g.items)
    .find((i) => i.href === '/superadmin/observabilidad')!
  assert.equal(item.badge, 'platformIncidents')
  assert.equal(canSeeItem(item, PLATFORM), true)
})

test('cada rol de empresa ve los nueve espacios (con Tours)', () => {
  for (const role of ['ADMINISTRADOR', 'GERENTE', 'ADMIN_EMPRESA'] as AppRole[]) {
    const ids = visibleWorkspaces({ role, scope: 'COMPANY', capacidades: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'EXCURSIONES'] }).map(
      (w) => w.id
    )
    assert.deepEqual(ids, [
      'inicio',
      'clientes',
      'tours',
      'beneficios',
      'marketing',
      'operacion',
      'analitica',
      'administracion',
      'soporte',
    ])
  }
})

// ── Conmutador de ámbito y menú de una columna ───────────────────────────

test('la entrada a Empresa solo se ofrece al superadmin en plataforma', () => {
  // Es el sentido de ida del conmutador. Sin él, los módulos de empresa no
  // tenían ningún enlace desde la plataforma: se llegaba escribiendo la URL.
  assert.equal(ofreceEntradaAEmpresa(PLATFORM), true)
  assert.equal(ofreceEntradaAEmpresa(EMPRESA_COMO_SA), false)
  assert.equal(ofreceEntradaAEmpresa(ADMIN), false)
  assert.equal(ofreceEntradaAEmpresa({ role: 'SUPERADMIN' }), false)
  assert.equal(ofreceEntradaAEmpresa({ role: 'CLIENTE' }), false)
})

test('los dos sentidos del conmutador nunca se ofrecen a la vez', () => {
  for (const ctx of [PLATFORM, EMPRESA_COMO_SA, ADMIN, { role: 'CLIENTE' } as ContextoNav]) {
    assert.ok(!(ofreceEntradaAEmpresa(ctx) && ofreceSalidaAPlataforma(ctx)))
  }
})

test('los aterrizajes del conmutador caen en un módulo real de su ámbito', () => {
  // Un conmutador que lleva a una ruta sin menú aterriza sin contexto.
  assert.equal(workspaceOf(ATERRIZAJE_PLATAFORMA, PLATFORM), 'plataforma')
  assert.equal(workspaceOf(ATERRIZAJE_EMPRESA, EMPRESA_COMO_SA), 'inicio')
})

test('la plataforma se pinta en una columna; el panel de empresa, en dos niveles', () => {
  // Un riel con un único icono no reparte nada. La plataforma y el mostrador
  // son un solo espacio y van en una columna con sus grupos rotulados; el
  // panel de empresa tiene nueve espacios y necesita el riel.
  assert.equal(menuEnUnaColumna(visibleWorkspaces(PLATFORM)), true)
  assert.equal(menuEnUnaColumna(visibleWorkspaces({ role: 'EMPLEADO' })), true)
  assert.equal(menuEnUnaColumna(visibleWorkspaces(EMPRESA_COMO_SA)), false)
  assert.equal(menuEnUnaColumna(visibleWorkspaces(ADMIN)), false)
  assert.equal(menuEnUnaColumna(visibleWorkspaces({ role: 'CLIENTE' })), false)
})

test('en una columna, la plataforma sigue rotulando sus cuatro grupos', () => {
  // Sin riel, los rótulos de grupo son la única estructura del menú: si
  // alguien fundiera los grupos en uno, volvería la lista de dieciséis
  // entradas sin nada que diga dónde mirar.
  const [plataforma] = visibleWorkspaces(PLATFORM)
  assert.deepEqual(
    plataforma.groups.map((g) => g.label),
    ['Resumen', 'Negocio', 'Operación', 'Sistema']
  )
})
