'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser, requireSection } from '@/lib/auth/guards'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

// F4.4: notas internas del CRM. Cada empresa solo ve/edita notas de SUS
// clientes; nunca se muestran al cliente.

export interface CrmState {
  error?: string
  success?: boolean
}

/** Devuelve el cliente solo si pertenece a la empresa del usuario (o superadmin). */
async function clienteDeMiEmpresa(
  clienteId: string,
  user: NonNullable<Awaited<ReturnType<typeof requireAdminUser>>>
) {
  const cliente = await sinEmpresa('cliente por id sin conocer la empresa', (tx) =>
    tx.cliente.findUnique({
      where: { id: clienteId },
      select: { id: true, companyId: true },
    })
  )
  if (!cliente) return null
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    cliente.companyId !== user.metadata.companyId
  ) {
    return null
  }
  return cliente
}

export async function agregarNotaCliente(
  _prev: CrmState,
  formData: FormData
): Promise<CrmState> {
  const user = await requireSection('clientes')
  if (!user) return { error: 'No autorizado.' }

  const clienteId = String(formData.get('clienteId') ?? '').trim()
  const texto = String(formData.get('texto') ?? '').trim()
  if (!clienteId) return { error: 'Cliente no especificado.' }
  if (!texto) return { error: 'Escribe la nota antes de guardar.' }
  if (texto.length > 2000) return { error: 'La nota es demasiado larga (máx 2000).' }

  try {
    const cliente = await clienteDeMiEmpresa(clienteId, user)
    if (!cliente) return { error: 'Cliente no encontrado.' }

    await conEmpresa(cliente.companyId, (tx) =>
      tx.clienteNota.create({
        data: {
          clienteId,
          autorId: user.metadata.dbUserId || null,
          texto,
        },
      })
    )

    revalidatePath(`/admin/clientes/${clienteId}`)
    return { success: true }
  } catch (e) {
    console.error('[crm] agregarNota', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarNotaCliente(
  _prev: CrmState,
  formData: FormData
): Promise<CrmState> {
  const user = await requireSection('clientes')
  if (!user) return { error: 'No autorizado.' }

  const notaId = String(formData.get('notaId') ?? '').trim()
  if (!notaId) return { error: 'Nota no especificada.' }

  try {
    const nota = await sinEmpresa('nota por id sin conocer la empresa', (tx) =>
      tx.clienteNota.findUnique({
        where: { id: notaId },
        select: { id: true, clienteId: true, cliente: { select: { companyId: true } } },
      })
    )
    if (!nota) return { error: 'Nota no encontrada.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      nota.cliente.companyId !== user.metadata.companyId
    ) {
      return { error: 'No autorizado.' }
    }

    await conEmpresa(nota.cliente.companyId, (tx) =>
      tx.clienteNota.delete({ where: { id: notaId } })
    )

    revalidatePath(`/admin/clientes/${nota.clienteId}`)
    return { success: true }
  } catch (e) {
    console.error('[crm] eliminarNota', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
