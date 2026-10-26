import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CodigoRazon, DecisionNeutral } from '@/modules/identidad/identidadCore'
import { ErrorDeProveedor, type DecisionDelProveedor, type DocumentoParaDedupe } from '@/modules/identidad/proveedor/contrato'

/**
 * DIDIT → MEMBEGO: la traducción, sin red y sin base de datos (se prueba con
 * fixtures). Dos cosas viven aquí:
 *
 *  1. QUÉ DICE DIDIT, EN NUESTRO VOCABULARIO. Estados de sesión y advertencias
 *     (`risk`) pasan a `DecisionNeutral` y al catálogo propio `CODIGOS_RAZON`. Lo que
 *     no reconocemos NO se muestra jamás: cae al código genérico.
 *  2. LA AUTENTICIDAD DE LOS AVISOS. Firma HMAC-SHA256 sobre el cuerpo, ventana de
 *     frescura y dos secretos para rotar.
 *
 * Fuentes: docs.didit.me (webhooks, decisión de sesión, advertencias de ID,
 * liveness y face match), consultadas el 22-oct-2026. Si Didit añade una
 * advertencia, aquí cae en lo genérico hasta que alguien la clasifique.
 */

// ── Estados de sesión ───────────────────────────────────────────────────────

type ResultadoNeutral = DecisionNeutral['resultado']

/**
 * Estado de sesión de Didit → resultado neutral. `null` = «sin novedad» (la
 * sesión existe pero la persona aún no ha hecho nada): no mueve el intento.
 * Los nombres distinguen mayúsculas, tal como los manda Didit.
 */
const ESTADOS_DE_SESION: Readonly<Record<string, ResultadoNeutral | null>> = {
  'Not Started': null,
  'In Progress': 'en_proceso',
  'Awaiting User': 'reenvio_requerido',
  Resubmitted: 'en_proceso',
  'In Review': 'en_revision',
  Approved: 'aprobada',
  Declined: 'rechazada',
  Expired: 'expirada',
  'Kyc Expired': 'expirada',
  Abandoned: 'abandonada',
}

export function esEstadoDeSesionConocido(estado: unknown): estado is string {
  return typeof estado === 'string' && Object.prototype.hasOwnProperty.call(ESTADOS_DE_SESION, estado)
}

// ── Advertencias → códigos de razón ─────────────────────────────────────────

const A_FRAUDE: CodigoRazon = 'SOSPECHA_DE_FRAUDE'
const A_ALTERADO: CodigoRazon = 'SOSPECHA_DE_DOCUMENTO_ALTERADO'

/**
 * Advertencia de Didit (`warnings[].risk`) → código propio. Solo se consultan
 * cuando la sesión se RECHAZA o va a revisión: en una aprobada Didit deja
 * advertencias informativas (QR no detectado, correo filtrado…) que no significan nada.
 *
 * Las señales de ataque o manipulación van a los códigos que NO se explican a la
 * persona ni admiten reintento: decirle qué saltó es enseñarle a evitarlo.
 */
const ADVERTENCIAS: Readonly<Record<string, CodigoRazon>> = {
  // Fraude / ataque a la captura
  LIVENESS_FACE_ATTACK: A_FRAUDE,
  FACE_IN_BLOCKLIST: A_FRAUDE,
  FRONT_CAMERA_FACE_IN_BLOCKLIST: A_FRAUDE,
  ID_DOCUMENT_IN_BLOCKLIST: A_FRAUDE,
  POSSIBLE_FACE_IN_BLOCKLIST: A_FRAUDE,
  POSSIBLE_FRONT_CAMERA_FACE_IN_BLOCKLIST: A_FRAUDE,
  VIRTUAL_CAMERA_DETECTED: A_FRAUDE,
  FRAME_INJECTION_SUSPECTED: A_FRAUDE,
  EXTERNAL_CAPTURE_DEVICE_DETECTED: A_FRAUDE,
  SCREEN_CAPTURE_DURING_CAPTURE: A_FRAUDE,
  LIVENESS_VIDEO_ANOMALY: A_FRAUDE,
  // Documento alterado o copiado
  SCREEN_CAPTURE_DETECTED: A_ALTERADO,
  PRINTED_COPY_DETECTED: A_ALTERADO,
  PORTRAIT_MANIPULATION_DETECTED: A_ALTERADO,
  BARCODE_SIGNATURE_INVALID: A_ALTERADO,
  PUBLIC_DOCUMENT_IMAGE_DETECTED: A_ALTERADO,
  // Edad
  MINIMUM_AGE_NOT_MET: 'MENOR_DE_EDAD',
  AGE_BELOW_MINIMUM: 'MENOR_DE_EDAD',
  // Documento
  DOCUMENT_EXPIRED: 'DOCUMENTO_VENCIDO',
  DOCUMENT_NOT_SUPPORTED_FOR_APPLICATION: 'DOCUMENTO_NO_SOPORTADO',
  COULD_NOT_DETECT_DOCUMENT_TYPE: 'DOCUMENTO_NO_SOPORTADO',
  DOCUMENT_HAS_NO_PORTRAIT: 'DOCUMENTO_NO_SOPORTADO',
  COULD_NOT_RECOGNIZE_DOCUMENT: 'DOCUMENTO_ILEGIBLE',
  IMAGE_TOO_BLURRY: 'DOCUMENTO_ILEGIBLE',
  IMAGE_TOO_DARK: 'DOCUMENTO_ILEGIBLE',
  IMAGE_TOO_BRIGHT: 'DOCUMENTO_ILEGIBLE',
  IMAGE_RESOLUTION_TOO_LOW: 'DOCUMENTO_ILEGIBLE',
  IMAGE_QUALITY_TOO_LOW: 'DOCUMENTO_ILEGIBLE',
  DOCUMENT_NOT_FULLY_VISIBLE: 'DOCUMENTO_ILEGIBLE',
  DOCUMENT_OCCLUSION_DETECTED: 'DOCUMENTO_ILEGIBLE',
  CRITICAL_FIELD_OCCLUSION_DETECTED: 'DOCUMENTO_ILEGIBLE',
  DOCUMENT_NUMBER_NOT_DETECTED: 'DOCUMENTO_ILEGIBLE',
  NAME_NOT_DETECTED: 'DOCUMENTO_ILEGIBLE',
  DATE_OF_BIRTH_NOT_DETECTED: 'DOCUMENTO_ILEGIBLE',
  INVALID_DATE: 'DOCUMENTO_ILEGIBLE',
  PORTRAIT_IMAGE_NOT_DETECTED: 'DOCUMENTO_ILEGIBLE',
  // Rostro
  LOW_FACE_MATCH_SIMILARITY: 'ROSTRO_NO_COINCIDE',
  LOW_FRONT_CAMERA_FACE_MATCH_SIMILARITY: 'ROSTRO_NO_COINCIDE',
  FACE_MATCH_NOT_COMPUTED: 'ROSTRO_NO_COINCIDE',
  NO_REFERENCE_IMAGE: 'ROSTRO_NO_COINCIDE',
  // Prueba de vida
  LOW_LIVENESS_SCORE: 'PRUEBA_DE_VIDA_FALLIDA',
  NO_FACE_DETECTED: 'PRUEBA_DE_VIDA_FALLIDA',
  NO_FACE_IN_SELFIE: 'PRUEBA_DE_VIDA_FALLIDA',
  MULTIPLE_FACES_DETECTED: 'PRUEBA_DE_VIDA_FALLIDA',
  LOW_FACE_QUALITY: 'PRUEBA_DE_VIDA_FALLIDA',
  LOW_FACE_LUMINANCE: 'PRUEBA_DE_VIDA_FALLIDA',
  HIGH_FACE_LUMINANCE: 'PRUEBA_DE_VIDA_FALLIDA',
  FRONT_CAMERA_CAPTURED_DOCUMENT: 'PRUEBA_DE_VIDA_FALLIDA',
  // Datos que no cuadran con lo esperado (MEMBEGO no manda datos esperados hoy: por si algún día)
  FULL_NAME_MISMATCH_WITH_PROVIDED: 'DATOS_NO_COINCIDEN',
  GENDER_MISMATCH_WITH_PROVIDED: 'DATOS_NO_COINCIDEN',
  DOB_MISMATCH_WITH_PROVIDED: 'DATOS_NO_COINCIDEN',
  COUNTRY_MISMATCH_WITH_PROVIDED: 'DATOS_NO_COINCIDEN',
  NATIONALITY_MISMATCH_WITH_PROVIDED: 'DATOS_NO_COINCIDEN',
  IDENTIFICATION_NUMBER_MISMATCH_WITH_PROVIDED: 'DATOS_NO_COINCIDEN',
}

/** Traduce una lista de advertencias a códigos propios; las desconocidas se descartan. */
export function traducirAdvertencias(riesgos: readonly string[]): CodigoRazon[] {
  const salida = new Set<CodigoRazon>()
  for (const r of riesgos) {
    const c = Object.prototype.hasOwnProperty.call(ADVERTENCIAS, r) ? ADVERTENCIAS[r] : undefined
    if (c) salida.add(c)
  }
  return [...salida]
}

// ── Lectura de la decisión (GET /v3/session/{id}/decision/) ─────────────────

type Objeto = Record<string, unknown>
const esObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v)
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const lista = (v: unknown): Objeto[] => (Array.isArray(v) ? v.filter(esObjeto) : [])

const FUNCIONES = ['id_verifications', 'liveness_checks', 'face_matches'] as const

/** Todas las advertencias (`risk`) de las funciones de la sesión. */
function riesgosDe(decision: Objeto): string[] {
  const riesgos: string[] = []
  for (const funcion of FUNCIONES) {
    for (const item of lista(decision[funcion])) {
      for (const w of lista(item.warnings)) {
        const r = texto(w.risk)
        if (r) riesgos.push(r)
      }
    }
  }
  return riesgos
}

const aprobada = (items: Objeto[]) => items.some((i) => i.status === 'Approved')

/** Categoría cerrada del tipo de documento (el texto del proveedor no entra al hash tal cual). */
export function categoriaDeDocumento(tipo: string | null): string {
  const t = (tipo ?? '').toLowerCase()
  if (/passport|pasaporte/.test(t)) return 'PASAPORTE'
  if (/driver|licen/.test(t)) return 'LICENCIA'
  if (/residen/.test(t)) return 'RESIDENCIA'
  if (/identity|id card|c[eé]dula|national/.test(t)) return 'CEDULA'
  return 'OTRO'
}

/**
 * Los datos para el hash de «mismo documento»: del primer documento aprobado
 * (o el primero, si ninguno). Prefiere el número PERSONAL (el de la cédula, que
 * no cambia al renovar la tarjeta) sobre el número de la tarjeta.
 */
export function extraerDocumento(decision: Objeto): DocumentoParaDedupe | null {
  const docs = lista(decision.id_verifications)
  const doc = docs.find((d) => d.status === 'Approved') ?? docs[0]
  if (!doc) return null
  const numero = texto(doc.personal_number) ?? texto(doc.document_number)
  const pais = texto(doc.issuing_state)
  if (!numero || !pais) return null
  return { tipoDocumento: categoriaDeDocumento(texto(doc.document_type)), numeroDocumento: numero, pais }
}

/**
 * Traduce la decisión de Didit. Estricta: una respuesta que no es lo que se
 * espera lanza `respuesta_invalida` en vez de adivinar.
 *
 * UNA APROBACIÓN NO BASTA SI NO TRAE LAS TRES PRUEBAS. El flujo se configura en la
 * consola de Didit, fuera de este repositorio; si alguien lo deja sin prueba de vida
 * o sin comparación facial, Didit aprobaría igual. MEMBEGO no acredita a nadie sin
 * documento aprobado, prueba de vida aprobada y rostro coincidente: si falta alguna,
 * el intento va a revisión con `FLUJO_INCOMPLETO` y lo mira una persona.
 */
export function traducirDecisionDeDidit(crudo: unknown): DecisionDelProveedor {
  if (!esObjeto(crudo)) throw new ErrorDeProveedor('respuesta_invalida', 'La decisión del proveedor no es un objeto.')
  const estado = crudo.status
  if (!esEstadoDeSesionConocido(estado)) {
    throw new ErrorDeProveedor('respuesta_invalida', 'La decisión del proveedor trae un estado que no conocemos.')
  }
  const referenciaDelCliente = texto(crudo.vendor_data)
  const base = { referenciaDelCliente, nivel: 'documento_selfie' as const }
  const resultado = ESTADOS_DE_SESION[estado]

  if (resultado === null) {
    // «Not Started»: sin novedad. Se devuelve como `iniciada` (la sesión existe) para que no mueva nada atrás.
    return { ...base, decision: { resultado: 'iniciada' }, documento: null }
  }

  if (resultado === 'aprobada') {
    const completa =
      aprobada(lista(crudo.id_verifications)) && aprobada(lista(crudo.liveness_checks)) && aprobada(lista(crudo.face_matches))
    if (!completa) {
      return { ...base, decision: { resultado: 'en_revision', codigos: ['FLUJO_INCOMPLETO'] }, documento: null }
    }
    return { ...base, decision: { resultado: 'aprobada' }, documento: extraerDocumento(crudo) }
  }

  if (resultado === 'rechazada' || resultado === 'en_revision' || resultado === 'reenvio_requerido') {
    return { ...base, decision: { resultado, codigos: traducirAdvertencias(riesgosDe(crudo)) }, documento: null }
  }
  return { ...base, decision: { resultado }, documento: null }
}

// ── Avisos (webhooks): firma, frescura y forma ──────────────────────────────

/** Ventana de frescura de un aviso, en segundos (la que recomienda Didit). */
export const TOLERANCIA_AVISO_S = 300

/** Lo máximo que se acepta por el cuerpo de un aviso. El de decisión de Didit puede ser largo. */
export const MAX_BYTES_AVISO = 512 * 1024

/**
 * La forma canónica con la que Didit firma (`X-Signature-V2`): claves ordenadas
 * recursivamente, sin espacios, Unicode sin escapar. Los números enteros escritos
 * como `100.0` ya llegan como `100` a JavaScript.
 */
export function canonizar(valor: unknown): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar)
    if (esObjeto(v)) {
      const salida: Objeto = {}
      for (const k of Object.keys(v).sort()) salida[k] = ordenar(v[k])
      return salida
    }
    return v
  }
  return JSON.stringify(ordenar(valor))
}

const hmacHex = (secreto: string, mensaje: string) => createHmac('sha256', secreto).update(mensaje, 'utf8').digest('hex')

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

export type ResultadoFirma =
  | { ok: true }
  | { ok: false; codigo: 'FIRMA_AUSENTE' | 'FIRMA_INVALIDA' | 'CUERPO_INVALIDO' | 'AVISO_VENCIDO' | 'SIN_SECRETOS'; motivo: string }

/**
 * Autentica un aviso de Didit. SE LLAMA ANTES de tocar la base de datos.
 *
 *  1. Se necesita al menos un secreto configurado (si no, ningún aviso vale).
 *  2. El cuerpo es JSON y trae `timestamp` (dentro de lo firmado): solo así la
 *     frescura no se puede mover sin romper la firma. Fuera de ±5 min = reproducción.
 *  3. Vale si la firma V2 (cuerpo canónico) coincide con ALGUNO de los secretos, o,
 *     si no, la firma sobre los bytes exactos (`X-Signature`). La comparación es de
 *     tiempo constante. NO se acepta `X-Signature-Simple`: no cubre la decisión.
 */
export function verificarFirmaDeDidit(p: {
  cuerpoCrudo: string
  cabeceras: Record<string, string | null | undefined>
  secretos: readonly string[]
  ahora: Date
  toleranciaS?: number
}): ResultadoFirma {
  if (p.secretos.length === 0) return { ok: false, codigo: 'SIN_SECRETOS', motivo: 'No hay secreto de webhook configurado.' }
  const v2 = p.cabeceras['x-signature-v2']?.trim().toLowerCase()
  const cruda = p.cabeceras['x-signature']?.trim().toLowerCase()
  if (!v2 && !cruda) return { ok: false, codigo: 'FIRMA_AUSENTE', motivo: 'El aviso no trae firma.' }

  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(p.cuerpoCrudo)
  } catch {
    return { ok: false, codigo: 'CUERPO_INVALIDO', motivo: 'El cuerpo no es JSON.' }
  }
  if (!esObjeto(cuerpo)) return { ok: false, codigo: 'CUERPO_INVALIDO', motivo: 'El cuerpo no es un objeto.' }

  const tolerancia = p.toleranciaS ?? TOLERANCIA_AVISO_S
  const firmadoEn = cuerpo.timestamp
  if (typeof firmadoEn !== 'number' || !Number.isFinite(firmadoEn)) {
    return { ok: false, codigo: 'AVISO_VENCIDO', motivo: 'El aviso no trae instante firmado.' }
  }
  if (Math.abs(p.ahora.getTime() / 1000 - firmadoEn) > tolerancia) {
    return { ok: false, codigo: 'AVISO_VENCIDO', motivo: 'El aviso está fuera de la ventana de frescura.' }
  }

  const canonico = canonizar(cuerpo)
  for (const secreto of p.secretos) {
    if (v2 && iguales(hmacHex(secreto, canonico), v2)) return { ok: true }
    if (cruda && iguales(hmacHex(secreto, p.cuerpoCrudo), cruda)) return { ok: true }
  }
  return { ok: false, codigo: 'FIRMA_INVALIDA', motivo: 'La firma no coincide.' }
}

/** Lo que MEMBEGO necesita de un aviso ya autenticado. Nada más se guarda. */
export interface AvisoDeProveedor {
  eventoId: string
  tipo: string
  /** Estado de sesión que decía el aviso. Informativo: se re-consulta la verdad. */
  estado: string | null
  sesionId: string | null
  /** Nuestro `intentoId`. */
  intentoId: string | null
}

/** Extrae lo necesario. `null` si el aviso no trae `event_id` y `webhook_type` (no se puede registrar con idempotencia). */
export function leerAviso(cuerpo: unknown): AvisoDeProveedor | null {
  if (!esObjeto(cuerpo)) return null
  const eventoId = texto(cuerpo.event_id)
  const tipo = texto(cuerpo.webhook_type)
  if (!eventoId || !tipo || eventoId.length > 100 || tipo.length > 60) return null
  return {
    eventoId,
    tipo,
    estado: texto(cuerpo.status)?.slice(0, 40) ?? null,
    sesionId: texto(cuerpo.session_id),
    intentoId: texto(cuerpo.vendor_data)?.slice(0, 100) ?? null,
  }
}
