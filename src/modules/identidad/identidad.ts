import 'server-only'
import { randomBytes } from 'node:crypto'
import type { AuditAccion } from '@prisma/client'
import { conUsuario, sinEmpresa, type Tx } from '@/lib/tenant'
import { anotarFallo, esViolacionUnica } from '@/lib/prisma-errors'
import { faltantesIdentidad, getIdentidadClavesMaestras } from '@/lib/env'
import { abrir, parsearClavesMaestras, sellar, versionActual } from '@/modules/connect/cifrado'
import { ipParaRegistro, userAgentParaRegistro } from '@/modules/pagos/consentimientosCore'
import {
  POLITICA_IDENTIDAD,
  calcularExpiracion,
  debeAvisarRevalidacion,
  diasParaExpirar,
  esCodigoRazon,
  esEstadoAbierto,
  estadoEfectivo,
  evaluarNuevoIntento,
  evaluarTransicion,
  mensajeParaUsuario,
  motivoEsVisible,
  puedeTransicionarVerificacion,
  resolverDecision,
  type CanalIntento,
  type DecisionNeutral,
  type DisparadorRevalidacion,
  type EstadoIdentidadPublico,
  type EstadoIntento,
  type EstadoVerificacion,
  type EvaluacionNuevoIntento,
  type NivelIdentidad,
  type OrigenIntento,
  type RechazoPrevio,
  type ViaVerificacion,
} from '@/modules/identidad/identidadCore'
import {
  TIPOS_REQUERIDOS_PARA_CAPTURAR,
  VERSION_VIGENTE,
  type CanalConsentimientoIdentidad,
  type TipoConsentimientoIdentidad,
} from '@/modules/identidad/identidadConsentimientosCore'

/**
 * LA VERIFICACIÓN DE IDENTIDAD, con base de datos (Fase 1 · backend y modelos).
 *
 * Fuente de verdad del diseño: docs/identidad/AUDITORIA-VERIFICACION-IDENTIDAD.md.
 * La lógica pura (estados, transiciones, reglas, mensajes) está en
 * `identidadCore.ts` y se prueba sin base; aquí solo está lo que necesita Postgres.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN PUEDE LLAMAR A QUÉ (el control de permisos de esta capa)
 *
 *  · LA PERSONA (sesión autenticada; la puerta de la Fase 2 comprueba que sea
 *    ella): `estadoDeIdentidadDe`, `otorgar/revocarConsentimientoIdentidad`,
 *    `crearIntento`. Todo lo suyo se lee y escribe con `conUsuario(userId)`.
 *  · EL WORKER (webhook ya autenticado + re-consulta al proveedor, Fase 2):
 *    `aplicarDecision`, `guardarReferenciaDeSesion`, `ejecutarMantenimientoDeIdentidad`.
 *    ES EL ÚNICO ESCRITOR de `estado` en intentos y verificaciones.
 *  · EL EQUIPO DE MEMBEGO (rol SUPERADMIN, y cada acción deja asiento):
 *    `consultarIdentidadComoStaff`, `revocarVerificacion`, `solicitarRevalidacion`,
 *    `cambiarInterruptorDeIdentidad`.
 *  · NADIE MÁS. Una EMPRESA no llama a nada de aquí: ve solo la proyección binaria
 *    que esta capa escribe en `clientes` (`proyectarEnFichas`) y solo si la persona
 *    consintió. NO EXISTE función que marque a alguien como verificado a petición
 *    suya, y `tests/identidad-guardas.test.ts` impide que aparezca.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NUNCA ENTRA AQUÍ
 *  · imágenes, vídeo, plantillas biométricas, número de cédula en claro, nombre
 *    legal extraído, tokens de sesión del proveedor, cuerpos de webhook;
 *  · nada de eso va a la bitácora (`payloadSeguro` descarta cualquier clave que
 *    no esté en su lista) ni a los logs.
 */

// ── Compuerta: entorno + interruptor ────────────────────────────────────────

export const CLAVE_INTERRUPTOR_IDENTIDAD = 'VERIFICACION_IDENTIDAD'

/** Quienes del equipo de Membego pueden gestionar identidades. Hoy solo el superadmin. */
export const ROLES_GESTION_IDENTIDAD: readonly string[] = ['SUPERADMIN']

export interface ActorDeIdentidad {
  userId: string
  rol: string
}

function exigirGestion(actor: ActorDeIdentidad): void {
  if (!actor?.userId || !ROLES_GESTION_IDENTIDAD.includes(actor.rol)) {
    throw new ErrorDeIdentidad('no_autorizado', 'Solo el equipo autorizado de Membego puede hacer esto.')
  }
}

export class ErrorDeIdentidad extends Error {
  constructor(
    readonly codigo:
      | 'no_autorizado'
      | 'sin_clave'
      | 'persona_no_encontrada'
      | 'motivo_requerido'
      | 'falta_configuracion'
      | 'no_existe'
      | 'proveedor_no_disponible',
    mensaje: string
  ) {
    super(mensaje)
    this.name = 'ErrorDeIdentidad'
  }
}

export interface CompuertaDeIdentidad {
  /** ¿Se puede verificar ahora? Hacen falta las dos cosas: entorno completo e interruptor encendido. */
  habilitada: boolean
  /** Variables de entorno que faltan (vacío si está completo). */
  faltantes: string[]
  interruptorEncendido: boolean
}

/**
 * Para que la verificación funcione hacen falta las dos cosas a favor: el
 * entorno completo (`faltantesIdentidad`) y el interruptor encendido en la base.
 * Para apagarla basta una. Sin la fila del interruptor = apagado.
 */
export async function compuertaDeIdentidad(): Promise<CompuertaDeIdentidad> {
  const faltantes = faltantesIdentidad()
  const fila = await sinEmpresa('identidad: leer el interruptor de la plataforma', (tx) =>
    tx.identidadInterruptor.findUnique({ where: { clave: CLAVE_INTERRUPTOR_IDENTIDAD } })
  )
  const interruptorEncendido = fila?.enabled === true
  return { habilitada: faltantes.length === 0 && interruptorEncendido, faltantes, interruptorEncendido }
}

/**
 * Enciende o apaga la verificación. Solo el equipo autorizado; apagar exige
 * motivo (un interruptor sin motivo es una avería que nadie sabe explicar tres
 * semanas después) y encender exige también el entorno completo.
 */
export async function cambiarInterruptorDeIdentidad(
  actor: ActorDeIdentidad,
  input: { encendido: boolean; motivo: string }
): Promise<CompuertaDeIdentidad> {
  exigirGestion(actor)
  const motivo = input.motivo?.trim()
  if (!motivo) throw new ErrorDeIdentidad('motivo_requerido', 'Indica el motivo del cambio.')
  if (input.encendido) {
    const faltan = faltantesIdentidad()
    if (faltan.length > 0) {
      throw new ErrorDeIdentidad('falta_configuracion', `Falta configurar: ${faltan.join(', ')}.`)
    }
  }
  await sinEmpresa('identidad: el equipo cambia el interruptor de la plataforma', async (tx) => {
    await tx.identidadInterruptor.upsert({
      where: { clave: CLAVE_INTERRUPTOR_IDENTIDAD },
      create: { clave: CLAVE_INTERRUPTOR_IDENTIDAD, enabled: input.encendido, reason: motivo.slice(0, 300), changedById: actor.userId },
      update: { enabled: input.encendido, reason: motivo.slice(0, 300), changedById: actor.userId, changedAt: new Date() },
    })
    await auditar(tx, 'IDENTIDAD_INTERRUPTOR_CAMBIADO', {
      actorUserId: actor.userId,
      entidadId: CLAVE_INTERRUPTOR_IDENTIDAD,
      payload: { encendido: input.encendido, motivo, rol: actor.rol },
    })
  })
  return compuertaDeIdentidad()
}

// ── Referencias selladas ────────────────────────────────────────────────────

/**
 * El AAD ata el sello a SU persona: copiar un sello de una fila a otra produce
 * uno que no abre. Mismo criterio que las credenciales de Connect.
 */
const aadDe = (userId: string) => `identidad:${userId}`

function clavesDeIdentidad() {
  const valor = getIdentidadClavesMaestras()
  if (!valor) {
    throw new ErrorDeIdentidad('sin_clave', 'Falta IDENTIDAD_CLAVES_MAESTRAS: la verificación falla cerrada.')
  }
  return parsearClavesMaestras(valor)
}

/** Sella la referencia del proveedor (el id de su sesión). Lanza `sin_clave` si falta la llave. */
export function sellarReferencia(userId: string, referencia: string): { sellado: string; claveVersion: number } {
  const km = clavesDeIdentidad()
  return { sellado: sellar(km, referencia, aadDe(userId)), claveVersion: versionActual(km) }
}

/** Abre una referencia sellada. SOLO para llamadas del servidor al proveedor: jamás se devuelve a un cliente. */
export function abrirReferencia(userId: string, sellado: string): string | null {
  const r = abrir(clavesDeIdentidad(), sellado, aadDe(userId))
  return r.ok ? r.datos : null
}

// ── Auditoría ───────────────────────────────────────────────────────────────

/**
 * Las ÚNICAS claves que pueden ir al payload de la bitácora. Son códigos, ids y
 * banderas: nunca nombre, documento, imagen ni texto del proveedor. Cualquier
 * otra clave se descarta en silencio, así que ni un descuido puede filtrar PII.
 */
const CLAVES_AUDITABLES = new Set([
  'intentoId',
  'verificacionId',
  'estadoAnterior',
  'estadoNuevo',
  'nivel',
  'via',
  'proveedor',
  'canal',
  'origen',
  'tipoRechazo',
  'codigoRazon',
  'disparador',
  'motivo',
  'rol',
  'encendido',
  'esRevalidacion',
  'cantidad',
  'resultado',
])

export function payloadSeguro(payload: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const salida: Record<string, string | number | boolean | null> = {}
  for (const [clave, valor] of Object.entries(payload)) {
    if (!CLAVES_AUDITABLES.has(clave)) continue
    if (valor === null || typeof valor === 'boolean' || typeof valor === 'number') salida[clave] = valor
    else if (typeof valor === 'string') salida[clave] = valor.slice(0, 200)
  }
  return salida
}

async function auditar(
  tx: Tx,
  accion: AuditAccion,
  datos: {
    /** Quien lo hizo; null si fue el sistema (el worker). */
    actorUserId?: string | null
    /** La persona a la que se refiere (o la clave del interruptor). */
    entidadId: string
    payload: Record<string, unknown>
    ip?: string | null
    userAgent?: string | null
  }
): Promise<void> {
  await tx.auditLog.create({
    data: {
      // La identidad es de la PERSONA: la bitácora no cuelga de ninguna empresa.
      companyId: null,
      userId: datos.actorUserId ?? null,
      accion,
      entidadTipo: 'IdentidadVerificacion',
      entidadId: datos.entidadId,
      payload: payloadSeguro(datos.payload),
      ipAddress: ipParaRegistro(datos.ip ?? null),
      userAgent: userAgentParaRegistro(datos.userAgent ?? null),
    },
  })
}

/** Un candado de la base, por persona, que vive lo que dura la transacción. */
async function bloquearPersona(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`identidad:${userId}`}, 0))`
}

// ── Consentimientos ─────────────────────────────────────────────────────────

export type ResultadoConsentimiento =
  | { ok: true; id: string; creado: boolean }
  | { ok: false; error: 'texto_cambio' | 'persona_no_encontrada' }

/**
 * Registra que la persona aceptó un texto. IDEMPOTENTE: aceptar dos veces la
 * misma versión no duplica ni reescribe la fecha. Si lo que se acepta es una
 * versión NUEVA, la anterior queda retirada y se registra otra: el historial
 * dice qué texto aceptó en cada momento.
 *
 * `textoVersionVista` es la versión que la persona VIO. Si no es la vigente (el
 * texto cambió entre que cargó la pantalla y que aceptó), no se registra: aceptar
 * un texto y anotar otro es lo que este registro existe para impedir.
 */
export async function otorgarConsentimientoIdentidad(
  userId: string,
  tipo: TipoConsentimientoIdentidad,
  input: { textoVersionVista: string; canal: CanalConsentimientoIdentidad; ip?: string | null; userAgent?: string | null }
): Promise<ResultadoConsentimiento> {
  if (input.textoVersionVista !== VERSION_VIGENTE[tipo]) return { ok: false, error: 'texto_cambio' }

  const resultado = await conUsuario(userId, async (tx): Promise<ResultadoConsentimiento> => {
    await bloquearPersona(tx, userId)
    const existe = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!existe) return { ok: false, error: 'persona_no_encontrada' }

    const vigente = await tx.identidadConsentimiento.findFirst({
      where: { userId, tipo, revocadoAt: null },
      select: { id: true, textoVersion: true },
    })
    if (vigente?.textoVersion === VERSION_VIGENTE[tipo]) return { ok: true, id: vigente.id, creado: false }
    if (vigente) {
      await tx.identidadConsentimiento.update({ where: { id: vigente.id }, data: { revocadoAt: new Date() } })
    }
    const fila = await tx.identidadConsentimiento.create({
      data: {
        userId,
        tipo,
        textoVersion: VERSION_VIGENTE[tipo],
        canal: input.canal,
        ipAddress: ipParaRegistro(input.ip ?? null),
        userAgent: userAgentParaRegistro(input.userAgent ?? null),
      },
      select: { id: true },
    })
    return { ok: true, id: fila.id, creado: true }
  })

  if (resultado.ok && tipo === 'IDENTIDAD_DIVULGACION_EMPRESAS') await proyectarEnFichas(userId)
  return resultado
}

/**
 * Retira un consentimiento. La fila no se borra: queda con su fecha de retiro.
 *
 *  · Retirar BIOMETRÍA o TRANSFERENCIA cancela el intento abierto (no se puede
 *    seguir capturando) y cierra la puerta a nuevos intentos. El resultado ya
 *    registrado NO se borra por esto: borrarlo es el derecho de supresión, que
 *    es otro flujo con su propio asiento.
 *  · Retirar DIVULGACIÓN borra la proyección en las fichas: las empresas dejan
 *    de ver el resultado.
 */
export async function revocarConsentimientoIdentidad(
  userId: string,
  tipo: TipoConsentimientoIdentidad
): Promise<{ revocados: number; intentosCancelados: number }> {
  const r = await conUsuario(userId, async (tx) => {
    await bloquearPersona(tx, userId)
    const rev = await tx.identidadConsentimiento.updateMany({
      where: { userId, tipo, revocadoAt: null },
      data: { revocadoAt: new Date() },
    })
    let cancelados = 0
    if (rev.count > 0 && TIPOS_REQUERIDOS_PARA_CAPTURAR.includes(tipo)) {
      const c = await tx.identidadIntento.updateMany({
        where: { userId, estado: { in: ['creada', 'iniciada', 'reenvio_requerido'] } },
        data: { estado: 'cancelada', resueltoAt: new Date() },
      })
      cancelados = c.count
    }
    return { revocados: rev.count, intentosCancelados: cancelados }
  })
  if (r.revocados > 0 && tipo === 'IDENTIDAD_DIVULGACION_EMPRESAS') await proyectarEnFichas(userId)
  return r
}

async function tiposVigentes(tx: Tx, userId: string): Promise<Map<TipoConsentimientoIdentidad, string>> {
  const filas = await tx.identidadConsentimiento.findMany({
    where: { userId, revocadoAt: null },
    select: { id: true, tipo: true },
  })
  const mapa = new Map<TipoConsentimientoIdentidad, string>()
  for (const f of filas) mapa.set(f.tipo as TipoConsentimientoIdentidad, f.id)
  return mapa
}

// ── Contexto para decidir ───────────────────────────────────────────────────

/**
 * Los rechazos que cuentan para decidir si se puede reintentar: solo los
 * POSTERIORES a la última aprobación. Un rechazo definitivo de hace años no
 * puede bloquear para siempre a quien ya fue verificado después (por revisión de
 * una persona) y cuya verificación expiró.
 */
async function rechazosRelevantes(tx: Tx, userId: string): Promise<RechazoPrevio[]> {
  const ultimaAprobacion = await tx.identidadIntento.findFirst({
    where: { userId, estado: 'aprobada', resueltoAt: { not: null } },
    orderBy: { resueltoAt: 'desc' },
    select: { resueltoAt: true },
  })
  const filas = await tx.identidadIntento.findMany({
    where: {
      userId,
      estado: { in: ['rechazada_reintentable', 'rechazada_definitiva'] },
      resueltoAt: ultimaAprobacion?.resueltoAt ? { gt: ultimaAprobacion.resueltoAt } : { not: null },
    },
    orderBy: { resueltoAt: 'desc' },
    take: 20,
    select: { resueltoAt: true, tipoRechazo: true },
  })
  return filas.flatMap((f) => (f.resueltoAt ? [{ resueltoAt: f.resueltoAt, tipoRechazo: f.tipoRechazo }] : []))
}

interface FotoDeLaPersona {
  verificacion: { id: string; estado: string; nivel: string | null; verificadaEn: Date | null; expiraEn: Date | null } | null
  intentoAbierto: { id: string; estado: string; canal: string; nonce: string | null; creadoAt: Date; venceAt: Date | null } | null
  rechazos: RechazoPrevio[]
  consentimientos: Map<TipoConsentimientoIdentidad, string>
}

async function fotoDeLaPersona(tx: Tx, userId: string): Promise<FotoDeLaPersona> {
  const verificacion = await tx.identidadVerificacion.findUnique({
    where: { userId },
    select: { id: true, estado: true, nivel: true, verificadaEn: true, expiraEn: true },
  })
  const intentoAbierto = await tx.identidadIntento.findFirst({
    where: { userId, estado: { in: ['creada', 'iniciada', 'enviada', 'en_proceso', 'reenvio_requerido', 'en_revision'] } },
    orderBy: { creadoAt: 'desc' },
    select: { id: true, estado: true, canal: true, nonce: true, creadoAt: true, venceAt: true },
  })
  return {
    verificacion,
    intentoAbierto,
    rechazos: await rechazosRelevantes(tx, userId),
    consentimientos: await tiposVigentes(tx, userId),
  }
}

const tieneTodos = (m: Map<TipoConsentimientoIdentidad, string>) => TIPOS_REQUERIDOS_PARA_CAPTURAR.every((t) => m.has(t))

// ── El estado que ve la persona ─────────────────────────────────────────────

/**
 * El estado de identidad de una persona, en la forma que se le puede enseñar:
 * nunca la referencia del proveedor, el hash ni el código de un rechazo cuyo
 * motivo no se explica. Incluye si puede empezar una verificación y por qué no.
 */
export async function estadoDeIdentidadDe(userId: string, ahora: Date = new Date()): Promise<EstadoIdentidadPublico> {
  return conUsuario(userId, async (tx) => {
    const f = await fotoDeLaPersona(tx, userId)
    const efectivo = estadoEfectivo(f.verificacion, ahora)
    const evaluacion = evaluarNuevoIntento(
      { verificacion: f.verificacion, hayIntentoAbierto: f.intentoAbierto !== null, tieneConsentimientos: tieneTodos(f.consentimientos), rechazos: f.rechazos },
      ahora
    )
    const ultimo = await tx.identidadIntento.findFirst({
      where: { userId, estado: { in: ['rechazada_reintentable', 'rechazada_definitiva'] } },
      orderBy: { resueltoAt: 'desc' },
      select: { tipoRechazo: true, codigoRazon: true, resueltoAt: true },
    })
    // Un rechazo anterior a la verificación vigente ya no es noticia.
    const rechazoVigente =
      ultimo && !(efectivo === 'verificada' && f.verificacion?.verificadaEn && ultimo.resueltoAt && ultimo.resueltoAt <= f.verificacion.verificadaEn)
        ? ultimo
        : null
    const verificada = efectivo === 'verificada'
    return {
      estado: efectivo,
      nivel: verificada ? ((f.verificacion?.nivel as NivelIdentidad | null) ?? null) : null,
      verificadaEn: verificada ? (f.verificacion?.verificadaEn ?? null) : null,
      expiraEn: f.verificacion?.expiraEn ?? null,
      diasParaExpirar: verificada ? diasParaExpirar(f.verificacion?.expiraEn ?? null, ahora) : null,
      revalidacionProxima: f.verificacion ? debeAvisarRevalidacion(f.verificacion, ahora) : false,
      intentoAbierto: f.intentoAbierto ? { id: f.intentoAbierto.id, estado: f.intentoAbierto.estado as EstadoIntento } : null,
      ultimoRechazo: rechazoVigente
        ? {
            reintentable: rechazoVigente.tipoRechazo !== 'definitivo',
            codigo: motivoEsVisible(rechazoVigente.codigoRazon) && esCodigoRazon(rechazoVigente.codigoRazon) ? rechazoVigente.codigoRazon : null,
            mensaje: mensajeParaUsuario(rechazoVigente.codigoRazon),
          }
        : null,
      puedeIniciar: evaluacion.permitido,
      motivoNoPuedeIniciar: evaluacion.permitido ? null : evaluacion.motivo,
      esperarHasta: !evaluacion.permitido && evaluacion.motivo === 'espera' ? (evaluacion.esperarHasta ?? null) : null,
    }
  })
}

// ── Crear un intento ────────────────────────────────────────────────────────

export interface IntentoCreado {
  id: string
  estado: EstadoIntento
  canal: string
  /** Ata el retorno por deep link a ESTE intento. */
  nonce: string | null
  creadoAt: Date
  venceAt: Date | null
}

export type ResultadoCrearIntento =
  | { ok: true; intento: IntentoCreado; /** Había uno abierto y se reutiliza. */ reutilizado: boolean; esRevalidacion: boolean }
  | {
      ok: false
      motivo:
        | Extract<EvaluacionNuevoIntento, { permitido: false }>['motivo']
        | 'persona_no_encontrada'
        | 'no_habilitada'
      esperarHasta?: Date
    }

/**
 * Empieza una verificación. Las reglas están en `evaluarNuevoIntento` (cuenta ya
 * verificada, consentimientos, espera tras un rechazo, tope de rechazos, bloqueo
 * por un rechazo definitivo). Aquí se añade lo que necesita la base:
 *
 *  · UN SOLO intento abierto por persona: un candado por persona serializa las
 *    peticiones simultáneas y el índice único parcial es la segunda barrera. Dos
 *    pestañas, dos dispositivos o un doble clic reciben el MISMO intento.
 *  · la compuerta (entorno + interruptor): apagada, no se empieza nada.
 *  · el consentimiento de biometría vigente queda anotado en el intento: la
 *    prueba de que se aceptó ANTES de capturar.
 *
 * NO habla con el proveedor: la sesión la crea la Fase 2 sobre este intento.
 */
export async function crearIntento(
  userId: string,
  input: {
    canal: CanalIntento
    origen?: OrigenIntento
    actorUserId?: string | null
    /** Solo el equipo: reabre a quien quedó bloqueado por rechazos. */
    desbloqueoPorStaff?: boolean
    ip?: string | null
    userAgent?: string | null
  },
  ahora: Date = new Date()
): Promise<ResultadoCrearIntento> {
  if (!(await compuertaDeIdentidad()).habilitada) return { ok: false, motivo: 'no_habilitada' }
  // El índice único parcial es la segunda barrera: si dos peticiones llegaran a pasar el candado,
  // la perdedora repite UNA vez y encuentra el intento de la ganadora.
  for (let vuelta = 1; ; vuelta++) {
    try {
      return await crearIntentoUnaVez(userId, input, ahora)
    } catch (e) {
      if (vuelta >= 2 || !esViolacionUnica(e)) throw e
    }
  }
}

async function crearIntentoUnaVez(
  userId: string,
  input: Parameters<typeof crearIntento>[1],
  ahora: Date
): Promise<ResultadoCrearIntento> {
  return conUsuario(userId, async (tx): Promise<ResultadoCrearIntento> => {
    await bloquearPersona(tx, userId)
    const persona = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!persona) return { ok: false, motivo: 'persona_no_encontrada' }

    const f = await fotoDeLaPersona(tx, userId)
    const evaluacion = evaluarNuevoIntento(
      {
        verificacion: f.verificacion,
        hayIntentoAbierto: f.intentoAbierto !== null,
        tieneConsentimientos: tieneTodos(f.consentimientos),
        rechazos: f.rechazos,
        desbloqueoPorStaff: input.desbloqueoPorStaff,
      },
      ahora
    )
    if (!evaluacion.permitido) {
      // Con un intento abierto se devuelve ESE (la persona vuelve a la pantalla y lo retoma).
      if (evaluacion.motivo === 'intento_abierto' && f.intentoAbierto) {
        const a = f.intentoAbierto
        return {
          ok: true,
          reutilizado: true,
          esRevalidacion: false,
          intento: { id: a.id, estado: a.estado as EstadoIntento, canal: a.canal, nonce: a.nonce, creadoAt: a.creadoAt, venceAt: a.venceAt },
        }
      }
      return { ok: false, motivo: evaluacion.motivo, esperarHasta: evaluacion.motivo === 'espera' ? evaluacion.esperarHasta : undefined }
    }

    const creado = await tx.identidadIntento.create({
      data: {
        userId,
        verificacionId: f.verificacion?.id ?? null,
        estado: 'creada',
        canal: input.canal,
        origen: input.origen ?? 'cliente',
        actorUserId: input.actorUserId ?? null,
        nonce: randomBytes(16).toString('hex'),
        consentimientoBiometriaId: f.consentimientos.get('IDENTIDAD_BIOMETRIA') ?? null,
        venceAt: new Date(ahora.getTime() + POLITICA_IDENTIDAD.vigenciaIntentoMs),
      },
      select: { id: true, estado: true, canal: true, nonce: true, creadoAt: true, venceAt: true },
    })
    await auditar(tx, 'IDENTIDAD_VERIFICACION_INICIADA', {
      actorUserId: input.actorUserId ?? userId,
      entidadId: userId,
      payload: { intentoId: creado.id, canal: input.canal, origen: input.origen ?? 'cliente', esRevalidacion: evaluacion.esRevalidacion },
      ip: input.ip,
      userAgent: input.userAgent,
    })
    return {
      ok: true,
      reutilizado: false,
      esRevalidacion: evaluacion.esRevalidacion,
      intento: { id: creado.id, estado: 'creada', canal: creado.canal, nonce: creado.nonce, creadoAt: creado.creadoAt, venceAt: creado.venceAt },
    }
  })
}

// ── Referencia de la sesión del proveedor ───────────────────────────────────

/**
 * Guarda, SELLADA, la referencia de la sesión del proveedor en el intento. La
 * Fase 2 la llama al crear la sesión. Sin `IDENTIDAD_CLAVES_MAESTRAS` lanza
 * `sin_clave`: no se guarda nada en claro, así que no se empieza ninguna sesión.
 */
export async function guardarReferenciaDeSesion(intentoId: string, referencia: string): Promise<void> {
  const intento = await sinEmpresa('identidad: el worker resuelve el intento por su id', (tx) =>
    tx.identidadIntento.findUnique({ where: { id: intentoId }, select: { userId: true } })
  )
  if (!intento) throw new ErrorDeIdentidad('no_existe', 'El intento no existe.')
  const { sellado, claveVersion } = sellarReferencia(intento.userId, referencia)
  await conUsuario(intento.userId, (tx) =>
    tx.identidadIntento.update({ where: { id: intentoId }, data: { referenciaProveedorSellada: sellado, claveVersion } })
  )
}

/** La referencia en claro de un intento, para llamar al proveedor desde el servidor. Null si no hay o no abre. */
export async function leerReferenciaDeSesion(intentoId: string): Promise<string | null> {
  const intento = await sinEmpresa('identidad: el worker resuelve el intento por su id', (tx) =>
    tx.identidadIntento.findUnique({ where: { id: intentoId }, select: { userId: true, referenciaProveedorSellada: true } })
  )
  if (!intento?.referenciaProveedorSellada) return null
  return abrirReferencia(intento.userId, intento.referenciaProveedorSellada)
}

// ── Lo que el worker necesita saber de un intento y anotar sobre él (Fase 2) ─

export interface IntentoUbicado {
  id: string
  userId: string
  estado: EstadoIntento
  codigoRazon: string | null
  /** Hay referencia de sesión guardada (sellada). */
  tieneSesion: boolean
  purgadoAt: Date | null
  purgaIntentos: number
  canal: string
}

/** Busca un intento por su id (el worker no sabe de quién es). Null si no existe. */
export async function ubicarIntento(intentoId: string): Promise<IntentoUbicado | null> {
  const f = await sinEmpresa('identidad: el worker resuelve el intento por su id', (tx) =>
    tx.identidadIntento.findUnique({
      where: { id: intentoId },
      select: { id: true, userId: true, estado: true, codigoRazon: true, referenciaProveedorSellada: true, purgadoAt: true, purgaIntentos: true, canal: true },
    })
  )
  if (!f) return null
  return {
    id: f.id,
    userId: f.userId,
    estado: f.estado as EstadoIntento,
    codigoRazon: f.codigoRazon,
    tieneSesion: f.referenciaProveedorSellada !== null,
    purgadoAt: f.purgadoAt,
    purgaIntentos: f.purgaIntentos,
    canal: f.canal,
  }
}

/** Anota que se le preguntó al proveedor por este intento (la reconciliación no insiste cada segundo). */
export async function anotarConsultaDeIntento(intentoId: string, ahora: Date = new Date()): Promise<void> {
  await sinEmpresa('identidad: el worker anota la consulta al proveedor', (tx) =>
    tx.identidadIntento.updateMany({ where: { id: intentoId }, data: { ultimaConsultaAt: ahora } })
  )
}

/**
 * Anota que la sesión se borró en el proveedor («procesar y purgar») y deja el
 * asiento que lo prueba. Idempotente: solo la primera vez escribe y audita.
 * Devuelve `true` si fue esta llamada la que lo anotó.
 */
export async function registrarPurgaDeSesion(intentoId: string, ahora: Date = new Date()): Promise<boolean> {
  return sinEmpresa('identidad: el worker anota el borrado en el proveedor', async (tx) => {
    const r = await tx.identidadIntento.updateMany({ where: { id: intentoId, purgadoAt: null }, data: { purgadoAt: ahora } })
    if (r.count === 0) return false
    const i = await tx.identidadIntento.findUnique({ where: { id: intentoId }, select: { userId: true } })
    if (i) {
      await auditar(tx, 'IDENTIDAD_SESION_PURGADA', { entidadId: i.userId, payload: { intentoId, proveedor: 'didit', resultado: 'borrada' } })
    }
    return true
  })
}

/** Cuenta un borrado fallido (para que el reintento no sea infinito ni silencioso). */
export async function registrarFalloDePurga(intentoId: string): Promise<void> {
  await sinEmpresa('identidad: el worker anota un borrado fallido', (tx) =>
    tx.identidadIntento.updateMany({ where: { id: intentoId }, data: { purgaIntentos: { increment: 1 } } })
  )
}

/** Deja asiento de un aviso del proveedor que no cuadra con el intento al que decía referirse. */
export async function registrarEventoDescartado(userId: string, intentoId: string, motivo: string): Promise<void> {
  await sinEmpresa('identidad: el worker audita un aviso descartado', (tx) =>
    auditar(tx, 'IDENTIDAD_EVENTO_DESCARTADO', { entidadId: userId, payload: { intentoId, proveedor: 'didit', motivo } })
  )
}

// ── Supresión de los datos de identidad de una persona (derecho de supresión) ─

/** Comprueba que quien llama es del equipo autorizado. Lanza `no_autorizado` si no. */
export function exigirGestionDeIdentidad(actor: ActorDeIdentidad): void {
  exigirGestion(actor)
}

/** Las referencias de sesión de la persona, abiertas (para el borrado en el proveedor). */
export async function sesionesDeLaPersona(userId: string): Promise<{ intentoId: string; sesionId: string; purgada: boolean }[]> {
  const filas = await conUsuario(userId, (tx) =>
    tx.identidadIntento.findMany({
      where: { userId, referenciaProveedorSellada: { not: null } },
      select: { id: true, referenciaProveedorSellada: true, purgadoAt: true },
      orderBy: { creadoAt: 'asc' },
    })
  )
  const sesiones: { intentoId: string; sesionId: string; purgada: boolean }[] = []
  for (const f of filas) {
    const sesionId = f.referenciaProveedorSellada ? abrirReferencia(userId, f.referenciaProveedorSellada) : null
    // Una referencia que no abre (llave perdida o rotada sin conservar la anterior) NO se salta: borrar «lo que se
    // pueda» dejaría datos biométricos en el proveedor sin que quedara cómo encontrarlos. Lo resuelve una persona.
    if (!sesionId) throw new ErrorDeIdentidad('sin_clave', 'No se pudo abrir una referencia sellada del proveedor.')
    sesiones.push({ intentoId: f.id, sesionId, purgada: f.purgadoAt !== null })
  }
  return sesiones
}

/** Deja el asiento de que se pidió el borrado. `actor` es null si lo pide la propia persona. */
export async function registrarSolicitudDeSupresion(userId: string, actor: ActorDeIdentidad | null, motivo: string): Promise<void> {
  await conUsuario(userId, (tx) =>
    auditar(tx, 'IDENTIDAD_SUPRESION_SOLICITADA', {
      actorUserId: actor?.userId ?? userId,
      entidadId: userId,
      payload: { motivo: motivo.slice(0, 120), rol: actor?.rol ?? 'persona' },
    })
  )
}

/**
 * LO ÚLTIMO de una supresión, cuando el proveedor ya confirmó el borrado: quita el
 * resultado global, las referencias y los códigos de los intentos, y retira lo que
 * veían las empresas. Se conservan SOLO el registro de consentimientos (es la prueba
 * de lo que la persona aceptó) y los intentos sin ningún dato (estado y fechas).
 */
export async function anonimizarIdentidadLocal(userId: string, actor: ActorDeIdentidad | null): Promise<{ intentos: number }> {
  const intentos = await conUsuario(userId, async (tx) => {
    await bloquearPersona(tx, userId)
    await tx.identidadVerificacion.deleteMany({ where: { userId } })
    const r = await tx.identidadIntento.updateMany({
      where: { userId },
      data: { referenciaProveedorSellada: null, claveVersion: null, codigoRazon: null, verificacionId: null },
    })
    await auditar(tx, 'IDENTIDAD_SUPRESION_COMPLETADA', {
      actorUserId: actor?.userId ?? null,
      entidadId: userId,
      payload: { cantidad: r.count, rol: actor?.rol ?? 'sistema' },
    })
    return r.count
  })
  await proyectarEnFichas(userId)
  return { intentos }
}

// ── Aplicar una decisión (EL ÚNICO ESCRITOR de estado) ──────────────────────

export interface DatosDeAprobacion {
  nivel?: NivelIdentidad
  via?: ViaVerificacion
  proveedor?: string
  /** Ya calculado con `calcularHashDedupe`; el número del documento no llega aquí. */
  hashDedupe?: string | null
}

export type ResultadoAplicarDecision =
  | { aplicado: 'aplicar'; estado: EstadoIntento; verificada: boolean; enRevisionPorDuplicado: boolean }
  | { aplicado: 'repetida' | 'ignorar_regresion' | 'prohibida'; estado: EstadoIntento }
  | { aplicado: 'no_existe' }

/**
 * Aplica lo que el proveedor decidió sobre un intento. SOLO la llama el worker,
 * después de autenticar el webhook y de RE-CONSULTAR la decisión al proveedor
 * ("fetch the truth"): nada que venga del cliente llega aquí.
 *
 *  · IDEMPOTENTE: el mismo evento dos veces no cambia nada.
 *  · SOLO HACIA DELANTE: un «en proceso» que llega tarde no deshace un «aprobada»,
 *    y una decisión final no la cambia otra distinta (se devuelve `prohibida` y se
 *    deja constancia: lo ve una persona).
 *  · al APROBAR escribe el resultado global con su fecha de expiración, o manda el
 *    intento a `en_revision` si el mismo documento ya está verificado en OTRA cuenta.
 *  · después refresca la proyección que ven las empresas.
 */
export async function aplicarDecision(
  intentoId: string,
  decision: DecisionNeutral,
  datos: DatosDeAprobacion = {},
  ahora: Date = new Date()
): Promise<ResultadoAplicarDecision> {
  const ubicado = await sinEmpresa('identidad: el worker resuelve el intento por su id', (tx) =>
    tx.identidadIntento.findUnique({ where: { id: intentoId }, select: { userId: true } })
  )
  if (!ubicado) return { aplicado: 'no_existe' }
  const userId = ubicado.userId

  const resultado = await conUsuario(userId, async (tx): Promise<ResultadoAplicarDecision> => {
    await bloquearPersona(tx, userId)
    const actual = await tx.identidadIntento.findUnique({ where: { id: intentoId } })
    if (!actual) return { aplicado: 'no_existe' }

    const resuelto = resolverDecision(decision)
    const evaluacion = evaluarTransicion(actual.estado, resuelto.estado)
    if (evaluacion !== 'aplicar') {
      if (evaluacion === 'prohibida') {
        anotarFallo('identidad:decision-conflictiva', { intentoId, de: actual.estado, a: resuelto.estado })(
          new Error('Una decisión final llegó sobre un intento ya cerrado con otra distinta.')
        )
      }
      return { aplicado: evaluacion, estado: actual.estado as EstadoIntento }
    }

    let estadoFinal: EstadoIntento = resuelto.estado
    let codigoRazon = resuelto.codigoRazon
    let tipoRechazo = resuelto.tipoRechazo
    let verificada = false
    let enRevisionPorDuplicado = false

    if (resuelto.estado === 'aprobada') {
      const r = await registrarAprobada(tx, userId, intentoId, datos, ahora)
      if (r === 'duplicada') {
        // El mismo documento ya respalda a OTRA cuenta: nunca se acredita en silencio.
        estadoFinal = 'en_revision'
        codigoRazon = 'IDENTIDAD_DUPLICADA'
        tipoRechazo = null
        enRevisionPorDuplicado = true
      } else {
        verificada = true
      }
    }

    const sello: Partial<Record<'iniciadoAt' | 'enviadoAt' | 'resueltoAt', Date>> = {}
    if (estadoFinal === 'iniciada') sello.iniciadoAt = ahora
    if (estadoFinal === 'enviada') sello.enviadoAt = ahora
    if (esEstadoFinalDeIntento(estadoFinal)) sello.resueltoAt = ahora
    await tx.identidadIntento.update({
      where: { id: intentoId },
      data: { estado: estadoFinal, tipoRechazo, codigoRazon, ...sello },
    })

    if (verificada) {
      // (el asiento de «aprobada» lo dejó `registrarAprobada`, junto con el resultado global)
    } else if (estadoFinal === 'rechazada_reintentable' || estadoFinal === 'rechazada_definitiva') {
      await auditar(tx, 'IDENTIDAD_VERIFICACION_RECHAZADA', {
        entidadId: userId,
        payload: { intentoId, tipoRechazo, codigoRazon, canal: actual.canal },
      })
    } else if (estadoFinal === 'en_revision') {
      await auditar(tx, 'IDENTIDAD_VERIFICACION_EN_REVISION', {
        entidadId: userId,
        payload: { intentoId, codigoRazon, canal: actual.canal },
      })
    }
    return { aplicado: 'aplicar', estado: estadoFinal, verificada, enRevisionPorDuplicado }
  })

  if (resultado.aplicado === 'aplicar' && resultado.verificada) await proyectarEnFichas(userId, ahora)
  return resultado
}

function esEstadoFinalDeIntento(estado: EstadoIntento): boolean {
  return !esEstadoAbierto(estado)
}

/** Escribe el resultado global al aprobar. Devuelve `duplicada` si el documento ya respalda a otra cuenta. */
async function registrarAprobada(
  tx: Tx,
  userId: string,
  intentoId: string,
  datos: DatosDeAprobacion,
  ahora: Date
): Promise<'ok' | 'duplicada'> {
  const hash = datos.hashDedupe ?? null
  if (hash) {
    // Dos cuentas aprobadas a la vez con el mismo documento se serializan aquí: la segunda ve la
    // fila de la primera ya confirmada. (Capturar la violación única no serviría: en PostgreSQL
    // un error dentro de la transacción la deja abortada.) El índice único queda de respaldo.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`identidad-doc:${hash}`}, 0))`
    const otra = await tx.identidadVerificacion.findFirst({
      where: { hashDedupe: hash, userId: { not: userId } },
      select: { id: true },
    })
    if (otra) return 'duplicada'
  }

  const nivel = datos.nivel ?? 'documento_selfie'
  const via = datos.via ?? 'proveedor_documento_selfie'
  const intento = await tx.identidadIntento.findUnique({
    where: { id: intentoId },
    select: { referenciaProveedorSellada: true, claveVersion: true },
  })
  const actual = await tx.identidadVerificacion.findUnique({ where: { userId }, select: { id: true, estado: true } })
  if (actual && actual.estado !== 'verificada' && !puedeTransicionarVerificacion(actual.estado, 'verificada')) {
    // No debería ocurrir (todos los estados pueden volver a `verificada`), pero una transición
    // ilegal no se escribe en silencio.
    throw new Error(`identidad: transición de verificación ilegal ${actual.estado} → verificada`)
  }

  const campos = {
    estado: 'verificada' as EstadoVerificacion,
    nivel,
    viaVerificacion: via,
    proveedor: datos.proveedor ?? null,
    referenciaProveedorSellada: intento?.referenciaProveedorSellada ?? null,
    claveVersion: intento?.claveVersion ?? null,
    hashDedupe: hash,
    verificadaEn: ahora,
    expiraEn: calcularExpiracion(ahora),
    revocadaEn: null,
    motivoRevocacion: null,
  }
  const { id: verificacionId } = await tx.identidadVerificacion.upsert({
    where: { userId },
    create: { userId, ...campos },
    update: campos,
    select: { id: true },
  })
  await tx.identidadIntento.update({ where: { id: intentoId }, data: { verificacionId } })
  await auditar(tx, 'IDENTIDAD_VERIFICACION_APROBADA', {
    entidadId: userId,
    payload: { intentoId, verificacionId, nivel, via, proveedor: datos.proveedor ?? null, estadoAnterior: actual?.estado ?? 'no_verificada', estadoNuevo: 'verificada' },
  })
  return 'ok'
}

// ── Revocar, revalidar, expirar ─────────────────────────────────────────────

/**
 * Retira una verificación (fraude confirmado, error, orden de la persona). Solo
 * el equipo autorizado; el motivo es un código, no texto libre.
 */
export async function revocarVerificacion(
  actor: ActorDeIdentidad,
  userId: string,
  motivo: string
): Promise<{ revocada: boolean }> {
  exigirGestion(actor)
  const codigo = motivo?.trim()
  if (!codigo) throw new ErrorDeIdentidad('motivo_requerido', 'Indica el motivo.')
  const hecho = await conUsuario(userId, async (tx) => {
    await bloquearPersona(tx, userId)
    const v = await tx.identidadVerificacion.findUnique({ where: { userId }, select: { id: true, estado: true } })
    if (!v || !puedeTransicionarVerificacion(v.estado, 'revocada')) return false
    await tx.identidadVerificacion.update({
      where: { userId },
      data: { estado: 'revocada', revocadaEn: new Date(), motivoRevocacion: codigo.slice(0, 120) },
    })
    await auditar(tx, 'IDENTIDAD_VERIFICACION_REVOCADA', {
      actorUserId: actor.userId,
      entidadId: userId,
      payload: { verificacionId: v.id, estadoAnterior: v.estado, estadoNuevo: 'revocada', motivo: codigo, rol: actor.rol },
    })
    return true
  })
  if (hecho) await proyectarEnFichas(userId)
  return { revocada: hecho }
}

/**
 * Pide revalidar a una persona verificada (documento vencido, cambio de nombre,
 * sospecha, solicitud suya o de soporte, política de riesgo). Mientras tanto su
 * resultado deja de verse en las fichas; puede empezar un intento nuevo.
 * `actor` es null cuando lo dispara el sistema.
 */
export async function solicitarRevalidacion(
  userId: string,
  disparador: DisparadorRevalidacion,
  actor: ActorDeIdentidad | null = null
): Promise<{ solicitada: boolean }> {
  if (actor) exigirGestion(actor)
  const hecho = await conUsuario(userId, async (tx) => {
    await bloquearPersona(tx, userId)
    const v = await tx.identidadVerificacion.findUnique({ where: { userId }, select: { id: true, estado: true } })
    if (!v || !puedeTransicionarVerificacion(v.estado, 'requiere_revalidacion')) return false
    await tx.identidadVerificacion.update({ where: { userId }, data: { estado: 'requiere_revalidacion' } })
    await auditar(tx, 'IDENTIDAD_REVALIDACION_REQUERIDA', {
      actorUserId: actor?.userId ?? null,
      entidadId: userId,
      payload: { verificacionId: v.id, estadoAnterior: v.estado, estadoNuevo: 'requiere_revalidacion', disparador, rol: actor?.rol ?? 'sistema' },
    })
    return true
  })
  if (hecho) await proyectarEnFichas(userId)
  return { solicitada: hecho }
}

export interface ResumenMantenimientoIdentidad {
  expiradas: number
  intentosAbandonados: number
  proximasARevalidar: number
  proyeccionesRepasadas: number
}

/**
 * El barrido diario (mantenimiento puro de la base; NO habla con el proveedor: la
 * reconciliación de intentos sin respuesta es de la Fase 2).
 *
 *  1. Marca `expirada` toda verificación cuya fecha ya pasó, con su asiento, y
 *     refresca la proyección (las empresas dejan de verla).
 *  2. Da por ABANDONADOS los intentos que no avanzaron (`creada`, `iniciada`,
 *     `reenvio_requerido` pasada su vigencia): libera el candado de «un intento
 *     abierto» para que la persona pueda volver a empezar. Los `enviada`,
 *     `en_proceso` y `en_revision` NO se tocan aquí: hay un proveedor o una persona
 *     por medio y los resuelve la reconciliación.
 *  3. Cuenta cuántas verificaciones entran en la ventana de aviso de revalidación
 *     (el aviso a la persona lo envía la experiencia de cliente, Fase 3).
 */
export async function ejecutarMantenimientoDeIdentidad(
  ahora: Date = new Date(),
  limite = 500
): Promise<ResumenMantenimientoIdentidad> {
  const { vencidas, abandonados, proximas } = await sinEmpresa(
    'identidad: el barrido diario recorre a todas las personas',
    async (tx) => {
      const aExpirar = await tx.identidadVerificacion.findMany({
        where: { estado: { in: ['verificada', 'requiere_revalidacion'] }, expiraEn: { lte: ahora } },
        select: { id: true, userId: true, estado: true },
        take: limite,
      })
      const expiradas: { id: string; userId: string }[] = []
      for (const v of aExpirar) {
        // Condición repetida en el UPDATE: si otro proceso la movió entre medias, no se pisa.
        const r = await tx.identidadVerificacion.updateMany({
          where: { id: v.id, estado: v.estado },
          data: { estado: 'expirada' },
        })
        if (r.count === 1) {
          expiradas.push({ id: v.id, userId: v.userId })
          await auditar(tx, 'IDENTIDAD_VERIFICACION_EXPIRADA', {
            entidadId: v.userId,
            payload: { verificacionId: v.id, estadoAnterior: v.estado, estadoNuevo: 'expirada' },
          })
        }
      }
      const aAbandonar = await tx.identidadIntento.updateMany({
        where: { estado: { in: ['creada', 'iniciada', 'reenvio_requerido'] }, venceAt: { lt: ahora } },
        data: { estado: 'abandonada', resueltoAt: ahora },
      })
      const limiteAviso = new Date(ahora.getTime() + POLITICA_IDENTIDAD.avisoRevalidacionDias * 86_400_000)
      const proximas = await tx.identidadVerificacion.count({
        where: { estado: 'verificada', expiraEn: { gt: ahora, lte: limiteAviso } },
      })
      return { vencidas: expiradas, abandonados: aAbandonar.count, proximas }
    }
  )
  for (const v of vencidas) await proyectarEnFichas(v.userId, ahora)
  return {
    expiradas: vencidas.length,
    intentosAbandonados: abandonados,
    proximasARevalidar: proximas,
    proyeccionesRepasadas: vencidas.length,
  }
}

// ── Lo que ve una empresa: la proyección binaria ────────────────────────────

/**
 * Recalcula, desde la verdad, lo que cada FICHA de la persona (una por empresa)
 * enseña de su identidad: `identidadEstado = 'verificada'` + nivel + fecha, o
 * todo `null`. Es lo ÚNICO que una empresa ve, y solo si:
 *
 *  · la persona consintió la divulgación (`IDENTIDAD_DIVULGACION_EMPRESAS`), y
 *  · su verificación VALE ahora (verificada y sin expirar).
 *
 * `null` significa «no consta», que no es «rechazada»: ninguna empresa puede
 * inferir un rechazo de este campo, ni en qué otras empresas es cliente la persona.
 *
 * Idempotente: se puede llamar después de cualquier cambio (resultado, consentimiento,
 * revocación, expiración) y converge. Corre en su propia transacción porque las
 * fichas son de empresa y esta capa es de persona.
 */
export async function proyectarEnFichas(userId: string, ahora: Date = new Date()): Promise<{ actualizadas: number; visible: boolean }> {
  const verdad = await conUsuario(userId, async (tx) => {
    const v = await tx.identidadVerificacion.findUnique({
      where: { userId },
      select: { estado: true, nivel: true, verificadaEn: true, expiraEn: true },
    })
    const consiente =
      (await tx.identidadConsentimiento.count({ where: { userId, tipo: 'IDENTIDAD_DIVULGACION_EMPRESAS', revocadoAt: null } })) > 0
    return { v, consiente }
  })
  const visible = verdad.consiente && verdad.v !== null && verdad.v.nivel !== null && estadoEfectivo(verdad.v, ahora) === 'verificada'

  const actualizadas = await sinEmpresa('identidad: la proyección cruza las fichas de la persona en todas las empresas', async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId }, select: { supabaseId: true } })
    if (!u) return 0
    const r = await tx.cliente.updateMany({
      // Las fichas de mostrador (`esLocal`) nunca tienen cuenta: no se proyecta nada en ellas.
      where: { supabaseId: u.supabaseId, esLocal: false },
      data: visible
        ? { identidadEstado: 'verificada', identidadNivel: verdad.v!.nivel, identidadVerificadaEn: verdad.v!.verificadaEn }
        : { identidadEstado: null, identidadNivel: null, identidadVerificadaEn: null },
    })
    return r.count
  })
  return { actualizadas, visible }
}

// ── El equipo de Membego mira un caso ───────────────────────────────────────

export interface IntentoParaStaff {
  id: string
  estado: string
  tipoRechazo: string | null
  codigoRazon: string | null
  canal: string
  origen: string
  creadoAt: Date
  resueltoAt: Date | null
}

export interface IdentidadParaStaff {
  estado: EstadoIdentidadPublico
  intentos: IntentoParaStaff[]
}

/**
 * El estado de identidad de una persona para el equipo de Membego. NUNCA devuelve
 * imágenes, la referencia del proveedor ni el hash: solo estado, fechas y el
 * historial de intentos con sus códigos de razón.
 *
 * Solo el equipo autorizado, y CADA lectura deja asiento (quién, a quién, con qué
 * motivo): el acceso a datos sensibles se audita, como pide OWASP.
 */
export async function consultarIdentidadComoStaff(
  actor: ActorDeIdentidad,
  userId: string,
  motivo: string,
  contexto: { ip?: string | null; userAgent?: string | null } = {},
  ahora: Date = new Date()
): Promise<IdentidadParaStaff> {
  exigirGestion(actor)
  const razon = motivo?.trim()
  if (!razon) throw new ErrorDeIdentidad('motivo_requerido', 'Indica el motivo de la consulta.')
  const existe = await sinEmpresa('identidad: el equipo comprueba que la persona existe', (tx) =>
    tx.user.findUnique({ where: { id: userId }, select: { id: true } })
  )
  if (!existe) throw new ErrorDeIdentidad('persona_no_encontrada', 'La persona no existe.')

  const estado = await estadoDeIdentidadDe(userId, ahora)
  const intentos = await conUsuario(userId, async (tx) => {
    const filas = await tx.identidadIntento.findMany({
      where: { userId },
      orderBy: { creadoAt: 'desc' },
      take: 20,
      select: { id: true, estado: true, tipoRechazo: true, codigoRazon: true, canal: true, origen: true, creadoAt: true, resueltoAt: true },
    })
    await auditar(tx, 'IDENTIDAD_ESTADO_CONSULTADO_POR_STAFF', {
      actorUserId: actor.userId,
      entidadId: userId,
      payload: { motivo: razon, rol: actor.rol, cantidad: filas.length },
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    })
    return filas
  })
  return { estado, intentos }
}
