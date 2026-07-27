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

    // ── A quién es el carro ────────────────────────────────────────────────
    // Tres caminos, en este orden:
    //   1. La placa ya está registrada → se liga sola. Es el caso frecuente y
    //      el que hace que el encargado no tenga que escribir nada.
    //   2. El encargado eligió un cliente en el selector.
    //   3. Escribió el nombre de alguien nuevo → se crea de MOSTRADOR ahí
    //      mismo, sin sacarlo de la pantalla de la pista.
    // Si no hay nada de eso, la entrada queda anónima como siempre: nunca se
    // bloquea la recepción de un carro por falta de datos del dueño.
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

    if (!clienteId) {
      const elegido = String(formData.get('clienteId') ?? '').trim()
      if (elegido) {
        // Se revalida contra la empresa: un id copiado de otro negocio no puede
        // colar un cliente ajeno en esta pista.
        const c = await prisma.cliente
          .findFirst({ where: { id: elegido, companyId: ctx.companyId }, select: { id: true } })
          .catch(() => null)
        if (c) clienteId = c.id
      }
    }

    const nombreNuevo = String(formData.get('clienteNombre') ?? '').trim().slice(0, 80)
    if (!clienteId && nombreNuevo) {
      const creado = await crearMostradorEnLinea(ctx.companyId, {
        nombre: nombreNuevo,
        telefono: String(formData.get('clienteTelefono') ?? '').trim().slice(0, 30) || null,
        placa: placa || null,
        descripcion,
      })
      if (creado) {
        clienteId = creado.clienteId
        vehiculoId = creado.vehiculoId
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

/**
 * Da de alta un cliente de MOSTRADOR desde la propia pantalla de la pista.
 *
 * Si viene placa, se le crea también el vehículo: así la PRÓXIMA vez que ese
 * carro entre, la placa lo reconoce solo y no hay que volver a escribir nada.
 * Ese es el punto entero — el sistema tiene que aprender de cada visita.
 *
 * A prueba de fallos: si algo sale mal, devuelve null y el vehículo entra a la
 * cola sin dueño. Registrar al cliente es deseable; recibir el carro es
 * obligatorio.
 */
async function crearMostradorEnLinea(
  companyId: string,
  datos: { nombre: string; telefono: string | null; placa: string | null; descripcion: string }
): Promise<{ clienteId: string; vehiculoId: string | null } | null> {
  try {
    const { nuevoIdLocal } = await import('./mostrador')
    return await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.create({
        data: {
          companyId,
          supabaseId: nuevoIdLocal(),
          nombre: datos.nombre,
          telefono: datos.telefono,
          email: '',
          esLocal: true,
          canalOrigen: 'MOSTRADOR',
        },
        select: { id: true },
      })

      let vehiculoId: string | null = null
      if (datos.placa) {
        // La descripción libre que escribió el encargado ("Corolla gris") se
        // aprovecha como marca/modelo en vez de perderse.
        const partes = datos.descripcion.split(/\s+/).filter(Boolean)
        const v = await tx.vehiculo.create({
          data: {
            clienteId: cliente.id,
            placa: datos.placa,
            marca: partes[0] ?? 'Sin marca',
            modelo: partes.slice(1).join(' ') || 'Sin modelo',
            anio: new Date().getFullYear(),
            color: 'Sin color',
          },
          select: { id: true },
        })
        vehiculoId = v.id
      }
      return { clienteId: cliente.id, vehiculoId }
    })
  } catch (e) {
    console.error('[cola] alta de mostrador:', e)
    return null
  }
}
