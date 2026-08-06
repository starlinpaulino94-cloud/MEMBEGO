'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

export interface MetodoPagoState {
  error?: string
  success?: boolean
}

export async function crearMetodoPago(
  _prev: MetodoPagoState,
  formData: FormData
): Promise<MetodoPagoState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const companyId =
    // Superadmin: companyId del form o, si no viene, la empresa ACTIVA del
    // selector del panel. Staff: siempre la de su sesión.
    (await resolveCompanyId(user, formData)) ?? ''

  if (!companyId) return { error: 'Empresa requerida.' }

  // Verify company exists to prevent creating metodoPago for non-existent companies
  const company = await conEmpresa(companyId, (tx) => tx.company.findUnique({ where: { id: companyId } }))
  if (!company) return { error: 'Empresa no encontrada.' }

  const tipo = String(formData.get('tipo') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const titular = String(formData.get('titular') ?? '').trim() || null
  const numeroCuenta = String(formData.get('numeroCuenta') ?? '').trim() || null
  const tipoCuenta = String(formData.get('tipoCuenta') ?? '').trim() || null
  const instrucciones = String(formData.get('instrucciones') ?? '').trim() || null

  if (!tipo || !nombre) return { error: 'Tipo y nombre son obligatorios.' }
  if (tipo !== 'TRANSFERENCIA' && tipo !== 'PRESENCIAL') {
    return { error: 'Tipo inválido.' }
  }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.metodoPago.create({
        data: {
          companyId,
          tipo: tipo as 'TRANSFERENCIA' | 'PRESENCIAL',
          nombre,
          titular,
          numeroCuenta,
          tipoCuenta,
          instrucciones,
        },
      })
    )

    revalidatePath('/admin/metodos-pago')
    revalidatePath('/superadmin/metodos-pago')
    return { success: true }
  } catch (e) {
    console.error('[metodoPago]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function actualizarMetodoPago(
  _prev: MetodoPagoState,
  formData: FormData
): Promise<MetodoPagoState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const titular = String(formData.get('titular') ?? '').trim() || null
  const numeroCuenta = String(formData.get('numeroCuenta') ?? '').trim() || null
  const tipoCuenta = String(formData.get('tipoCuenta') ?? '').trim() || null
  const instrucciones = String(formData.get('instrucciones') ?? '').trim() || null
  const activo = formData.get('activo') !== 'false'

  if (!id || !nombre) return { error: 'ID y nombre son obligatorios.' }

  const method = await sinEmpresa('método de pago por id sin conocer la empresa', (tx) =>
    tx.metodoPago.findUnique({ where: { id } })
  )
  if (!method) return { error: 'Método no encontrado.' }
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    method.companyId !== user.metadata.companyId
  ) {
    return { error: 'No autorizado.' }
  }

  try {
    await conEmpresa(method.companyId, (tx) =>
      tx.metodoPago.update({
        where: { id },
        data: { nombre, titular, numeroCuenta, tipoCuenta, instrucciones, activo },
      })
    )

    revalidatePath('/admin/metodos-pago')
    revalidatePath('/superadmin/metodos-pago')
    return { success: true }
  } catch (e) {
    console.error('[metodoPago]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarMetodoPago(
  _prev: MetodoPagoState,
  formData: FormData
): Promise<MetodoPagoState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'ID requerido.' }

  const method = await sinEmpresa('método de pago por id sin conocer la empresa', (tx) =>
    tx.metodoPago.findUnique({ where: { id } })
  )
  if (!method) return { error: 'Método no encontrado.' }
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    method.companyId !== user.metadata.companyId
  ) {
    return { error: 'No autorizado.' }
  }

  try {
    const count = await conEmpresa(method.companyId, (tx) =>
      tx.membership.count({ where: { metodoPagoId: id } })
    )
    if (count > 0) {
      await conEmpresa(method.companyId, (tx) =>
        tx.metodoPago.update({ where: { id }, data: { activo: false } })
      )
    } else {
      await conEmpresa(method.companyId, (tx) => tx.metodoPago.delete({ where: { id } }))
    }

    revalidatePath('/admin/metodos-pago')
    revalidatePath('/superadmin/metodos-pago')
    return { success: true }
  } catch (e) {
    console.error('[metodoPago]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
