'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'

async function requireCliente() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) return null
  return user
}

export interface ProfileState {
  error?: string
  success?: boolean
}

export async function actualizarPerfil(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await requireCliente()
  if (!user) return { error: 'No autorizado.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim() || null
  const avatarUrl = String(formData.get('avatarUrl') ?? '').trim() || null
  const fechaRaw = String(formData.get('fechaNacimiento') ?? '').trim()
  const ciudad = String(formData.get('ciudad') ?? '').trim() || null
  const genero = String(formData.get('genero') ?? '').trim() || null
  const notifPromos = formData.getAll('notifPromos').at(-1) === 'on'
  const notifRecordatorios = formData.getAll('notifRecordatorios').at(-1) === 'on'

  if (!nombre) return { error: 'El nombre no puede estar vacío.' }

  // Fecha de nacimiento opcional: vacío = limpiar; con valor debe ser válida y
  // no futura.
  let fechaNacimiento: Date | null = null
  if (fechaRaw) {
    const d = new Date(fechaRaw)
    if (Number.isNaN(d.getTime()) || d > new Date()) {
      return { error: 'Fecha de nacimiento inválida.' }
    }
    fechaNacimiento = d
  }

  try {
    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa requerida.' }
    const clienteId = user.metadata.clienteId!
    await conEmpresa(companyId, (tx) =>
      tx.cliente.update({
        where: { id: clienteId },
        data: {
          nombre,
          telefono,
          fechaNacimiento,
          ciudad,
          genero,
          notifPromos,
          notifRecordatorios,
          ...(avatarUrl !== null ? { avatarUrl } : {}),
        },
      })
    )
    revalidatePath('/cliente/perfil')
    revalidatePath('/cliente/dashboard')
    revalidatePath('/mis-membresias')
    revalidatePath('/cliente/ayuda')
    return { success: true }
  } catch (e) {
    console.error('[profile]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function agregarVehiculo(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await requireCliente()
  if (!user) return { error: 'No autorizado.' }

  const marca = String(formData.get('marca') ?? '').trim()
  const modelo = String(formData.get('modelo') ?? '').trim()
  const anioRaw = String(formData.get('anio') ?? '').trim()
  const color = String(formData.get('color') ?? '').trim()
  const placa = String(formData.get('placa') ?? '').trim() || null

  if (!marca || !modelo || !color) return { error: 'Marca, modelo y color son obligatorios.' }

  const anio = Number(anioRaw)
  if (!anio || anio < 1900 || anio > new Date().getFullYear() + 1) {
    return { error: 'Año inválido.' }
  }

  try {
    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa requerida.' }
    const clienteId = user.metadata.clienteId!
    await conEmpresa(companyId, (tx) =>
      tx.vehiculo.create({
        data: { clienteId, marca, modelo, anio, color, placa },
      })
    )
    revalidatePath('/cliente/perfil')
    revalidatePath('/cliente/dashboard')
    return { success: true }
  } catch (e) {
    console.error('[profile]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarVehiculo(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await requireCliente()
  if (!user) return { error: 'No autorizado.' }

  const vehiculoId = String(formData.get('vehiculoId') ?? '').trim()
  if (!vehiculoId) return { error: 'Vehículo no especificado.' }

  try {
    const v = await sinEmpresa('cliente: buscar mi vehículo', (tx) =>
      tx.vehiculo.findUnique({
        where: { id: vehiculoId },
        select: { id: true, clienteId: true, cliente: { select: { companyId: true } } },
      })
    )
    const clienteId = user.metadata.clienteId!
    if (!v || v.clienteId !== clienteId) return { error: 'No autorizado.' }
    const companyId = v.cliente.companyId

    const visitas = await conEmpresa(companyId, (tx) => tx.visit.count({ where: { vehiculoId } }))
    if (visitas > 0) return { error: 'No se puede eliminar: tiene visitas asociadas.' }

    await conEmpresa(companyId, (tx) => tx.vehiculo.delete({ where: { id: vehiculoId } }))

    revalidatePath('/cliente/perfil')
    revalidatePath('/cliente/dashboard')
    return { success: true }
  } catch (e) {
    console.error('[profile]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
