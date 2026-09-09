'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import type { NotaTipo } from './types'

// ── State ──────────────────────────────────────────────────────────────────

export interface NotaActionState {
  error?: string
  success?: boolean
  notaId?: string
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Crea una nota de seguimiento para un lead.
 */
export async function createNota(
  _prev: NotaActionState,
  formData: FormData
): Promise<NotaActionState> {
  const user = await requireSection('clientes', 'nota_crear')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const leadId = String(formData.get('leadId') ?? '').trim()
  if (!leadId) return { error: 'Lead no especificado.' }

  // Verificar que el lead pertenece a la empresa
  const lead = await sinEmpresa('nota: verificar lead', (tx) =>
    tx.lead.findUnique({
      where: { id: leadId },
      select: { id: true, companyId: true },
    })
  )
  if (!lead || lead.companyId !== companyId) {
    return { error: 'Lead no encontrado.' }
  }

  const contenido = String(formData.get('contenido') ?? '').trim()
  if (!contenido) return { error: 'Escribe la nota antes de guardar.' }
  if (contenido.length > 5000) return { error: 'La nota es demasiado larga (máx 5000).' }

  const tipo = String(formData.get('tipo') ?? 'NOTA') as NotaTipo
  const fechaProximaRaw = String(formData.get('fechaProxima') ?? '').trim()
  const fechaProxima = fechaProximaRaw ? new Date(fechaProximaRaw) : null

  try {
    const nota = await conEmpresa(companyId, (tx) =>
      tx.notaSeguimiento.create({
        data: {
          leadId,
          userId: user.metadata.dbUserId || '',
          contenido,
          tipo,
          fechaProxima,
        },
      })
    )

    revalidatePath(`/admin/crm/${leadId}`)
    return { success: true, notaId: nota.id }
  } catch (e) {
    console.error('[crm] createNota', e)
    return { error: 'Ocurrió un error al crear la nota.' }
  }
}

/**
 * Elimina una nota de seguimiento.
 */
export async function deleteNota(
  _prev: NotaActionState,
  formData: FormData
): Promise<NotaActionState> {
  const user = await requireSection('clientes', 'nota_eliminar')
  if (!user) return { error: 'No autorizado.' }

  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Empresa no especificada.' }

  const notaId = String(formData.get('notaId') ?? '').trim()
  if (!notaId) return { error: 'Nota no especificada.' }

  // Verificar que la nota pertenece a un lead de la empresa
  const nota = await sinEmpresa('nota: verificar pertenencia', (tx) =>
    tx.notaSeguimiento.findUnique({
      where: { id: notaId },
      select: {
        id: true,
        leadId: true,
        lead: { select: { companyId: true } },
      },
    })
  )
  if (!nota || nota.lead.companyId !== companyId) {
    return { error: 'Nota no encontrada.' }
  }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.notaSeguimiento.delete({ where: { id: notaId } })
    )

    revalidatePath(`/admin/crm/${nota.leadId}`)
    return { success: true, notaId }
  } catch (e) {
    console.error('[crm] deleteNota', e)
    return { error: 'Ocurrió un error al eliminar la nota.' }
  }
}
