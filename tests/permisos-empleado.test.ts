import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolverPermisosUsuario,
  seccionPermitida,
  funcionPermitida,
  permisosDesdeSeleccion,
  puedeEditarPermisos,
  canAccessAdminSection,
  adminSectionForPath,
} from '../src/lib/auth/permissions'
import {
  navForRole,
  allLinks,
  hrefsNegadosPorPermisos,
} from '../src/components/layout/nav-config'
import type { AppRole } from '../src/types'

/**
 * Módulo de PERMISOS por empleado (14-08-2026): el rol da la base y el
 * ajuste concede o niega encima. Estas pruebas fijan la resolución pura —
 * la misma que consumen el proxy (vista), el menú y requireSection (acciones).
 */

test('sin ajustes, manda el rol tal cual', () => {
  assert.equal(seccionPermitida('CAJERO', 'pagos', null), true)
  assert.equal(seccionPermitida('MARKETING', 'pagos', null), false)
  assert.equal(seccionPermitida('MARKETING', 'campanas', null), true)
})

test('negar una sección le gana al rol (el caso "quítale Pagos al cajero")', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { pagos: false } })
  assert.equal(seccionPermitida('CAJERO', 'pagos', p), false)
  // Y el resto de sus secciones no se toca.
  assert.equal(seccionPermitida('CAJERO', 'clientes', p), true)
})

test('conceder una sección que el rol no trae (Marketing con Clientes)', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { clientes: true } })
  assert.equal(canAccessAdminSection('MARKETING', 'clientes'), false)
  assert.equal(seccionPermitida('MARKETING', 'clientes', p), true)
})

test('el superadmin ignora cualquier ajuste; los ADMINISTRADORES ya no (control de plataforma)', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { pagos: false, clientes: false } })
  assert.equal(seccionPermitida('SUPERADMIN', 'pagos', p), true)
  // Decisión de producto (15-08-2026): la plataforma puede restringir a los
  // administradores de una empresa — sus ajustes SÍ resuelven.
  assert.equal(seccionPermitida('ADMINISTRADOR', 'pagos', p), false)
  assert.equal(seccionPermitida('ADMIN_EMPRESA', 'clientes', p), false)
  assert.equal(seccionPermitida('ADMINISTRADOR', 'membresias', p), true)
})

test('quién edita a quién: superadmin a cualquiera (menos superadmin); admin solo a su equipo', () => {
  assert.equal(puedeEditarPermisos('SUPERADMIN', 'ADMINISTRADOR'), true)
  assert.equal(puedeEditarPermisos('SUPERADMIN', 'CAJERO'), true)
  assert.equal(puedeEditarPermisos('SUPERADMIN', 'SUPERADMIN'), false)
  assert.equal(puedeEditarPermisos('ADMINISTRADOR', 'CAJERO'), true)
  assert.equal(puedeEditarPermisos('ADMINISTRADOR', 'ADMINISTRADOR'), false)
  assert.equal(puedeEditarPermisos('ADMINISTRADOR', 'ADMIN_EMPRESA'), false)
  assert.equal(puedeEditarPermisos('ADMINISTRADOR', 'SUPERADMIN'), false)
  assert.equal(puedeEditarPermisos('CAJERO', 'EMPLEADO'), false)
})

test('el ejemplo de citas: módulo abierto, configurar negado', () => {
  const p = resolverPermisosUsuario({ v: 1, funciones: { citas: { configurar: false } } })
  assert.equal(seccionPermitida('CAJERO', 'citas', p), true)
  assert.equal(funcionPermitida('CAJERO', 'citas', 'gestionar', p), true)
  assert.equal(funcionPermitida('CAJERO', 'citas', 'configurar', p), false)
  // Y aplica también a un ADMINISTRADOR (puesto por la plataforma).
  assert.equal(funcionPermitida('ADMINISTRADOR', 'citas', 'configurar', p), false)
  assert.equal(funcionPermitida('ADMINISTRADOR', 'citas', 'gestionar', p), true)
})

test('negar una función bloquea esa función y solo esa', () => {
  const p = resolverPermisosUsuario({
    v: 1,
    funciones: { promociones: { eliminar: false } },
  })
  assert.equal(funcionPermitida('CAJERO', 'promociones', 'eliminar', p), false)
  assert.equal(funcionPermitida('CAJERO', 'promociones', 'crear', p), true)
  // La sección sigue abierta: la negación fue quirúrgica.
  assert.equal(seccionPermitida('CAJERO', 'promociones', p), true)
})

test('una sección negada cierra también todas sus funciones', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { pagos: false } })
  assert.equal(funcionPermitida('CAJERO', 'pagos', 'confirmar_pago', p), false)
})

test('la basura no resuelve: secciones inventadas y valores raros se descartan', () => {
  assert.equal(resolverPermisosUsuario(null), null)
  assert.equal(resolverPermisosUsuario('x'), null)
  assert.equal(resolverPermisosUsuario({ secciones: { inventada: false, pagos: 'no' } }), null)
  const p = resolverPermisosUsuario({ funciones: { pagos: { x: true, y: false } } })
  // Solo las negaciones (false) cuentan en funciones.
  assert.deepEqual(p?.funciones, { pagos: { y: false } })
})

test('permisosDesdeSeleccion guarda SOLO diferencias contra el rol', () => {
  // Un cajero con todo igual a su rol → null (columna limpia).
  assert.equal(
    permisosDesdeSeleccion('CAJERO', { secciones: { pagos: true }, funcionesNegadas: {} }),
    null
  )
  // Negarle pagos sí es diferencia; concederle a Marketing clientes también.
  const p1 = permisosDesdeSeleccion('CAJERO', { secciones: { pagos: false }, funcionesNegadas: {} })
  assert.deepEqual(p1?.secciones, { pagos: false })
  const p2 = permisosDesdeSeleccion('MARKETING', {
    secciones: { clientes: true },
    funcionesNegadas: { promociones: ['eliminar'] },
  })
  assert.deepEqual(p2?.secciones, { clientes: true })
  assert.deepEqual(p2?.funciones, { promociones: { eliminar: false } })
})

// -- El menú y los permisos no pueden divergir --------------------------------

/**
 * LA PRUEBA QUE FALTABA.
 *
 * `facturas` (Comprobantes) estuvo meses en el menú lateral sin estar en
 * `ADMIN_SECTIONS`. No daba error en ningún sitio: la pantalla abría, el
 * enlace se pintaba, y lo único que pasaba —invisible— es que el formulario
 * de PERMISOS POR EMPLEADO no tenía casilla que ofrecer para ese módulo.
 * Nadie podía concederlo ni negarlo.
 *
 * Un módulo que se anuncia en el menú y no se puede gobernar es un agujero
 * silencioso, así que se comprueba el invariante entero y no el caso
 * concreto: recorrer el menú de cada rol y exigir que TODA ruta `/admin/*`
 * resuelva a una `AdminSection` conocida. La próxima que aparezca falla aquí.
 *
 * Solo se miran las rutas de `/admin`: `adminSectionForPath` devuelve null
 * para `/superadmin/*` y `/cliente/*` por definición — esas no pasan por el
 * gate de secciones.
 */

/**
 * DEUDA RECONOCIDA, no una excusa: rutas del menú que todavía no resuelven a
 * ninguna sección. Están aquí para que el invariante pueda existir hoy y para
 * que quien añada una nueva vea fallar la prueba en vez de colarla. Esta lista
 * se vacía, no crece.
 */
const PENDIENTES: readonly string[] = [
  // `/admin/crm` (Prospectos). Su subárbol YA se gobierna —las pantallas de
  // /admin/crm/* piden `leads`, `conversaciones`, `pipeline` o `configuracion`—
  // pero el enlace del menú apunta a la raíz `/admin/crm`, cuyo primer segmento
  // no es sección de nada. Bajo cuál de las cuatro cae la raíz es una decisión
  // del CRM, no de este módulo.
  '/admin/crm',
]

test('toda ruta /admin del menú resuelve a una sección conocida', () => {
  const roles: AppRole[] = [
    'SUPERADMIN',
    'ADMINISTRADOR',
    'GERENTE',
    'CAJERO',
    'RECEPCION',
    'MARKETING',
    'SUPERVISOR',
    'EMPLEADO',
    'CLIENTE',
  ]
  for (const role of roles) {
    for (const link of allLinks(navForRole(role))) {
      if (!link.href.startsWith('/admin')) continue
      if (PENDIENTES.includes(link.href)) continue
      assert.ok(
        adminSectionForPath(link.href),
        `${role}: «${link.label}» (${link.href}) está en el menú pero no resuelve a ninguna AdminSection. ` +
          'Añádela a ADMIN_SECTIONS (y a SECCION_LABELS) o sácala del menú: si no, el módulo de Permisos no puede ni concederla ni negarla.'
      )
    }
  }
})

test('la lista de pendientes no tapa nada que ya se gobierne', () => {
  // Si una pendiente pasa a tener sección y se queda en la lista, el
  // invariante seguiría saltándosela y dejaría de vigilar esa ruta para
  // siempre. Al gobernarla, se borra de PENDIENTES.
  for (const href of PENDIENTES) {
    assert.equal(
      adminSectionForPath(href),
      null,
      `${href} ya resuelve a una sección: quítala de PENDIENTES.`
    )
  }
})

test('Comprobantes es una sección gobernable', () => {
  // El caso de uso que antes no existía: quitarle a un cajero el historial de
  // comprobantes sin tocarle el resto de su rol.
  const p = resolverPermisosUsuario({ v: 1, secciones: { facturas: false } })
  assert.equal(seccionPermitida('CAJERO', 'facturas', p), false)
  assert.equal(seccionPermitida('CAJERO', 'pagos', p), true)
  // Y con la columna limpia sigue siendo lo que su rol dice.
  assert.equal(seccionPermitida('CAJERO', 'facturas', null), true)
})

test('hacerla sección no le abrió la puerta a ningún rol acotado', () => {
  // DECISIÓN EXPLÍCITA, no un descuido: `facturas` no entra en
  // RESTRICTED_ACCESS (el porqué está en permissions.ts). Antes los roles
  // acotados rebotaban porque el proxy no reconocía el path; ahora rebotan
  // porque la sección no es suya. Mismo resultado, motivo comprobable.
  for (const role of ['MARKETING', 'SUPERVISOR'] as const) {
    assert.equal(
      canAccessAdminSection(role, 'facturas'),
      false,
      `${role} no debería traer facturas de serie`
    )
  }
  // Los roles plenos la siguen viendo, igual que antes del cambio.
  assert.equal(canAccessAdminSection('ADMINISTRADOR', 'facturas'), true)
  assert.equal(canAccessAdminSection('CAJERO', 'facturas'), true)
})

test('negar Comprobantes lo borra también del menú', () => {
  // `hrefsNegadosPorPermisos` es lo que hace que el enlace desaparezca del
  // sidebar, la paleta de comandos y la barra inferior. Sin sección, ese href
  // era inalcanzable para esta función.
  const p = resolverPermisosUsuario({ v: 1, secciones: { facturas: false } })
  assert.ok(hrefsNegadosPorPermisos('CAJERO', p).includes('/admin/facturas'))
})

// -- Sinónimos de búsqueda ---------------------------------------------------
//
// Lo destapó la prueba del menú de arriba: estaba en el mismo caso que
// Comprobantes, pero peor. La pantalla la tapaba el proxy; sus dos server
// actions, no — y las actions se despachan por ID desde cualquier path
// permitido, así que `requireRole(ADMIN_ROLES)` dejaba a MARKETING y
// SUPERVISOR editar los sinónimos de la empresa sin poder abrir el módulo.

const RAIZ = join(__dirname, '..')

test('Sinónimos de búsqueda es una sección gobernable', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { sinonimos: false } })
  assert.equal(seccionPermitida('GERENTE', 'sinonimos', p), false)
  // Su vecina en el menú («Experiencia cliente») no se toca.
  assert.equal(seccionPermitida('GERENTE', 'personalizacion', p), true)
  // Y con la columna limpia sigue siendo lo que su rol dice.
  assert.equal(seccionPermitida('GERENTE', 'sinonimos', null), true)
})

test('los sinónimos no se le conceden a ningún rol acotado', () => {
  // El menú nunca se los enseñó; ahora la sección dice lo mismo, y las
  // actions —que son la barrera real— también.
  for (const role of ['MARKETING', 'SUPERVISOR'] as const) {
    assert.equal(
      canAccessAdminSection(role, 'sinonimos'),
      false,
      `${role} no debería traer sinonimos de serie`
    )
  }
  assert.equal(canAccessAdminSection('ADMINISTRADOR', 'sinonimos'), true)
  assert.equal(canAccessAdminSection('GERENTE', 'sinonimos'), true)
})

test('negar Sinónimos lo borra también del menú', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { sinonimos: false } })
  assert.ok(hrefsNegadosPorPermisos('GERENTE', p).includes('/admin/sinonimos'))
})

test('las acciones de sinónimos piden la sección, no un rol', () => {
  // La prueba de arriba solo comprueba la resolución pura. Esta fija la
  // guardia en el código: es lo único que separa a un rol acotado de escribir
  // en los sinónimos de la empresa, porque el proxy no ve las actions.
  const src = readFileSync(join(RAIZ, 'src/modules/busqueda/actions.ts'), 'utf8')
  assert.equal(
    src.split("await requireSection('sinonimos')").length - 1,
    2,
    'las dos acciones de empresa (guardar y eliminar) tienen que pedir la sección'
  )
  assert.ok(
    !src.includes('requireRole(ADMIN_ROLES)'),
    'ADMIN_ROLES incluye MARKETING y SUPERVISOR: volvería a abrir la puerta'
  )
  // Los sinónimos GLOBALES siguen siendo de la plataforma y de nadie más.
  assert.ok(src.includes("requireRole('SUPERADMIN')"))
})
