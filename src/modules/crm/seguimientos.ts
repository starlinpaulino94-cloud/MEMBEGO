import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { etiquetaContacto, type Canal } from '@/modules/mensajeria/nucleo'
import type { TipoSeguimiento } from '@/modules/crm/nucleo'

/**
 * SEGUIMIENTOS (Meta · Fase 6): lo que el equipo se propone hacer con un
 * prospecto —llamarle, escribirle, visitarle— con fecha o sin ella, y
 * cuándo se hizo. Un seguimiento hecho sobre un prospecto «nuevo» lo pasa a
 * «contactado»: si alguien ya le llamó, ya no es nuevo.
 */

export async function crearSeguimiento(input: {
  companyId: string
  prospectoId: string
  tipo: TipoSeguimiento
  nota: string
  programadoAt: Date | null
  hecho: boolean
  creadoPorId: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return conEmpresa(input.companyId, async (tx) => {
    const p = await tx.prospecto.findFirst({
      where: { id: input.prospectoId, companyId: input.companyId },
      select: { id: true, etapa: true },
    })
    if (!p) return { ok: false, error: 'Este prospecto ya no existe.' }
    const ahora = new Date()
    const s = await tx.seguimientoProspecto.create({
      data: {
        companyId: input.companyId,
        prospectoId: p.id,
        tipo: input.tipo,
        nota: input.nota,
        programadoAt: input.programadoAt,
        hechoAt: input.hecho ? ahora : null,
        creadoPorId: input.creadoPorId,
      },
      select: { id: true },
    })
    await tx.prospecto.update({
      where: { id: p.id, companyId: input.companyId },
      data: {
        ultimaActividadAt: ahora,
        ...(input.hecho && p.etapa === 'nuevo' ? { etapa: 'contactado', etapaCambiadaAt: ahora } : {}),
      },
    })
    return { ok: true, id: s.id }
  })
}

export async function marcarSeguimientoHecho(companyId: string, seguimientoId: string): Promise<boolean> {
  return conEmpresa(companyId, async (tx) => {
    const s = await tx.seguimientoProspecto.findFirst({
      where: { id: seguimientoId, companyId, hechoAt: null },
      select: { id: true, prospecto: { select: { id: true, etapa: true } } },
    })
    if (!s) return false
    const ahora = new Date()
    await tx.seguimientoProspecto.update({ where: { id: s.id, companyId }, data: { hechoAt: ahora } })
    await tx.prospecto.update({
      where: { id: s.prospecto.id, companyId },
      data: {
        ultimaActividadAt: ahora,
        ...(s.prospecto.etapa === 'nuevo' ? { etapa: 'contactado', etapaCambiadaAt: ahora } : {}),
      },
    })
    return true
  })
}

export interface SeguimientoEnLista {
  id: string
  tipo: string
  nota: string
  programadoAt: Date | null
  hechoAt: Date | null
  /** Pendiente con fecha ya pasada. Se decide aquí, no en el render. */
  vencido: boolean
  createdAt: Date
  prospecto: { id: string; etiqueta: string; canal: Canal }
}

export async function listarSeguimientos(
  companyId: string,
  estado: 'pendientes' | 'hechos',
  limite = 100
): Promise<SeguimientoEnLista[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.seguimientoProspecto.findMany({
      where: { companyId, hechoAt: estado === 'pendientes' ? null : { not: null } },
      orderBy:
        estado === 'pendientes'
          ? [{ programadoAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
          : [{ hechoAt: 'desc' }],
      take: Math.min(Math.max(limite, 1), 300),
      select: {
        id: true,
        tipo: true,
        nota: true,
        programadoAt: true,
        hechoAt: true,
        createdAt: true,
        prospecto: {
          select: {
            id: true,
            nombre: true,
            telefono: true,
            canal: true,
            contacto: { select: { nombre: true, telefono: true, idExterno: true, canal: true } },
          },
        },
      },
    })
  )
  const ahora = Date.now()
  return filas.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    nota: f.nota,
    programadoAt: f.programadoAt,
    hechoAt: f.hechoAt,
    vencido: !f.hechoAt && !!f.programadoAt && f.programadoAt.getTime() < ahora,
    createdAt: f.createdAt,
    prospecto: {
      id: f.prospecto.id,
      canal: (f.prospecto.canal === 'MESSENGER' || f.prospecto.canal === 'INSTAGRAM' ? f.prospecto.canal : 'WHATSAPP') as Canal,
      etiqueta: etiquetaContacto({
        nombre: f.prospecto.nombre ?? f.prospecto.contacto.nombre,
        telefono: f.prospecto.telefono ?? f.prospecto.contacto.telefono,
        idExterno: f.prospecto.contacto.idExterno,
        canal: f.prospecto.contacto.canal,
      }),
    },
  }))
}
