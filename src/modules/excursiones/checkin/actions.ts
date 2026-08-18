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

export interface CheckinBusqueda {
  error?: string
  reserva?: {
    id: string
    numero: string
    cliente: string
    telefono: string | null
    excursion: string
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

/** ADMIN · Leer el QR de check-in y ver a quién corresponde. */
export async function buscarParaCheckin(codigo: string): Promise<CheckinBusqueda> {
  try {
    const user = await requireSection('excursiones', 'checkin_registrar')
    if (!user) return { error: 'No tienes permiso para hacer check-in.' }
    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Empresa requerida.' }

    const token = tokenDesdeCodigo(codigo)
    if (!token) return { error: 'Ese código no es un QR de reserva.' }

    // El token es único global, pero la reserva tiene que ser DE ESTA EMPRESA:
    // sin eso, un código de otra empresa mostraría su cliente y su teléfono.
    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { checkinToken: token, companyId },
        select: {
          id: true, numero: true, estado: true, fecha: true, hora: true,
          adultos: true, ninos: true, total: true, moneda: true,
          checkinAt: true, clienteId: true, excursionId: true,
          pagos: { select: { monto: true, estado: true } },
          pasajeros: { select: { presente: true } },
        },
      })
    )
    if (!reserva) return { error: 'No encontramos ninguna reserva con ese código.' }

    const totalPasajeros = reserva.pasajeros.length
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
          select: { nombre: true },
        })
      ),
    ])

    const pagado = reserva.pagos
      .filter((p) => p.estado === 'REGISTRADO')
      .reduce((t, p) => t + Number(p.monto), 0)
    const saldo = Math.round(Math.max(0, Number(reserva.total) - pagado) * 100) / 100

    return {
      reserva: {
        id: reserva.id,
        numero: reserva.numero,
        cliente: cliente?.nombre ?? 'Cliente',
        telefono: cliente?.telefono ?? null,
        excursion: excursion?.nombre ?? '—',
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
      },
    }
  } catch (e) {
    console.error('[excursiones] buscarParaCheckin:', e)
    return { error: 'No se pudo consultar la reserva. Intenta de nuevo.' }
  }
}

/** ADMIN · Confirmar el embarque, con cuántos se subieron de verdad. */
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

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: {
          id: true, numero: true, estado: true, fecha: true, checkinAt: true,
          pasajeros: { select: { id: true }, orderBy: { tipo: 'asc' } },
        },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }

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

    const suben = pasajerosQueEmbarcan(formData.get('presentes'), reserva.pasajeros.length)
    const ahora = new Date()
    const idsQueSuben = reserva.pasajeros.slice(0, suben).map((p) => p.id)
    const idsQueNo = reserva.pasajeros.slice(suben).map((p) => p.id)

    await conEmpresa(companyId, async (tx) => {
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
    })
    revalidatePath('/admin/excursiones/checkin')
    revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)
    return {
      success: `${reserva.numero}: embarcaron ${suben} de ${reserva.pasajeros.length}.`,
    }
  } catch (e) {
    console.error('[excursiones] registrarCheckin:', e)
    return { error: 'No se pudo registrar el embarque.' }
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
