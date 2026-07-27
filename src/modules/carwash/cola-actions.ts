'use server'

/**
 * App Car Wash · E5 — acciones de la COLA DE VEHÍCULOS.
 * Todas exigen sección 'app' (roles de administración) + capacidad
 * COLA_VEHICULOS encendida + pertenencia a la empresa. Cada cambio deja
 * rastro en AuditLog y revalida el tablero.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireSection } from '@/lib/auth/guards'
import { getRequestMeta } from '@/lib/server-utils'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import {
  COLA_ESTADOS,
  COLA_TRANSICIONES,
  type ColaEstado,
} from './cola'
import { anotarFallo } from '@/lib/prisma-errors'

const RUTA_COLA = '/admin/app/carwash/cola'

export interface ColaActionState {
  error?: string
  success?: string
}

async function contextoCola(): Promise<
  { user: NonNullable<Awaited<ReturnType<typeof requireSection>>>; companyId: string } | { error: string }
> {
  const user = await requireSection('app')
  if (!user) return { error: 'No tienes permisos para operar la cola.' }
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }
  if (!(await tieneCapacidad(companyId, 'COLA_VEHICULOS'))) {
    return { error: 'La cola de vehículos no está activada para tu negocio.' }
  }
  return { user, companyId }
}

export async function registrarEnCola(
  _prev: ColaActionState,
  formData: FormData
): Promise<ColaActionState> {
  try {
    const ctx = await contextoCola()
    if ('error' in ctx) return { error: ctx.error }

    const placa = String(formData.get('placa') ?? '').trim().toUpperCase().slice(0, 20)
    const descripcion = String(formData.get('descripcion') ?? '').trim().slice(0, 120)
    const servicio = String(formData.get('servicio') ?? '').trim().slice(0, 120)
    const notaInterna = String(formData.get('notaInterna') ?? '').trim().slice(0, 300)
    if (!placa && !descripcion) {
      return { error: 'Indica al menos la placa o una descripción del vehículo.' }
    }

    // Si la placa pertenece a un vehículo registrado de la empresa, la entrada
    // queda ligada al cliente (su historial y sus fotos se conectan solos).
    let vehiculoId: string | null = null
    let clienteId: string | null = null
    if (placa) {
      const vehiculo = await prisma.vehiculo
        .findFirst({
          where: {
            placa: { equals: placa, mode: 'insensitive' },
            cliente: { companyId: ctx.companyId },
          },
          select: { id: true, clienteId: true },
        })
        .catch(() => null)
      if (vehiculo) {
        vehiculoId = vehiculo.id
        clienteId = vehiculo.clienteId
      }
    }

    const entrada = await prisma.colaVehiculo.create({
      data: {
        companyId: ctx.companyId,
        placa: placa || null,
        descripcion: descripcion || null,
        servicio: servicio || null,
        notaInterna: notaInterna || null,
        vehiculoId,
        clienteId,
        registradaPorId: ctx.user.metadata.dbUserId ?? null,
      },
      select: { id: true },
    })

    const meta = await getRequestMeta()
    await prisma.auditLog
      .create({
        data: {
          companyId: ctx.companyId,
          userId: ctx.user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'ColaVehiculo',
          entidadId: entrada.id,
          payload: { tipo: 'COLA_REGISTRO', placa, descripcion },
          ...meta,
        },
      })
      .catch(anotarFallo('carwash:auditLog.create'))

    revalidatePath(RUTA_COLA)
    return { success: 'Vehículo agregado a la cola.' }
  } catch (e) {
    console.error('[cola] registrar:', e)
    return {
      error:
        'No se pudo registrar. Si acabas de instalar esta versión, corre la migración 20260759_e5_carwash en la base de datos.',
    }
  }
}

export async function moverCola(
  id: string,
  destino: string
): Promise<{ ok?: true; error?: string }> {
  try {
    const ctx = await contextoCola()
    if ('error' in ctx) return { error: ctx.error }
    if (!(COLA_ESTADOS as readonly string[]).includes(destino)) {
      return { error: 'Estado no válido.' }
    }

    const entrada = await prisma.colaVehiculo.findUnique({
      where: { id },
      select: { id: true, companyId: true, estado: true, inicioAt: true },
    })
    if (!entrada || entrada.companyId !== ctx.companyId) {
      return { error: 'Entrada de cola no encontrada.' }
    }
    const actual = entrada.estado as ColaEstado
    if (!COLA_TRANSICIONES[actual]?.includes(destino as ColaEstado)) {
      return { error: `No se puede pasar de "${actual}" a "${destino}".` }
    }

    const ahora = new Date()
    await prisma.colaVehiculo.update({
      where: { id },
      data: {
        estado: destino,
        ...(destino === 'EN_SERVICIO' && !entrada.inicioAt ? { inicioAt: ahora } : {}),
        ...(destino === 'LISTO' ? { listoAt: ahora } : {}),
        ...(destino === 'ENTREGADO' ? { entregadoAt: ahora } : {}),
      },
    })

    const meta = await getRequestMeta()
    await prisma.auditLog
      .create({
        data: {
          companyId: ctx.companyId,
          userId: ctx.user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'ColaVehiculo',
          entidadId: id,
          payload: { tipo: 'COLA_TRANSICION', de: actual, a: destino },
          ...meta,
        },
      })
      .catch(anotarFallo('carwash:auditLog.create'))

    revalidatePath(RUTA_COLA)
    return { ok: true }
  } catch (e) {
    console.error('[cola] mover:', e)
    return { error: 'No se pudo actualizar la cola. Intenta de nuevo.' }
  }
}
