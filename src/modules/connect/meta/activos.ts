import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarConector } from '@/modules/connect/bitacora'

/**
 * LOS ACTIVOS DE META DE UNA EMPRESA (Fase 1).
 *
 * Una Página de Facebook, una cuenta profesional de Instagram, una cuenta de
 * WhatsApp Business (WABA) o un número: cada uno pertenece a UNA empresa de
 * MembeGo, y eso lo impone la base con `@@unique([tipo, idExterno])`, no una
 * convención. Es la misma regla que ya protegía al WABA en `ConexionEmpresa`,
 * generalizada a todo lo que Meta nos deje tocar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RECLAMAR NO ES UN UPSERT
 *
 * Un `upsert` con RLS apagado (desarrollo) reasignaría en silencio el activo
 * de otra empresa. Aquí se mira PRIMERO quién lo tiene, cruzando empresas con
 * motivo declarado, y solo entonces se crea o se actualiza. Un activo que otra
 * empresa RETIRÓ (`REMOVED`) sí se puede volver a reclamar: el negocio se
 * mudó de cuenta en MembeGo, y eso pasa.
 */

export const TIPOS_ACTIVO = ['PAGE', 'IG_ACCOUNT', 'WABA', 'PHONE_NUMBER'] as const
export type TipoActivo = (typeof TIPOS_ACTIVO)[number]

export interface ActivoMetaVista {
  id: string
  companyId: string
  conexionId: string
  tipo: TipoActivo
  idExterno: string
  nombre: string | null
  padreId: string | null
  estado: string
  metadata: Record<string, unknown>
}

export type ResultadoReclamo =
  | { ok: true; id: string; nuevo: boolean }
  | { ok: false; motivo: 'otra_empresa' | 'error' }

export async function reclamarActivo(input: {
  companyId: string
  conexionId: string
  tipo: TipoActivo
  idExterno: string
  nombre?: string | null
  padreId?: string | null
  metadata?: Record<string, unknown>
}): Promise<ResultadoReclamo> {
  const existente = await sinEmpresa(
    'meta: comprobar a qué empresa pertenece un activo antes de reclamarlo',
    (tx) =>
      tx.activoMeta.findUnique({
        where: { tipo_idExterno: { tipo: input.tipo, idExterno: input.idExterno } },
        select: { id: true, companyId: true, estado: true },
      })
  ).catch(() => undefined)
  if (existente === undefined) return { ok: false, motivo: 'error' }

  if (existente && existente.companyId !== input.companyId && existente.estado !== 'REMOVED') {
    return { ok: false, motivo: 'otra_empresa' }
  }

  const datos = {
    conexionId: input.conexionId,
    nombre: input.nombre ?? null,
    padreId: input.padreId ?? null,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
    estado: 'ACTIVE',
  }

  try {
    if (existente) {
      // Reasignación de un activo retirado por otra empresa, o refresco del
      // propio: cruza empresas SOLO en el primer caso, y queda anotado.
      await sinEmpresa('meta: reasignar un activo retirado o refrescar el propio', (tx) =>
        tx.activoMeta.update({
          where: { id: existente.id },
          data: { ...datos, companyId: input.companyId },
        })
      )
      if (existente.companyId !== input.companyId) {
        await anotarConector({
          companyId: input.companyId,
          origen: 'CONEXION',
          origenId: input.conexionId,
          evento: 'meta.activo_reasignado',
          detalle: { tipo: input.tipo },
        })
      }
      return { ok: true, id: existente.id, nuevo: false }
    }

    const creado = await conEmpresa(input.companyId, (tx) =>
      tx.activoMeta.create({
        data: { ...datos, companyId: input.companyId, tipo: input.tipo, idExterno: input.idExterno },
        select: { id: true },
      })
    )
    return { ok: true, id: creado.id, nuevo: true }
  } catch (e) {
    // Carrera: otra empresa lo reclamó entre la comprobación y la escritura.
    // El UNIQUE es la última palabra.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, motivo: 'otra_empresa' }
    }
    return { ok: false, motivo: 'error' }
  }
}

/**
 * QUIÉN ES EL DUEÑO de un activo, para el webhook: llega sin sesión y hay que
 * cruzar empresas para saber a cuál pertenece lo que Meta manda. Solo un
 * activo ACTIVO resuelve; uno retirado no atribuye nada a nadie.
 */
export async function activoPorIdExterno(
  tipo: TipoActivo,
  idExterno: string
): Promise<{ id: string; companyId: string; conexionId: string } | null> {
  const fila = await sinEmpresa(
    'meta: webhook — resolver la única empresa dueña de un activo',
    (tx) =>
      tx.activoMeta.findUnique({
        where: { tipo_idExterno: { tipo, idExterno } },
        select: { id: true, companyId: true, conexionId: true, estado: true },
      })
  ).catch(() => null)
  if (!fila || fila.estado !== 'ACTIVE') return null
  return { id: fila.id, companyId: fila.companyId, conexionId: fila.conexionId }
}

export async function activosDeConexion(
  companyId: string,
  conexionId: string
): Promise<ActivoMetaVista[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.activoMeta.findMany({
      where: { companyId, conexionId, estado: { not: 'REMOVED' } },
      orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
    })
  )
  return filas.map((f) => ({
    id: f.id,
    companyId: f.companyId,
    conexionId: f.conexionId,
    tipo: f.tipo as TipoActivo,
    idExterno: f.idExterno,
    nombre: f.nombre,
    padreId: f.padreId,
    estado: f.estado,
    metadata:
      f.metadata && typeof f.metadata === 'object' && !Array.isArray(f.metadata)
        ? (f.metadata as Record<string, unknown>)
        : {},
  }))
}

/** Los activos vivos de un tipo en una empresa (para adaptadores y bandeja). */
export async function activosDeEmpresaPorTipo(
  companyId: string,
  tipo: TipoActivo
): Promise<ActivoMetaVista[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.activoMeta.findMany({
      where: { companyId, tipo, estado: 'ACTIVE' },
      orderBy: { nombre: 'asc' },
    })
  )
  return filas.map((f) => ({
    id: f.id,
    companyId: f.companyId,
    conexionId: f.conexionId,
    tipo: f.tipo as TipoActivo,
    idExterno: f.idExterno,
    nombre: f.nombre,
    padreId: f.padreId,
    estado: f.estado,
    metadata:
      f.metadata && typeof f.metadata === 'object' && !Array.isArray(f.metadata)
        ? (f.metadata as Record<string, unknown>)
        : {},
  }))
}

/** Al desconectar: los activos se RETIRAN, no se borran (historial). */
export async function retirarActivosDeConexion(input: {
  companyId: string
  conexionId: string
}): Promise<number> {
  const r = await conEmpresa(input.companyId, (tx) =>
    tx.activoMeta.updateMany({
      where: { companyId: input.companyId, conexionId: input.conexionId, estado: { not: 'REMOVED' } },
      data: { estado: 'REMOVED' },
    })
  )
  return r.count
}
