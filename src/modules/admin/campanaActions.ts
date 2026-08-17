'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

// F4.6: CRUD de campañas. Cada empresa administra solo las suyas; al
// eliminar, las promociones/publicaciones quedan sin campaña (SetNull).

export interface CampanaState {
  error?: string
  success?: boolean
}

function parseCampana(formData: FormData): { error: string } | {
  nombre: string
  descripcion: string | null
  fechaInicio: Date | null
  fechaFin: Date | null
} {
  const nombre = String(formData.get('nombre') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim() || null
  const inicioRaw = String(formData.get('fechaInicio') ?? '').trim()
  const finRaw = String(formData.get('fechaFin') ?? '').trim()
  const fechaInicio = inicioRaw ? new Date(inicioRaw) : null
  const fechaFin = finRaw ? new Date(finRaw) : null

  if (!nombre) return { error: 'El nombre de la campaña es obligatorio.' }
  if (fechaInicio && fechaFin && fechaFin <= fechaInicio) {
    return { error: 'La fecha de fin debe ser posterior a la de inicio.' }
  }
  return { nombre, descripcion, fechaInicio, fechaFin }
}

function revalidateCampanas() {
  revalidatePath('/admin/campanas')
  revalidatePath('/admin/promociones')
  revalidatePath('/admin/publicaciones')
}

async function campanaDeMiEmpresa(
  id: string,
  user: NonNullable<Awaited<ReturnType<typeof requireAdminUser>>>
) {
  const campana = await sinEmpresa('campaña por id sin conocer la empresa', (tx) =>
    tx.campana.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    })
  )
  if (!campana) return null
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    campana.companyId !== user.metadata.companyId
  ) {
    return null
  }
  return campana
}

export async function crearCampana(
  _prev: CampanaState,
  formData: FormData
): Promise<CampanaState> {
  const user = await requireSection('campanas', 'crear')
  if (!user) return { error: 'No autorizado.' }

  const companyId = await resolveCompanyId(user, formData)
  if (!companyId) return { error: 'Esta función es del panel de empresa.' }

  const parsed = parseCampana(formData)
  if ('error' in parsed) return { error: parsed.error }

  try {
    await conEmpresa(companyId, (tx) => tx.campana.create({ data: { companyId, ...parsed } }))
    revalidateCampanas()
    return { success: true }
  } catch (e) {
    console.error('[campana] crear', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function actualizarCampana(
  _prev: CampanaState,
  formData: FormData
): Promise<CampanaState> {
  const user = await requireSection('campanas', 'editar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Campaña no especificada.' }

  const parsed = parseCampana(formData)
  if ('error' in parsed) return { error: parsed.error }

  const activo = String(formData.get('activo') ?? 'true') === 'true'

  try {
    const campana = await campanaDeMiEmpresa(id, user)
    if (!campana) return { error: 'Campaña no encontrada.' }

    await conEmpresa(campana.companyId, (tx) =>
      tx.campana.update({
        where: { id },
        data: { ...parsed, activo },
      })
    )
    revalidateCampanas()
    return { success: true }
  } catch (e) {
    console.error('[campana] actualizar', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarCampana(
  _prev: CampanaState,
  formData: FormData
): Promise<CampanaState> {
  const user = await requireSection('campanas', 'eliminar')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Campaña no especificada.' }

  try {
    const campana = await campanaDeMiEmpresa(id, user)
    if (!campana) return { error: 'Campaña no encontrada.' }

    // SetNull en las FKs: promos y publicaciones quedan sin campaña.
    await conEmpresa(campana.companyId, (tx) => tx.campana.delete({ where: { id } }))
    revalidateCampanas()
    return { success: true }
  } catch (e) {
    console.error('[campana] eliminar', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
