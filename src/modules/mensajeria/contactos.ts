import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { candidatosTelefono, type Canal } from '@/modules/mensajeria/nucleo'

/**
 * CONTACTOS DE MENSAJERÍA (Meta · Fase 2).
 *
 * Un contacto es la persona al otro lado de un canal, POR EMPRESA: el mismo
 * wa_id en dos negocios son dos contactos, con dos historiales que no se
 * tocan. Se enlaza a un `Cliente` cuando el teléfono coincide con alguna de
 * las formas habituales de escribirlo; si no, queda sin enlazar y se enlaza
 * a mano desde la bandeja. Nunca se adivina por nombre.
 */
export async function resolverContacto(input: {
  companyId: string
  canal: Canal
  idExterno: string
  nombre?: string | null
}): Promise<{ id: string; clienteId: string | null; nuevo: boolean }> {
  return conEmpresa(input.companyId, async (tx) => {
    const existente = await tx.contactoMensajeria.findUnique({
      where: {
        companyId_canal_idExterno: {
          companyId: input.companyId,
          canal: input.canal,
          idExterno: input.idExterno,
        },
      },
      select: { id: true, clienteId: true, nombre: true },
    })

    if (existente) {
      // El nombre de perfil puede cambiar; el enlace al cliente no se toca aquí.
      if (input.nombre && input.nombre !== existente.nombre) {
        await tx.contactoMensajeria.update({ where: { id: existente.id }, data: { nombre: input.nombre } })
      }
      return { id: existente.id, clienteId: existente.clienteId, nuevo: false }
    }

    let clienteId: string | null = null
    let telefono: string | null = null
    if (input.canal === 'WHATSAPP') {
      telefono = input.idExterno
      const candidatos = candidatosTelefono(input.idExterno)
      if (candidatos.length > 0) {
        const cliente = await tx.cliente.findFirst({
          where: { companyId: input.companyId, telefono: { in: candidatos } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        })
        clienteId = cliente?.id ?? null
      }
    }

    const creado = await tx.contactoMensajeria.create({
      data: {
        companyId: input.companyId,
        canal: input.canal,
        idExterno: input.idExterno,
        nombre: input.nombre ?? null,
        telefono,
        clienteId,
      },
      select: { id: true },
    })
    return { id: creado.id, clienteId, nuevo: true }
  })
}

/** Enlazar (o desenlazar) un contacto con un cliente, a mano. */
export async function enlazarContactoConCliente(input: {
  companyId: string
  contactoId: string
  clienteId: string | null
}): Promise<boolean> {
  return conEmpresa(input.companyId, async (tx) => {
    if (input.clienteId) {
      const cliente = await tx.cliente.findFirst({
        where: { id: input.clienteId, companyId: input.companyId },
        select: { id: true },
      })
      if (!cliente) return false
    }
    const r = await tx.contactoMensajeria.updateMany({
      where: { id: input.contactoId, companyId: input.companyId },
      data: { clienteId: input.clienteId },
    })
    return r.count === 1
  })
}
