import 'server-only'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { ventanaAbierta, type Canal } from '@/modules/mensajeria/nucleo'

/**
 * LO QUE LEE LA BANDEJA (Meta · Fase 5).
 *
 * Solo lecturas y el cambio de estado de una conversación. Todo pasa por
 * `conEmpresa` y todo `where` lleva `companyId`: la bandeja de una empresa
 * no puede ver ni un hilo de otra, ni por id adivinado ni por búsqueda.
 * Nada de lo que sale de aquí lleva tokens ni secretos: son conversaciones,
 * contactos y mensajes, tal cual están en la base.
 */

const CANALES_BANDEJA = ['WHATSAPP', 'MESSENGER', 'INSTAGRAM'] as const satisfies readonly Canal[]

export function esCanal(v: unknown): v is Canal {
  return typeof v === 'string' && (CANALES_BANDEJA as readonly string[]).includes(v)
}

export type EstadoConversacion = 'ABIERTA' | 'CERRADA'

export interface FiltroBandeja {
  canal?: Canal | null
  estado?: EstadoConversacion
  busqueda?: string | null
}

export interface ContactoVista {
  id: string
  nombre: string | null
  telefono: string | null
  idExterno: string
  clienteId: string | null
}

export interface ConversacionVista {
  id: string
  canal: Canal
  estado: string
  asignadoAId: string | null
  contacto: ContactoVista
  activo: { tipo: string; nombre: string | null }
  ultimoTexto: string | null
  ultimoMensajeAt: Date | null
  ultimoEntranteAt: Date | null
  noLeidos: number
  /** ¿Se puede escribir texto libre ahora mismo? (24 h desde el último entrante.) */
  ventanaAbierta: boolean
}

const SELECT_CONVERSACION = {
  id: true,
  canal: true,
  estado: true,
  asignadoAId: true,
  ultimoTexto: true,
  ultimoMensajeAt: true,
  ultimoEntranteAt: true,
  noLeidos: true,
  contacto: { select: { id: true, nombre: true, telefono: true, idExterno: true, clienteId: true } },
  activo: { select: { tipo: true, nombre: true } },
} satisfies Prisma.ConversacionSelect

type FilaConversacion = Prisma.ConversacionGetPayload<{ select: typeof SELECT_CONVERSACION }>

function aVista(f: FilaConversacion): ConversacionVista {
  return {
    id: f.id,
    canal: esCanal(f.canal) ? f.canal : 'WHATSAPP',
    estado: f.estado,
    asignadoAId: f.asignadoAId,
    contacto: f.contacto,
    activo: f.activo,
    ultimoTexto: f.ultimoTexto,
    ultimoMensajeAt: f.ultimoMensajeAt,
    ultimoEntranteAt: f.ultimoEntranteAt,
    noLeidos: f.noLeidos,
    ventanaAbierta: ventanaAbierta(f.ultimoEntranteAt),
  }
}

export async function listarConversaciones(
  companyId: string,
  filtro: FiltroBandeja = {},
  limite = 100
): Promise<ConversacionVista[]> {
  const q = filtro.busqueda?.trim().slice(0, 80) || null
  const filas = await conEmpresa(companyId, (tx) =>
    tx.conversacion.findMany({
      where: {
        companyId,
        estado: filtro.estado ?? 'ABIERTA',
        ...(filtro.canal ? { canal: filtro.canal } : {}),
        ...(q
          ? {
              contacto: {
                OR: [
                  { nombre: { contains: q, mode: 'insensitive' } },
                  { telefono: { contains: q.replace(/\D/g, '') || q } },
                  { idExterno: { contains: q } },
                ],
              },
            }
          : {}),
      },
      orderBy: [{ ultimoMensajeAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: Math.min(Math.max(limite, 1), 200),
      select: SELECT_CONVERSACION,
    })
  )
  return filas.map(aVista)
}

export interface MensajeVista {
  id: string
  direccion: 'ENTRANTE' | 'SALIENTE'
  tipo: string
  texto: string | null
  estado: string
  errorCodigo: number | null
  errorDetalle: string | null
  plantilla: { nombre?: string; idioma?: string } | null
  enviadoPorId: string | null
  origen: string | null
  timestamp: Date
}

export async function hiloDeConversacion(
  companyId: string,
  conversacionId: string,
  limite = 200
): Promise<{ conversacion: ConversacionVista; mensajes: MensajeVista[] } | null> {
  return conEmpresa(companyId, async (tx) => {
    const fila = await tx.conversacion.findFirst({
      where: { id: conversacionId, companyId },
      select: SELECT_CONVERSACION,
    })
    if (!fila) return null
    const mensajes = await tx.mensaje.findMany({
      where: { conversacionId: fila.id, companyId },
      orderBy: { timestamp: 'desc' },
      take: Math.min(Math.max(limite, 1), 500),
      select: {
        id: true,
        direccion: true,
        tipo: true,
        texto: true,
        estado: true,
        errorCodigo: true,
        errorDetalle: true,
        plantilla: true,
        enviadoPorId: true,
        origen: true,
        timestamp: true,
      },
    })
    return {
      conversacion: aVista(fila),
      mensajes: mensajes.reverse().map((m) => ({
        ...m,
        direccion: m.direccion === 'SALIENTE' ? 'SALIENTE' : 'ENTRANTE',
        plantilla:
          m.plantilla && typeof m.plantilla === 'object' && !Array.isArray(m.plantilla)
            ? (m.plantilla as { nombre?: string; idioma?: string })
            : null,
      })),
    }
  })
}

export type ResumenBandeja = Record<Canal, { abiertas: number; noLeidos: number }>

/** Cuántas conversaciones abiertas y cuántos mensajes sin leer, por canal. */
export async function resumenPorCanal(companyId: string): Promise<ResumenBandeja> {
  const grupos = await conEmpresa(companyId, (tx) =>
    tx.conversacion.groupBy({
      by: ['canal'],
      where: { companyId, estado: 'ABIERTA' },
      _count: { _all: true },
      _sum: { noLeidos: true },
    })
  )
  const resumen: ResumenBandeja = {
    WHATSAPP: { abiertas: 0, noLeidos: 0 },
    MESSENGER: { abiertas: 0, noLeidos: 0 },
    INSTAGRAM: { abiertas: 0, noLeidos: 0 },
  }
  for (const g of grupos) {
    if (!esCanal(g.canal)) continue
    resumen[g.canal] = { abiertas: g._count._all, noLeidos: g._sum.noLeidos ?? 0 }
  }
  return resumen
}

/** Cerrar o reabrir. Devuelve false si la conversación no es de la empresa. */
export async function cambiarEstadoConversacion(
  companyId: string,
  conversacionId: string,
  estado: EstadoConversacion
): Promise<boolean> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.conversacion.updateMany({ where: { id: conversacionId, companyId }, data: { estado } })
  )
  return r.count > 0
}
