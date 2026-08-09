'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { validarVehiculoNuevo } from '@/modules/registro/vehiculo-nuevo'
import { clasificarErrorPrisma } from '@/lib/prisma-errors'
import { capturarErrorInesperado } from '@/lib/sentry'

/**
 * Onboarding v2 · AGREGAR VEHÍCULO desde el portal del cliente (Fase 5).
 *
 * El destino de `START_VEHICLE_ONBOARDING` (§15): el cliente ya registrado
 * que quiere comprar una membresía de car wash y no tiene vehículo —o lo
 * tiene incompleto— lo completa aquí, con las MISMAS reglas del asistente de
 * registro (validarVehiculoNuevo): completo o error con mensaje.
 *
 * REGLA DE COMPATIBILIDAD: esta acción es siempre voluntaria — agrega
 * vehículos, jamás toca ni re-valida los existentes.
 */

export interface VehiculoActionState {
  error?: string
  success?: boolean
  vehiculoId?: string
}

export async function agregarVehiculoCliente(
  _prev: VehiculoActionState,
  formData: FormData
): Promise<VehiculoActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }
    const clienteId = user.metadata.clienteId
    const companyId = user.metadata.companyId

    if (!(await formSubmitLimiter(clienteId))) {
      return { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    }

    const r = validarVehiculoNuevo({
      tipoVehiculoId: String(formData.get('tipoVehiculoId') ?? ''),
      marca: String(formData.get('marca') ?? ''),
      modelo: String(formData.get('modelo') ?? ''),
      anioRaw: String(formData.get('anio') ?? ''),
      color: String(formData.get('color') ?? ''),
      placa: String(formData.get('placa') ?? ''),
      pais: String(formData.get('pais') ?? ''),
    })
    if (!r.ok) return { error: r.error }
    const vehiculo = r.vehiculo

    // La placa es identidad global: si ya está en una cuenta de OTRA persona,
    // no se duplica (§18). Los vehículos del propio usuario (en cualquier
    // empresa) no cuentan como duplicado.
    const placaAjena = await sinEmpresa(
      'cliente: detectar placa duplicada (la placa es identidad global del vehículo)',
      (tx) =>
        tx.vehiculo.findFirst({
          where: {
            pais: vehiculo.pais,
            placaNormalizada: vehiculo.placaNormalizada,
            cliente: { supabaseId: { not: user.supabaseId } },
          },
          select: { id: true },
        })
    ).catch(() => null)
    if (placaAjena) {
      return {
        error:
          'Esta placa ya está registrada en otra cuenta. Si el vehículo es tuyo, escríbenos desde Ayuda para reclamarlo.',
      }
    }

    const creado = await conEmpresa(companyId, async (tx) => {
      // La categoría debe ser de la empresa del cliente y estar activa.
      const tipoValido = await tx.tipoVehiculo.findFirst({
        where: { id: vehiculo.tipoVehiculoId, companyId, activo: true },
        select: { id: true },
      })
      if (!tipoValido) return null

      // Mismo carro registrado dos veces por el MISMO cliente → se reutiliza
      // en silencio (idempotencia ante doble clic o pestañas duplicadas).
      const propio = await tx.vehiculo.findFirst({
        where: { clienteId, pais: vehiculo.pais, placaNormalizada: vehiculo.placaNormalizada },
        select: { id: true },
      })
      if (propio) return propio

      const esPrimero = (await tx.vehiculo.count({ where: { clienteId } })) === 0
      return tx.vehiculo.create({
        data: { clienteId, ...vehiculo, esPrincipal: esPrimero },
        select: { id: true },
      })
    })
    if (!creado) {
      return { error: 'La categoría de vehículo elegida ya no está disponible. Vuelve a elegirla.' }
    }

    revalidatePath('/cliente/planes')
    return { success: true, vehiculoId: creado.id }
  } catch (e) {
    // Carrera de placa duplicada perdida contra el unique: mensaje claro.
    if (clasificarErrorPrisma(e).codigo === 'P2002') {
      return {
        error:
          'Esta placa ya está registrada en otra cuenta. Si el vehículo es tuyo, escríbenos desde Ayuda para reclamarlo.',
      }
    }
    capturarErrorInesperado('cliente:agregarVehiculo', e)
    return { error: 'No se pudo guardar el vehículo. Intenta de nuevo.' }
  }
}

/**
 * Marcar OTRO vehículo como principal (§41).
 *
 * QUÉ ES "PRINCIPAL" — Y QUÉ NO ES. Es el vehículo que se enseña primero y el
 * que viene preseleccionado al comprar. Nada más. NO cambia el precio de
 * ninguna membresía:
 *
 *  · Lo ya comprado no se re-tarifa. Renovar cobra `membership.plan.precio`
 *    (modules/pagos/activacion.ts) sin mirar el vehículo, así que marcar otro
 *    principal no puede encarecerle a nadie lo que ya tiene.
 *  · En una compra NUEVA el precio sigue al vehículo que el cliente elige en
 *    el selector de `PlanesGrid`, que viaja como `vehiculoId` hasta el cobro.
 *    Ser principal solo decide cuál viene marcado de entrada; cambiar la
 *    selección cambia el precio en pantalla, como debe ser — un camión no
 *    puede pagar tarifa de moto por haberse registrado segundo.
 *
 * Por eso esta acción es segura y no necesita tocar el motor de elegibilidad:
 * mueve una etiqueta, no una tarifa.
 */
export async function marcarVehiculoPrincipal(
  _prev: VehiculoActionState,
  formData: FormData
): Promise<VehiculoActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
      return { error: 'No autorizado.' }
    }
    const clienteId = user.metadata.clienteId

    const vehiculoId = String(formData.get('vehiculoId') ?? '').trim()
    if (!vehiculoId) return { error: 'Vehículo no especificado.' }

    // El vehículo tiene que ser SUYO. Sin esta comprobación, un id ajeno en el
    // formulario reordenaría el garaje de otra persona.
    const propio = await sinEmpresa('cliente: buscar mi vehículo', (tx) =>
      tx.vehiculo.findUnique({
        where: { id: vehiculoId },
        select: { id: true, clienteId: true, esPrincipal: true, cliente: { select: { companyId: true } } },
      })
    )
    if (!propio || propio.clienteId !== clienteId) return { error: 'No autorizado.' }
    if (propio.esPrincipal) return { success: true, vehiculoId }

    // Los dos escritos van juntos —`conEmpresa` ya abre una transacción—: si
    // se quedara a medias, el cliente acabaría con dos principales o ninguno.
    await conEmpresa(propio.cliente.companyId, async (tx) => {
      await tx.vehiculo.updateMany({
        where: { clienteId, esPrincipal: true },
        data: { esPrincipal: false },
      })
      await tx.vehiculo.update({ where: { id: vehiculoId }, data: { esPrincipal: true } })
    })

    revalidatePath('/cliente/vehiculos')
    revalidatePath('/cliente/perfil')
    revalidatePath('/cliente/planes')
    return { success: true, vehiculoId }
  } catch (e) {
    capturarErrorInesperado('cliente:marcarVehiculoPrincipal', e)
    return { error: 'No se pudo cambiar el vehículo principal. Intenta de nuevo.' }
  }
}
