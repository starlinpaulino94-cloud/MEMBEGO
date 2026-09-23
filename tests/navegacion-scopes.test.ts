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
  visibleGroups,
  visibleWorkspaces,
  workspaceLanding,
  workspaceOf,
  workspacesForRole,
  type CapacidadNav,
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
  assert.deepEqual(espacios.map((w) => w.id), ['empresa'])
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
  assert.equal(workspaceOf('/admin/scanner', ADMIN), 'empresa')
})

test('los aterrizajes nunca salen de su ámbito', () => {
  const plataforma = visibleWorkspaces(PLATFORM)[0]
  assert.equal(workspaceLanding(plataforma, PLATFORM), '/superadmin/dashboard')
  // El hub aterriza en su módulo principal: el Resumen.
  const empresa = visibleWorkspaces(ADMIN)[0]!
  assert.equal(workspaceLanding(empresa, ADMIN), '/admin/dashboard')
})

test('las migas de plataforma nombran el espacio único', () => {
  const m = breadcrumbs('/superadmin/tickets', PLATFORM)
  assert.deepEqual(
    m.map((x) => x.label),
    ['Plataforma', 'Operación', 'Tickets']
  )
})

test('lo que se consulta poco va al final, no flotando', () => {
  // Antes esto era `anclado` sobre dos espacios del riel. Con el hub en una
  // columna la intención es la misma y se cumple con el ORDEN: Ajustes cierra
  // el menú, para que no cambie de sitio según cuántos grupos tenga delante.
  const empresa = workspacesForRole('ADMINISTRADOR')[0]!
  const grupos = empresa.groups.map((g) => g.id)
  assert.equal(grupos.at(-1), 'ajustes')
  assert.equal(grupos[0], 'principal', 'Y lo que se consulta a diario abre.')
})

test('Parques y Tours sigue gated por la capacidad EXCURSIONES', () => {
  const con = hrefsDe({ role: 'ADMINISTRADOR', scope: 'COMPANY', capacidades: ['EXCURSIONES'] })
  const sin = hrefsDe({ role: 'ADMINISTRADOR', scope: 'COMPANY', capacidades: [] })
  assert.ok(con.includes('/admin/excursiones'))
  assert.ok(!sin.includes('/admin/excursiones'))
})

test('/admin/crm se conserva y resuelve dentro de Clientes', () => {
  // Cambia de grupo —el diseño pone los prospectos con los clientes, no con
  // marketing— pero NO desaparece: eso es lo que esta guardia vigila desde que
  // una reagrupación anterior estuvo a punto de perderlo.
  assert.ok(hrefsDe(ADMIN).includes('/admin/crm'))
  const empresa = workspacesForRole('ADMINISTRADOR')[0]!
  const grupo = empresa.groups.find((g) => g.items.some((i) => i.href === '/admin/crm'))
  assert.equal(grupo?.id, 'clientes')
})

test('roles acotados ven sus secciones también con ámbito', () => {
  const marketing = hrefsDe({ role: 'MARKETING', scope: 'COMPANY' } as ContextoNav)
  assert.ok(marketing.includes('/admin/campanas'))
  assert.ok(!marketing.includes('/admin/empleados'))
  const supervisor = hrefsDe({ role: 'SUPERVISOR', scope: 'COMPANY' } as ContextoNav)
  assert.ok(supervisor.includes('/admin/reportes'))
  assert.ok(!supervisor.includes('/admin/campanas'))
})

test('las claves de contador son exactamente las siete reales', () => {
  // Las dos del hub (planes activos y canjes de hoy) entraron con el contrato
  // Stitch: conteos baratos y cacheados. Las caras —clientes en riesgo— siguen
  // fuera a propósito; ver la nota de coste en modules/navegacion/badges.ts.
  assert.deepEqual([...CLAVES_BADGE], [
    'platformOpenTickets',
    'companyOpenTickets',
    'platformIncidents',
    'solicitudes',
    'colaAtascada',
    'planesActivos',
    'canjesHoy',
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

test('cada rol de empresa ve el hub con sus ocho grupos', () => {
  // GERENTE salió de esta lista al acotarse por oficio: ya no trae la
  // configuración de experiencia de cliente, así que su hub tiene siete
  // grupos y no ocho. Lo que ve él y lo que ve el mostrador se fija abajo,
  // a propósito y por separado — un menú que encoge sin que nadie lo note es
  // como se pierde el acceso de alguien sin enterarse.
  for (const role of ['ADMINISTRADOR', 'ADMIN_EMPRESA'] as AppRole[]) {
    const ctx = { role, scope: 'COMPANY' as const, capacidades: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'EXCURSIONES'] as CapacidadNav[] }
    const espacios = visibleWorkspaces(ctx)
    assert.deepEqual(espacios.map((w) => w.id), ['empresa'])
    assert.deepEqual(visibleGroups(espacios[0]!, ctx).map((g) => g.id), [
      'principal',
      'experiencia-cliente',
      'catalogo',
      'operaciones',
      'clientes',
      'marketing',
      'analitica',
      'ajustes',
    ])
  }
})

/**
 * EL MENÚ DE LOS ROLES ACOTADOS, ESCRITO.
 *
 * Un CAJERO y un GERENTE traían las 44 secciones —campañas y audiencia
 * incluidas— porque `canAccessAdminSection` miraba `FULL_ADMIN_ROLES` antes
 * que nada. Desde que tienen paquete por oficio, su hub encoge; y como
 * encoger un menú es también quitarle a alguien algo que usaba, aquí queda
 * exactamente qué le queda a cada uno.
 */
test('el mostrador ve cuatro grupos, y marketing no está entre ellos', () => {
  const ctx = { role: 'CAJERO' as AppRole, scope: 'COMPANY' as const, capacidades: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'EXCURSIONES'] as CapacidadNav[] }
  const espacios = visibleWorkspaces(ctx)
  assert.deepEqual(visibleGroups(espacios[0]!, ctx).map((g) => g.id), [
    'principal',
    'catalogo',
    'operaciones',
    'clientes',
  ])
})

test('la operación ve su hub sin la configuración de experiencia', () => {
  const ctx = { role: 'GERENTE' as AppRole, scope: 'COMPANY' as const, capacidades: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'EXCURSIONES'] as CapacidadNav[] }
  const espacios = visibleWorkspaces(ctx)
  const grupos = visibleGroups(espacios[0]!, ctx).map((g) => g.id)
  assert.deepEqual(grupos, [
    'principal',
    'catalogo',
    'operaciones',
    'clientes',
    // Sigue apareciendo, y no por las campañas: dentro solo le quedan
    // invitar a su equipo y los regalos VIP, que son dos palancas de quien
    // dirige el turno. Las campañas, la audiencia y las automatizaciones ya
    // no están.
    'marketing',
    'analitica',
    'ajustes',
  ])
  assert.ok(!grupos.includes('experiencia-cliente'))
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
  assert.equal(workspaceOf(ATERRIZAJE_EMPRESA, EMPRESA_COMO_SA), 'empresa')
})

test('plataforma, mostrador y empresa se pintan en una columna; el cliente no', () => {
  // El panel de empresa tenía nueve espacios y necesitaba riel. Los diseños de
  // Stitch lo definen como UNA columna con ocho grupos rotulados, así que el
  // riel deja de tener a quién repartir en el ámbito de empresa.
  //
  // El cliente conserva sus espacios: su navegación no es este hub, son los
  // cuatro destinos del dock.
  assert.equal(menuEnUnaColumna(visibleWorkspaces(PLATFORM)), true)
  assert.equal(menuEnUnaColumna(visibleWorkspaces({ role: 'EMPLEADO' })), true)
  assert.equal(menuEnUnaColumna(visibleWorkspaces(EMPRESA_COMO_SA)), true)
  assert.equal(menuEnUnaColumna(visibleWorkspaces(ADMIN)), true)
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
