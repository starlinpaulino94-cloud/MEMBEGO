'use server'

/**
 * App Car Wash · acciones de CLIENTES DE MOSTRADOR.
 *
 * Estas acciones NO exigen una capacidad nueva: poder anotar quién trajo el
 * carro es parte de operar la pista, no un módulo opcional. Exigen rol de
 * administración y acotan todo a la empresa del usuario.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { anotarFallo } from '@/lib/prisma-errors'
import { normalizarPlaca } from './cuentas'
import { nuevoIdLocal, esIdLocal, buscarClientes } from './mostrador'

export interface MostradorState {
  error?: string
  success?: string
  /** Id del cliente creado, para que la pantalla lo seleccione sola. */
  clienteId?: string
}

const RUTA = '/admin/app/carwash/clientes'
const RUTA_COLA = '/admin/app/carwash/cola'

async function contexto(): Promise<{ companyId: string; userId: string | null } | { error: string }> {
  const user = await getUser()
  if (!user || !(ADMIN_ROLES as readonly string[]).includes(user.metadata.role)) {
    return { error: 'No autorizado.' }
  }
  const companyId = companyFilter(user) ?? user.metadata.companyId ?? null
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }
  return { companyId, userId: user.metadata.dbUserId ?? null }
}

function texto(v: FormDataEntryValue | null, max = 120): string {
  return String(v ?? '').trim().slice(0, max)
}

/**
 * Crea un cliente de mostrador, opcionalmente con su vehículo.
 *
 * Solo el NOMBRE es obligatorio. Pedir correo o cédula en la puerta de una
 * pista es la forma más rápida de que el encargado deje de usar el sistema y
 * vuelva al cuaderno.
 */
export async function crearClienteMostrador(
  _prev: MostradorState,
  formData: FormData
): Promise<MostradorState> {
  try {
    const ctx = await contexto()
    if ('error' in ctx) return ctx

    const nombre = texto(formData.get('nombre'), 80)
    if (!nombre) return { error: 'Escribe al menos el nombre.' }

    const telefono = texto(formData.get('telefono'), 30) || null
    const placaCruda = texto(formData.get('placa'), 20)
    const placa = placaCruda ? normalizarPlaca(placaCruda) : null

    // Si la placa ya está registrada, no se crea un duplicado: se avisa de
    // quién es. Dos fichas con el mismo carro parten el historial en dos y
    // nadie vuelve a saber cuántas veces vino ese cliente.
    if (placa) {
      const existente = await conEmpresa(ctx.companyId, (tx) =>
        tx.vehiculo.findFirst({
          where: {
            placa: { equals: placa, mode: 'insensitive' },
            cliente: { companyId: ctx.companyId },
          },
          select: { cliente: { select: { id: true, nombre: true } } },
        })
      )
      if (existente) {
        return {
          error: `La placa ${placa} ya está registrada a nombre de ${existente.cliente.nombre}.`,
          clienteId: existente.cliente.id,
        }
      }
    }

    const tipoVehiculoId = texto(formData.get('tipoVehiculoId'), 40) || null

    const cliente = await conEmpresa(ctx.companyId, async (tx) => {
      const c = await tx.cliente.create({
        data: {
          companyId: ctx.companyId,
          // Identidad que Supabase nunca podría emitir: este cliente no puede
          // iniciar sesión ni por accidente.
          supabaseId: nuevoIdLocal(),
          nombre,
          telefono,
          email: '',
          esLocal: true,
          canalOrigen: 'MOSTRADOR',
        },
        select: { id: true },
      })

      if (placa || texto(formData.get('marca'))) {
        await tx.vehiculo.create({
          data: {
            clienteId: c.id,
            placa,
            marca: texto(formData.get('marca'), 40) || 'Sin marca',
            modelo: texto(formData.get('modelo'), 40) || 'Sin modelo',
            anio: Number(formData.get('anio')) || new Date().getFullYear(),
            color: texto(formData.get('color'), 30) || 'Sin color',
            ...(tipoVehiculoId ? { tipoVehiculoId } : {}),
          },
        })
      }
      return c
    })

    revalidatePath(RUTA)
    revalidatePath(RUTA_COLA)
    return { success: `${nombre} registrado.`, clienteId: cliente.id }
  } catch (e) {
    console.error('[mostrador] crear:', e)
    return { error: 'No se pudo registrar. ¿Corriste la migración 20260766?' }
  }
}

/** Actualiza nombre y teléfono de un cliente de mostrador. */
export async function editarClienteMostrador(
  _prev: MostradorState,
  formData: FormData
): Promise<MostradorState> {
  try {
    const ctx = await contexto()
    if ('error' in ctx) return ctx

    const id = texto(formData.get('id'), 40)
    const nombre = texto(formData.get('nombre'), 80)
    if (!nombre) return { error: 'El nombre no puede quedar vacío.' }

    // Solo los de mostrador: los datos de un cliente con cuenta los cambia él
    // desde su perfil, no el negocio.
    const upd = await conEmpresa(ctx.companyId, (tx) =>
      tx.cliente.updateMany({
        where: { id, companyId: ctx.companyId, esLocal: true },
        data: { nombre, telefono: texto(formData.get('telefono'), 30) || null },
      })
    )
    if (upd.count === 0) {
      return { error: 'Cliente no encontrado, o tiene cuenta propia y edita sus datos él mismo.' }
    }

    revalidatePath(RUTA)
    return { success: 'Datos actualizados.' }
  } catch (e) {
    console.error('[mostrador] editar:', e)
    return { error: 'No se pudo actualizar.' }
  }
}

/** Agrega otro vehículo a un cliente ya registrado. */
export async function agregarVehiculo(
  _prev: MostradorState,
  formData: FormData
): Promise<MostradorState> {
  try {
    const ctx = await contexto()
    if ('error' in ctx) return ctx

    const clienteId = texto(formData.get('clienteId'), 40)
    const cliente = await conEmpresa(ctx.companyId, (tx) =>
      tx.cliente.findFirst({
        where: { id: clienteId, companyId: ctx.companyId },
        select: { id: true },
      })
    )
    if (!cliente) return { error: 'Cliente no encontrado.' }

    const placaCruda = texto(formData.get('placa'), 20)
    const placa = placaCruda ? normalizarPlaca(placaCruda) : null
    if (placa) {
      const existente = await conEmpresa(ctx.companyId, (tx) =>
        tx.vehiculo.findFirst({
          where: {
            placa: { equals: placa, mode: 'insensitive' },
            cliente: { companyId: ctx.companyId },
          },
          select: { cliente: { select: { nombre: true } } },
        })
      )
      if (existente) {
        return { error: `La placa ${placa} ya está a nombre de ${existente.cliente.nombre}.` }
      }
    }

    const tipoVehiculoId = texto(formData.get('tipoVehiculoId'), 40) || null
    await conEmpresa(ctx.companyId, (tx) =>
      tx.vehiculo.create({
        data: {
          clienteId: cliente.id,
          placa,
          marca: texto(formData.get('marca'), 40) || 'Sin marca',
          modelo: texto(formData.get('modelo'), 40) || 'Sin modelo',
          anio: Number(formData.get('anio')) || new Date().getFullYear(),
          color: texto(formData.get('color'), 30) || 'Sin color',
          ...(tipoVehiculoId ? { tipoVehiculoId } : {}),
        },
      })
    )

    revalidatePath(`${RUTA}/${clienteId}`)
    return { success: 'Vehículo agregado.' }
  } catch (e) {
    console.error('[mostrador] agregarVehiculo:', e)
    return { error: 'No se pudo agregar el vehículo.' }
  }
}

/**
 * Vincula un cliente de MOSTRADOR con su cuenta real, cuando la persona acaba
 * registrándose en la plataforma.
 *
 * POR QUÉ IMPORTA: sin esto, el cliente que lleva dos años lavando aquí se
 * registra y el sistema lo trata como nuevo — pierde su historial y el negocio
 * pierde el dato de que es su mejor cliente. Con el tiempo la base se llena de
 * pares duplicados y ya no hay forma de saber quién es quién.
 *
 * QUÉ SE MUEVE: vehículos, entradas de pista, incidencias y visitas. Lo que se
 * mueve es el HISTORIAL, que es lo que no se puede reconstruir. La ficha local
 * se borra al final solo si ya no le cuelga nada; si tiene membresías o compras
 * se conserva y se avisa, en vez de fallar a medias.
 */
export async function vincularConCuenta(
  _prev: MostradorState,
  formData: FormData
): Promise<MostradorState> {
  try {
    const ctx = await contexto()
    if ('error' in ctx) return ctx

    const localId = texto(formData.get('localId'), 40)
    const destinoId = texto(formData.get('destinoId'), 40)
    if (!localId || !destinoId) return { error: 'Faltan datos.' }
    if (localId === destinoId) return { error: 'Es el mismo cliente.' }

    const [local, destino] = await conEmpresa(ctx.companyId, (tx) =>
      Promise.all([
        tx.cliente.findFirst({
          where: { id: localId, companyId: ctx.companyId },
          select: { id: true, nombre: true, esLocal: true, supabaseId: true },
        }),
        tx.cliente.findFirst({
          where: { id: destinoId, companyId: ctx.companyId },
          select: { id: true, nombre: true, esLocal: true, supabaseId: true },
        }),
      ])
    )
    if (!local || !destino) return { error: 'Cliente no encontrado.' }

    // El origen tiene que ser de mostrador y el destino una cuenta real. Al
    // revés se perdería la cuenta, que es lo único irreemplazable.
    if (!local.esLocal || !esIdLocal(local.supabaseId)) {
      return { error: 'El origen tiene que ser un cliente de mostrador.' }
    }
    if (destino.esLocal || esIdLocal(destino.supabaseId)) {
      return { error: 'El destino tiene que ser un cliente con cuenta en la plataforma.' }
    }

    const movidos = await conEmpresa(ctx.companyId, async (tx) => {
      const [vehiculos, cola, incidencias, visitas] = await Promise.all([
        tx.vehiculo.updateMany({ where: { clienteId: localId }, data: { clienteId: destinoId } }),
        tx.colaVehiculo.updateMany({ where: { clienteId: localId }, data: { clienteId: destinoId } }),
        tx.incidencia.updateMany({ where: { clienteId: localId }, data: { clienteId: destinoId } }),
        tx.visit.updateMany({ where: { clienteId: localId }, data: { clienteId: destinoId } }),
      ])
      return {
        vehiculos: vehiculos.count,
        visitas: cola.count,
        incidencias: incidencias.count,
        visitasLegacy: visitas.count,
      }
    })

    // Se intenta borrar la ficha vacía. Si algo más le cuelga (una membresía
    // que el negocio le dio a mano, una compra), la FK lo impide: se conserva
    // y se dice, en vez de dejar un borrado a medias.
    let fichaBorrada = true
    try {
      await conEmpresa(ctx.companyId, (tx) => tx.cliente.delete({ where: { id: localId } }))
    } catch {
      fichaBorrada = false
      await conEmpresa(ctx.companyId, (tx) =>
        tx.cliente
          .update({
            where: { id: localId },
            data: { nombre: `${local.nombre} (fusionado con ${destino.nombre})` },
          })
          .catch(anotarFallo('mostrador:marcarFusionado', { localId }))
      )
    }

    revalidatePath(RUTA)
    revalidatePath('/admin/clientes')
    const detalle = `${movidos.vehiculos} vehículo(s) y ${movidos.visitas} visita(s)`
    return {
      success: fichaBorrada
        ? `Historial de ${local.nombre} unido a ${destino.nombre}: ${detalle}.`
        : `Historial unido a ${destino.nombre} (${detalle}). La ficha de mostrador se conservó porque tiene membresías o compras propias.`,
      clienteId: destinoId,
    }
  } catch (e) {
    console.error('[mostrador] vincular:', e)
    return { error: 'No se pudo vincular.' }
  }
}

/** Búsqueda para el selector de la pista. Devuelve pocos y rápido. */
export async function buscarParaPista(
  q: string
): Promise<{ id: string; nombre: string; telefono: string | null; esLocal: boolean; placas: string[] }[]> {
  const ctx = await contexto()
  if ('error' in ctx) return []
  const encontrados = await buscarClientes(ctx.companyId, q, 8)
  return encontrados.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    telefono: c.telefono,
    esLocal: c.esLocal,
    placas: c.placas,
  }))
}
