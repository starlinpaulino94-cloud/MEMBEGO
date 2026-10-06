/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · EL JUICIO OPERATIVO, EN UN SITIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PREGUNTA QUE ESTE ARCHIVO CONTESTA
 *
 * ¿Está sano esto? Y «sano» no puede significar «el código existe»: tiene que
 * salir de datos reales, con un umbral que alguien decidió y que se puede
 * mover sin tocar el código.
 *
 * Todo lo de aquí es puro —números y estados entran, veredicto sale—, así que
 * cada caso se puede comprobar sin base de datos. El panel solo pinta lo que
 * esto decide.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CUATRO ESTADOS, Y NO TODO ES ROJO
 *
 *   HEALTHY         funciona
 *   DEGRADED        funciona y hay trabajo acumulado o algo que mirar
 *   UNAVAILABLE     no funciona: no se puede operar
 *   NOT_CONFIGURED  no está puesto. NO es un fallo si está apagado a propósito
 *
 * La diferencia entre DEGRADED y UNAVAILABLE es la que decide si alguien se
 * levanta de madrugada. Pintar todo en rojo es la forma más rápida de que
 * nadie mire ninguno.
 */

export type EstadoComponente = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED'

/** De peor a mejor. Es el orden en el que un operador quiere ver la lista. */
export const ORDEN_ESTADO: Record<EstadoComponente, number> = {
  UNAVAILABLE: 0,
  DEGRADED: 1,
  NOT_CONFIGURED: 2,
  HEALTHY: 3,
}

export function peorEstado(estados: readonly EstadoComponente[]): EstadoComponente {
  if (estados.length === 0) return 'HEALTHY'
  return [...estados].sort((a, b) => ORDEN_ESTADO[a] - ORDEN_ESTADO[b])[0]!
}

/**
 * El estado agregado del sistema.
 *
 * `NOT_CONFIGURED` NO arrastra el total a rojo: una integración apagada a
 * propósito es una decisión, no una avería. Lo que sí lo arrastra es que algo
 * encendido no funcione.
 */
export function estadoDelSistema(componentes: readonly { estado: EstadoComponente }[]): EstadoComponente {
  const cuentan = componentes.map((c) => c.estado).filter((e) => e !== 'NOT_CONFIGURED')
  if (cuentan.length === 0) return 'NOT_CONFIGURED'
  return peorEstado(cuentan)
}

export type SeveridadAlerta = 'INFO' | 'WARNING' | 'CRITICAL'

export const ORDEN_SEVERIDAD: Record<SeveridadAlerta, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }

// ── Umbrales ────────────────────────────────────────────────────────────────

/**
 * Los umbrales, configurables y con valor por defecto documentado.
 *
 * Son el juicio operativo escrito en números, y por eso se pueden mover sin
 * tocar código: lo que para un negocio es «atrasado» para otro es normal. Un
 * valor absurdo —negativo, no numérico— NO apaga la vigilancia: se vuelve al
 * de siempre, porque un umbral mal escrito no puede dejar el sistema ciego.
 */
export interface Umbrales {
  /** Minutos de un efecto esperando antes de avisar. Por defecto 15. */
  outboxPendienteAviso: number
  /** Minutos antes de considerarlo crítico. Por defecto 60. */
  outboxPendienteCritico: number
  /** Cuántos difuntos de la cola bastan para avisar. Por defecto 1. */
  difuntosAviso: number
  /** Cuántos incidentes HIGH abiertos bastan para avisar. Por defecto 1. */
  incidentesAltosAviso: number
  /** Cuántas conciliaciones discrepantes bastan para avisar. Por defecto 1. */
  discrepanciasAviso: number
  /** Cuántos eventos del inbox muertos bastan para avisar. Por defecto 1. */
  eventosMuertosAviso: number
}

export const UMBRALES_POR_DEFECTO: Umbrales = {
  outboxPendienteAviso: 15,
  outboxPendienteCritico: 60,
  difuntosAviso: 1,
  incidentesAltosAviso: 1,
  discrepanciasAviso: 1,
  eventosMuertosAviso: 1,
}

/** Lee un entero positivo del entorno, o se queda con el de siempre. */
export function enteroPositivo(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor)
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : porDefecto
}

export function umbralesDelEntorno(env: Record<string, string | undefined> = process.env): Umbrales {
  const u: Umbrales = {
    outboxPendienteAviso: enteroPositivo(env.SUPPLY_V2_OUTBOX_PENDING_WARN_MINUTES, UMBRALES_POR_DEFECTO.outboxPendienteAviso),
    outboxPendienteCritico: enteroPositivo(env.SUPPLY_V2_OUTBOX_PENDING_CRITICAL_MINUTES, UMBRALES_POR_DEFECTO.outboxPendienteCritico),
    difuntosAviso: enteroPositivo(env.SUPPLY_V2_DEAD_LETTER_THRESHOLD, UMBRALES_POR_DEFECTO.difuntosAviso),
    incidentesAltosAviso: enteroPositivo(env.SUPPLY_V2_OPEN_INCIDENTS_HIGH_THRESHOLD, UMBRALES_POR_DEFECTO.incidentesAltosAviso),
    discrepanciasAviso: enteroPositivo(env.SUPPLY_V2_MISMATCH_THRESHOLD, UMBRALES_POR_DEFECTO.discrepanciasAviso),
    eventosMuertosAviso: enteroPositivo(env.SUPPLY_V2_INBOX_DEAD_THRESHOLD, UMBRALES_POR_DEFECTO.eventosMuertosAviso),
  }
  // Si alguien pone el crítico por debajo del aviso, el crítico manda: un
  // umbral mal ordenado no puede hacer que lo grave avise más tarde que lo
  // leve.
  if (u.outboxPendienteCritico < u.outboxPendienteAviso) {
    u.outboxPendienteCritico = u.outboxPendienteAviso
  }
  return u
}

// ── Las cifras que el panel resume ──────────────────────────────────────────

export interface CifrasOperativas {
  incidentesAbiertos: number
  incidentesAltos: number
  discrepancias: number
  outboxPendiente: number
  outboxMasViejoMin: number | null
  outboxMuertos: number
  eventosFallidos: number
  eventosMuertos: number
  difuntosDeCola: number
  /** Cuántos efectos se entregaron en la última ventana: señal de vida. */
  efectosEntregados: number
}

export const CIFRAS_EN_CERO: CifrasOperativas = {
  incidentesAbiertos: 0,
  incidentesAltos: 0,
  discrepancias: 0,
  outboxPendiente: 0,
  outboxMasViejoMin: null,
  outboxMuertos: 0,
  eventosFallidos: 0,
  eventosMuertos: 0,
  difuntosDeCola: 0,
  efectosEntregados: 0,
}

export interface Componente {
  clave: string
  etiqueta: string
  estado: EstadoComponente
  /** Una frase que explique el estado. Nunca «todo bien» sin dato detrás. */
  detalle: string
}

export interface EntradaDeSalud {
  cifras: CifrasOperativas
  /** ¿Responde la base? Lo único que puede dejar todo UNAVAILABLE. */
  baseViva: boolean
  /** Deriva de esquema detectada: el código espera algo que la base no tiene. */
  derivaDeEsquema: boolean
  /** Lo que el validador de configuración dijo de cada pieza. */
  configuracion: readonly { clave: string; estado: EstadoConfig }[]
  /** El estado efectivo de cada capacidad (bandera Y interruptor). */
  capacidades: Readonly<Record<Capacidad, boolean>>
  umbrales: Umbrales
}

/**
 * LOS COMPONENTES, DERIVADOS DE DATOS. Ninguno dice HEALTHY por existir.
 */
export function componentesDeSalud(e: EntradaDeSalud): Componente[] {
  const u = e.umbrales
  const c = e.cifras

  const base: Componente = e.baseViva
    ? e.derivaDeEsquema
      ? { clave: 'base', etiqueta: 'Base de datos', estado: 'DEGRADED', detalle: 'Responde, pero el código espera objetos que no están: hay migraciones pendientes.' }
      : { clave: 'base', etiqueta: 'Base de datos', estado: 'HEALTHY', detalle: 'Responde y el esquema coincide con el código.' }
    : { clave: 'base', etiqueta: 'Base de datos', estado: 'UNAVAILABLE', detalle: 'No responde: Supply 2.0 no puede operar.' }

  const pagos: Componente = !e.capacidades.SUPPLY_V2_EXTERNAL_PAYMENTS
    ? { clave: 'pagos', etiqueta: 'Pagos externos', estado: 'NOT_CONFIGURED', detalle: 'Apagados a propósito: el webhook responde sin procesar.' }
    : faltaConfig(e.configuracion, ['SUPPLY_V2_TEST_GATEWAY_SECRET', 'SUPPLY_V2_WEBHOOK_ACTOR_ID'])
      ? { clave: 'pagos', etiqueta: 'Pagos externos', estado: 'UNAVAILABLE', detalle: 'Encendidos pero sin configurar: no se puede aceptar un aviso de pago.' }
      : c.eventosMuertos >= u.eventosMuertosAviso
        ? { clave: 'pagos', etiqueta: 'Pagos externos', estado: 'DEGRADED', detalle: `${c.eventosMuertos} evento(s) agotaron sus intentos y esperan decisión.` }
        : c.eventosFallidos > 0
          ? { clave: 'pagos', etiqueta: 'Pagos externos', estado: 'DEGRADED', detalle: `${c.eventosFallidos} evento(s) reprogramados tras un fallo.` }
          : { clave: 'pagos', etiqueta: 'Pagos externos', estado: 'HEALTHY', detalle: 'Firma, cuenta de integración y procesamiento al día.' }

  const outbox: Componente = !e.capacidades.SUPPLY_V2_OUTBOX_DELIVERY
    ? { clave: 'outbox', etiqueta: 'Outbox', estado: 'NOT_CONFIGURED', detalle: 'Entrega apagada: los efectos se apuntan y esperan.' }
    : c.outboxMuertos > 0
      ? { clave: 'outbox', etiqueta: 'Outbox', estado: 'DEGRADED', detalle: `${c.outboxMuertos} efecto(s) sin salida tras agotar los intentos.` }
      : c.outboxMasViejoMin != null && c.outboxMasViejoMin >= u.outboxPendienteCritico
        ? { clave: 'outbox', etiqueta: 'Outbox', estado: 'UNAVAILABLE', detalle: `Hay un efecto esperando ${c.outboxMasViejoMin} min: la entrega no está corriendo.` }
        : c.outboxMasViejoMin != null && c.outboxMasViejoMin >= u.outboxPendienteAviso
          ? { clave: 'outbox', etiqueta: 'Outbox', estado: 'DEGRADED', detalle: `El efecto más viejo lleva ${c.outboxMasViejoMin} min esperando.` }
          : { clave: 'outbox', etiqueta: 'Outbox', estado: 'HEALTHY', detalle: c.outboxPendiente > 0 ? `${c.outboxPendiente} efecto(s) en cola, todos recientes.` : 'Sin efectos pendientes.' }

  const trabajos: Componente = c.difuntosDeCola >= u.difuntosAviso
    ? { clave: 'trabajos', etiqueta: 'Trabajos en cola', estado: 'DEGRADED', detalle: `${c.difuntosDeCola} trabajo(s) difunto(s) esperando decisión.` }
    : { clave: 'trabajos', etiqueta: 'Trabajos en cola', estado: 'HEALTHY', detalle: 'Ningún trabajo difunto pendiente.' }

  const conciliacion: Componente = !e.capacidades.SUPPLY_V2_RECONCILIATION_SWEEP
    ? { clave: 'conciliacion', etiqueta: 'Conciliación', estado: 'NOT_CONFIGURED', detalle: 'Barrido apagado: solo concilia el camino del webhook.' }
    : c.incidentesAltos >= u.incidentesAltosAviso
      ? { clave: 'conciliacion', etiqueta: 'Conciliación', estado: 'DEGRADED', detalle: `${c.incidentesAltos} incidente(s) de severidad alta sin resolver.` }
      : c.discrepancias >= u.discrepanciasAviso
        ? { clave: 'conciliacion', etiqueta: 'Conciliación', estado: 'DEGRADED', detalle: `${c.discrepancias} comprobación(es) con desacuerdo.` }
        : { clave: 'conciliacion', etiqueta: 'Conciliación', estado: 'HEALTHY', detalle: c.incidentesAbiertos > 0 ? `${c.incidentesAbiertos} incidente(s) abierto(s), ninguno de severidad alta.` : 'Sin desacuerdos abiertos.' }

  const config: Componente = (() => {
    const faltan = e.configuracion.filter((x) => x.estado === 'MISSING' || x.estado === 'INVALID')
    if (faltan.length === 0) {
      return { clave: 'config', etiqueta: 'Configuración', estado: 'HEALTHY' as const, detalle: 'Todo lo crítico está puesto.' }
    }
    // Falta algo, pero ¿de algo encendido? Si la capacidad está apagada, falta
    // por decisión, no por descuido.
    const criticoEncendido = faltaConfig(e.configuracion, ['SUPPLY_V2_WEBHOOK_ACTOR_ID']) && e.capacidades.SUPPLY_V2_EXTERNAL_PAYMENTS
    return {
      clave: 'config',
      etiqueta: 'Configuración',
      estado: criticoEncendido ? ('UNAVAILABLE' as const) : ('NOT_CONFIGURED' as const),
      detalle: `${faltan.length} variable(s) crítica(s) sin configurar o con valor inválido.`,
    }
  })()

  return [base, pagos, outbox, conciliacion, trabajos, config]
}

function faltaConfig(
  configuracion: readonly { clave: string; estado: EstadoConfig }[],
  claves: readonly string[]
): boolean {
  return configuracion.some((c) => claves.includes(c.clave) && (c.estado === 'MISSING' || c.estado === 'INVALID'))
}

// ── Configuración crítica ───────────────────────────────────────────────────

/**
 * El estado de una pieza de configuración. NUNCA su valor.
 *
 *   CONFIGURED    está y parece válida
 *   MISSING       no está, y hace falta
 *   INVALID       está pero no sirve (formato, longitud, un marcador de ejemplo)
 *   DISABLED      no hace falta porque la capacidad está apagada
 */
export type EstadoConfig = 'CONFIGURED' | 'MISSING' | 'INVALID' | 'DISABLED'

export interface PiezaDeConfig {
  clave: string
  etiqueta: string
  estado: EstadoConfig
  /** Qué hacer si falta. Sin valores, sin pistas sobre el secreto. */
  remedio: string
}

/** Valores de ejemplo que se cuelan al copiar un `.env`: no son configuración. */
const MARCADORES = ['cambiame', 'changeme', 'xxx', 'tu-secreto', 'your-secret', 'placeholder', 'todo']

/**
 * ¿Es esto un secreto de verdad?
 *
 * Se comprueba la FORMA, no el valor: longitud mínima y que no sea un marcador
 * de ejemplo. Un secreto de cuatro letras copiado de un tutorial pasa
 * cualquier comprobación de «¿está puesto?» y no protege nada.
 */
export function secretoValido(valor: string | undefined, minimo = 16): EstadoConfig {
  const v = valor?.trim()
  if (!v) return 'MISSING'
  if (v.length < minimo) return 'INVALID'
  if (MARCADORES.some((m) => v.toLowerCase().includes(m))) return 'INVALID'
  return 'CONFIGURED'
}

// ── Banderas y interruptores ────────────────────────────────────────────────

/**
 * LAS CAPACIDADES DE SUPPLY 2.0 QUE SE PUEDEN APAGAR.
 *
 * Nombres explícitos a propósito: `SUPPLY_V2_EXTERNAL_PAYMENTS` dice qué se
 * apaga; `SUPPLY_V2_PAGOS` no diría si se apaga el cobro al cliente, el pago
 * al proveedor o los avisos de la pasarela.
 */
export const CAPACIDADES = [
  'SUPPLY_V2_EXTERNAL_PAYMENTS',
  'SUPPLY_V2_OUTBOX_DELIVERY',
  'SUPPLY_V2_RECONCILIATION_SWEEP',
  'SUPPLY_V2_OPERATIONS_CENTER',
  // Bloque 5: las automatizaciones que avisan por vencimientos y por el estado
  // operativo. Es una capacidad y no una tabla de reglas nueva porque lo que
  // hay que poder decidir es «avisa o no avisa», y eso ya lo sabe hacer el
  // interruptor del bloque 4 —desde el panel, con motivo y auditado—.
  'SUPPLY_V2_AUTOMATIONS',
] as const
export type Capacidad = (typeof CAPACIDADES)[number]

export const ETIQUETA_CAPACIDAD: Record<Capacidad, string> = {
  SUPPLY_V2_EXTERNAL_PAYMENTS: 'Pagos externos (webhook de pasarela)',
  SUPPLY_V2_OUTBOX_DELIVERY: 'Entrega de efectos del outbox',
  SUPPLY_V2_RECONCILIATION_SWEEP: 'Barrido de conciliación',
  SUPPLY_V2_OPERATIONS_CENTER: 'Centro de Operaciones',
  SUPPLY_V2_AUTOMATIONS: 'Automatizaciones de aviso',
}

/**
 * LO QUE SE APAGA AL APAGAR CADA COSA, Y LO QUE NO.
 *
 * Esto es la diferencia entre un interruptor útil y uno que deja el sistema a
 * ciegas: apagar los pagos externos corta el PROCESAMIENTO, no la lectura. El
 * Centro de Operaciones sigue funcionando, la búsqueda sigue funcionando, un
 * incidente se sigue pudiendo investigar y resolver a mano. Si apagar la
 * integración apagara también el panel, nadie podría ver por qué la apagó.
 */
export const QUE_APAGA: Record<Capacidad, { corta: readonly string[]; conserva: readonly string[] }> = {
  SUPPLY_V2_EXTERNAL_PAYMENTS: {
    corta: ['recibir y procesar avisos de pago de la pasarela'],
    conserva: ['el Centro de Operaciones', 'la búsqueda', 'investigar y resolver incidentes', 'la conciliación manual'],
  },
  SUPPLY_V2_OUTBOX_DELIVERY: {
    corta: ['entregar los efectos ya apuntados'],
    conserva: ['apuntar efectos nuevos (no se pierde nada)', 'la lectura del outbox', 'el reintento manual'],
  },
  SUPPLY_V2_RECONCILIATION_SWEEP: {
    corta: ['el barrido automático'],
    conserva: ['la conciliación del webhook', 'la conciliación a petición desde el panel'],
  },
  SUPPLY_V2_OPERATIONS_CENTER: {
    corta: ['el panel de operaciones'],
    conserva: ['todo el procesamiento: apagar el panel no apaga el sistema'],
  },
  SUPPLY_V2_AUTOMATIONS: {
    corta: ['los avisos por vencimiento y los de operaciones que nacen del cron'],
    conserva: [
      'los avisos de una compra o un pago (esos nacen del hecho, no del cron)',
      'las alertas del panel',
      'todo el procesamiento',
    ],
  },
}

/**
 * La BANDERA: ¿existe esta capacidad en este despliegue? Vive en el entorno y
 * cambiarla pide un despliegue.
 *
 * Por defecto ENCENDIDA, y conviene explicar por qué eso es lo seguro aquí: la
 * protección de este camino no es la bandera —es la firma, la cuenta de
 * integración configurada y la conciliación, que fallan CERRADO cada una por su
 * cuenta—. Una bandera apagada por defecto haría que un despliegue nuevo
 * dejara de aceptar avisos de pago en silencio, que es otra forma de perder
 * dinero: el proveedor los daría por entregados.
 *
 * Solo un valor explícitamente negativo la apaga.
 */
export function banderaActiva(clave: Capacidad, env: Record<string, string | undefined> = process.env): boolean {
  const v = env[clave]?.trim().toLowerCase()
  if (v === undefined || v === '') return true
  return !['false', '0', 'off', 'no'].includes(v)
}

export function esApagado(valor: string | undefined): boolean {
  const v = valor?.trim().toLowerCase()
  return v !== undefined && ['false', '0', 'off', 'no'].includes(v)
}

/**
 * EL ESTADO EFECTIVO: bandera Y interruptor.
 *
 * La bandera es la decisión del despliegue; el interruptor es la decisión de
 * AHORA, que se guarda en la base y se cambia desde el panel sin esperar un
 * despliegue. Para que algo funcione tienen que estar las dos cosas a favor —y
 * para apagarlo basta una—, porque en una emergencia lo que se necesita es que
 * apagar sea fácil y encender sea deliberado.
 */
export function capacidadEfectiva(
  clave: Capacidad,
  interruptor: boolean | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!banderaActiva(clave, env)) return false
  return interruptor !== false
}

// ── Alertas agregadas ───────────────────────────────────────────────────────

export type EstadoAlerta = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED'

/**
 * Las condiciones que vigilamos. UNA por condición, no una por fila.
 *
 * Esto es la diferencia entre una alerta que se lee y mil que se silencian: si
 * cada efecto fallido abriera su alerta, veintitrés efectos fallidos serían
 * veintitrés avisos y nadie leería el veinticuatro. Lo que se quiere es
 * `OUTBOX_BACKLOG count=23 oldest=17m`.
 */
export const CONDICIONES = [
  'OUTBOX_BACKLOG',
  'OUTBOX_DEAD',
  'INBOX_DEAD',
  'FINANCE_INCIDENTS_HIGH',
  'RECONCILIATION_MISMATCH',
  'QUEUE_DEAD_JOBS',
  'READINESS_DEGRADED',
] as const
export type Condicion = (typeof CONDICIONES)[number]

export const ETIQUETA_CONDICION: Record<Condicion, string> = {
  OUTBOX_BACKLOG: 'Efectos del outbox esperando demasiado',
  OUTBOX_DEAD: 'Efectos sin salida',
  INBOX_DEAD: 'Eventos externos sin salida',
  FINANCE_INCIDENTS_HIGH: 'Incidentes de severidad alta sin resolver',
  RECONCILIATION_MISMATCH: 'Comprobaciones de pago con desacuerdo',
  QUEUE_DEAD_JOBS: 'Trabajos difuntos en la cola',
  READINESS_DEGRADED: 'Supply 2.0 no está listo para operar',
}

export interface AlertaCalculada {
  condicion: Condicion
  severidad: SeveridadAlerta
  /** Cuántas filas la provocan. Es el número que va en la alerta, no N alertas. */
  cuenta: number
  /** Datos de la condición, para el panel. Sin secretos: solo números. */
  detalle: Record<string, number>
  resumen: string
}

/**
 * EVALÚA TODAS LAS CONDICIONES. Devuelve solo las que se cumplen.
 *
 * Lo que no sale en esta lista y estaba activo, se resuelve: una alerta se
 * apaga porque la condición desapareció, no porque alguien la cerrara.
 */
export function evaluarAlertas(e: EntradaDeSalud): AlertaCalculada[] {
  const u = e.umbrales
  const c = e.cifras
  const alertas: AlertaCalculada[] = []

  if (c.outboxMasViejoMin != null && c.outboxMasViejoMin >= u.outboxPendienteAviso && e.capacidades.SUPPLY_V2_OUTBOX_DELIVERY) {
    const critico = c.outboxMasViejoMin >= u.outboxPendienteCritico
    alertas.push({
      condicion: 'OUTBOX_BACKLOG',
      severidad: critico ? 'CRITICAL' : 'WARNING',
      cuenta: c.outboxPendiente,
      detalle: { pendientes: c.outboxPendiente, masViejoMin: c.outboxMasViejoMin, umbralMin: critico ? u.outboxPendienteCritico : u.outboxPendienteAviso },
      resumen: `${c.outboxPendiente} efecto(s) esperando; el más viejo lleva ${c.outboxMasViejoMin} min.`,
    })
  }

  if (c.outboxMuertos > 0) {
    alertas.push({
      condicion: 'OUTBOX_DEAD',
      severidad: 'WARNING',
      cuenta: c.outboxMuertos,
      detalle: { muertos: c.outboxMuertos },
      resumen: `${c.outboxMuertos} efecto(s) agotaron sus intentos y necesitan una decisión.`,
    })
  }

  if (c.eventosMuertos >= u.eventosMuertosAviso) {
    alertas.push({
      condicion: 'INBOX_DEAD',
      severidad: 'WARNING',
      cuenta: c.eventosMuertos,
      detalle: { muertos: c.eventosMuertos },
      resumen: `${c.eventosMuertos} evento(s) externo(s) sin salida.`,
    })
  }

  if (c.incidentesAltos >= u.incidentesAltosAviso) {
    alertas.push({
      condicion: 'FINANCE_INCIDENTS_HIGH',
      severidad: 'CRITICAL',
      cuenta: c.incidentesAltos,
      detalle: { altos: c.incidentesAltos, abiertos: c.incidentesAbiertos },
      resumen: `${c.incidentesAltos} incidente(s) de severidad alta sin resolver.`,
    })
  }

  if (c.discrepancias >= u.discrepanciasAviso) {
    alertas.push({
      condicion: 'RECONCILIATION_MISMATCH',
      severidad: 'WARNING',
      cuenta: c.discrepancias,
      detalle: { discrepancias: c.discrepancias },
      resumen: `${c.discrepancias} comprobación(es) de pago no cuadran.`,
    })
  }

  if (c.difuntosDeCola >= u.difuntosAviso) {
    alertas.push({
      condicion: 'QUEUE_DEAD_JOBS',
      severidad: 'WARNING',
      cuenta: c.difuntosDeCola,
      detalle: { difuntos: c.difuntosDeCola },
      resumen: `${c.difuntosDeCola} trabajo(s) difunto(s) en la cola.`,
    })
  }

  const sistema = estadoDelSistema(componentesDeSalud(e))
  if (sistema === 'UNAVAILABLE') {
    alertas.push({
      condicion: 'READINESS_DEGRADED',
      severidad: 'CRITICAL',
      cuenta: 1,
      detalle: {},
      resumen: 'Supply 2.0 no está en condiciones de operar: ver el estado de los componentes.',
    })
  }

  return alertas.sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad])
}

/**
 * La transición que le toca a una alerta.
 *
 * `ACKNOWLEDGED` NO se pierde si la condición sigue: alguien dijo «ya lo sé» y
 * volver a ponerla en ACTIVE sería discutir con él. Lo que sí la cambia es que
 * la condición DESAPAREZCA —ahí pasa a RESOLVED— o que vuelva después de
 * resuelta, y entonces es una alerta nueva.
 */
export function transicionDeAlerta(
  estadoActual: EstadoAlerta | null,
  sigueLaCondicion: boolean
): EstadoAlerta | null {
  if (sigueLaCondicion) {
    if (estadoActual === null) return 'ACTIVE'
    if (estadoActual === 'RESOLVED') return 'ACTIVE'
    return null // ACTIVE o ACKNOWLEDGED: se queda como está
  }
  if (estadoActual === 'ACTIVE' || estadoActual === 'ACKNOWLEDGED') return 'RESOLVED'
  return null
}

// ── Búsqueda operativa ─────────────────────────────────────────────────────

export type TipoDeBusqueda =
  | 'ORDEN'
  | 'CORRELACION'
  | 'TRANSACCION'
  | 'EVENTO_EXTERNO'
  | 'ID'
  | 'DESCONOCIDO'

export interface BusquedaInterpretada {
  tipo: TipoDeBusqueda
  valor: string
}

/**
 * QUÉ ME ESTÁN PREGUNTANDO.
 *
 * Interpretar el texto ANTES de consultar es lo que permite buscar por campos
 * indexados y por igualdad: `MBG-SO-000123` es un número de compra y se busca
 * por su índice único, no con un `contains` sobre una tabla que va a crecer.
 * Un `%texto%` sobre cuatro tablas grandes es cómo un panel de operaciones se
 * convierte en la consulta más lenta del sistema justo el día que hay un
 * incidente.
 */
export function interpretarBusqueda(texto: string): BusquedaInterpretada {
  const v = texto.trim()
  if (!v) return { tipo: 'DESCONOCIDO', valor: '' }

  // Nuestro número de compra: prefijo propio y estable.
  if (/^MBG-SO-/i.test(v)) return { tipo: 'ORDEN', valor: v.toUpperCase() }
  // Nuestro hilo de operación (bloque 2): `sv2-…`.
  if (/^sv2-/i.test(v)) return { tipo: 'CORRELACION', valor: v }
  // Identificador de transacción de la pasarela.
  if (/^TX[-_]/i.test(v)) return { tipo: 'TRANSACCION', valor: v }
  // Identificador de evento del proveedor.
  if (/^(evt|ev)[-_]/i.test(v)) return { tipo: 'EVENTO_EXTERNO', valor: v }
  // Un cuid de los nuestros: 25 caracteres que empiezan por `c`.
  if (/^c[a-z0-9]{20,30}$/i.test(v)) return { tipo: 'ID', valor: v }
  return { tipo: 'DESCONOCIDO', valor: v }
}

// ── Enmascarado ─────────────────────────────────────────────────────────────

/**
 * LO QUE EL PANEL PUEDE MOSTRAR DE UN SECRETO: QUE ESTÁ.
 *
 * Ni los últimos cuatro caracteres. Un panel de operaciones lo ve más gente que
 * la base de datos —soporte, un compañero mirando por encima del hombro, una
 * captura en un chat— y «los últimos cuatro» de un secreto corto es media
 * clave. Lo único útil para operar es si está puesto y si parece válido.
 */
export function enmascarar(valor: string | undefined | null): string {
  return valor?.trim() ? 'configurado' : 'sin configurar'
}

/** Minutos enteros entre dos instantes, sin negativos. */
export function minutosDesde(fecha: Date | null | undefined, ahora = new Date()): number | null {
  if (!fecha) return null
  const ms = ahora.getTime() - fecha.getTime()
  return ms <= 0 ? 0 : Math.floor(ms / 60000)
}
