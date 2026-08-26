'use server'

/**
 * EXCURSIONES · Check-in — acciones.
 *
 * El escaneo NO decide solo: busca la reserva y devuelve lo que el operador
 * necesita ver antes de subir a nadie (cliente, excursión, pasajeros y el aviso
 * si la fecha no cuadra). Embarcar es un segundo paso, con su confirmación.
 *
 * Esa separación es deliberada: un escáner que embarca al leer convierte un
 * escaneo accidental en un dato falso del manifiesto, y el manifiesto es lo que
 * después responde «¿quién se subió a ese bus?».
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { generarCodigo } from '@/lib/codes'
import { evaluarCheckin, tokenDesdeCodigo, pasajerosQueEmbarcan } from './nucleo'
import {
  calcularSaldo,
  estadoPorPagos,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import { procesarVentaYComisionInterna } from '@/modules/excursiones/ventas/actions'

export interface CheckinItemReserva {
  id: string
  actividadId: string
  actividadNombre: string
  tipoItem: string
  fecha: string
  hora: string | null
  duracionMin: number | null
  ubicacion: string | null
  puntoSalida: string | null
  estado: string
  checkinAt: string | null
  adultos: number
  ninos: number
}

export interface CheckinBusqueda {
  error?: string
  reserva?: {
    id: string
    numero: string
    cliente: string
    telefono: string | null
    excursion: string
    tipoItem: string
    esCombo: boolean
    fecha: string
    hora: string | null
    adultos: number
    ninos: number
    totalPasajeros: number
    estado: string
    saldo: number
    moneda: string
    yaEmbarcada: boolean
    presentes: number
    aviso: string | null
    items: CheckinItemReserva[]
    itemsCompletados: number
    totalItems: number
  }
}

export interface CheckinActionState {
  error?: string
  success?: string
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
  ).catch(anotarFallo('excursiones:checkin:auditLog'))
}

/** ADMIN · Leer el QR de check-in o buscar por número de reserva, voucher o ID. */
export async function buscarParaCheckin(codigo: string): Promise<CheckinBusqueda> {
  try {
    const user = await requireSection('excursiones', 'checkin_registrar')
    if (!user) return { error: 'No tienes permiso para hacer check-in.' }
    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa requerida.' }

    const limpio = (codigo ?? '').trim().replace(/\s+/g, '')
    if (!limpio) return { error: 'Escribe o escanea un código de reserva.' }

    const token = tokenDesdeCodigo(limpio) ?? limpio

    const condicionesOr: Prisma.ReservaExcWhereInput[] = [
      { checkinToken: token },
      { checkinToken: limpio },
      { numero: { equals: limpio, mode: 'insensitive' } },
      { voucherAgencia: { equals: limpio, mode: 'insensitive' } },
    ]
    if (limpio.length >= 20) {
      condicionesOr.push({ id: limpio })
    }

    // El token/código busca la reserva dentro de ESTA empresa
    let reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: {
          companyId,
          OR: condicionesOr,
        },
        select: {
          id: true, numero: true, estado: true, fecha: true, hora: true,
          adultos: true, ninos: true, total: true, moneda: true,
          checkinAt: true, checkinToken: true, clienteId: true, excursionId: true,
          pagos: { select: { monto: true, estado: true } },
          pasajeros: { select: { id: true, presente: true } },
          items: {
            select: {
              id: true,
              actividadId: true,
              fecha: true,
              hora: true,
              estado: true,
              checkinAt: true,
              adultos: true,
              ninos: true,
              actividad: {
                select: {
                  nombre: true,
                  tipoItem: true,
                  duracionMin: true,
                  ubicacion: true,
                  puntoSalida: true,
                },
              },
            },
            orderBy: { fecha: 'asc' },
          },
        },
      })
    )
    if (!reserva) return { error: 'No encontramos ninguna reserva con ese código o número.' }

    // Auto-generar token si no existía
    if (!reserva.checkinToken) {
      const nuevoToken = generarCodigo(24)
      await conEmpresa(companyId, (tx) =>
        tx.reservaExc.update({
          where: { id: reserva.id },
          data: { checkinToken: nuevoToken },
        })
      ).catch(anotarFallo('excursiones:checkin:autoToken'))
      reserva.checkinToken = nuevoToken
    }

    // Auto-aprovisionar pasajeros si la reserva tenía conteo pero no registros físicos
    if (reserva.pasajeros.length === 0 && (reserva.adultos + reserva.ninos > 0)) {
      const nuevosPasajeros = [
        ...Array.from({ length: reserva.adultos }, () => ({ companyId, tipo: 'ADULTO' })),
        ...Array.from({ length: reserva.ninos }, () => ({ companyId, tipo: 'NINO' })),
      ]
      await conEmpresa(companyId, async (tx) => {
        await tx.reservaPasajero.createMany({
          data: nuevosPasajeros.map((p) => ({ ...p, reservaId: reserva.id })),
        })
      }).catch(anotarFallo('excursiones:checkin:autoPasajeros'))

      const recargados = await conEmpresa(companyId, (tx) =>
        tx.reservaPasajero.findMany({
          where: { reservaId: reserva.id, companyId },
          select: { id: true, presente: true },
        })
      )
      reserva.pasajeros = recargados
    }

    const totalPasajeros = reserva.pasajeros.length || (reserva.adultos + reserva.ninos)
    const veredicto = evaluarCheckin(
      {
        estado: reserva.estado,
        fecha: reserva.fecha,
        checkinAt: reserva.checkinAt,
        totalPasajeros,
      },
      new Date()
    )
    if (!veredicto.ok) return { error: veredicto.error }

    const [cliente, excursion] = await Promise.all([
      conEmpresa(companyId, (tx) =>
        tx.cliente.findFirst({
          where: { id: reserva.clienteId, companyId },
          select: { nombre: true, telefono: true },
        })
      ),
      conEmpresa(companyId, (tx) =>
        tx.excursion.findFirst({
          where: { id: reserva.excursionId, companyId },
          select: { nombre: true, tipoItem: true },
        })
      ),
    ])

    const pagado = reserva.pagos
      .filter((p) => p.estado === 'REGISTRADO')
      .reduce((t, p) => t + Number(p.monto), 0)
    const saldo = Math.round(Math.max(0, Number(reserva.total) - pagado) * 100) / 100

    const esCombo = excursion?.tipoItem === 'COMBO' || reserva.items.length > 0
    const itemsMapped: CheckinItemReserva[] = reserva.items.map((it) => ({
      id: it.id,
      actividadId: it.actividadId,
      actividadNombre: it.actividad.nombre,
      tipoItem: it.actividad.tipoItem,
      fecha: it.fecha.toISOString().slice(0, 10),
      hora: it.hora,
      duracionMin: it.actividad.duracionMin,
      ubicacion: it.actividad.ubicacion,
      puntoSalida: it.actividad.puntoSalida,
      estado: it.estado,
      checkinAt: it.checkinAt ? it.checkinAt.toISOString() : null,
      adultos: it.adultos,
      ninos: it.ninos,
    }))
    const itemsCompletados = itemsMapped.filter(
      (it) => it.checkinAt !== null || it.estado === 'CHECKIN_COMPLETADO' || it.estado === 'EMBARCADA'
    ).length

    return {
      reserva: {
        id: reserva.id,
        numero: reserva.numero,
        cliente: cliente?.nombre ?? 'Cliente',
        telefono: cliente?.telefono ?? null,
        excursion: excursion?.nombre ?? '—',
        tipoItem: excursion?.tipoItem ?? 'EXCURSION',
        esCombo,
        fecha: reserva.fecha.toISOString(),
        hora: reserva.hora,
        adultos: reserva.adultos,
        ninos: reserva.ninos,
        totalPasajeros,
        estado: reserva.estado,
        saldo,
        moneda: reserva.moneda,
        yaEmbarcada: veredicto.yaEstaba,
        presentes: reserva.pasajeros.filter((p) => p.presente).length,
        aviso: veredicto.aviso,
        items: itemsMapped,
        itemsCompletados,
        totalItems: itemsMapped.length,
      },
    }
  } catch (e) {
    console.error('[excursiones] buscarParaCheckin:', e)
    return { error: 'No se pudo consultar la reserva. Intenta de nuevo.' }
  }
}

/** Recalcula el estado de la reserva desde los pagos vivos. Devuelve el estado resultante. */
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

/** ADMIN · Confirmar el embarque, con cuántos se subieron de verdad, qué items en combos y cobro opcional de saldo. */
export async function registrarCheckin(
  _prev: CheckinActionState,
  formData: FormData
): Promise<CheckinActionState> {
  try {
    const user = await requireSection('excursiones', 'checkin_registrar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reservaId = String(formData.get('reservaId') ?? '')
    const rawItemIds = formData.getAll('itemIds') as string[]
    const rawItemIdsJson = String(formData.get('itemIdsJson') ?? '')
    let itemIdsSeleccionados: string[] = rawItemIds.filter(Boolean)
    if (itemIdsSeleccionados.length === 0 && rawItemIdsJson) {
      try {
        const parsed = JSON.parse(rawItemIdsJson)
        if (Array.isArray(parsed)) itemIdsSeleccionados = parsed.map(String)
      } catch {
        /* ignore */
      }
    }

    let reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: {
          id: true, numero: true, estado: true, fecha: true, checkinAt: true,
          adultos: true, ninos: true, total: true, moneda: true,
          pagos: { select: { monto: true, estado: true } },
          pasajeros: { select: { id: true }, orderBy: { tipo: 'asc' } },
          items: {
            select: { id: true, estado: true, checkinAt: true, actividad: { select: { nombre: true } } },
          },
        },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }

    // Auto-aprovisionar pasajeros si no existían físicamente
    if (reserva.pasajeros.length === 0 && (reserva.adultos + reserva.ninos > 0)) {
      const nuevosPasajeros = [
        ...Array.from({ length: reserva.adultos }, () => ({ companyId, tipo: 'ADULTO' })),
        ...Array.from({ length: reserva.ninos }, () => ({ companyId, tipo: 'NINO' })),
      ]
      await conEmpresa(companyId, async (tx) => {
        await tx.reservaPasajero.createMany({
          data: nuevosPasajeros.map((p) => ({ ...p, reservaId: reserva.id })),
        })
      }).catch(anotarFallo('excursiones:checkin:registrarAutoPasajeros'))

      const recargados = await conEmpresa(companyId, (tx) =>
        tx.reservaPasajero.findMany({
          where: { reservaId: reserva.id, companyId },
          select: { id: true },
          orderBy: { tipo: 'asc' },
        })
      )
      reserva.pasajeros = recargados
    }

    const veredicto = evaluarCheckin(
      {
        estado: reserva.estado,
        fecha: reserva.fecha,
        checkinAt: reserva.checkinAt,
        totalPasajeros: reserva.pasajeros.length,
      },
      new Date()
    )
    if (!veredicto.ok) return { error: veredicto.error }

    // Calcular saldo actual de la reserva
    const { saldo } = calcularSaldo(
      Number(reserva.total),
      reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
    )

    // Procesar cobro de saldo pendiente si se solicitó
    const cobrarSaldo = formData.get('cobrarSaldo') === 'true' || formData.get('cobrarSaldo') === 'on'
    const montoCobroRaw = formData.get('montoCobro')
    const metodoCobro = String(formData.get('metodoCobro') ?? 'EFECTIVO').trim() || 'EFECTIVO'
    const referenciaCobro = String(formData.get('referenciaCobro') ?? '').trim()
    let cobroRealizadoTexto = ''
    let saldoRestante = saldo

    if (cobrarSaldo && montoCobroRaw) {
      const montoACobrar = Number(montoCobroRaw)
      if (montoACobrar > 0 && !isNaN(montoACobrar)) {
        await conEmpresa(companyId, (tx) =>
          tx.reservaPago.create({
            data: {
              companyId,
              reservaId: reserva.id,
              monto: montoACobrar,
              moneda: reserva.moneda,
              metodo: metodoCobro,
              referencia: referenciaCobro || `Cobro en Check-in (${reserva.numero})`,
              notas: `Registrado en muelle / control de acceso durante el check-in`,
              confirmadoPorId: user.metadata.dbUserId ?? null,
            },
          })
        )
        const nuevoEstado = await refrescarEstadoPorPagos(companyId, reserva.id)
        if (nuevoEstado === 'PAGADA') {
          await procesarVentaYComisionInterna(
            companyId,
            reserva.id,
            user.metadata.dbUserId ?? null
          ).catch(anotarFallo('excursiones:checkin:autoVentaComision'))
        }
        saldoRestante = Math.max(0, Math.round((saldo - montoACobrar) * 100) / 100)
        cobroRealizadoTexto = ` + Cobro de ${reserva.moneda} ${montoACobrar.toLocaleString()} registrado (${metodoCobro})`
      }
    }

    // REGLA ESTRICTA: No se puede confirmar el embarque si la reserva tiene falta de pago
    if (saldoRestante > 0.01) {
      return {
        error: `No se puede confirmar el embarque: la reserva tiene un saldo pendiente de ${reserva.moneda} ${saldoRestante.toLocaleString('es-DO', { minimumFractionDigits: 2 })}. Debe saldarse el pago para autorizar el acceso.`,
      }
    }

    const suben = pasajerosQueEmbarcan(formData.get('presentes'), reserva.pasajeros.length)
    const ahora = new Date()
    const idsQueSuben = reserva.pasajeros.slice(0, suben).map((p) => p.id)
    const idsQueNo = reserva.pasajeros.slice(suben).map((p) => p.id)
    const esCombo = reserva.items.length > 0

    await conEmpresa(companyId, async (tx) => {
      if (esCombo && itemIdsSeleccionados.length > 0) {
        // Actualizar únicamente los items seleccionados
        await tx.reservaItem.updateMany({
          where: { id: { in: itemIdsSeleccionados }, reservaId: reserva.id, companyId },
          data: {
            estado: 'CHECKIN_COMPLETADO',
            checkinAt: ahora,
          },
        })
      } else if (esCombo) {
        // Si no se especificaron items, marcar todos
        await tx.reservaItem.updateMany({
          where: { reservaId: reserva.id, companyId },
          data: {
            estado: 'CHECKIN_COMPLETADO',
            checkinAt: ahora,
          },
        })
      }

      await tx.reservaExc.update({
        where: { id: reserva.id },
        data: {
          checkinAt: reserva.checkinAt ?? ahora,
          checkinPorId: user.metadata.dbUserId ?? null,
        },
      })

      if (idsQueSuben.length > 0) {
        await tx.reservaPasajero.updateMany({
          where: { id: { in: idsQueSuben }, companyId },
          data: { presente: true, checkinAt: ahora },
        })
      }
      // Corregir a la baja también: si se embarcó de más por error, volver a
      // escanear con menos pasajeros tiene que arreglarlo, no acumular.
      if (idsQueNo.length > 0) {
        await tx.reservaPasajero.updateMany({
          where: { id: { in: idsQueNo }, companyId },
          data: { presente: false, checkinAt: null },
        })
      }
    })

    await auditar(companyId, user.metadata.dbUserId ?? null, reserva.id, {
      tipo: 'RESERVA_CHECKIN',
      numero: reserva.numero,
      presentes: suben,
      de: reserva.pasajeros.length,
      repetido: veredicto.yaEstaba,
      itemIds: itemIdsSeleccionados,
    })

    revalidatePath('/admin/excursiones/checkin')
    revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)

    let detalleItemsTexto = ''
    if (esCombo && itemIdsSeleccionados.length > 0) {
      const confirmados = reserva.items
        .filter((it) => itemIdsSeleccionados.includes(it.id))
        .map((it) => it.actividad.nombre)
      if (confirmados.length > 0) {
        detalleItemsTexto = ` para [${confirmados.join(', ')}]`
      }
    }

    return {
      success: `${reserva.numero}: check-in confirmado${detalleItemsTexto} (${suben} de ${reserva.pasajeros.length} pasajeros)${cobroRealizadoTexto}.`,
    }
  } catch (e) {
    console.error('[excursiones] registrarCheckin:', e)
    return { error: 'No se pudo registrar el embarque.' }
  }
}

/** ADMIN · Registrar cobro de saldo pendiente desde el escáner de check-in. */
export async function registrarCobroCheckin(
  _prev: CheckinActionState,
  formData: FormData
): Promise<CheckinActionState & { saldoRestante?: number }> {
  try {
    const user = await requireSection('excursiones', 'reserva_pago')
    if (!user) return { error: 'No autorizado para registrar pagos.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reservaId = String(formData.get('reservaId') ?? '')
    const montoRaw = String(formData.get('monto') ?? '')
    const metodo = String(formData.get('metodo') ?? 'EFECTIVO').trim() || 'EFECTIVO'
    const referencia = String(formData.get('referencia') ?? '').trim()

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: {
          id: true,
          numero: true,
          total: true,
          moneda: true,
          estado: true,
          pagos: { select: { monto: true, estado: true } },
        },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }

    const { saldo } = calcularSaldo(
      Number(reserva.total),
      reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
    )

    const monto = Number(montoRaw)
    if (!Number.isFinite(monto) || monto <= 0) {
      return { error: 'El monto a cobrar debe ser mayor que cero.' }
    }
    if (monto > saldo + 0.01) {
      return { error: `El monto (${monto}) no puede ser mayor que el saldo pendiente (${saldo}).` }
    }

    await conEmpresa(companyId, (tx) =>
      tx.reservaPago.create({
        data: {
          companyId,
          reservaId: reserva.id,
          monto,
          moneda: reserva.moneda,
          metodo,
          referencia: referencia || `Cobro en Check-in (${reserva.numero})`,
          notas: `Cobrado en control de acceso / muelle`,
          confirmadoPorId: user.metadata.dbUserId ?? null,
        },
      })
    )

    const nuevoEstado = await refrescarEstadoPorPagos(companyId, reserva.id)
    if (nuevoEstado === 'PAGADA') {
      await procesarVentaYComisionInterna(
        companyId,
        reserva.id,
        user.metadata.dbUserId ?? null
      ).catch(anotarFallo('excursiones:checkin:autoVentaComision'))
    }

    await auditar(companyId, user.metadata.dbUserId ?? null, reserva.id, {
      tipo: 'CHECKIN_COBRO_SALDO',
      monto,
      metodo,
      nuevoEstado,
    })

    revalidatePath('/admin/excursiones/checkin')
    revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)

    const nuevoSaldo = Math.max(0, Math.round((saldo - monto) * 100) / 100)
    return {
      success: `Cobro de ${reserva.moneda} ${monto.toLocaleString()} registrado con éxito (${metodo}). Saldo restante: ${reserva.moneda} ${nuevoSaldo.toLocaleString()}`,
      saldoRestante: nuevoSaldo,
    }
  } catch (e) {
    console.error('[excursiones] registrarCobroCheckin:', e)
    return { error: 'No se pudo registrar el pago.' }
  }
}

/** ADMIN · Marcar o desmarcar el check-in de una actividad individual de combo directamente. */
export async function toggleCheckinItem(
  reservaId: string,
  itemId: string,
  completar: boolean
): Promise<{ error?: string; success?: string }> {
  try {
    const user = await requireSection('excursiones', 'checkin_registrar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa requerida.' }

    const item = await conEmpresa(companyId, (tx) =>
      tx.reservaItem.findFirst({
        where: { id: itemId, reservaId, companyId },
        include: {
          actividad: { select: { nombre: true } },
          reserva: {
            select: {
              id: true,
              total: true,
              moneda: true,
              pagos: { select: { monto: true, estado: true } },
            },
          },
        },
      })
    )
    if (!item) return { error: 'Actividad no encontrada en la reserva.' }

    if (completar) {
      const { saldo } = calcularSaldo(
        Number(item.reserva.total),
        item.reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
      )
      if (saldo > 0.01) {
        return {
          error: `No se puede confirmar el check-in: la reserva tiene un saldo pendiente de ${item.reserva.moneda} ${saldo.toLocaleString('es-DO', { minimumFractionDigits: 2 })}. Registra el pago en la reserva antes de autorizar el embarque.`,
        }
      }
    }

    const ahora = new Date()

    await conEmpresa(companyId, async (tx) => {
      await tx.reservaItem.update({
        where: { id: itemId },
        data: {
          estado: completar ? 'CHECKIN_COMPLETADO' : 'PENDIENTE',
          checkinAt: completar ? ahora : null,
        },
      })

      const itemsRestantes = await tx.reservaItem.findMany({
        where: { reservaId, companyId },
        select: { id: true, checkinAt: true, estado: true },
      })
      const algunCompletado = itemsRestantes.some(
        (it) => (it.id === itemId ? completar : it.checkinAt !== null || it.estado === 'CHECKIN_COMPLETADO')
      )

      await tx.reservaExc.update({
        where: { id: reservaId },
        data: {
          checkinAt: algunCompletado ? (item.checkinAt ?? ahora) : null,
          checkinPorId: algunCompletado ? (user.metadata.dbUserId ?? null) : null,
        },
      })
    })

    await auditar(companyId, user.metadata.dbUserId ?? null, reservaId, {
      tipo: 'ITEM_CHECKIN_TOGGLE',
      itemId,
      actividad: item.actividad.nombre,
      completar,
    })

    revalidatePath(`/admin/excursiones/reservas/${reservaId}`)
    revalidatePath('/admin/excursiones/checkin')

    return {
      success: completar
        ? `Check-in confirmado para ${item.actividad.nombre}.`
        : `Check-in desmarcado para ${item.actividad.nombre}.`,
    }
  } catch (e) {
    console.error('[excursiones] toggleCheckinItem:', e)
    return { error: 'No se pudo actualizar el estado de check-in.' }
  }
}

/**
 * ADMIN · Generar (o recuperar) el QR de check-in de una reserva.
 *
 * Se crea cuando se pide, no al reservar: las reservas anteriores a esta fase
 * no tienen token, y una migración que se los inventara a todos habría escrito
 * millones de filas para códigos que quizá nadie use.
 */
export async function tokenDeCheckin(
  _prev: CheckinActionState & { token?: string },
  formData: FormData
): Promise<CheckinActionState & { token?: string }> {
  try {
    const user = await requireSection('excursiones', 'checkin_registrar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reservaId = String(formData.get('reservaId') ?? '')

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: { id: true, checkinToken: true },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }
    if (reserva.checkinToken) return { token: reserva.checkinToken }

    // Reintento ante la colisión: el índice único es el árbitro.
    for (let i = 0; i < 5; i++) {
      const token = generarCodigo(24)
      try {
        await conEmpresa(companyId, (tx) =>
          tx.reservaExc.update({ where: { id: reserva.id }, data: { checkinToken: token } })
        )
        revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)
        return { token }
      } catch (e) {
        const esUnique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
        if (!esUnique || i === 4) throw e
      }
    }
    return { error: 'No se pudo generar el código.' }
  } catch (e) {
    console.error('[excursiones] tokenDeCheckin:', e)
    return { error: 'No se pudo generar el código.' }
  }
}
