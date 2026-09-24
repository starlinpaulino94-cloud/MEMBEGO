import { ADMIN_ROLES, FULL_ADMIN_ROLES, type AppRole } from '@/types'

/**
 * Autorización FINA del panel /admin por sección (Onboarding Fase 2 · O-5).
 *
 * Los roles de `FULL_ADMIN_ROLES` (admin/gerente/cajero/superadmin) acceden a
 * TODAS las secciones. Los roles acotados (MARKETING, SUPERVISOR) solo a las
 * suyas. La fuente de verdad se consume en el middleware (navegación), en la
 * navegación (para no mostrar lo que no pueden abrir) y en los guards de las
 * server actions sensibles (`requireSection`), que son la barrera real: el
 * gate del middleware no protege las actions (se despachan por ID sobre
 * cualquier path permitido).
 *
 * INVARIANTE: toda ruta `/admin/*` que aparezca en el menú lateral tiene que
 * resolver a una sección de esta lista. Una que no esté aquí no es un módulo
 * "sin permisos": es un módulo que el panel de PERMISOS POR EMPLEADO no puede
 * ni conceder ni negar, porque no hay casilla que marcar. Así se coló
 * `facturas` durante meses. Lo vigila la prueba «toda ruta /admin del menú
 * resuelve a una sección conocida» (tests/permisos-empleado.test.ts), que
 * lleva además la lista de las que siguen sin gobernar, que hoy está vacía.
 */
export const ADMIN_SECTIONS = [
  'dashboard',
  'clientes',
  'membresias',
  'promociones',
  'publicaciones',
  'campanas',
  'referidos',
  'crecimiento',
  'scanner',
  'pagos',
  // Comprobantes (`/admin/facturas`): el historial permanente de ventas y
  // entregas sin cobro, con sus montos. Estaba en el menú y NO aquí, así que
  // el módulo de Permisos no podía ofrecerlo — no había forma de quitarle a un
  // empleado concreto el historial de dinero sin quitarle también el rol.
  'facturas',
  'citas',
  'ofertas',
  'perfil',
  'sucursales',
  'metodos-pago',
  'planes',
  'notificaciones',
  'automatizaciones',
  'comunicacion',
  'tickets',
  'empleados',
  'registros',
  'regalos',
  'seguimiento',
  'reportes',
  // Bitácora de actividad: toda acción con su fecha y hora exactas.
  'actividad',
  // Bloque 2 de la auditoría: quién está a punto de irse y cuánto cuesta
  // perderlo, y el reporte de retención con el pasivo de usos sin consumir.
  'riesgo',
  'retencion',
  // Comprobaciones cruzadas entre membresías, transacciones y caja.
  'conciliacion',
  'adquisicion',
  'audiencia',
  'invitaciones',
  'marketing',
  'gamificacion',
  'personalizacion',
  // Sinónimos de búsqueda (`/admin/sinonimos`): las equivalencias con las que
  // los clientes de la empresa encuentran su catálogo. Segundo caso destapado
  // por la prueba del menú, y más serio que `facturas`: sus dos server actions
  // (`guardarSinonimoEmpresa`, `eliminarSinonimoEmpresa`) pedían
  // `requireRole(ADMIN_ROLES)`, que incluye MARKETING y SUPERVISOR. Como las
  // actions se despachan por ID desde cualquier path permitido, el gate del
  // proxy no las tapaba: se podían llamar sin poder abrir la pantalla.
  'sinonimos',
  // Módulo de EXCURSIONES (ventas, vendedores y comisiones). Detrás de la
  // capacidad EXCURSIONES: sin ella encendida, requireSection la niega.
  'excursiones',
  // CRM (`/admin/crm/*`). UNA sección para el módulo entero, y a propósito:
  // su layout exige 'leads' para todo el subárbol y `SECCION_POR_PREFIJO` le
  // manda las rutas, así que negarla cierra de una vez prospectos,
  // conversaciones, seguimientos, métricas y configuración.
  //
  // Aquí hubo también 'conversaciones', 'pipeline' y 'configuracion'. Ninguna
  // se exigió nunca en ningún sitio —cero `requireSection`, y sin ruta propia
  // que el proxy pudiera cerrar—, así que eran tres casillas del formulario de
  // Permisos que no cambiaban ningún acceso: exactamente el «interruptor
  // pintado» que `funciones.ts` prohíbe para las funciones. Si el CRM llega a
  // necesitar permisos finos, se añaden CON su guardia y no antes; lo vigila
  // la prueba «toda sección se exige en algún sitio».
  'leads',
  // Membego Connect (Fase 4): claves de API, webhooks y actividad de las
  // integraciones de la empresa. Es una sección de CONFIGURACIÓN sensible —
  // una clave de API abre los datos de la empresa a un tercero— así que no
  // entra en los roles acotados: solo la ve quien administra de verdad.
  'integraciones',
  // `/admin/app/<vertical>/*`. El launchpad `/admin/aplicaciones` se retiró
  // —los sistemas de cada oficio se construyen aparte y se conectan por
  // contrato—, pero las pantallas de Car Wash siguen en el repositorio para su
  // extracción y su guardia tiene que seguir existiendo. Ya no se enlazan desde
  // ningún sitio: son alcanzables por URL y nada más.
  'app',
  // Membego Supply (`/admin/supply/*`): los compromisos de la empresa COMO
  // PROVEEDORA de la plataforma — cuánto contrató Membego, cuánto lleva
  // entregado, sus liquidaciones y sus incidencias.
  //
  // Va detrás de la capacidad MEMBEGO_SUPPLIER, y NO entra en los roles
  // acotados: aquí se leen cifras contractuales y de liquidación, que es
  // información de dirección, no de mostrador. Escanear vouchers vive en
  // 'scanner', que sí tiene Supervisión.
  'supply',
] as const

// Tipo derivado de la lista: una sola fuente de verdad (evita drift).
export type AdminSection = (typeof ADMIN_SECTIONS)[number]

// Secciones permitidas por rol acotado (Decisión 2 del plan de onboarding).
// MARKETING = difusión; SUPERVISOR = operación. Ambos incluyen 'dashboard'
// como aterrizaje. Todo lo no listado queda denegado (fail-closed).
//
// `facturas` NO entra en ninguno de los dos, y es una decisión, no un olvido:
// Supervisión ya tiene `pagos`, `registros` y `conciliacion`, así que el
// historial de comprobantes le encajaría… salvo que reimprimir uno pasa por
// `registrarImpresionTx`, guardada por `SCANNER_ROLES`, que NO incluye
// SUPERVISOR. Darle la pantalla sin la acción es un botón que contesta "No
// autorizado". Primero se decide si Supervisión reimprime; después se le abre
// la sección.
//
// Mientras tanto, en la práctica no le cambia el acceso a NADIE: los roles
// plenos ya entraban y los acotados ya rebotaban en el proxy, que denegaba los
// paths de /admin sin sección. Lo que sí cambia es que ahora se puede
// gobernar — y que la pantalla dejó de fiarse solo del proxy: pasó de
// `requireRole(ADMIN_ROLES)`, que incluye a Marketing y Supervisión, a
// `requireSection('facturas')`, que no.
//
// `sinonimos` tampoco entra, y por el mismo motivo de fondo: el menú nunca se
// lo enseñó a los roles acotados, y cambiarle el dueño a un módulo no se hace
// de paso. La diferencia con `facturas` es que aquí sí había una puerta
// abierta: sus server actions aceptaban `ADMIN_ROLES`, y a las actions el
// proxy no las cubre. Ahora piden la sección, así que Marketing y Supervisión
// dejan de poder tocar los sinónimos — que es lo que el menú ya daba a
// entender.
const RESTRICTED_ACCESS: Partial<Record<AppRole, AdminSection[]>> = {
  // 'riesgo' entra en los dos: Marketing lo necesita para saber a quién
  // dirigir una campaña de retención, y Supervisión para repartir las llamadas.
  MARKETING: ['dashboard', 'ofertas', 'promociones', 'publicaciones', 'campanas', 'marketing', 'audiencia', 'adquisicion', 'notificaciones', 'automatizaciones', 'riesgo', 'retencion'],
  // Sin 'aplicaciones': el módulo se retiró a propósito (los genéricos —QR,
  // citas, seguimiento— volvieron al menú lateral como secciones propias).
  SUPERVISOR: ['dashboard', 'reportes', 'seguimiento', 'registros', 'actividad', 'clientes', 'membresias', 'pagos', 'scanner', 'citas', 'app', 'riesgo', 'retencion', 'conciliacion'],
  /**
   * EL MOSTRADOR. Lo que hace falta para cobrar, registrar una visita y
   * atender a quien está delante: el cliente, su membresía, el cobro, el
   * comprobante, la cita y el canje. Nada de marketing, nada de configuración
   * y nada de analítica.
   */
  //
  // Sin 'regalos' A PROPÓSITO, aunque un regalo VIP se entregue en el
  // mostrador: en el menú vive bajo el grupo «Marketing», y era el único
  // enlace que hacía que a un cajero le siguiera apareciendo ese título. Un
  // cajero que sí entregue regalos lo recibe desde su pantalla de Permisos.
  CAJERO: ['dashboard', 'clientes', 'membresias', 'pagos', 'facturas', 'citas', 'scanner', 'ofertas', 'registros', 'conciliacion'],
  /**
   * LA OPERACIÓN. Todo lo del mostrador más lo que hace falta para dirigirla:
   * los reportes, la bitácora, el seguimiento, el equipo y las sucursales.
   *
   * Fuera queda el marketing —campañas, audiencia, adquisición,
   * automatizaciones, publicaciones— y la configuración comercial de la
   * empresa: planes, métodos de pago, perfil público, personalización e
   * integraciones. Eso lo decide quien es dueño del negocio, no quien dirige
   * el turno. Cualquiera de esas se concede a un gerente concreto desde su
   * pantalla de Permisos.
   */
  GERENTE: [
    'dashboard', 'clientes', 'membresias', 'pagos', 'facturas', 'citas', 'scanner',
    'ofertas', 'regalos', 'promociones', 'registros', 'actividad', 'reportes',
    'seguimiento', 'riesgo', 'retencion', 'conciliacion', 'empleados', 'invitaciones',
    'sucursales', 'tickets', 'comunicacion', 'app', 'excursiones',
  ],
}

/**
 * ¿Puede este rol abrir esta sección del panel?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS PREGUNTAS QUE ERAN LA MISMA Y NO LO SON
 *
 * Esto miraba PRIMERO `FULL_ADMIN_ROLES`, así que un CAJERO y un GERENTE
 * traían TODAS las secciones: campañas, audiencia, automatizaciones y la
 * configuración comercial incluidas. No era un fallo del módulo de Permisos
 * —negar funcionaba— sino que no había nada que negar hasta que alguien se
 * sentaba a quitarle cuarenta casillas a cada empleado, una por una.
 *
 * `FULL_ADMIN_ROLES` NO se toca, y es deliberado: esa lista responde otra
 * pregunta —«¿es admin pleno para MUTAR?»— y la consultan 41 guardias de
 * server action, el reparto de avisos, los comprobantes y el onboarding.
 * Sacar de ahí al cajero le habría dejado el panel a la vista y las manos
 * atadas, que es peor que el problema.
 *
 * Así que el orden se invierte: un rol con paquete acotado se rige POR SU
 * PAQUETE; solo quien no tiene paquete cae en «admin pleno lo trae todo».
 * Administrador y superadmin siguen sin paquete, y siguen trayéndolo todo.
 */
export function canAccessAdminSection(role: AppRole, section: AdminSection): boolean {
  const paquete = RESTRICTED_ACCESS[role]
  if (paquete) return paquete.includes(section)
  return FULL_ADMIN_ROLES.includes(role)
}

// ── Permisos POR EMPLEADO (módulo de Permisos, 14-08-2026) ───────────────────
//
// El rol da el punto de partida; los permisos del empleado lo AJUSTAN en las
// dos direcciones: conceder una sección que su rol no trae, o negarle una que
// sí trae — y dentro de una sección permitida, negar funciones concretas.
//
// Se guardan como DIFERENCIAS contra el rol (mismo patrón que los overrides
// de capacidades): si mañana cambia lo que un rol trae de serie, los
// empleados sin ajuste lo heredan solo.

export interface PermisosUsuario {
  v: 1
  /** Sección → true (conceder más allá del rol) | false (negar pese al rol). */
  secciones?: Record<string, boolean>
  /** Sección → función → false (negada). Solo se guardan negaciones. */
  funciones?: Record<string, Record<string, boolean>>
}

/**
 * Roles a los que los ajustes NO se aplican al RESOLVER: solo el superadmin.
 *
 * DECISIÓN DE PRODUCTO (15-08-2026, dueño de la plataforma): en esta etapa la
 * plataforma tiene control total sobre lo que cada empresa puede usar — así
 * que los ajustes SÍ aplican a los ADMINISTRADORES de empresa… pero solo el
 * superadmin puede ponérselos (ver `puedeEditarPermisos`): un admin sigue
 * sin poder bloquear a otro admin ni a sí mismo. El candado cambió de "los
 * admins son intocables" a "a los admins solo los toca la plataforma".
 */
export const ROLES_EXENTOS_PERMISOS: readonly AppRole[] = ['SUPERADMIN']

const ROLES_ADMIN_EMPRESA: readonly AppRole[] = ['ADMINISTRADOR', 'ADMIN_EMPRESA']

/**
 * Quién puede ABRIR el módulo de Permisos: la ficha de un empleado y el mapa
 * de accesos del equipo. `puedeEditarPermisos` decide después a quién de la
 * lista puede tocar cada uno; esto es solo la puerta de entrada.
 *
 * Vive aquí y no en la pantalla porque ya son dos las que la necesitan. Una
 * lista copiada a mano en una tercera —con un rol de más— es una puerta
 * abierta que no se ve en ninguna revisión: el código compila igual. Una
 * prueba vigila que nadie vuelva a escribirla suelta.
 */
export const ROLES_CON_PERMISOS: AppRole[] = ['SUPERADMIN', 'ADMINISTRADOR', 'ADMIN_EMPRESA']

/**
 * ¿Puede `editor` ajustar los permisos de `objetivo`?
 *  · SUPERADMIN → a cualquiera menos a otro superadmin.
 *  · Admin de empresa → a su equipo, nunca a otro admin (ni a la plataforma).
 *  · Nadie se edita a sí mismo (eso lo valida el caller con los ids).
 */
export function puedeEditarPermisos(editor: AppRole, objetivo: AppRole): boolean {
  if (objetivo === 'SUPERADMIN') return false
  if (editor === 'SUPERADMIN') return true
  if (ROLES_ADMIN_EMPRESA.includes(editor)) return !ROLES_ADMIN_EMPRESA.includes(objetivo)
  return false
}

/** Normaliza el JSON guardado (tolerante a null/basura). Null = sin ajustes. */
export function resolverPermisosUsuario(raw: unknown): PermisosUsuario | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as { secciones?: unknown; funciones?: unknown }
  const secciones: Record<string, boolean> = {}
  if (r.secciones && typeof r.secciones === 'object') {
    for (const [k, v] of Object.entries(r.secciones as Record<string, unknown>)) {
      if ((ADMIN_SECTIONS as readonly string[]).includes(k) && typeof v === 'boolean') {
        secciones[k] = v
      }
    }
  }
  const funciones: Record<string, Record<string, boolean>> = {}
  if (r.funciones && typeof r.funciones === 'object') {
    for (const [sec, fns] of Object.entries(r.funciones as Record<string, unknown>)) {
      if (!(ADMIN_SECTIONS as readonly string[]).includes(sec)) continue
      if (!fns || typeof fns !== 'object') continue
      const limpio: Record<string, boolean> = {}
      for (const [f, v] of Object.entries(fns as Record<string, unknown>)) {
        if (v === false) limpio[f] = false
      }
      if (Object.keys(limpio).length) funciones[sec] = limpio
    }
  }
  if (!Object.keys(secciones).length && !Object.keys(funciones).length) return null
  return { v: 1, secciones, funciones }
}

/**
 * ¿Puede ESTE empleado abrir esta sección? Rol como base, ajuste encima.
 * Los roles exentos ignoran los ajustes (nunca pueden quedar bloqueados).
 */
export function seccionPermitida(
  role: AppRole,
  section: AdminSection,
  permisos: PermisosUsuario | null | undefined
): boolean {
  const base = canAccessAdminSection(role, section)
  if (ROLES_EXENTOS_PERMISOS.includes(role)) return base
  return permisos?.secciones?.[section] ?? base
}

/**
 * ¿Esta sección se le CONCEDIÓ a esta persona de forma explícita?
 *
 * Distinto de `seccionPermitida`, que responde «puede o no puede» sumando el
 * rol. Esto responde «alguien se sentó a dárselo»: solo mira el ajuste, y
 * solo el valor `true`. Lo necesitan las superficies que deben tratar una
 * concesión como una decisión deliberada —abrirle el panel a quien su rol no
 * lo trae, o enseñarle en el menú un módulo por encima de su rango—, sin que
 * eso valga para lo que simplemente viene heredado.
 */
export function seccionConcedida(
  section: AdminSection,
  permisos: PermisosUsuario | null | undefined
): boolean {
  return permisos?.secciones?.[section] === true
}

/**
 * ¿Puede esta persona ENTRAR al panel de empresa?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PUERTA QUE HACÍA DECORATIVO AL MÓDULO DE PERMISOS
 *
 * La entrada a `/admin` se decidía SOLO por rol (`ADMIN_ROLES`), y esa
 * comprobación ocurre ANTES de que nadie mire los permisos. Un EMPLEADO al
 * que se le concedían Clientes, Membresías y Pagos veía en su pantalla de
 * Permisos «Concedido», se guardaba en la base, y el proxy lo rebotaba a su
 * escáner sin llegar a consultarlo: tres módulos concedidos y ninguno
 * alcanzable.
 *
 * Ahora la puerta admite las dos llaves. El rol sigue abriendo de par en par;
 * una concesión explícita abre solo para lo concedido, porque en cuanto se
 * pasa esta puerta manda `seccionPermitida` sección por sección —ni siquiera
 * el panel de inicio, que para un rol de mostrador no está concedido—.
 */
export function puedeEntrarAlPanel(
  role: AppRole,
  permisos: PermisosUsuario | null | undefined
): boolean {
  if (ADMIN_ROLES.includes(role)) return true
  return ADMIN_SECTIONS.some((s) => seccionConcedida(s, permisos))
}

/**
 * ¿Puede ejecutar esta FUNCIÓN de la sección? Exige la sección permitida y
 * que la función no esté negada. Las funciones no negadas se permiten: la
 * negación es la excepción, no la regla.
 */
export function funcionPermitida(
  role: AppRole,
  section: AdminSection,
  funcion: string,
  permisos: PermisosUsuario | null | undefined
): boolean {
  if (!seccionPermitida(role, section, permisos)) return false
  if (ROLES_EXENTOS_PERMISOS.includes(role)) return true
  return permisos?.funciones?.[section]?.[funcion] !== false
}

/**
 * Convierte la SELECCIÓN del formulario (estado efectivo deseado por sección
 * y función) en el JSON de diferencias contra el rol. Devuelve null si no
 * queda ningún ajuste (la columna se limpia).
 */
export function permisosDesdeSeleccion(
  role: AppRole,
  seleccion: {
    secciones: Partial<Record<AdminSection, boolean>>
    funcionesNegadas: Partial<Record<AdminSection, string[]>>
  }
): PermisosUsuario | null {
  const secciones: Record<string, boolean> = {}
  for (const [sec, efectivo] of Object.entries(seleccion.secciones)) {
    if (typeof efectivo !== 'boolean') continue
    const base = canAccessAdminSection(role, sec as AdminSection)
    if (efectivo !== base) secciones[sec] = efectivo
  }
  const funciones: Record<string, Record<string, boolean>> = {}
  for (const [sec, negadas] of Object.entries(seleccion.funcionesNegadas)) {
    if (!negadas?.length) continue
    funciones[sec] = Object.fromEntries(negadas.map((f) => [f, false]))
  }
  if (!Object.keys(secciones).length && !Object.keys(funciones).length) return null
  return { v: 1, secciones, funciones }
}

/**
 * Prefijos cuyo primer segmento NO da su nombre a una sección.
 *
 * Hoy solo el CRM. Sus pantallas viven bajo `/admin/crm/*` pero el módulo se
 * gobierna por `leads`, que es lo que exige su layout para todo el subárbol
 * (`src/app/(admin)/admin/crm/layout.tsx`) y lo que piden todas sus server
 * actions. El catálogo de capacidades ya lo decía —«todo /admin/crm cuelga de
 * la sección 'leads'»—; lo que faltaba era que `adminSectionForPath` lo
 * supiera, porque hasta ahora devolvía null y el proxy trataba el módulo
 * entero como una ruta desconocida.
 *
 * Inventar una sección `crm` habría sido la otra salida, y es peor: serían
 * cinco casillas en el formulario de Permisos para un módulo con una sola
 * puerta, y cuatro de ellas no harían nada.
 */
const SECCION_POR_PREFIJO: ReadonlyArray<readonly [string, AdminSection]> = [
  ['/admin/crm', 'leads'],
]

/**
 * Deriva la sección de un path del panel: `/admin/promociones/nuevo` →
 * `promociones`. Solo `/admin` exacto → `dashboard`. Devuelve null si el path
 * no es de /admin, tiene un segmento vacío (p. ej. `/admin//x`) o la sección
 * no es reconocida — en esos casos el llamador debe denegar (fail-closed).
 */
export function adminSectionForPath(path: string): AdminSection | null {
  if (path === '/admin') return 'dashboard'
  if (!path.startsWith('/admin/')) return null
  for (const [prefijo, seccion] of SECCION_POR_PREFIJO) {
    if (path === prefijo || path.startsWith(prefijo + '/')) return seccion
  }
  const seg = path.split('/')[2]
  if (!seg) return null
  return (ADMIN_SECTIONS as readonly string[]).includes(seg) ? (seg as AdminSection) : null
}
