/**
 * DOMINIO DE PLATAFORMA · Fase 1 — PROYECCIONES LOCALES (read models).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SHARED DATA CONTRACTS, NO SHARED DATABASE
 *
 * Cada vertical tiene su propia base. Ninguno se conecta a la de MembeGo. Pero
 * un restaurante no puede pedir por HTTP el nombre del cliente cada vez que
 * pinta una fila de la comanda: eso es lento, frágil y se cae con MembeGo.
 *
 * La salida es que cada vertical mantenga COPIAS LOCALES de los datos
 * compartidos —proyecciones—, alimentadas por eventos. La experiencia se
 * comporta como una plataforma integrada; los datos siguen siendo de quien son.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE NO SE PUEDE ROMPER
 *
 * Una proyección es una CACHÉ, nunca una AUTORIDAD.
 *
 * Se puede leer para pintar, listar, buscar y filtrar. NO se puede leer para
 * decidir. «¿Cómo se llama este cliente?» → proyección. «¿Puede canjear este
 * beneficio?» → MembeGo, siempre, sin excepción.
 *
 * El motivo no es purismo: una proyección puede estar desfasada por un webhook
 * en cola, y una decisión tomada sobre datos viejos regala un beneficio que ya
 * se consumió. Un nombre desfasado se ve raro; un canje desfasado cuesta
 * dinero y no deja rastro de por qué.
 *
 * Por eso cada entidad declara aquí su `autoridad`, y las de tipo `CORE` no
 * admiten decisión local por muy fresca que parezca la copia.
 */

// ── Qué puede proyectar un vertical ─────────────────────────────────────────

/**
 * `refresco` es una promesa operativa, no un adorno:
 *
 *  · EVENTO   — llega por webhook cuando cambia. Puede tardar lo que tarde la
 *               cola; para nombres y etiquetas es de sobra.
 *  · CONSULTA — no se proyecta: se pregunta en el momento. Reservado para lo
 *               que decide dinero o acceso.
 */
export type ModoRefresco = 'EVENTO' | 'CONSULTA'

export type Autoridad = 'CORE' | 'VERTICAL'

export interface ContratoProyeccion {
  /** Entidad del Core que el vertical puede copiar. */
  entidad: string
  autoridad: Autoridad
  refresco: ModoRefresco
  /** Campos que el vertical puede guardar. Todo lo demás NO se envía (§69). */
  campos: readonly string[]
  /** Eventos que obligan a refrescar la copia. */
  eventos: readonly string[]
  /** Para qué sirve la copia — y para qué NO. */
  usoPermitido: string
}

export const PROYECCIONES: readonly ContratoProyeccion[] = [
  {
    entidad: 'Company',
    autoridad: 'CORE',
    refresco: 'EVENTO',
    campos: ['id', 'nombre', 'slug', 'logoUrl', 'moneda', 'zonaHoraria', 'idioma'],
    eventos: ['company.updated'],
    usoPermitido: 'Cabeceras, comprobantes, formato de moneda y fecha.',
  },
  {
    entidad: 'Branch',
    autoridad: 'CORE',
    refresco: 'EVENTO',
    campos: ['id', 'companyId', 'nombre', 'direccion', 'activa'],
    eventos: ['branch.created', 'branch.updated', 'branch.deleted'],
    usoPermitido: 'Selector de sucursal, impresión, informes locales.',
  },
  {
    entidad: 'Customer',
    autoridad: 'CORE',
    refresco: 'EVENTO',
    // Sin dirección, sin documento, sin preferencias: el vertical no las
    // necesita para operar y pedirlas por si acaso es lo contrario de §69.
    campos: ['id', 'nombre', 'email', 'telefono'],
    eventos: ['customer.created', 'customer.updated'],
    usoPermitido:
      'Buscar por nombre, pintar la comanda, imprimir. NO para decidir elegibilidad.',
  },
  {
    entidad: 'MembershipSummary',
    autoridad: 'CORE',
    refresco: 'EVENTO',
    campos: ['id', 'customerId', 'companyId', 'planNombre', 'estado', 'vigenteHasta'],
    eventos: [
      'membership.activated',
      'membership.updated',
      'membership.suspended',
      'membership.expired',
      'membership.cancelled',
    ],
    usoPermitido:
      'Mostrar "cliente con membresía activa" en pantalla. NUNCA para autorizar un canje: eso es benefits.evaluate.',
  },
  {
    entidad: 'BenefitEligibility',
    autoridad: 'CORE',
    // La única que NO se proyecta, y es la más importante de la lista.
    refresco: 'CONSULTA',
    campos: [],
    eventos: [],
    usoPermitido:
      'No se copia. Se consulta a MembeGo en cada operación: es la que decide dinero.',
  },
]

const PORENTIDAD = new Map(PROYECCIONES.map((p) => [p.entidad, p]))

export function proyeccionDe(entidad: string): ContratoProyeccion | undefined {
  return PORENTIDAD.get(entidad)
}

/**
 * ¿Puede el vertical DECIDIR con su copia local de esta entidad?
 *
 * Solo si la autoridad es suya. Es una función de una línea a propósito: el
 * SDK y las revisiones de código preguntan aquí en vez de razonarlo cada vez,
 * y así la respuesta no depende de quién esté mirando.
 */
export function puedeDecidirLocalmente(entidad: string): boolean {
  return proyeccionDe(entidad)?.autoridad === 'VERTICAL'
}

/** Entidades que se refrescan por evento (las que el satélite debe suscribir). */
export function entidadesProyectables(): ContratoProyeccion[] {
  return PROYECCIONES.filter((p) => p.refresco === 'EVENTO')
}

/**
 * Eventos que un vertical debe atender para mantener sus proyecciones al día.
 * Es la lista mínima de suscripción de cualquier satélite.
 */
export function eventosDeSincronizacion(): string[] {
  return [...new Set(entidadesProyectables().flatMap((p) => p.eventos))].sort()
}

/**
 * Campos permitidos de una entidad. El emisor de eventos recorta por aquí, así
 * que añadir un campo al payload exige declararlo antes: la minimización de
 * datos deja de depender de que alguien se acuerde.
 */
export function camposPermitidos(entidad: string): readonly string[] {
  return proyeccionDe(entidad)?.campos ?? []
}
