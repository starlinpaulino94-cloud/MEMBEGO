'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

export interface SucursalState {
  error?: string
  success?: boolean
}

export async function crearSucursal(
  _prev: SucursalState,
  formData: FormData
): Promise<SucursalState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const companyId =
    // Superadmin: companyId del form o, si no viene, la empresa ACTIVA del
    // selector del panel. Staff: siempre la de su sesión.
    (await resolveCompanyId(user, formData)) ?? ''

  if (!companyId) return { error: 'Empresa requerida.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  const direccion = String(formData.get('direccion') ?? '').trim() || null
  const telefono = String(formData.get('telefono') ?? '').trim() || null

  if (!nombre) return { error: 'El nombre es obligatorio.' }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.sucursal.create({ data: { companyId, nombre, direccion, telefono } })
    )
    revalidatePath('/admin/sucursales')
    return { success: true }
  } catch (e) {
    console.error('[sucursal]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function actualizarSucursal(
  _prev: SucursalState,
  formData: FormData
): Promise<SucursalState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const direccion = String(formData.get('direccion') ?? '').trim() || null
  const telefono = String(formData.get('telefono') ?? '').trim() || null
  const activa = formData.get('activa') !== 'false'

  if (!id || !nombre) return { error: 'ID y nombre son obligatorios.' }

  try {
    const suc = await sinEmpresa('sucursal por id sin conocer la empresa', (tx) =>
      tx.sucursal.findUnique({ where: { id } })
    )
    if (!suc) return { error: 'Sucursal no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && suc.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }

    await conEmpresa(suc.companyId, (tx) =>
      tx.sucursal.update({ where: { id }, data: { nombre, direccion, telefono, activa } })
    )

    revalidatePath('/admin/sucursales')
    return { success: true }
  } catch (e) {
    console.error('[sucursal]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarSucursal(
  _prev: SucursalState,
  formData: FormData
): Promise<SucursalState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'ID requerido.' }

  try {
    const suc = await sinEmpresa('sucursal por id sin conocer la empresa', (tx) =>
      tx.sucursal.findUnique({ where: { id } })
    )
    if (!suc) return { error: 'Sucursal no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && suc.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }

    const visitas = await conEmpresa(suc.companyId, (tx) =>
      tx.visit.count({ where: { sucursalId: id } })
    )
    if (visitas > 0) {
      await conEmpresa(suc.companyId, (tx) =>
        tx.sucursal.update({ where: { id }, data: { activa: false } })
      )
    } else {
      await conEmpresa(suc.companyId, (tx) => tx.sucursal.delete({ where: { id } }))
    }

    revalidatePath('/admin/sucursales')
    return { success: true }
  } catch (e) {
    console.error('[sucursal]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
