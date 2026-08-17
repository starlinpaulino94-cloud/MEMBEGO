'use server'

/**
 * EXCURSIONES · Reservas — acciones.
 *
 * Tres decisiones que gobiernan este archivo:
 *
 * 1. EL PRECIO LO PONE EL SERVIDOR. El formulario dice a quién, cuándo y
 *    cuántos; los precios se leen del catálogo aquí y se CONGELAN en la
 *    reserva. Si mañana sube la excursión, esta reserva sigue valiendo lo que
 *    valía (§57).
 * 2. EL VENDEDOR SE CONGELA AL RESERVAR. Se resuelve con la política de la
 *    empresa sobre los hechos de atribución y se guarda en la reserva. Cambiar
 *    la política después no reescribe reservas viejas (§12).
 * 3. NADA SE BORRA. Un pago se anula con un movimiento nuevo; una reserva se
 *    cancela, no desaparece (§99).
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  resolverVendedorAtribuido,
  politicaValida,
  VENTANA_ATRIBUCION_DIAS,
} from '@/modules/excursiones/atribucion/nucleo'
import {
  ESTADOS_RESERVA,
  ESTADOS_CERRADOS,
  calcularTotales,
  calcularSaldo,
  estadoPorPagos,
  numeroReserva,
  validarReserva,
  validarPago,
  type EstadoReserva,
} from './nucleo'

export interface ReservaActionState {
  error?: string
  success?: string
  creada?: { reservaId: string; numero: string; total: string }
}

async function auditar(
  companyId: string,
  userId: string | null,
  entidadId: string,
  payload: Record<string, unknown>
) {
  const meta = await getRequestMeta()
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId,
        accion: 'NOTA_INTERNA',
        entidadTipo: 'ReservaExc',
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:reservas:auditLog'))
}

/**
 * A quién le toca esta reserva: se leen los hechos de atribución del cliente
 * y se aplica la política de la empresa. Sin hechos vivos no hay vendedor —
 * es una venta directa, y eso es un resultado legítimo, no un error (§98).
 */
async function vendedorParaCliente(companyId: string, clienteId: string): Promise<string | null> {
  try {
    const config = await conEmpresa(companyId, (tx) =>
      tx.excursionesConfig.findUnique({
        where: { companyId },
        select: { politicaAtribucion: true, ventanaAtribucionDias: true },
      })
    )
    const hechos = await conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.findMany({
        where: { companyId, clienteId },
        select: { vendedorId: true, etapa: true, createdAt: true },
      })
    )
    return resolverVendedorAtribuido(hechos, {
      politica: politicaValida(config?.politicaAtribucion),
      ventanaDias: config?.ventanaAtribucionDias ?? VENTANA_ATRIBUCION_DIAS,
    })
  } catch (e) {
    console.error('[excursiones] vendedorParaCliente:', e)
    return null
  }
}

/** ADMIN · Crear la reserva con sus pasajeros y su número correlativo. */
export async function crearReserva(
  _prev: ReservaActionState,
  formData: FormData
): Promise<ReservaActionState> {
  try {
    const user = await requireSection('excursiones', 'reserva_crear')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const clienteId = String(formData.get('clienteId') ?? '')
    const excursionId = String(formData.get('excursionId') ?? '')
    const varianteId = String(formData.get('varianteId') ?? '')
    if (!clienteId || !excursionId) {
      return { error: 'Elige el cliente y la excursión.' }
    }

    const v = validarReserva({
      fecha: String(formData.get('fecha') ?? ''),
      hora: String(formData.get('hora') ?? ''),
      adultos: String(formData.get('adultos') ?? '0'),
      ninos: String(formData.get('ninos') ?? '0'),
      descuento: String(formData.get('descuento') ?? '0'),
      notas: String(formData.get('notas') ?? ''),
      canal: String(formData.get('canal') ?? ''),
    })
    if (!v.ok) return { error: v.error }

    // El cliente tiene que ser de ESTA empresa: sin esto, un id copiado de
    // otra pantalla reservaría a nombre de un cliente ajeno.
    const cliente = await conEmpresa(companyId, (tx) =>
      tx.cliente.findFirst({ where: { id: clienteId, companyId }, select: { id: true, nombre: true } })
    )
    if (!cliente) return { error: 'Ese cliente no existe en tu empresa.' }

    // Precios y moneda: del catálogo, nunca del formulario (§57).
    const excursion = await conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: excursionId, companyId },
        select: {
          id: true,
          nombre: true,
          moneda: true,
          impuestoPct: true,
          estado: true,
          variantes: {
            where: { activa: true },
            select: { id: true, nombre: true, precioAdulto: true, precioNino: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    )
    if (!excursion) return { error: 'Esa excursión no existe en tu empresa.' }
    if (excursion.estado === 'ARCHIVADA') {
      return { error: 'Esa excursión está archivada: no se puede reservar.' }
    }
    const variante =
      excursion.variantes.find((x) => x.id === varianteId) ?? excursion.variantes[0]
    if (!variante) return { error: 'Esa excursión no tiene variantes activas con precio.' }

    const totales = calcularTotales({
      adultos: v.datos.adultos,
      ninos: v.datos.ninos,
      precioAdulto: Number(variante.precioAdulto),
      precioNino: variante.precioNino != null ? Number(variante.precioNino) : null,
      descuento: v.datos.descuento,
      impuestoPct: excursion.impuestoPct != null ? Number(excursion.impuestoPct) : null,
    })

    const vendedorId = await vendedorParaCliente(companyId, clienteId)
    const anio = v.datos.fecha.getUTCFullYear()

    // Correlativo por empresa y año con reintento ante la carrera: el índice
    // único companyId+numero es el árbitro.
    const creada = await conEmpresa(companyId, async (tx) => {
      const desde = new Date(Date.UTC(anio, 0, 1))
      const hasta = new Date(Date.UTC(anio + 1, 0, 1))
      let intento =
        (await tx.reservaExc.count({
          where: { companyId, fecha: { gte: desde, lt: hasta } },
        })) + 1

      for (let i = 0; i < 5; i++) {
        try {
          return await tx.reservaExc.create({
            data: {
              companyId,
              numero: numeroReserva('EXC', anio, intento),
              clienteId,
              vendedorId,
              excursionId: excursion.id,
              varianteId: variante.id,
              fecha: v.datos.fecha,
              hora: v.datos.hora,
              adultos: v.datos.adultos,
              ninos: v.datos.ninos,
              subtotal: totales.subtotal,
              descuento: totales.descuento,
              impuestos: totales.impuestos,
              total: totales.total,
              moneda: excursion.moneda,
              estado: 'PENDIENTE',
              canal: v.datos.canal,
              notas: v.datos.notas,
              creadaPorId: user.metadata.dbUserId ?? null,
              pasajeros: {
                create: [
                  ...Array.from({ length: v.datos.adultos }, () => ({ companyId, tipo: 'ADULTO' })),
                  ...Array.from({ length: v.datos.ninos }, () => ({ companyId, tipo: 'NINO' })),
                ],
              },
            },
            select: { id: true, numero: true, total: true },
          })
        } catch (e) {
          const esUnique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
          if (!esUnique || i === 4) throw e
          intento += 1
        }
      }
      throw new Error('sin_numero')
    })

    // La reserva es una etapa del embudo del vendedor: se deja el hecho, que
    // es lo que después sostiene su comisión.
    if (vendedorId) {
      await conEmpresa(companyId, (tx) =>
        tx.vendedorAtribucion.create({
          data: { companyId, vendedorId, clienteId, etapa: 'RESERVA' },
        })
      ).catch(anotarFallo('excursiones:reservas:atribucion'))
    }

    await auditar(companyId, user.metadata.dbUserId ?? null, creada.id, {
      tipo: 'RESERVA_CREADA',
      numero: creada.numero,
      total: String(creada.total),
      excursion: excursion.nombre,
      vendedorId,
    })
    revalidatePath('/admin/excursiones/reservas')
    return {
      success: `Reserva ${creada.numero} creada.`,
      creada: { reservaId: creada.id, numero: creada.numero, total: String(creada.total) },
    }
  } catch (e) {
    console.error('[excursiones] crearReserva:', e)
    return { error: 'No se pudo crear la reserva. Intenta de nuevo.' }
  }
}

/** Recalcula el estado desde los pagos vivos. Devuelve el estado resultante. */
async function refrescarEstadoPorPagos(
  companyId: string,
  reservaId: string
): Promise<EstadoReserva | null> {
  const reserva = await conEmpresa(companyId, (tx) =>
    tx.reservaExc.findFirst({
      where: { id: reservaId, companyId },
      select: {
        estado: true,
        total: true,
        pagos: { select: { monto: true, estado: true } },
      },
    })
  )
  if (!reserva) return null
  const total = Number(reserva.total)
  const { pagado } = calcularSaldo(
    total,
    reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
  )
  const nuevo = estadoPorPagos(reserva.estado as EstadoReserva, total, pagado)
  if (nuevo !== reserva.estado) {
    await conEmpresa(companyId, (tx) =>
      tx.reservaExc.updateMany({ where: { id: reservaId, companyId }, data: { estado: nuevo } })
    )
  }
  return nuevo
}

/** ADMIN · Registrar un abono o el pago completo. */
export async function registrarPago(
  _prev: ReservaActionState,
  formData: FormData
): Promise<ReservaActionState> {
  try {
    const user = await requireSection('excursiones', 'reserva_pago')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reservaId = String(formData.get('reservaId') ?? '')

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: {
          id: true,
          estado: true,
          total: true,
          moneda: true,
          pagos: { select: { monto: true, estado: true } },
        },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }
    if (reserva.estado === 'CANCELADA') {
      return { error: 'Esta reserva está cancelada: no admite pagos.' }
    }

    // El saldo se calcula AQUÍ, con los pagos vivos de la base. Lo que la
    // pantalla creyera que faltaba no decide nada.
    const { saldo } = calcularSaldo(
      Number(reserva.total),
      reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
    )
    const v = validarPago(
      {
        monto: String(formData.get('monto') ?? ''),
        metodo: String(formData.get('metodo') ?? ''),
        referencia: String(formData.get('referencia') ?? ''),
        notas: String(formData.get('notas') ?? ''),
      },
      saldo
    )
    if (!v.ok) return { error: v.error }

    await conEmpresa(companyId, (tx) =>
      tx.reservaPago.create({
        data: {
          companyId,
          reservaId: reserva.id,
          monto: v.datos.monto,
          moneda: reserva.moneda,
          metodo: v.datos.metodo,
          referencia: v.datos.referencia,
          notas: v.datos.notas,
          confirmadoPorId: user.metadata.dbUserId ?? null,
        },
      })
    )
    const estado = await refrescarEstadoPorPagos(companyId, reserva.id)

    await auditar(companyId, user.metadata.dbUserId ?? null, reserva.id, {
      tipo: 'RESERVA_PAGO',
      monto: v.datos.monto,
      metodo: v.datos.metodo,
      estado,
    })
    revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)
    revalidatePath('/admin/excursiones/reservas')
    return { success: 'Pago registrado.' }
  } catch (e) {
    console.error('[excursiones] registrarPago:', e)
    return { error: 'No se pudo registrar el pago.' }
  }
}

/**
 * ADMIN · Anular un pago mal registrado. El movimiento se marca ANULADO y se
 * queda a la vista: la trazabilidad del dinero no admite borrar (§99).
 */
export async function anularPago(
  _prev: ReservaActionState,
  formData: FormData
): Promise<ReservaActionState> {
  try {
    const user = await requireSection('excursiones', 'reserva_anular_pago')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const pagoId = String(formData.get('pagoId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 300)
    if (!motivo) return { error: 'Escribe por qué se anula el pago.' }

    const pago = await conEmpresa(companyId, (tx) =>
      tx.reservaPago.findFirst({
        where: { id: pagoId, companyId },
        select: { id: true, reservaId: true, monto: true, estado: true },
      })
    )
    if (!pago) return { error: 'Pago no encontrado.' }
    if (pago.estado === 'ANULADO') return { error: 'Ese pago ya estaba anulado.' }

    await conEmpresa(companyId, (tx) =>
      tx.reservaPago.updateMany({
        where: { id: pago.id, companyId },
        data: { estado: 'ANULADO', notas: `Anulado: ${motivo}` },
      })
    )
    const estado = await refrescarEstadoPorPagos(companyId, pago.reservaId)

    await auditar(companyId, user.metadata.dbUserId ?? null, pago.reservaId, {
      tipo: 'RESERVA_PAGO_ANULADO',
      pagoId: pago.id,
      monto: String(pago.monto),
      motivo,
      estado,
    })
    revalidatePath(`/admin/excursiones/reservas/${pago.reservaId}`)
    return { success: 'Pago anulado.' }
  } catch (e) {
    console.error('[excursiones] anularPago:', e)
    return { error: 'No se pudo anular el pago.' }
  }
}

/**
 * ADMIN · Mover la reserva a mano: confirmar, completar, cancelar o marcar que
 * no se presentó. Cancelar exige motivo — es el estado que después explica un
 * reembolso o una comisión que no se paga.
 */
export async function cambiarEstadoReserva(
  _prev: ReservaActionState,
  formData: FormData
): Promise<ReservaActionState> {
  try {
    const estado = String(formData.get('estado') ?? '') as EstadoReserva
    if (!(ESTADOS_RESERVA as readonly string[]).includes(estado)) {
      return { error: 'Estado no reconocido.' }
    }
    const esCancelacion = estado === 'CANCELADA'
    const user = await requireSection(
      'excursiones',
      esCancelacion ? 'reserva_cancelar' : 'reserva_editar'
    )
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reservaId = String(formData.get('reservaId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 300)
    if (esCancelacion && !motivo) return { error: 'Escribe el motivo de la cancelación.' }

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: { id: true, estado: true, notas: true },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }
    if (ESTADOS_CERRADOS.includes(reserva.estado as EstadoReserva) && reserva.estado !== estado) {
      return {
        error: 'Esta reserva ya está cerrada. Su histórico no se reescribe; registra una nueva.',
      }
    }

    await conEmpresa(companyId, (tx) =>
      tx.reservaExc.updateMany({
        where: { id: reserva.id, companyId },
        data: {
          estado,
          ...(motivo
            ? { notas: `${reserva.notas ? `${reserva.notas}\n` : ''}[${estado}] ${motivo}` }
            : {}),
        },
      })
    )

    await auditar(companyId, user.metadata.dbUserId ?? null, reserva.id, {
      tipo: 'RESERVA_ESTADO',
      desde: reserva.estado,
      hacia: estado,
      ...(motivo ? { motivo } : {}),
    })
    revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)
    revalidatePath('/admin/excursiones/reservas')
    return { success: `Reserva ${estado.toLowerCase().replace('_', ' ')}.` }
  } catch (e) {
    console.error('[excursiones] cambiarEstadoReserva:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}
