'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { normalizeEngagementConfig } from '@/lib/engagementConfig'

export interface PersonalizacionState {
  error?: string
  success?: boolean
}

export async function guardarPersonalizacion(
  _prev: PersonalizacionState,
  fd: FormData
): Promise<PersonalizacionState> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user, fd)
  if (!companyId) return { error: 'Empresa requerida.' }

  // Los checkboxes solo llegan cuando están marcados → ausencia = desactivado.
  const cfg = normalizeEngagementConfig(
    {
      color: String(fd.get('color') ?? '').trim(),
      gamificacion: fd.get('gamificacion') === 'on',
      pruebaSocial: fd.get('pruebaSocial') === 'on',
      campanas: fd.get('campanas') === 'on',
      carruseles: fd.get('carruseles') === 'on',
      popups: fd.get('popups') === 'on',
    },
    null
  )

  try {
    await conEmpresa(companyId, (tx) =>
      tx.company.update({
        where: { id: companyId },
        data: { engagementConfig: cfg as never },
      })
    )
    revalidatePath('/admin/personalizacion')
    revalidatePath('/mis-membresias')
    return { success: true }
  } catch (e) {
    console.error('[personalizacion] guardar:', e)
    return { error: 'No se pudo guardar la personalización.' }
  }
}
