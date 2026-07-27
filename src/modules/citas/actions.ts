'use server'

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireAdminUser, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { crearNotificacion, notificarAdmins } from '@/modules/notificaciones/service'
import {
  etiquetaDia,
  normalizarHorarios,
  slotsDelDia,
  sumarDias,
  utcDesdeLocal,
  ymdEnTz,
  type HorarioSemanal,
} from '@/modules/citas/disponibilidad'
import { ESTADOS_ACTIVOS, getAgendaConfig } from '@/modules/citas/queries'
import { anotarFallo } from '@/lib/prisma-errors'

export interface CitaActionState {
  error?: string
  success?: boolean
  mensaje?: string
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * CLIENTE · Reservar una cita.
 *
 * La UI muestra la disponibilidad, pero aquí se REVALIDA todo contra la
 * base (agenda activa, día dentro de la ventana, turno del horario,
 * anticipación, cupo por turno, cupo por día y 1 cita activa por día por
 * cliente) dentro de una transacción: entre cargar la página y confirmar,
 * otro cliente pudo tomar el turno.
 */
export async function reservarCita(
  _prev: CitaActionState,
  formData: FormData
): Promise<CitaActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
      return { error: 'No autorizado.' }
    }
    if (!(await formSubmitLimiter(`cita:${user.metadata.clienteId}`))) {
      return { error: 'Demasiados intentos. Espera un momento.' }
    }

    const ymd = String(formData.get('fecha') ?? '').trim()
    const hm = String(formData.get('hora') ?? '').trim()
    const vehiculoId = String(formData.get('vehiculoId') ?? '').trim() || null
    let servicio = String(formData.get('servicio') ?? '').trim().slice(0, 300) || null
    // Cita para canjear una recompensa gratis (habilita su QR al agendar).
    const compraId = String(formData.get('compraId') ?? '').trim() || null
    if (!YMD_RE.test(ymd) || !HM_RE.test(hm)) return { error: 'Elige día y hora.' }

    const cliente = await prisma.cliente.findUnique({
      where: { id: user.metadata.clienteId },
      select: {
        id: true,
        nombre: true,
        companyId: true,
        company: { select: { zonaHoraria: true, idioma: true } },
      },
    })
    if (!cliente) return { error: 'Cliente no encontrado.' }
    const tz = cliente.company.zonaHoraria

    const cfg = await getAgendaConfig(cliente.companyId)
    if (!cfg?.activa) return { error: 'Esta empresa no tiene la agenda de citas activa.' }

    // Ventana de reserva: entre hoy y hoy + ventanaDias - 1 (en la TZ del negocio).
    const hoy = ymdEnTz(new Date(), tz)
    if (ymd < hoy || ymd > sumarDias(hoy, cfg.ventanaDias - 1)) {
      return { error: 'Ese día está fuera de la ventana de reservas.' }
    }

    // El turno debe existir en el horario del día.
    const slot = slotsDelDia(cfg.horarios, ymd, cfg.duracionMin, tz).find((s) => s.hm === hm)
    if (!slot) return { error: 'Ese horario no está disponible.' }
    if (slot.inicio.getTime() < Date.now() + cfg.anticipacionHoras * 3600_000) {
      return { error: `Reserva con al menos ${cfg.anticipacionHoras} h de anticipación.` }
    }

    // El vehículo (si viene) debe ser del cliente.
    if (vehiculoId) {
      const veh = await prisma.vehiculo.findFirst({
        where: { id: vehiculoId, clienteId: cliente.id },
        select: { id: true },
      })
      if (!veh) return { error: 'Vehículo no válido.' }
    }

    // La recompensa (si viene) debe ser del cliente y estar disponible.
    let compraTitulo: string | null = null
    if (compraId) {
      const compra = await prisma.productoCompra.findFirst({
        where: {
          id: compraId,
          clienteId: cliente.id,
          companyId: cliente.companyId,
          estado: 'ACTIVA',
          usosRestantes: { gt: 0 },
        },
        select: { promocion: { select: { titulo: true } } },
      })
      if (!compra) return { error: 'Esa recompensa ya no está disponible.' }
      compraTitulo = compra.promocion?.titulo ?? 'Recompensa'
      if (!servicio) servicio = `Canje: ${compraTitulo}`.slice(0, 300)
    }

    // Límites del día natural en la TZ del negocio.
    const inicioDia = utcDesdeLocal(ymd, '00:00', tz)
    const finDia = utcDesdeLocal(sumarDias(ymd, 1), '00:00', tz)

    // Cupos + creación en una transacción (revalida contra carreras).
    const resultado = await prisma.$transaction(async (tx) => {
      const [enSlot, enDia, mias] = await Promise.all([
        tx.cita.count({
          where: {
            companyId: cliente.companyId,
            inicio: slot.inicio,
            estado: { in: [...ESTADOS_ACTIVOS] },
          },
        }),
        tx.cita.count({
          where: {
            companyId: cliente.companyId,
            inicio: { gte: inicioDia, lt: finDia },
            estado: { in: [...ESTADOS_ACTIVOS] },
          },
        }),
        tx.cita.count({
          where: {
            clienteId: cliente.id,
            companyId: cliente.companyId,
            inicio: { gte: inicioDia, lt: finDia },
            estado: { in: [...ESTADOS_ACTIVOS] },
          },
        }),
      ])
      if (enSlot >= cfg.maxPorSlot) return { error: 'Ese turno acaba de llenarse. Elige otro.' }
      if (cfg.maxPorDia > 0 && enDia >= cfg.maxPorDia) {
        return { error: 'Ese día ya alcanzó el máximo de citas. Elige otro día.' }
      }
      if (mias > 0) return { error: 'Ya tienes una cita activa para ese día.' }

      const cita = await tx.cita.create({
        data: {
          companyId: cliente.companyId,
          clienteId: cliente.id,
          vehiculoId,
          inicio: slot.inicio,
          duracionMin: cfg.duracionMin,
          servicio,
          estado: cfg.autoConfirmar ? 'CONFIRMADA' : 'PENDIENTE',
        },
        select: { id: true, estado: true },
      })
      return { cita }
    })
    if ('error' in resultado) return { error: resultado.error }

    // Vincular la recompensa a la cita (habilita su QR). Defensivo: si la
    // columna citas.compraId aún no existe (migración 20260756 pendiente),
    // la cita queda creada igual y solo se pierde el vínculo.
    if (compraId) {
      await prisma.cita
        .update({ where: { id: resultado.cita.id }, data: { compraId } })
        .catch((e) => console.error('[citas] vincular compra:', e))
    }

    const cuando = `${etiquetaDia(ymd, tz, cliente.company.idioma ?? undefined)} · ${hm}`
    await notificarAdmins(cliente.companyId, {
      tipo: 'CITA_NUEVA',
      titulo: cfg.autoConfirmar ? 'Nueva cita reservada' : 'Nueva cita por confirmar',
      mensaje: `${cliente.nombre} reservó para el ${cuando}${servicio ? ` — ${servicio}` : ''}.`,
      href: `/admin/citas?fecha=${ymd}`,
    }).catch(anotarFallo('citas:cita.update'))

    revalidatePath('/cliente/citas')
    revalidatePath('/admin/citas')
    if (compraId) {
      revalidatePath(`/cliente/mis-promociones/${compraId}`)
      revalidatePath('/cliente/mis-promociones')
    }
    return {
      success: true,
      mensaje: compraId
        ? `Cita para tu ${compraTitulo ?? 'recompensa'} el ${cuando}. ¡Tu QR quedó habilitado!`
        : cfg.autoConfirmar
          ? `Cita confirmada para el ${cuando}.`
          : `Cita reservada para el ${cuando}. El negocio la confirmará pronto.`,
    }
  } catch (e) {
    console.error('[citas] reservar:', e)
    return { error: 'No se pudo reservar. Intenta de nuevo.' }
  }
}

/** CLIENTE · Cancelar su propia cita (mientras no haya empezado). */
export async function cancelarCitaCliente(
  _prev: CitaActionState,
  formData: FormData
): Promise<CitaActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
      return { error: 'No autorizado.' }
    }
    const citaId = String(formData.get('citaId') ?? '').trim()
    const cita = await prisma.cita.findFirst({
      where: { id: citaId, clienteId: user.metadata.clienteId },
      include: {
        cliente: { select: { nombre: true } },
        company: { select: { zonaHoraria: true } },
      },
    })
    if (!cita) return { error: 'Cita no encontrada.' }
    if (!ESTADOS_ACTIVOS.includes(cita.estado as (typeof ESTADOS_ACTIVOS)[number])) {
      return { error: 'Esta cita ya no se puede cancelar.' }
    }
    if (cita.inicio.getTime() <= Date.now()) {
      return { error: 'La cita ya comenzó; contacta al negocio.' }
    }

    await prisma.cita.update({
      where: { id: cita.id },
      data: { estado: 'CANCELADA', canceladaPor: 'CLIENTE' },
    })

    const tz = cita.company.zonaHoraria
    await notificarAdmins(cita.companyId, {
      tipo: 'CITA_CANCELADA',
      titulo: 'Cita cancelada por el cliente',
      mensaje: `${cita.cliente.nombre} canceló su cita del ${etiquetaDia(ymdEnTz(cita.inicio, tz), tz)}.`,
      href: `/admin/citas?fecha=${ymdEnTz(cita.inicio, tz)}`,
    }).catch(anotarFallo('citas:cita.update'))

    revalidatePath('/cliente/citas')
    revalidatePath('/admin/citas')
    return { success: true, mensaje: 'Cita cancelada.' }
  } catch (e) {
    console.error('[citas] cancelar cliente:', e)
    return { error: 'No se pudo cancelar. Intenta de nuevo.' }
  }
}

/**
 * ADMIN · Confirmar / completar / no-asistió / cancelar una cita.
 * Sección 'citas' (admin pleno + SUPERVISOR).
 */
export async function actualizarEstadoCita(
  _prev: CitaActionState,
  formData: FormData
): Promise<CitaActionState> {
  try {
    const user = await requireSection('citas')
    if (!user) return { error: 'No autorizado.' }

    const citaId = String(formData.get('citaId') ?? '').trim()
    const accion = String(formData.get('accion') ?? '').trim()
    const motivo = String(formData.get('motivo') ?? '').trim() || null

    const cita = await prisma.cita.findUnique({
      where: { id: citaId },
      include: {
        cliente: { select: { nombre: true, supabaseId: true } },
        company: { select: { zonaHoraria: true } },
      },
    })
    if (!cita) return { error: 'Cita no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && cita.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }

    const tz = cita.company.zonaHoraria
    const cuando = `${etiquetaDia(ymdEnTz(cita.inicio, tz), tz)}`
    const activa = ESTADOS_ACTIVOS.includes(cita.estado as (typeof ESTADOS_ACTIVOS)[number])

    let notifCliente: { tipo: 'CITA_CONFIRMADA' | 'CITA_CANCELADA'; titulo: string; mensaje: string } | null = null

    if (accion === 'confirmar') {
      if (cita.estado !== 'PENDIENTE') return { error: 'Esta cita no está pendiente.' }
      await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'CONFIRMADA' } })
      notifCliente = {
        tipo: 'CITA_CONFIRMADA',
        titulo: 'Tu cita fue confirmada',
        mensaje: `Te esperamos el ${cuando}. ¡No faltes!`,
      }
    } else if (accion === 'completar') {
      if (!activa) return { error: 'Esta cita no está activa.' }
      await prisma.cita.update({
        where: { id: cita.id },
        data: { estado: 'COMPLETADA', atendidaPorId: user.metadata.dbUserId ?? null },
      })
    } else if (accion === 'no_asistio') {
      if (!activa) return { error: 'Esta cita no está activa.' }
      await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'NO_ASISTIO' } })
    } else if (accion === 'cancelar') {
      if (!activa) return { error: 'Esta cita no está activa.' }
      if (!motivo) return { error: 'Indica el motivo de la cancelación.' }
      await prisma.cita.update({
        where: { id: cita.id },
        data: { estado: 'CANCELADA', canceladaPor: 'NEGOCIO', motivoCancelacion: motivo },
      })
      notifCliente = {
        tipo: 'CITA_CANCELADA',
        titulo: 'Tu cita fue cancelada',
        mensaje: `El negocio canceló tu cita del ${cuando}: ${motivo}. Puedes reservar otro turno.`,
      }
    } else {
      return { error: 'Acción no válida.' }
    }

    if (notifCliente) {
      const clienteUser = await prisma.user.findUnique({
        where: { supabaseId: cita.cliente.supabaseId },
        select: { id: true },
      })
      if (clienteUser) {
        await crearNotificacion({
          userId: clienteUser.id,
          tipo: notifCliente.tipo,
          titulo: notifCliente.titulo,
          mensaje: notifCliente.mensaje,
          href: '/cliente/citas',
        }).catch(anotarFallo('citas:user.findUnique'))
      }
    }

    revalidatePath('/admin/citas')
    revalidatePath('/cliente/citas')
    return { success: true }
  } catch (e) {
    console.error('[citas] actualizar estado:', e)
    return { error: 'No se pudo actualizar la cita.' }
  }
}

/**
 * ADMIN · Guardar la configuración de la agenda (límites por turno/hora y por
 * día, duración, horarios semanales, ventana, anticipación, autoconfirmación).
 * Solo admin pleno: cambia las reglas de capacidad del negocio.
 */
export async function guardarAgendaConfig(
  _prev: CitaActionState,
  formData: FormData
): Promise<CitaActionState> {
  try {
    const user = await requireAdminUser()
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const num = (k: string, def: number, min: number, max: number) => {
      const n = Number(String(formData.get(k) ?? ''))
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def
    }
    const activa = formData.get('activa') === 'on'
    const autoConfirmar = formData.get('autoConfirmar') === 'on'
    const duracionMin = num('duracionMin', 30, 10, 240)
    const maxPorSlot = num('maxPorSlot', 1, 1, 100)
    const maxPorDia = num('maxPorDia', 0, 0, 500)
    const anticipacionHoras = num('anticipacionHoras', 1, 0, 168)
    const ventanaDias = num('ventanaDias', 14, 1, 60)
    const notas = String(formData.get('notas') ?? '').trim().slice(0, 500) || null

    // Horario semanal: una franja por día (dia_{0..6}_activo/desde/hasta).
    const horarios: HorarioSemanal = {}
    for (let d = 0; d <= 6; d++) {
      if (formData.get(`dia_${d}_activo`) !== 'on') continue
      const desde = String(formData.get(`dia_${d}_desde`) ?? '').trim()
      const hasta = String(formData.get(`dia_${d}_hasta`) ?? '').trim()
      horarios[String(d)] = [{ desde, hasta }]
    }
    const horariosValidos = normalizarHorarios(horarios)
    if (activa && Object.keys(horariosValidos).length === 0) {
      return { error: 'Activa al menos un día con un horario válido (desde < hasta).' }
    }

    await prisma.agendaConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        activa,
        duracionMin,
        maxPorSlot,
        maxPorDia,
        anticipacionHoras,
        ventanaDias,
        autoConfirmar,
        notas,
        horarios: horariosValidos as Prisma.InputJsonValue,
      },
      update: {
        activa,
        duracionMin,
        maxPorSlot,
        maxPorDia,
        anticipacionHoras,
        ventanaDias,
        autoConfirmar,
        notas,
        horarios: horariosValidos as Prisma.InputJsonValue,
      },
    })

    revalidatePath('/admin/citas')
    revalidatePath('/admin/citas/configuracion')
    revalidatePath('/cliente/citas')
    return { success: true, mensaje: 'Agenda guardada.' }
  } catch (e) {
    console.error('[citas] guardar config:', e)
    return { error: 'No se pudo guardar la configuración.' }
  }
}
