/**
 * COLA SIN CONEXIÓN DEL ESCÁNER DE PISTA (auditoría · Fase 7, punto 28).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA, QUE ES DE NEGOCIO Y NO DE SOFTWARE
 *
 * El escáner se usa de pie, en la pista, con un móvil, bajo un techo de zinc y
 * con el wifi del local llegando a duras penas. Cuando la red se cae —y se
 * cae— hoy pasa esto: el empleado escanea, la acción falla, sale un mensaje de
 * error, hay un coche esperando y una fila detrás. La salida real no es
 * reintentar: es **lavar el coche sin registrar la visita**.
 *
 * Y una visita no registrada no es un dato perdido. Es un uso de membresía que
 * el cliente conserva, un lavado que no aparece en caja, una comisión que el
 * lavador no cobra y un reporte del mes que miente. Es el fallo más caro del
 * sistema y el único que no produce ningún error en ningún panel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE ESTA COLA
 *
 * Si la confirmación no sale, se guarda en el dispositivo y se reintenta sola
 * cuando vuelve la red. El empleado ve "1 pendiente" y sigue atendiendo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES DECISIONES QUE IMPORTAN
 *
 * 1. **ORDEN FIFO, SIEMPRE.** Se reenvía en el orden en que ocurrieron los
 *    lavados. No es estética: el ticket lleva número secuencial por empresa y
 *    la sesión de caja tiene apertura y cierre. Reenviar en desorden produce
 *    tickets cuyo número no corresponde a su hora, que es exactamente el tipo
 *    de cosa que hace impugnable un arqueo.
 *
 * 2. **HAY ERRORES QUE NO SE REINTENTAN.** Un QR ya usado, una promoción sin
 *    usos o una falta de permisos no mejoran esperando. Reintentarlos cuatro
 *    veces solo retrasa los que sí valen y llena la cola de basura que el
 *    empleado no sabe interpretar. Se marcan como descartadas y se muestran
 *    para que alguien decida.
 *
 * 3. **REENVIAR ES SEGURO.** El servidor invalida el `qrTokenId` dentro de la
 *    misma transacción que registra la visita. Si la red se cortó DESPUÉS de
 *    que el servidor confirmara —el caso ambiguo, el que produce cobros
 *    dobles en sistemas mal hechos—, el reenvío choca contra ese token ya
 *    invalidado y devuelve `QR_YA_USADO`. Es decir: la idempotencia no la
 *    inventa esta cola, ya estaba en la base de datos; lo que hace la cola es
 *    apoyarse en ella en vez de pelearse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Este archivo es lógica PURA: no toca `window`, ni la red, ni React. Todo lo
 * que decide —qué se reenvía, cuándo, en qué orden y qué se abandona— se prueba
 * en `tests/cola-offline.test.ts`. El almacenamiento vive en `almacenCola.ts` y
 * la orquestación en `useColaOffline.ts`.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type EstadoPendiente =
  /** Esperando su turno o su siguiente intento. */
  | 'pendiente'
  /** Se está enviando ahora mismo. */
  | 'enviando'
  /** Salió bien. Se conserva un rato para que el empleado lo vea y se limpia. */
  | 'enviada'
  /** No se va a reintentar: o el error es definitivo o se agotaron los intentos. */
  | 'descartada'

export type TipoPendiente = 'visita' | 'canje'

export interface Pendiente {
  /** Identificador local. No viaja al servidor. */
  id: string
  tipo: TipoPendiente
  /** Momento del escaneo, no del envío. Es el que ordena la cola. */
  creadoEn: number
  /** Campos del formulario, ya serializados. */
  datos: Record<string, string>
  estado: EstadoPendiente
  intentos: number
  /** Epoch ms a partir del cual se puede volver a intentar. */
  proximoIntento: number
  /** Por qué falló la última vez, en etiqueta. */
  motivo?: string
  /** Para que el empleado sepa de qué lavado habla la fila. */
  etiqueta?: string
}

/** Intentos antes de rendirse. */
export const MAX_INTENTOS = 5

/**
 * Cuánto se conserva una entrada ya enviada antes de borrarla.
 *
 * Diez minutos. Lo justo para que el empleado levante la vista, vea que se
 * envió y se quede tranquilo. Borrarla al instante hace que el contador baje
 * solo y nadie sepa si llegó a salir.
 */
export const MS_CONSERVAR_ENVIADA = 10 * 60 * 1000

/**
 * Motivos que NO se reintentan.
 *
 * Son los errores que el servidor devuelve cuando la operación está mal
 * planteada, no cuando falló la comunicación. Se comparan por inclusión sobre
 * el mensaje ya normalizado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OJO AL MANTENER ESTA LISTA — una prueba encontró el fallo
 *
 * La primera versión estaba escrita contra los códigos INTERNOS del servidor
 * (`QR_YA_USADO`, `SIN_USOS`). Pero lo que llega hasta aquí no es el código: es
 * el `error` que la server action devuelve al formulario, o sea el mensaje en
 * español que lee el empleado ("Este QR ya fue utilizado…"). Ninguna de las
 * entradas de aquella lista coincidía nunca, así que TODOS los errores se
 * habrían tratado como temporales y reintentado cinco veces.
 *
 * No era un fallo visible: la cola habría funcionado igual con red buena y solo
 * habría molestado el día de una caída. Por eso se prueba.
 *
 * Regla al añadir: los fragmentos van contra el TEXTO normalizado del mensaje
 * real (`grep "error: '" src/modules/visitas/actions.ts`). Se conservan además
 * los códigos internos, porque las excepciones lanzadas (`QR_YA_USADO`) sí los
 * llevan y pueden llegar por el `catch`.
 */
const MOTIVOS_DEFINITIVOS = [
  // Códigos internos (llegan por excepción).
  'qr_ya_usado',
  'sin_usos',
  // Mensajes reales (llegan por `state.error`).
  'ya_fue_utilizado',
  'no_quedan_usos',
  'no_tienes_permisos',
  'no_autorizado',
  'no_se_encontro_la_membresia',
  'la_membresia_no_fue_encontrada',
  'la_membresia_ha_vencido',
  'compra_no_encontrada',
  'sucursal_no_valida',
  'la_sucursal_no_fue_encontrada',
  'la_sucursal_no_pertenece',
  'pertenece_a_otra_empresa',
  'datos_del_canje_incompletos',
  'selecciona_un_servicio',
  'no_es_valido_para_esta_membresia',
  'no_existe',
]

/**
 * Espera antes del siguiente intento, en milisegundos.
 *
 * 2 s, 4 s, 8 s, 16 s, 32 s. Crece porque si la red acaba de caerse, martillear
 * cada segundo gasta batería y no adelanta nada; y se topa en 32 s porque más
 * allá el empleado ya cerró la aplicación y da igual.
 *
 * El primer intento (intentos = 0) no espera: si hay red, sale de inmediato.
 */
export function esperaSiguiente(intentos: number): number {
  if (intentos <= 0) return 0
  return Math.min(2000 * 2 ** (intentos - 1), 32000)
}

/** Normaliza un mensaje de error a etiqueta comparable. */
export function normalizarMotivo(mensaje: string | null | undefined): string {
  if (!mensaje) return 'desconocido'
  const limpio = mensaje
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/, '')
  return limpio || 'desconocido'
}

/**
 * ¿Este error mejora esperando?
 *
 * Ante la duda, se REINTENTA. Equivocarse hacia "reintenta" cuesta unos
 * segundos y un mensaje repetido; equivocarse hacia "descarta" pierde el
 * registro de un lavado que sí se hizo, y eso no se recupera.
 */
export function esDefinitivo(motivo: string): boolean {
  return MOTIVOS_DEFINITIVOS.some((m) => motivo.includes(m))
}

/** Crea una entrada nueva, lista para su primer intento. */
export function nuevaPendiente(
  entrada: { tipo: TipoPendiente; datos: Record<string, string>; etiqueta?: string },
  ahora: number = Date.now(),
  id: string = generarId()
): Pendiente {
  return {
    id,
    tipo: entrada.tipo,
    creadoEn: ahora,
    datos: entrada.datos,
    estado: 'pendiente',
    intentos: 0,
    proximoIntento: ahora,
    etiqueta: entrada.etiqueta,
  }
}

function generarId(): string {
  // `crypto.randomUUID` existe en todos los navegadores que soportan el
  // escáner. El respaldo cubre contextos sin `crypto` (pruebas, WebViews muy
  // viejas) y no necesita ser criptográfico: es una clave local.
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Marca un intento fallido y decide si habrá otro. */
export function marcarFallo(
  p: Pendiente,
  mensaje: string | null | undefined,
  ahora: number = Date.now()
): Pendiente {
  const motivo = normalizarMotivo(mensaje)
  const intentos = p.intentos + 1

  if (esDefinitivo(motivo) || intentos >= MAX_INTENTOS) {
    return { ...p, estado: 'descartada', intentos, motivo, proximoIntento: ahora }
  }

  return {
    ...p,
    estado: 'pendiente',
    intentos,
    motivo,
    proximoIntento: ahora + esperaSiguiente(intentos),
  }
}

/** Marca un envío correcto. */
export function marcarEnviada(p: Pendiente, ahora: number = Date.now()): Pendiente {
  return { ...p, estado: 'enviada', motivo: undefined, proximoIntento: ahora }
}

/**
 * La siguiente entrada a enviar, o `null` si no toca ninguna.
 *
 * Devuelve UNA, no una lista, y eso es deliberado: enviar en paralelo rompería
 * el orden FIFO y, con conexión mala, multiplicaría por cinco las peticiones
 * que ya están fallando.
 */
export function siguienteAEnviar(
  cola: Pendiente[],
  ahora: number = Date.now(),
  enLinea: boolean = true
): Pendiente | null {
  if (!enLinea) return null
  // Si hay algo enviándose, se espera: una a la vez.
  if (cola.some((p) => p.estado === 'enviando')) return null

  const candidatas = ordenar(cola).filter(
    (p) => p.estado === 'pendiente' && p.proximoIntento <= ahora
  )
  return candidatas[0] ?? null
}

/** Orden FIFO por momento del escaneo. Ver la decisión 1 de la cabecera. */
export function ordenar(cola: Pendiente[]): Pendiente[] {
  return [...cola].sort((a, b) => a.creadoEn - b.creadoEn || a.id.localeCompare(b.id))
}

/** Sustituye una entrada por su versión nueva, conservando el orden. */
export function reemplazar(cola: Pendiente[], p: Pendiente): Pendiente[] {
  return cola.map((x) => (x.id === p.id ? p : x))
}

/**
 * Quita lo que ya no hace falta guardar: las enviadas hace rato.
 *
 * Las DESCARTADAS no se limpian solas nunca. Cada una representa un lavado que
 * puede no haberse registrado, y que desaparezca sola del historial es cómo se
 * pierde dinero sin que nadie se entere. Se van cuando una persona las
 * descarta a mano.
 */
export function limpiar(cola: Pendiente[], ahora: number = Date.now()): Pendiente[] {
  return cola.filter(
    (p) => !(p.estado === 'enviada' && ahora - p.proximoIntento > MS_CONSERVAR_ENVIADA)
  )
}

export interface ResumenCola {
  pendientes: number
  enviando: number
  descartadas: number
  /** Lo que el empleado tiene que ver en la insignia. */
  total: number
  /** Hay algo que exige la atención de una persona. */
  requiereAtencion: boolean
}

export function resumen(cola: Pendiente[]): ResumenCola {
  const pendientes = cola.filter((p) => p.estado === 'pendiente').length
  const enviando = cola.filter((p) => p.estado === 'enviando').length
  const descartadas = cola.filter((p) => p.estado === 'descartada').length
  return {
    pendientes,
    enviando,
    descartadas,
    total: pendientes + enviando + descartadas,
    requiereAtencion: descartadas > 0,
  }
}

/**
 * Convierte los datos guardados en el `FormData` que espera la server action.
 *
 * Existe aquí y no en el componente porque es parte del contrato de la cola:
 * lo que se guardó tiene que poder reconstruirse exactamente, o el reenvío
 * enviaría algo distinto de lo que el empleado confirmó.
 */
export function aFormData(p: Pendiente): FormData {
  const fd = new FormData()
  for (const [clave, valor] of Object.entries(p.datos)) fd.set(clave, valor)
  return fd
}

/**
 * Extrae de un FormData los campos que hay que conservar.
 *
 * Se copia TODO lo que sea texto. Los archivos se descartan: una foto de
 * evidencia no cabe en el almacenamiento local y, sobre todo, no puede
 * reconstruirse desde texto. Si algún día el escáner sube fotos sin conexión,
 * esto tiene que pasar a IndexedDB — está anotado en `almacenCola.ts`.
 */
export function desdeFormData(fd: FormData): Record<string, string> {
  const datos: Record<string, string> = {}
  fd.forEach((valor, clave) => {
    if (typeof valor === 'string') datos[clave] = valor
  })
  return datos
}
