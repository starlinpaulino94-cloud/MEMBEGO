'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { misClienteIds, propagarDatosPersonales } from '@/modules/cliente/afiliacion'

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

    /**
     * UNA PERSONA, UN PERFIL — aunque por dentro sean N fichas.
     *
     * ────────────────────────────────────────────────────────────────────────
     * LO QUE PASABA
     *
     * Este formulario guardaba solo en la ficha ACTIVA. Su nombre, su
     * teléfono, su cumpleaños y su foto son de la PERSONA, pero cada negocio
     * guardaba su propia copia — así que al corregir un teléfono mal escrito,
     * la corrección llegaba a un negocio y no a los otros dos.
     *
     * Y nadie se enteraba: la pantalla enseña la ficha activa, así que después
     * de guardar todo parecía correcto. El número viejo seguía vivo donde no
     * se miraba, que es exactamente donde importa cuando llaman para avisar de
     * que el pedido está listo.
     *
     * ────────────────────────────────────────────────────────────────────────
     * QUÉ SE PROPAGA Y QUÉ NO
     *
     * Se propaga lo que es de la persona: nombre, teléfono, fecha de
     * nacimiento, ciudad, género, foto y sus preferencias de aviso.
     *
     * NO se toca nada de la relación comercial —membresías, beneficios,
     * historial, notas del negocio—: eso es de cada empresa y no es suyo para
     * copiarlo de un lado a otro.
     *
     * Cada ficha se escribe con `conEmpresa` de SU empresa, no con una lectura
     * omnisciente: el aislamiento sigue puesto en cada escritura.
     */
    const escritas = await propagarDatosPersonales(user.supabaseId, {
      nombre,
      telefono,
      fechaNacimiento,
      ciudad,
      genero,
      notifPromos,
      notifRecordatorios,
      ...(avatarUrl !== null ? { avatarUrl } : {}),
    })
    if (escritas === 0) return { error: 'No se pudo guardar. Intenta de nuevo.' }
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
        select: {
          id: true,
          clienteId: true,
          esPrincipal: true,
          cliente: { select: { companyId: true } },
        },
      })
    )
    /**
     * Contra TODAS sus fichas: la lista de vehículos enseña los de todos sus
     * negocios, así que comprobar la ficha ACTIVA dejaba el botón de borrar
     * contestando «No autorizado» sobre un coche suyo.
     *
     * `clienteId` pasa a ser el del VEHÍCULO —no el de la sesión—, que es el
     * que hace falta más abajo para elegir el sucesor como principal: con el
     * de la sesión, borrar el principal de un negocio le habría marcado como
     * principal un coche de OTRO.
     */
    const misFichas = await misClienteIds(user.supabaseId)
    if (!v || !misFichas.includes(v.clienteId)) return { error: 'No autorizado.' }
    const clienteId = v.clienteId
    const companyId = v.cliente.companyId

    const visitas = await conEmpresa(companyId, (tx) => tx.visit.count({ where: { vehiculoId } }))
    if (visitas > 0) return { error: 'No se puede eliminar: tiene visitas asociadas.' }

    await conEmpresa(companyId, async (tx) => {
      await tx.vehiculo.delete({ where: { id: vehiculoId } })

      // Borrar el principal dejaba al cliente sin ninguno: la lista perdía su
      // orden y la compra se quedaba sin vehículo preseleccionado. Hereda el
      // más antiguo de los que quedan — el criterio de siempre, el primero que
      // registró.
      if (v.esPrincipal) {
        const sucesor = await tx.vehiculo.findFirst({
          where: { clienteId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
        if (sucesor) {
          await tx.vehiculo.update({ where: { id: sucesor.id }, data: { esPrincipal: true } })
        }
      }
    })

    revalidatePath('/cliente/perfil')
    revalidatePath('/cliente/dashboard')
    return { success: true }
  } catch (e) {
    console.error('[profile]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
