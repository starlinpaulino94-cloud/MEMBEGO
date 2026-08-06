'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

export interface ReglaRecompensaState {
  error?: string
  success?: boolean
}

export async function crearReglaRecompensa(
  _prev: ReglaRecompensaState,
  formData: FormData
): Promise<ReglaRecompensaState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const companyId =
    // Superadmin: companyId del form o, si no viene, la empresa ACTIVA del
    // selector del panel. Staff: siempre la de su sesión.
    (await resolveCompanyId(user, formData)) ?? ''
  if (!companyId) return { error: 'Empresa requerida.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  const valorCondicion = Number(formData.get('valorCondicion') ?? '')
  const tipoRecompensa = String(formData.get('tipoRecompensa') ?? '').trim()
  const valorRecompensa = Number(formData.get('valorRecompensa') ?? '')

  if (!nombre || !Number.isFinite(valorCondicion) || valorCondicion < 1) {
    return { error: 'Completa el nombre y la cantidad de referidos requerida.' }
  }
  if (!['LAVADOS_GRATIS', 'DESCUENTO_PORCENTAJE', 'DESCUENTO_MONTO'].includes(tipoRecompensa)) {
    return { error: 'Tipo de recompensa inválido.' }
  }
  if (!Number.isFinite(valorRecompensa) || valorRecompensa <= 0) {
    return { error: 'El valor de la recompensa debe ser mayor a cero.' }
  }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.reglaRecompensa.create({
        data: {
          companyId,
          nombre,
          condicion: 'N_REFERIDOS_COMPLETADOS',
          valorCondicion,
          tipoRecompensa: tipoRecompensa as 'LAVADOS_GRATIS' | 'DESCUENTO_PORCENTAJE' | 'DESCUENTO_MONTO',
          valorRecompensa,
        },
      })
    )

    revalidatePath('/admin/referidos')
    return { success: true }
  } catch (e) {
    console.error('[recompensa]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function actualizarReglaRecompensa(
  _prev: ReglaRecompensaState,
  formData: FormData
): Promise<ReglaRecompensaState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  const activo = formData.get('activo') !== 'false'

  if (!id) return { error: 'ID requerido.' }

  try {
    const regla = await sinEmpresa('regla por id sin conocer la empresa', (tx) =>
      tx.reglaRecompensa.findUnique({ where: { id } })
    )
    if (!regla) return { error: 'Regla no encontrada.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      regla.companyId !== user.metadata.companyId
    ) {
      return { error: 'No autorizado.' }
    }

    await conEmpresa(regla.companyId, (tx) =>
      tx.reglaRecompensa.update({ where: { id }, data: { activo } })
    )

    revalidatePath('/admin/referidos')
    return { success: true }
  } catch (e) {
    console.error('[recompensa]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarReglaRecompensa(
  _prev: ReglaRecompensaState,
  formData: FormData
): Promise<ReglaRecompensaState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'ID requerido.' }

  try {
    const regla = await sinEmpresa('regla por id sin conocer la empresa', (tx) =>
      tx.reglaRecompensa.findUnique({ where: { id } })
    )
    if (!regla) return { error: 'Regla no encontrada.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      regla.companyId !== user.metadata.companyId
    ) {
      return { error: 'No autorizado.' }
    }

    await conEmpresa(regla.companyId, (tx) => tx.reglaRecompensa.delete({ where: { id } }))

    revalidatePath('/admin/referidos')
    return { success: true }
  } catch (e) {
    console.error('[recompensa]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
