import 'server-only'
import { getIdentidadPepper } from '@/lib/env'
import { anotarFallo } from '@/lib/prisma-errors'
import { appUrlFor } from '@/lib/site'
import { conUsuario, sinEmpresa } from '@/lib/tenant'
import {
  ErrorDeIdentidad,
  aplicarDecision,
  anotarConsultaDeIntento,
  compuertaDeIdentidad,
  crearIntento,
  estadoDeIdentidadDe,
  guardarReferenciaDeSesion,
  leerReferenciaDeSesion,
  registrarEventoDescartado,
  registrarFalloDePurga,
  registrarPurgaDeSesion,
  ubicarIntento,
  type ResultadoCrearIntento,
} from '@/modules/identidad/identidad'
import {
  calcularHashDedupe,
  esEstadoFinal,
  type CanalIntento,
  type EstadoIdentidadPublico,
  type EstadoIntento,
} from '@/modules/identidad/identidadCore'
import { avisarResultadoDeIdentidad } from '@/modules/identidad/avisos'
import { RUTA_DEL_AVISO_PARA_PROVEEDOR } from '@/modules/identidad/avisosCore'
import { ErrorDeProveedor } from '@/modules/identidad/proveedor/contrato'
import { proveedorDeIdentidad } from '@/modules/identidad/proveedor/didit'

/**
 * LA CONEXIÓN CON EL PROVEEDOR (Fase 2): crear la sesión, enterarse de lo que
 * pasó y borrar lo que el proveedor ya no necesita.
 *
 * Tres ideas mandan aquí:
 *
 *  1. «FETCH THE TRUTH». Un aviso del proveedor, el regreso de la persona por el
 *     enlace y el barrido diario NO dicen qué pasó: solo dicen «ve a mirar». Lo
 *     que se aplica es lo que el proveedor responde al preguntarle POR NUESTRA
 *     referencia de la sesión. Un aviso falsificado o repetido solo provoca una
 *     consulta inocua.
 *  2. PROCESAR Y PURGAR. Cuando el resultado ya está guardado en MEMBEGO, se borra
 *     la sesión en el proveedor (documentos, selfie, plantillas). Nunca antes: si el
 *     borrado falla, el reintento lo hace después; lo que no puede pasar es borrar
 *     sin haber guardado.
 *  3. LA VERIFICACIÓN NUNCA ES PRECONDICIÓN DE NADA. Si el proveedor se cae, esta
 *     capa responde «inténtalo en un momento» y ya; compras, renovaciones y accesos
 *     no pasan por aquí.
 */

/** Adonde vuelve la persona en la app móvil. Solo dispara una consulta de estado. */
export const RETORNO_APP_IDENTIDAD = 'membego://identidad/retorno'
/** Ruta web a la que vuelve la persona: su pantalla de verificación de identidad. */
export const RUTA_WEB_RETORNO_IDENTIDAD = '/cliente/identidad'

/**
 * Desde dónde empezó la verificación en la web, para volver al mismo sitio: la pantalla de la persona (cliente) o la del
 * portal del proveedor (quien aceptó el contrato, Fase 5). LISTA CERRADA: la ruta nunca sale de lo que escribe el usuario.
 */
export const RUTAS_WEB_DE_RETORNO = {
  cliente: RUTA_WEB_RETORNO_IDENTIDAD,
  proveedor: RUTA_DEL_AVISO_PARA_PROVEEDOR,
} as const
export type OrigenWebDeVerificacion = keyof typeof RUTAS_WEB_DE_RETORNO

export function esOrigenWebDeVerificacion(valor: unknown): valor is OrigenWebDeVerificacion {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(RUTAS_WEB_DE_RETORNO, valor)
}

/** A dónde manda el proveedor a la persona al terminar. Lleva el id y el nonce del intento, nada más. */
export function urlDeRetornoDeIdentidad(canal: CanalIntento, intentoId: string, nonce: string | null, baseWeb?: string, origen: OrigenWebDeVerificacion = 'cliente'): string {
  const consulta = new URLSearchParams({ intento: intentoId })
  if (nonce) consulta.set('nonce', nonce)
  if (canal === 'web') {
    consulta.set('identidad', 'retorno')
    return `${baseWeb ?? appUrlFor(RUTAS_WEB_DE_RETORNO[origen])}?${consulta.toString()}`
  }
  return `${RETORNO_APP_IDENTIDAD}?${consulta.toString()}`
}

/** Los estados de intento que Didit puede mover: los que todavía esperan al proveedor. */
const ESTADOS_QUE_ESPERAN_AL_PROVEEDOR: readonly EstadoIntento[] = ['creada', 'iniciada', 'enviada', 'en_proceso', 'reenvio_requerido', 'en_revision']

// ── Empezar ─────────────────────────────────────────────────────────────────

export type ResultadoIniciarSesion =
  | { ok: true; url: string; intentoId: string; nonce: string | null; estado: EstadoIntento; esRevalidacion: boolean }
  | {
      ok: false
      motivo: Extract<ResultadoCrearIntento, { ok: false }>['motivo'] | 'en_revision' | 'proveedor_no_disponible' | 'proveedor_rechazo' | 'sin_configuracion'
      esperarHasta?: Date
      /** Cuándo reintentar, en segundos (la pantalla dice «inténtalo en un momento»). */
      reintentarEnSegundos?: number
    }

/**
 * Empieza (o retoma) la verificación de una persona y devuelve la dirección a la
 * que hay que mandarla. NADA de lo que devuelve se registra: la dirección lleva
 * un token de la sesión.
 *
 * Las reglas de si puede o no (consentimientos, espera tras un rechazo, tope, ya
 * verificada, compuerta) son las de `crearIntento`. Aquí se añade la sesión con el
 * proveedor, que es idempotente por intento: volver a pedirla devuelve la misma.
 * Si el proveedor falla, el intento queda `creada` y la persona puede reintentar
 * (el barrido lo abandona a las 24 h si nadie vuelve).
 */
export async function iniciarSesionDeVerificacion(
  userId: string,
  input: { canal: CanalIntento; ip?: string | null; userAgent?: string | null; origen?: OrigenWebDeVerificacion },
  ahora: Date = new Date()
): Promise<ResultadoIniciarSesion> {
  const creado = await crearIntento(userId, { canal: input.canal, ip: input.ip, userAgent: input.userAgent }, ahora)
  if (!creado.ok) return { ok: false, motivo: creado.motivo, esperarHasta: creado.esperarHasta }
  const intento = creado.intento
  // Un intento en revisión ya tiene su sesión resuelta: abrir otra sería cobrar de nuevo por lo mismo.
  if (intento.estado === 'en_revision') return { ok: false, motivo: 'en_revision' }

  let proveedor
  try {
    proveedor = proveedorDeIdentidad()
  } catch (e) {
    if (e instanceof ErrorDeProveedor && e.codigo === 'no_configurado') return { ok: false, motivo: 'sin_configuracion' }
    throw e
  }

  let sesion
  try {
    sesion = await proveedor.crearSesion({
      intentoId: intento.id,
      callbackUrl: urlDeRetornoDeIdentidad(input.canal, intento.id, intento.nonce, undefined, input.origen ?? 'cliente'),
      idioma: 'es',
    })
  } catch (e) {
    if (!(e instanceof ErrorDeProveedor)) throw e
    anotarFallo('identidad:crear-sesion', { codigo: e.codigo, http: e.estadoHttp })(e)
    return e.reintentable
      ? { ok: false, motivo: 'proveedor_no_disponible', reintentarEnSegundos: 30 }
      : { ok: false, motivo: 'proveedor_rechazo' }
  }

  // La referencia se guarda SELLADA. Si esto falla, el proveedor ya tiene una sesión sin dueño en
  // nuestra base: la próxima petición de la persona recibe la MISMA sesión (idempotente) y la guarda.
  await guardarReferenciaDeSesion(intento.id, sesion.sesionId)
  const avance = await aplicarDecision(intento.id, { resultado: 'iniciada' }, {}, ahora)
  const estado: EstadoIntento = avance.aplicado === 'no_existe' ? intento.estado : avance.estado
  return { ok: true, url: sesion.url, intentoId: intento.id, nonce: intento.nonce, estado, esRevalidacion: creado.esRevalidacion }
}

// ── Enterarse de lo que pasó ────────────────────────────────────────────────

export type ResultadoSincronizacion =
  | { resultado: 'sincronizado'; estado: EstadoIntento; purga: ResultadoPurga | null }
  | { resultado: 'no_existe' | 'sin_sesion' | 'descartado' }

/**
 * Le pregunta al proveedor qué pasó con el intento y aplica la respuesta.
 * LANZA `ErrorDeProveedor` si el proveedor falla: quien llama decide si reintenta.
 *
 *  · un intento ya cerrado no se vuelve a consultar (solo se completa un borrado pendiente);
 *  · la respuesta debe llevar NUESTRA referencia (`vendor_data` = id del intento): si no
 *    coincide, se descarta con asiento y no se aplica nada;
 *  · una aprobación calcula el hash del documento con el pepper y DESCARTA el número;
 *  · si el intento quedó cerrado (y no está en revisión), se borra la sesión del proveedor.
 */
export async function sincronizarIntento(intentoId: string, ahora: Date = new Date()): Promise<ResultadoSincronizacion> {
  const intento = await ubicarIntento(intentoId)
  if (!intento) return { resultado: 'no_existe' }
  if (!intento.tieneSesion) return { resultado: 'sin_sesion' }

  if (esEstadoFinal(intento.estado)) {
    const purga = await purgarSesionDeIntento(intentoId, ahora)
    return { resultado: 'sincronizado', estado: intento.estado, purga }
  }

  const sesionId = await leerReferenciaDeSesion(intentoId)
  if (!sesionId) return { resultado: 'sin_sesion' }

  const proveedor = proveedorDeIdentidad()
  const respuesta = await proveedor.consultarDecision(sesionId)
  await anotarConsultaDeIntento(intentoId, ahora)

  if (respuesta.referenciaDelCliente !== intentoId) {
    await registrarEventoDescartado(intento.userId, intentoId, 'referencia_no_coincide')
    return { resultado: 'descartado' }
  }

  let hashDedupe: string | null = null
  if (respuesta.decision.resultado === 'aprobada' && respuesta.documento) {
    const pepper = getIdentidadPepper()
    // Sin pepper no se aprueba en silencio sin poder detectar documentos repetidos: se reintenta cuando haya.
    if (!pepper) throw new ErrorDeIdentidad('falta_configuracion', 'Falta IDENTIDAD_PEPPER_DEDUPE.')
    hashDedupe = calcularHashDedupe(pepper, respuesta.documento)
  }

  const aplicada = await aplicarDecision(
    intentoId,
    respuesta.decision,
    { nivel: respuesta.nivel, via: 'proveedor_documento_selfie', proveedor: proveedor.nombre, hashDedupe },
    ahora
  )
  if (aplicada.aplicado === 'no_existe') return { resultado: 'no_existe' }
  // Se le avisa a la persona SOLO la primera vez que el resultado se aplica (el aviso, además, es único por intento y resultado).
  if (aplicada.aplicado === 'aplicar') await avisarResultadoDeIdentidad(intentoId)

  // En revisión (por el proveedor o por documento repetido) la sesión se conserva: lo mira una persona.
  const cerrado = esEstadoFinal(aplicada.estado)
  const purga = cerrado ? await purgarSesionDeIntento(intentoId, ahora) : null
  return { resultado: 'sincronizado', estado: aplicada.estado, purga }
}

// ── Procesar y purgar ───────────────────────────────────────────────────────

export type ResultadoPurga = 'purgada' | 'ya_purgada' | 'pendiente' | 'sin_sesion'

/**
 * Borra la sesión del intento en el proveedor y lo anota. Idempotente. Si el
 * proveedor falla NO lanza: cuenta el fallo y devuelve `pendiente`, y el barrido
 * lo reintenta. Solo se llama con el resultado ya guardado en MEMBEGO.
 */
export async function purgarSesionDeIntento(intentoId: string, ahora: Date = new Date()): Promise<ResultadoPurga> {
  const intento = await ubicarIntento(intentoId)
  if (!intento?.tieneSesion) return 'sin_sesion'
  if (intento.purgadoAt) return 'ya_purgada'
  const sesionId = await leerReferenciaDeSesion(intentoId)
  if (!sesionId) return 'sin_sesion'
  try {
    await proveedorDeIdentidad().borrarSesion(sesionId, { motivo: 'operacional', instruccionId: intentoId })
  } catch (e) {
    if (!(e instanceof ErrorDeProveedor)) throw e
    anotarFallo('identidad:purgar-sesion', { codigo: e.codigo, http: e.estadoHttp })(e)
    await registrarFalloDePurga(intentoId)
    return 'pendiente'
  }
  await registrarPurgaDeSesion(intentoId, ahora)
  return 'purgada'
}

// ── El estado que ve la persona, con red de seguridad ───────────────────────

/** No se vuelve a preguntar al proveedor por un intento más seguido que esto. */
const ENFRIAMIENTO_CONSULTA_MS = 15_000

/**
 * El estado de la persona, preguntándole antes al proveedor si el intento abierto
 * lleva un rato sin novedad. Es la red de seguridad de los avisos: si el webhook se
 * perdió (el proveedor solo reintenta dos veces), la pantalla que sondea el estado
 * lo resuelve sin esperar al barrido. Un fallo del proveedor nunca rompe la lectura.
 */
export async function consultarEstadoConReconciliacion(userId: string, ahora: Date = new Date()): Promise<EstadoIdentidadPublico> {
  const abierto = await conUsuario(userId, (tx) =>
    tx.identidadIntento.findFirst({
      where: { userId, estado: { in: ['iniciada', 'enviada', 'en_proceso', 'reenvio_requerido', 'en_revision'] }, referenciaProveedorSellada: { not: null } },
      orderBy: { creadoAt: 'desc' },
      select: { id: true, codigoRazon: true, estado: true, ultimaConsultaAt: true },
    })
  )
  // Un documento repetido espera a una persona, no al proveedor: preguntarle no cambiaría nada.
  const esperaAlProveedor = abierto && !(abierto.estado === 'en_revision' && abierto.codigoRazon === 'IDENTIDAD_DUPLICADA')
  if (esperaAlProveedor && (!abierto.ultimaConsultaAt || ahora.getTime() - abierto.ultimaConsultaAt.getTime() >= ENFRIAMIENTO_CONSULTA_MS)) {
    try {
      if ((await compuertaDeIdentidad()).faltantes.length === 0) await sincronizarIntento(abierto.id, ahora)
    } catch (e) {
      anotarFallo('identidad:reconciliar-al-consultar', { intento: abierto.id })(e)
    }
  }
  return estadoDeIdentidadDe(userId, ahora)
}

// ── Barridos ────────────────────────────────────────────────────────────────

export interface ResumenReconciliacion {
  consultados: number
  cerrados: number
  purgasReintentadas: number
  purgasPendientes: number
  fallosDelProveedor: number
}

/**
 * El barrido de reconciliación: pregunta por los intentos que llevan rato esperando
 * al proveedor sin novedad (el aviso se perdió o nunca llegó) y reintenta los
 * borrados pendientes. Corre dentro del cron diario de identidad con un presupuesto
 * de tiempo; lo que no alcance queda para la siguiente pasada.
 */
export async function reconciliarConElProveedor(opciones: { ahora?: Date; limite?: number; presupuestoMs?: number } = {}): Promise<ResumenReconciliacion> {
  const ahora = opciones.ahora ?? new Date()
  const limite = opciones.limite ?? 50
  const termina = Date.now() + (opciones.presupuestoMs ?? 45_000)
  const resumen: ResumenReconciliacion = { consultados: 0, cerrados: 0, purgasReintentadas: 0, purgasPendientes: 0, fallosDelProveedor: 0 }
  if ((await compuertaDeIdentidad()).faltantes.length > 0) return resumen // sin proveedor configurado no hay con quién hablar

  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000)
  const { esperando, sinBorrar } = await sinEmpresa('identidad: la reconciliación recorre los intentos de todas las personas', async (tx) => ({
    esperando: await tx.identidadIntento.findMany({
      where: {
        estado: { in: ESTADOS_QUE_ESPERAN_AL_PROVEEDOR as EstadoIntento[] },
        referenciaProveedorSellada: { not: null },
        // Un documento repetido espera a una persona, no al proveedor.
        NOT: { estado: 'en_revision', codigoRazon: 'IDENTIDAD_DUPLICADA' },
        creadoAt: { lt: hace(5) },
        OR: [{ ultimaConsultaAt: null }, { ultimaConsultaAt: { lt: hace(10) } }],
      },
      select: { id: true },
      orderBy: { creadoAt: 'asc' },
      take: limite,
    }),
    sinBorrar: await tx.identidadIntento.findMany({
      where: {
        estado: { in: ['aprobada', 'rechazada_reintentable', 'rechazada_definitiva', 'expirada', 'abandonada', 'cancelada'] },
        referenciaProveedorSellada: { not: null },
        purgadoAt: null,
        purgaIntentos: { lt: 20 },
      },
      select: { id: true },
      orderBy: { resueltoAt: 'asc' },
      take: limite,
    }),
  }))

  for (const { id } of esperando) {
    if (Date.now() > termina) break
    resumen.consultados++
    try {
      const r = await sincronizarIntento(id, ahora)
      if (r.resultado === 'sincronizado' && esEstadoFinal(r.estado)) resumen.cerrados++
    } catch (e) {
      resumen.fallosDelProveedor++
      anotarFallo('identidad:reconciliar', { intento: id })(e)
    }
  }
  for (const { id } of sinBorrar) {
    if (Date.now() > termina) break
    resumen.purgasReintentadas++
    const r = await purgarSesionDeIntento(id, ahora)
    if (r === 'pendiente') resumen.purgasPendientes++
  }
  return resumen
}
