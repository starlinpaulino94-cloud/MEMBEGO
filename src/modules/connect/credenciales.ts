import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { getConnectClavesMaestras } from '@/lib/env'
import {
  abrir,
  parsearClavesMaestras,
  sellar,
  versionActual,
  type ClavesMaestras,
} from '@/modules/connect/cifrado'
import { anotarConector } from '@/modules/connect/bitacora'

/**
 * ALMACÉN de credenciales de conexión: la única puerta entre los secretos de
 * los conectores y la base de datos.
 *
 * Todo lo que entra se SELLA (AES-256-GCM, `cifrado.ts`) atado a la identidad
 * de su fila; todo lo que sale se abre aquí y NUNCA se anota ni se devuelve
 * en errores. Sin clave maestra en el entorno, este módulo FALLA CERRADO: no
 * guarda ni lee — «el almacén está apagado» es un estado visible y honesto,
 * un cifrado con clave por defecto no lo sería.
 */

export type TipoCredencial = 'OAUTH_TOKENS' | 'API_KEY' | 'SECRETO'

export type ResultadoGuardar =
  | { ok: true; keyVersion: number }
  | { ok: false; motivo: 'sin_clave_maestra' | 'conexion_no_existe' }

export type ResultadoLeer =
  | { ok: true; secreto: string; keyVersion: number; expiresAt: Date | null }
  | { ok: false; motivo: 'sin_clave_maestra' | 'no_existe' | 'ilegible' }

/**
 * Las claves se parsean UNA vez por proceso: el parseo valida formato y
 * tamaños, y hacerlo en cada guardado sería pagar la validación mil veces.
 * Si la variable está mal puesta, el primer uso lanza con el mensaje del
 * parser — en el arranque del flujo, no en un rincón.
 */
let clavesCacheadas: ClavesMaestras | null | undefined
function claves(): ClavesMaestras | null {
  if (clavesCacheadas === undefined) {
    const valor = getConnectClavesMaestras()
    clavesCacheadas = valor ? parsearClavesMaestras(valor) : null
  }
  return clavesCacheadas
}

/** La identidad que ata cada sello a SU fila (AAD). */
function aadDe(conexionId: string, tipo: TipoCredencial): string {
  return `credencial:${conexionId}:${tipo}`
}

/**
 * Guarda (o REEMPLAZA — upsert) el secreto de una conexión. `secreto` es la
 * representación completa en texto (para OAUTH_TOKENS, el JSON con access +
 * refresh; para API_KEY, la clave tal cual).
 */
export async function guardarCredencial(input: {
  companyId: string
  conexionId: string
  tipo: TipoCredencial
  secreto: string
  expiresAt?: Date | null
  /** Datos NO sensibles (scopes concedidos, cuenta conectada…). */
  metadata?: Record<string, unknown>
}): Promise<ResultadoGuardar> {
  const km = claves()
  if (!km) return { ok: false, motivo: 'sin_clave_maestra' }

  const sellado = sellar(km, input.secreto, aadDe(input.conexionId, input.tipo))
  const keyVersion = versionActual(km)

  const conexion = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { id: input.conexionId, companyId: input.companyId },
      select: { id: true },
    })
  )
  if (!conexion) return { ok: false, motivo: 'conexion_no_existe' }

  await conEmpresa(input.companyId, (tx) =>
    tx.credencialConexion.upsert({
      where: { conexionId_tipo: { conexionId: input.conexionId, tipo: input.tipo } },
      create: {
        conexionId: input.conexionId,
        companyId: input.companyId,
        tipo: input.tipo,
        sellado,
        keyVersion,
        expiresAt: input.expiresAt ?? null,
        metadata: (input.metadata ?? undefined) as object | undefined,
      },
      update: {
        sellado,
        keyVersion,
        expiresAt: input.expiresAt ?? null,
        metadata: (input.metadata ?? undefined) as object | undefined,
        rotadaAt: new Date(),
      },
    })
  )

  // En la bitácora queda QUE se guardó, jamás QUÉ se guardó.
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    evento: 'credencial.guardada',
    detalle: { tipo: input.tipo, keyVersion },
  })

  return { ok: true, keyVersion }
}

/** Abre el secreto de una conexión. El secreto abierto no se anota nunca. */
export async function leerCredencial(input: {
  companyId: string
  conexionId: string
  tipo: TipoCredencial
}): Promise<ResultadoLeer> {
  const km = claves()
  if (!km) return { ok: false, motivo: 'sin_clave_maestra' }

  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.credencialConexion.findFirst({
      where: { conexionId: input.conexionId, companyId: input.companyId, tipo: input.tipo },
      select: { sellado: true, keyVersion: true, expiresAt: true },
    })
  )
  if (!fila) return { ok: false, motivo: 'no_existe' }

  const abierto = abrir(km, fila.sellado, aadDe(input.conexionId, input.tipo))
  if (!abierto.ok) {
    // «clave_desconocida» = falta la clave maestra vieja en el entorno (se
    // restaura la variable); «manipulado»/«formato» = alguien tocó la fila
    // (se investiga). La bitácora conserva la diferencia; el llamador recibe
    // un solo «ilegible» porque su remedio inmediato es el mismo: reconectar.
    await anotarConector({
      companyId: input.companyId,
      origen: 'CONEXION',
      origenId: input.conexionId,
      nivel: 'ERROR',
      evento: 'credencial.ilegible',
      detalle: { tipo: input.tipo, motivo: abierto.motivo, keyVersion: fila.keyVersion },
    })
    return { ok: false, motivo: 'ilegible' }
  }

  return { ok: true, secreto: abierto.datos, keyVersion: fila.keyVersion, expiresAt: fila.expiresAt }
}

/** Borra el secreto de una conexión (al desconectar). */
/**
 * METADATOS de una credencial, SIN abrirla.
 *
 * Lo que se guarda al lado del sello y no es secreto: qué permisos concedió de
 * verdad el proveedor, si llegó refresh token, qué cuenta es. La validación de
 * una conexión necesita justo eso y no necesita el secreto — pedirlo obligaría
 * a descifrar para responder «¿tienes permiso para listar calendarios?».
 *
 * Devuelve null si no hay credencial: es la forma de preguntar «¿está
 * autorizado?» sin tocar el material sensible.
 */
export async function metadatosCredencial(input: {
  companyId: string
  conexionId: string
  tipo: TipoCredencial
}): Promise<Record<string, unknown> | null> {
  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.credencialConexion.findFirst({
      where: { conexionId: input.conexionId, tipo: input.tipo },
      select: { metadata: true },
    })
  ).catch(() => null)
  if (!fila) return null
  const m = fila.metadata
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {}
  return m as Record<string, unknown>
}

export async function eliminarCredencial(input: {
  companyId: string
  conexionId: string
  tipo: TipoCredencial
}): Promise<void> {
  await conEmpresa(input.companyId, (tx) =>
    tx.credencialConexion.deleteMany({
      where: { conexionId: input.conexionId, companyId: input.companyId, tipo: input.tipo },
    })
  )
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    evento: 'credencial.eliminada',
    detalle: { tipo: input.tipo },
  })
}
