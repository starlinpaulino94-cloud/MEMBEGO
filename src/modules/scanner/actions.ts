'use server'

/**
 * Fase E7 · Preferencia de escáner de la empresa (cámara vs lector físico).
 * Solo el valor PREDETERMINADO; el operador puede cambiarlo en pantalla sin
 * recargar (persistencia por usuario en el cliente).
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireAdminUser } from '@/lib/auth/guards'

const MODOS = ['camara', 'lector'] as const
export type EscanerModo = (typeof MODOS)[number]

export interface EscanerModoState {
  error?: string
  success?: boolean
}

export async function guardarEscanerModoEmpresa(modo: string): Promise<EscanerModoState> {
  try {
    const user = await requireAdminUser()
    if (!user) return { error: 'No autorizado.' }
    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Tu cuenta no tiene una empresa asignada.' }
    if (!(MODOS as readonly string[]).includes(modo)) return { error: 'Modo no válido.' }

    await conEmpresa(companyId, (tx) =>
      tx.company.update({
        where: { id: companyId },
        data: { escanerModo: modo },
      })
    )

    revalidatePath('/admin/scanner')
    revalidatePath('/empleado/scanner')
    return { success: true }
  } catch (e) {
    console.error('[scanner] guardarEscanerModoEmpresa:', e)
    return { error: 'No se pudo guardar la preferencia.' }
  }
}
