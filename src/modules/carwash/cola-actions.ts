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
): Promise<{ ok?: true; error?: string; aviso?: string }> {
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

    // ── Fase 2: al ENTREGAR se cierra el dinero de esa orden ────────────────
    // FUERA de la actualización de estado y a prueba de fallos: el vehículo ya
    // se entregó y el cliente tiene su llave. Si la comisión o el cargo a la
    // flota fallan, no se puede "des-entregar" el carro — se avisa y se sigue.
    let aviso: string | undefined
    if (destino === 'ENTREGADO') {
      aviso = await cerrarEntrega(ctx.companyId, id)
    }

    revalidatePath(RUTA_COLA)
    return { ok: true, aviso }
  } catch (e) {
    console.error('[cola] mover:', e)
    return { error: 'No se pudo actualizar la cola. Intenta de nuevo.' }
  }
}

/**
 * Lo que ocurre cuando un vehículo se entrega: se devenga la comisión del
 * lavador y, si la placa es de una flota, el servicio se carga a su cuenta en
 * vez de esperar un cobro en caja.
 *
 * Las dos cosas están detrás de su capacidad y las dos son idempotentes, así
 * que reintentar una entrega no paga dos veces ni factura dos veces.
 *
 * Devuelve un aviso legible para mostrarle al encargado, o undefined si no
 * hubo nada que reportar.
 */
async function cerrarEntrega(companyId: string, colaId: string): Promise<string | undefined> {
  const avisos: string[] = []

  try {
    if (await tieneCapacidad(companyId, 'COMISIONES')) {
      const { devengarComision } = await import('./comisiones')
      const r = await devengarComision(companyId, colaId)
      if (r) avisos.push(`Comisión: RD$${r.monto.toFixed(2)}`)
    }
  } catch (e) {
    console.error('[cola] comisión al entregar:', e)
  }

  try {
    if (await tieneCapacidad(companyId, 'CUENTAS_CORPORATIVAS')) {
      const cargo = await cargarAFlotaSiAplica(companyId, colaId)
      if (cargo) avisos.push(`Cargado a ${cargo.cuenta}: RD$${cargo.monto.toFixed(2)}`)
    }
  } catch (e) {
    console.error('[cola] cargo a flota al entregar:', e)
  }

  return avisos.length > 0 ? avisos.join(' · ') : undefined
}

/**
 * Si la placa pertenece a una flota, deja el consumo cargado a su cuenta.
 *
 * El seguro contra el cargo doble es buscar primero un cargo con este mismo
 * `colaId`: un vehículo se factura UNA vez, aunque se reintente la entrega.
 */
async function cargarAFlotaSiAplica(
  companyId: string,
  colaId: string
): Promise<{ cuenta: string; monto: number } | null> {
  const cola = await prisma.colaVehiculo.findFirst({
    where: { id: colaId, companyId },
    select: {
      placa: true,
      vehiculo: { select: { placa: true } },
      servicios: { select: { nombre: true, precio: true, cantidad: true } },
    },
  })
  if (!cola) return null

  const placa = cola.placa ?? cola.vehiculo?.placa ?? null
  const { cuentaDeLaPlaca, normalizarPlaca } = await import('./cuentas')
  const cuenta = await cuentaDeLaPlaca(companyId, placa)
  if (!cuenta) return null

  const yaCargado = await prisma.cargoCuenta.findFirst({
    where: { colaId },
    select: { id: true },
  })
  if (yaCargado) return null

  const monto = cola.servicios.reduce((acc, s) => acc + Number(s.precio) * s.cantidad, 0)
  if (monto <= 0) return null

  const concepto =
    cola.servicios.map((s) => s.nombre).join(' + ').slice(0, 160) || 'Servicio de lavado'

  await prisma.cargoCuenta.create({
    data: {
      cuentaId: cuenta.cuentaId,
      colaId,
      placa: placa ? normalizarPlaca(placa) : null,
      concepto,
      monto,
    },
  })

  return { cuenta: cuenta.nombre, monto }
}
