'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { normalizeEngagementConfig } from '@/lib/engagementConfig'
import { normalizeCompanyBrandColor } from '@/lib/company-branding'

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
  const color = normalizeCompanyBrandColor(fd.get('color'))
  if (!color) return { error: 'Elige un color de marca válido.' }

  const cfg = normalizeEngagementConfig(
    {
      color,
      gamificacion: fd.get('gamificacion') === 'on',
      campanas: fd.get('campanas') === 'on',
      carruseles: fd.get('carruseles') === 'on',
      popups: fd.get('popups') === 'on',
    },
    color
  )

  try {
    await conEmpresa(companyId, (tx) =>
      tx.company.update({
        where: { id: companyId },
        data: { engagementConfig: cfg as never, colorPrimario: color },
      })
    )
    revalidatePath('/admin/personalizacion')
    revalidatePath('/admin/perfil')
    revalidatePath('/mis-membresias')
    updateTag('marketplace')
    return { success: true }
  } catch (e) {
    console.error('[personalizacion] guardar:', e)
    return { error: 'No se pudo guardar la personalización.' }
  }
}
