import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolverPermisosUsuario,
  seccionPermitida,
  funcionPermitida,
  permisosDesdeSeleccion,
  puedeEditarPermisos,
  canAccessAdminSection,
  puedeEntrarAlPanel,
  seccionConcedida,
  adminSectionForPath,
  ADMIN_SECTIONS,
} from '../src/lib/auth/permissions'
import {
  navForRole,
  allLinks,
  hrefsNegadosPorPermisos,
  visibleWorkspaces,
  visibleGroups,
} from '../src/components/layout/nav-config'
import { FULL_ADMIN_ROLES, type AppRole } from '../src/types'

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
  // Con GERENTE y no con CAJERO: desde que el mostrador está acotado por
  // oficio, el cajero no trae 'promociones' y la prueba mediría otra cosa
  // —una sección que su rol ya no da— en vez de la negación quirúrgica.
  assert.equal(funcionPermitida('GERENTE', 'promociones', 'eliminar', p), false)
  assert.equal(funcionPermitida('GERENTE', 'promociones', 'crear', p), true)
  // La sección sigue abierta: la negación fue quirúrgica.
  assert.equal(seccionPermitida('GERENTE', 'promociones', p), true)
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
 * ninguna sección.
 *
 * HOY ESTÁ VACÍA, y ese es el objetivo. Llegó a tener tres —`/admin/facturas`,
 * `/admin/sinonimos` y `/admin/crm`— y se vació gobernándolas, no tachándolas
 * de aquí. El mecanismo se queda puesto: si mañana entra un módulo al menú sin
 * sección, la prueba de abajo falla, y anotarlo aquí obliga a escribir por qué
 * y deja a la segunda prueba vigilando que no se quede anotado de más.
 */
const PENDIENTES: readonly string[] = []

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
  // Con ADMINISTRADOR y no con GERENTE: los sinónimos son configuración del
  // catálogo y desde que el gerente está acotado por oficio ya no los trae de
  // serie. Probarlo con él comprobaría que se niega algo que su rol tampoco da.
  assert.equal(seccionPermitida('ADMINISTRADOR', 'sinonimos', p), false)
  // Su vecina en el menú («Experiencia cliente») no se toca.
  assert.equal(seccionPermitida('ADMINISTRADOR', 'personalizacion', p), true)
  // Y con la columna limpia sigue siendo lo que su rol dice.
  assert.equal(seccionPermitida('ADMINISTRADOR', 'sinonimos', null), true)
})

test('los sinónimos no se le conceden a ningún rol acotado', () => {
  // El menú nunca se los enseñó; ahora la sección dice lo mismo, y las
  // actions —que son la barrera real— también.
  //
  // CAJERO y GERENTE entran ahora en este bucle, y no como excepción: desde
  // que tienen paquete por oficio son roles acotados como los otros dos. El
  // título de esta prueba lo pedía desde el principio.
  for (const role of ['MARKETING', 'SUPERVISOR', 'CAJERO', 'GERENTE'] as const) {
    assert.equal(
      canAccessAdminSection(role, 'sinonimos'),
      false,
      `${role} no debería traer sinonimos de serie`
    )
  }
  assert.equal(canAccessAdminSection('ADMINISTRADOR', 'sinonimos'), true)
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

// -- El CRM ------------------------------------------------------------------
//
// La última que quedaba. El caso era distinto a los dos anteriores: el módulo
// SÍ estaba gobernado —su layout exige 'leads' para todo el subárbol, y sus
// server actions también— pero `adminSectionForPath` no lo sabía, porque el
// primer segmento de `/admin/crm/*` no es el nombre de ninguna sección. Para
// el proxy y para el menú era una ruta desconocida.
//
// La salida NO fue inventar una sección `crm`: habría dado cinco casillas en
// el formulario de Permisos para un módulo con una sola puerta. El prefijo
// resuelve a `leads`, que es lo que de verdad se exige.

test('/admin/crm y todo su subárbol resuelven a la sección leads', () => {
  assert.equal(adminSectionForPath('/admin/crm'), 'leads')
  for (const sub of [
    '/admin/crm/leads',
    '/admin/crm/conversaciones',
    '/admin/crm/seguimientos',
    '/admin/crm/metricas',
    '/admin/crm/configuracion',
    '/admin/crm/configuracion/auto-reply',
    '/admin/crm/prospectos/abc123',
  ]) {
    assert.equal(adminSectionForPath(sub), 'leads', `${sub} debería colgar de leads`)
  }
  // El prefijo se aplica a la ruta, no a las que solo empiezan igual.
  assert.equal(adminSectionForPath('/admin/crmx'), null)
})

test('negar leads cierra el CRM entero, menú incluido', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { leads: false } })
  assert.equal(seccionPermitida('GERENTE', 'leads', p), false)
  assert.equal(seccionPermitida('GERENTE', 'clientes', p), true)
  // Antes este href no era alcanzable para esta función: sin sección, no había
  // nada que negar y el enlace se quedaba en el menú.
  assert.ok(hrefsNegadosPorPermisos('GERENTE', p).includes('/admin/crm'))
})

test('ninguna pantalla del CRM se guarda por rol', () => {
  // Mismo problema que en los sinónimos, y por eso se revisa el directorio
  // entero y no una lista: el layout ya exigía 'leads', pero cinco páginas
  // llevaban además su propio `requireRole(ADMIN_ROLES)` —que admite MARKETING
  // y SUPERVISOR—, que era el guard más flojo del par. Una página nueva que
  // repita el patrón cae aquí.
  const base = join(RAIZ, 'src/app/(admin)/admin/crm')
  const malas = readdirSync(base, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.tsx'))
    .filter((p) => readFileSync(join(base, p), 'utf8').includes('requireRole(ADMIN_ROLES)'))
  assert.deepEqual(malas, [], 'estas pantallas del CRM siguen guardándose por rol')
})

test('el layout del CRM sigue siendo la puerta del subárbol', () => {
  // Todo lo anterior descansa en que este guard exista: es el que cubre las
  // rutas del CRM que no tienen página propia hoy.
  const src = readFileSync(join(RAIZ, 'src/app/(admin)/admin/crm/layout.tsx'), 'utf8')
  assert.ok(src.includes("await requireSection('leads')"))
})

// -- Ninguna casilla pintada -------------------------------------------------

/**
 * TODA SECCIÓN SE EXIGE EN ALGÚN SITIO.
 *
 * Una sección de `ADMIN_SECTIONS` es una casilla en el formulario de Permisos
 * por empleado. Si nada la exige, esa casilla miente: el panel dice «negado» y
 * no se cierra ninguna puerta. Es la misma deshonestidad que `funciones.ts`
 * prohíbe para las funciones, un piso más arriba.
 *
 * Se exige de una de dos maneras, y vale cualquiera:
 *
 *  · Con `requireSection('<seccion>')` en el código — la barrera real, la
 *    única que cubre las server actions.
 *  · Con una carpeta `/admin/<seccion>` — entonces `adminSectionForPath`
 *    resuelve sus rutas y el proxy cierra la vista, aunque las páginas de
 *    dentro todavía se guarden por rol.
 *
 * `leads` pasa por la primera sin tener carpeta: sus rutas son `/admin/crm/*`
 * y llegan por `SECCION_POR_PREFIJO`.
 *
 * Esto salió de tres secciones —'conversaciones', 'pipeline' y
 * 'configuracion'— que no cumplían ninguna de las dos y llevaban meses
 * ofreciéndose en el formulario sin gobernar nada.
 */
test('toda sección se exige en algún sitio', () => {
  const BASE_ADMIN = join(RAIZ, 'src/app/(admin)/admin')
  const carpetas = new Set(
    readdirSync(BASE_ADMIN, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  )

  const fuente = readdirSync(join(RAIZ, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => readFileSync(join(RAIZ, 'src', f), 'utf8'))
    .join('\n')

  const pintadas = ADMIN_SECTIONS.filter(
    (s) => !carpetas.has(s) && !fuente.includes(`requireSection('${s}'`)
  )
  assert.deepEqual(
    pintadas,
    [],
    'estas secciones salen en el formulario de Permisos y no cierran ninguna puerta: ' +
      'dales una guardia o sácalas de ADMIN_SECTIONS'
  )
})

test('el CRM tiene UNA sección, no cinco', () => {
  // Concreta a propósito, además del invariante de arriba: si alguien vuelve a
  // añadir 'conversaciones' o 'pipeline' junto con una guardia de adorno, el
  // invariante pasaría y esta prueba explica por qué sigue estando mal.
  const delCrm = (ADMIN_SECTIONS as readonly string[]).filter((s) =>
    ['crm', 'leads', 'conversaciones', 'pipeline', 'configuracion'].includes(s)
  )
  assert.deepEqual(delCrm, ['leads'])
  assert.equal(adminSectionForPath('/admin/crm/conversaciones'), 'leads')
})

// -- El mostrador y la operación, acotados por oficio -------------------------

/**
 * LO QUE ESTO VIENE A ARREGLAR.
 *
 * `canAccessAdminSection` miraba PRIMERO `FULL_ADMIN_ROLES`, así que un CAJERO
 * y un GERENTE traían las 44 secciones: campañas, audiencia, automatizaciones
 * y la configuración comercial incluidas. El módulo de Permisos no estaba
 * roto —negar funcionaba— pero no había nada que negar hasta que alguien se
 * sentaba a quitar cuarenta casillas por empleado, una por una.
 */
test('el mostrador no trae marketing ni configuración', () => {
  for (const s of ['campanas', 'audiencia', 'adquisicion', 'marketing',
                   'automatizaciones', 'publicaciones', 'planes', 'metodos-pago',
                   'personalizacion', 'integraciones', 'empleados'] as const) {
    assert.equal(
      canAccessAdminSection('CAJERO', s),
      false,
      `un cajero no debería traer ${s} de serie`
    )
  }
})

test('el mostrador sí trae lo suyo', () => {
  for (const s of ['dashboard', 'clientes', 'membresias', 'pagos', 'facturas',
                   'citas', 'scanner', 'conciliacion'] as const) {
    assert.equal(
      canAccessAdminSection('CAJERO', s),
      true,
      `un cajero necesita ${s} para trabajar`
    )
  }
})

test('la operación dirige, pero no hace marketing ni toca la configuración comercial', () => {
  for (const s of ['reportes', 'actividad', 'empleados', 'sucursales', 'seguimiento'] as const) {
    assert.equal(canAccessAdminSection('GERENTE', s), true, `un gerente necesita ${s}`)
  }
  for (const s of ['campanas', 'audiencia', 'adquisicion', 'marketing',
                   'automatizaciones', 'planes', 'metodos-pago', 'perfil',
                   'personalizacion', 'integraciones'] as const) {
    assert.equal(
      canAccessAdminSection('GERENTE', s),
      false,
      `un gerente no debería traer ${s} de serie`
    )
  }
})

test('quien administra de verdad sigue trayéndolo todo', () => {
  for (const role of ['SUPERADMIN', 'ADMINISTRADOR', 'ADMIN_EMPRESA'] as const) {
    for (const s of ADMIN_SECTIONS) {
      assert.equal(
        canAccessAdminSection(role, s),
        true,
        `${role} dejó de traer ${s}: acotar al equipo no puede acotar a quien manda`
      )
    }
  }
})

/**
 * LA TRAMPA QUE ESTO VIGILA, Y NO ES TEÓRICA.
 *
 * `FULL_ADMIN_ROLES` parece «qué secciones trae el rol» y NO es eso: responde
 * «¿es admin pleno para MUTAR?», y la consultan 41 guardias de server action
 * (`requireAdminUser`), el reparto de avisos, los comprobantes y el
 * onboarding.
 *
 * El arreglo obvio para acotar al cajero era sacarlo de esa lista. Le habría
 * dejado el panel a la vista y las manos atadas: vería sus clientes y no
 * podría cobrar. Por eso el acotado se hace con un PAQUETE y esa lista no se
 * toca — y por eso esta prueba existe, para que el atajo no vuelva.
 */
test('acotar por sección no desarma las mutaciones', () => {
  for (const role of ['CAJERO', 'GERENTE'] as const) {
    assert.ok(
      FULL_ADMIN_ROLES.includes(role),
      `${role} salió de FULL_ADMIN_ROLES: eso no acota su panel, le quita las 41 ` +
        'guardias de mutación que dependen de esa lista'
    )
  }
})

test('acotar a un rol no le quita lo que se le conceda a mano', () => {
  // El paquete es el PUNTO DE PARTIDA, no un techo: un gerente que sí lleva
  // las campañas las recupera desde su pantalla de Permisos, sin cambiarle el
  // rol ni tocar el paquete de los demás.
  const p = resolverPermisosUsuario({ v: 1, secciones: { campanas: true } })
  assert.equal(seccionPermitida('GERENTE', 'campanas', null), false)
  assert.equal(seccionPermitida('GERENTE', 'campanas', p), true)
})

// -- Conceder a un empleado tiene que servir para algo ------------------------

/**
 * EL FALLO QUE ESTO ARREGLA, TAL COMO SE VIO.
 *
 * A una empleada se le concedieron Clientes, Membresías, Pagos, Comprobantes
 * y Citas. La pantalla decía «Concedido», se guardaba en la base… y su menú
 * seguía teniendo dos cosas: escanear y caja.
 *
 * Había tres puertas cerradas antes de que nadie mirara un permiso: el proxy
 * y el layout decidían la entrada a /admin SOLO por rol, y el menú del
 * mostrador ni siquiera construía el árbol del panel. Cinco módulos
 * concedidos y ninguno alcanzable: el módulo de Permisos prometía algo que
 * esas tres líneas deshacían.
 */
const empleadaCon = (...secciones: string[]) =>
  resolverPermisosUsuario({
    v: 1,
    secciones: Object.fromEntries(secciones.map((s) => [s, true])),
  })

test('un rol sin panel entra si se le concede algo, y no antes', () => {
  assert.equal(puedeEntrarAlPanel('EMPLEADO', null), false)
  assert.equal(puedeEntrarAlPanel('EMPLEADO', empleadaCon('clientes')), true)
  // Negar no abre nada: solo el `true` explícito es una concesión.
  const negada = resolverPermisosUsuario({ v: 1, secciones: { clientes: false } })
  assert.equal(puedeEntrarAlPanel('EMPLEADO', negada), false)
  assert.equal(seccionConcedida('clientes', negada), false)
})

test('quien tiene panel por su rol sigue entrando sin concesiones', () => {
  for (const role of ['ADMINISTRADOR', 'GERENTE', 'CAJERO', 'MARKETING', 'SUPERVISOR'] as const) {
    assert.equal(puedeEntrarAlPanel(role, null), true, `${role} perdió la entrada al panel`)
  }
  // Y quien no es del equipo no entra ni con la puerta nueva.
  assert.equal(puedeEntrarAlPanel('CLIENTE', null), false)
})

test('entrar por concesión abre SOLO lo concedido, ni siquiera el panel de inicio', () => {
  const p = empleadaCon('clientes')
  assert.equal(seccionPermitida('EMPLEADO', 'clientes', p), true)
  for (const s of ['membresias', 'pagos', 'campanas', 'empleados', 'dashboard'] as const) {
    assert.equal(
      seccionPermitida('EMPLEADO', s, p),
      false,
      `conceder clientes no puede abrir ${s}`
    )
  }
})

test('el menú del mostrador enseña lo concedido, y solo eso', () => {
  const enlaces = (permisos: ReturnType<typeof resolverPermisosUsuario>) => {
    const ctx = { role: 'EMPLEADO' as AppRole, scope: 'COMPANY' as const, permisos }
    return visibleWorkspaces(ctx)
      .flatMap((w) => visibleGroups(w, ctx))
      .flatMap((g) => allLinks([g]))
      .map((l) => l.href)
  }
  // Sin concesiones, su menú es el de siempre: ni un enlace del panel.
  assert.ok(!enlaces(null).some((h) => h.startsWith('/admin')))
  // Con dos concedidas, aparecen esas dos. Y ninguna más del panel.
  const con = enlaces(empleadaCon('clientes', 'membresias'))
  const delPanel = con.filter((h) => h.startsWith('/admin'))
  assert.deepEqual(delPanel.sort(), ['/admin/clientes', '/admin/membresias'])
})

// -- La barrera viva, sección por sección ------------------------------------

/**
 * CADA SECCIÓN CON CARPETA TIENE SU GUARDIA EN EL LAYOUT.
 *
 * Es más estricta que «toda sección se exige en algún sitio», y a propósito.
 * Aquella acepta que baste con tener carpeta, porque entonces el proxy cierra
 * la vista — pero el proxy lee los permisos del TOKEN. Quitarle un módulo a
 * alguien no le cerraba la puerta hasta que su sesión se refrescara, y de las
 * 147 pantallas del panel había 92 que no tenían ninguna barrera viva detrás.
 *
 * El layout la tiene: `requireSection` lee la base en cada render, y cubre
 * todo el subárbol —incluidas las pantallas que alguien añada mañana sin
 * acordarse de la guardia—.
 *
 * `dashboard` queda fuera, y es la única excepción: es el destino al que
 * rebota todo lo negado, aquí y en el proxy, así que guardarlo sería rebotar
 * a sí mismo.
 */
test('cada sección del panel tiene guardia viva en su layout', () => {
  const BASE = join(RAIZ, 'src/app/(admin)/admin')
  const SIN_GUARDIA = new Set(['dashboard'])

  const sinCubrir: string[] = []
  for (const d of readdirSync(BASE, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    if (!(ADMIN_SECTIONS as readonly string[]).includes(d.name)) continue
    if (SIN_GUARDIA.has(d.name)) continue
    const lay = join(BASE, d.name, 'layout.tsx')
    let src = ''
    try {
      src = readFileSync(lay, 'utf8')
    } catch {
      sinCubrir.push(`${d.name} (sin layout)`)
      continue
    }
    // Sin comentarios: el porqué de esto está escrito en la fábrica y nombra
    // a `requireSection`, así que un fichero que solo lo MENCIONE pasaría.
    const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const guarda =
      /guardarSeccion\(/.test(codigo) || /requireSection\(/.test(codigo)
    if (!guarda) sinCubrir.push(`${d.name} (layout sin guardia)`)
  }

  assert.deepEqual(
    sinCubrir,
    [],
    'estas secciones no tienen barrera VIVA: sus pantallas solo las cierra el ' +
      'proxy, que lee los permisos del token y va con un refresco de retraso'
  )
})

test('la sección que se guarda es la de su carpeta, no otra', () => {
  // Una fábrica hace muy fácil copiar el fichero de al lado y olvidar cambiar
  // el nombre: el layout de «pagos» guardando 'clientes' pasaría la prueba de
  // arriba y dejaría pagos abierto a quien tenga clientes.
  const BASE = join(RAIZ, 'src/app/(admin)/admin')
  const cruzadas: string[] = []
  for (const d of readdirSync(BASE, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    if (!(ADMIN_SECTIONS as readonly string[]).includes(d.name)) continue
    let src = ''
    try {
      src = readFileSync(join(BASE, d.name, 'layout.tsx'), 'utf8')
    } catch {
      continue
    }
    const m = /guardarSeccion\('([a-z-]+)'\)/.exec(src)
    if (m && m[1] !== d.name) cruzadas.push(`${d.name} guarda '${m[1]}'`)
  }
  assert.deepEqual(cruzadas, [], 'un layout guarda una sección que no es la suya')
})
