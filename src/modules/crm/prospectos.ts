import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { altaCliente } from '@/modules/plataforma/alta-cliente'
import { enlazarContactoConCliente } from '@/modules/mensajeria/contactos'
import { etiquetaContacto, type Canal } from '@/modules/mensajeria/nucleo'
import { ETAPAS_ABIERTAS, esEtapa, naceProspecto, type Etapa } from '@/modules/crm/nucleo'

/**
 * PROSPECTOS (Meta · Fase 6).
 *
 * Nacen solos, del primer mensaje entrante de quien no es cliente; se
 * trabajan por etapas; se convierten en cliente con el alta de siempre
 * (`altaCliente`, que ya evita fichas duplicadas por teléfono o correo) y el
 * contacto de mensajería queda enlazado a esa ficha, así que su bandeja pasa
 * a enseñar «Ver ficha del cliente» y sus próximos mensajes ya no crean
 * prospectos.
 *
 * Todo pasa por `conEmpresa` y todo `where` lleva `companyId`.
 */

export async function registrarProspectoDesdeEntrante(input: {
  companyId: string
  contacto: { id: string; clienteId: string | null }
  conversacionId: string
  canal: Canal
  nombre: string | null
  telefono: string | null
  timestamp: Date
}): Promise<{ id: string; creado: boolean } | null> {
  if (!naceProspecto(input.contacto)) return null
  return conEmpresa(input.companyId, async (tx) => {
    const existente = await tx.prospecto.findFirst({
      where: { contactoId: input.contacto.id, companyId: input.companyId },
      select: { id: true, ultimaActividadAt: true, nombre: true },
    })
    if (existente) {
      await tx.prospecto.update({
        where: { id: existente.id, companyId: input.companyId },
        data: {
          ...(input.timestamp > existente.ultimaActividadAt ? { ultimaActividadAt: input.timestamp } : {}),
          ...(!existente.nombre && input.nombre ? { nombre: input.nombre } : {}),
        },
      })
      return { id: existente.id, creado: false }
    }
    try {
      const creado = await tx.prospecto.create({
        data: {
          companyId: input.companyId,
          contactoId: input.contacto.id,
          conversacionId: input.conversacionId,
          canal: input.canal,
          nombre: input.nombre,
          telefono: input.telefono,
          primerMensajeAt: input.timestamp,
          ultimaActividadAt: input.timestamp,
        },
        select: { id: true },
      })
      return { id: creado.id, creado: true }
    } catch (e) {
      // Dos entrantes del mismo contacto procesados a la vez: el segundo
      // choca con el UNIQUE y se queda con el que ganó.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const ganador = await tx.prospecto.findFirst({
          where: { contactoId: input.contacto.id, companyId: input.companyId },
          select: { id: true },
        })
        if (ganador) return { id: ganador.id, creado: false }
      }
      throw e
    }
  })
}

export interface ProspectoVista {
  id: string
  etiqueta: string
  canal: Canal
  etapa: Etapa
  telefono: string | null
  clienteId: string | null
  conversacionId: string | null
  primerMensajeAt: Date
  ultimaActividadAt: Date
  seguimientosPendientes: number
}

const SELECT_PROSPECTO = {
  id: true,
  canal: true,
  etapa: true,
  nombre: true,
  telefono: true,
  clienteId: true,
  conversacionId: true,
  primerMensajeAt: true,
  ultimaActividadAt: true,
  contacto: { select: { nombre: true, telefono: true, idExterno: true, canal: true } },
  _count: { select: { seguimientos: { where: { hechoAt: null } } } },
} satisfies Prisma.ProspectoSelect

type FilaProspecto = Prisma.ProspectoGetPayload<{ select: typeof SELECT_PROSPECTO }>

function aVista(f: FilaProspecto): ProspectoVista {
  const canal = (f.canal === 'MESSENGER' || f.canal === 'INSTAGRAM' ? f.canal : 'WHATSAPP') as Canal
  return {
    id: f.id,
    etiqueta: etiquetaContacto({
      nombre: f.nombre ?? f.contacto.nombre,
      telefono: f.telefono ?? f.contacto.telefono,
      idExterno: f.contacto.idExterno,
      canal: f.contacto.canal,
    }),
    canal,
    etapa: esEtapa(f.etapa) ? f.etapa : 'nuevo',
    telefono: f.telefono ?? f.contacto.telefono,
    clienteId: f.clienteId,
    conversacionId: f.conversacionId,
    primerMensajeAt: f.primerMensajeAt,
    ultimaActividadAt: f.ultimaActividadAt,
    seguimientosPendientes: f._count.seguimientos,
  }
}

export async function listarProspectos(
  companyId: string,
  filtro: { canal?: Canal | null; etapa?: Etapa | null } = {},
  limite = 300
): Promise<ProspectoVista[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.prospecto.findMany({
      where: {
        companyId,
        ...(filtro.canal ? { canal: filtro.canal } : {}),
        ...(filtro.etapa ? { etapa: filtro.etapa } : {}),
      },
      orderBy: { ultimaActividadAt: 'desc' },
      take: Math.min(Math.max(limite, 1), 500),
      select: SELECT_PROSPECTO,
    })
  )
  return filas.map(aVista)
}

export interface SeguimientoVista {
  id: string
  tipo: string
  nota: string
  programadoAt: Date | null
  hechoAt: Date | null
  createdAt: Date
}

export async function prospectoDe(
  companyId: string,
  prospectoId: string
): Promise<(ProspectoVista & { notas: string | null; seguimientos: SeguimientoVista[] }) | null> {
  const fila = await conEmpresa(companyId, (tx) =>
    tx.prospecto.findFirst({
      where: { id: prospectoId, companyId },
      select: {
        ...SELECT_PROSPECTO,
        notas: true,
        seguimientos: {
          orderBy: [{ hechoAt: { sort: 'asc', nulls: 'first' } }, { programadoAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
          select: { id: true, tipo: true, nota: true, programadoAt: true, hechoAt: true, createdAt: true },
        },
      },
    })
  )
  if (!fila) return null
  return { ...aVista(fila), notas: fila.notas, seguimientos: fila.seguimientos }
}

export async function cambiarEtapa(companyId: string, prospectoId: string, etapa: Etapa): Promise<boolean> {
  const ahora = new Date()
  const cerrada = !ETAPAS_ABIERTAS.includes(etapa)
  const r = await conEmpresa(companyId, (tx) =>
    tx.prospecto.updateMany({
      where: { id: prospectoId, companyId },
      data: { etapa, etapaCambiadaAt: ahora, ultimaActividadAt: ahora, cerradoAt: cerrada ? ahora : null },
    })
  )
  return r.count > 0
}

export async function guardarNotas(companyId: string, prospectoId: string, notas: string): Promise<boolean> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.prospecto.updateMany({ where: { id: prospectoId, companyId }, data: { notas: notas || null } })
  )
  return r.count > 0
}

export type ResultadoConversion =
  | { ok: true; clienteId: string; creado: boolean }
  | { ok: false; error: string }

/**
 * Convertir en cliente: alta con la ficha de siempre (que reutiliza una
 * existente por teléfono o correo), enlace del contacto y cierre del prospecto.
 */
export async function convertirEnCliente(
  companyId: string,
  prospectoId: string,
  datos: { nombre: string; telefono: string | null; email: string | null }
): Promise<ResultadoConversion> {
  const p = await conEmpresa(companyId, (tx) =>
    tx.prospecto.findFirst({
      where: { id: prospectoId, companyId },
      select: { id: true, contactoId: true, clienteId: true, canal: true },
    })
  )
  if (!p) return { ok: false, error: 'Este prospecto ya no existe.' }
  if (p.clienteId) return { ok: true, clienteId: p.clienteId, creado: false }

  const alta = await altaCliente(companyId, datos, `crm:${p.canal.toLowerCase()}`)
  if ('error' in alta) return { ok: false, error: alta.error }

  await enlazarContactoConCliente({ companyId, contactoId: p.contactoId, clienteId: alta.cliente.id })
  const ahora = new Date()
  await conEmpresa(companyId, (tx) =>
    tx.prospecto.updateMany({
      where: { id: p.id, companyId },
      data: { clienteId: alta.cliente.id, etapa: 'cerrado', etapaCambiadaAt: ahora, ultimaActividadAt: ahora, cerradoAt: ahora },
    })
  )
  return { ok: true, clienteId: alta.cliente.id, creado: alta.creado }
}

/** Los prospectos en juego, para elegir uno en el formulario de seguimientos. */
export async function prospectosParaElegir(companyId: string): Promise<{ id: string; etiqueta: string }[]> {
  const abiertos = await listarProspectos(companyId, {}, 500)
  return abiertos.filter((p) => ETAPAS_ABIERTAS.includes(p.etapa)).map((p) => ({ id: p.id, etiqueta: p.etiqueta }))
}
