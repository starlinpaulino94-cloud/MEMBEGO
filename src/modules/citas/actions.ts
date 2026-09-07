'use server'

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { requireAdminUser, requireSection, usuarioPuedeFuncion } from '@/lib/auth/guards'
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
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { anotarFallo } from '@/lib/prisma-errors'

export interface CitaActionState {
  error?: string
  success?: boolean
  mensaje?: string
}

/**
 * ─── Google Calendar ─────────────────────────────────────────────────────────
 *
 * Las dos operaciones del ciclo de vida del evento de una cita, en UN sitio:
 * llevarla a la agenda al confirmarse —venga de donde venga la confirmación—
 * y quitarla al cancelarse, la cancele quien la cancele. Best-effort las dos:
 * la cita ya cambió de estado y está guardada; que Google esté caído no puede
 * deshacerlo ni devolver un error a quien pulsó el botón — el fallo queda en
 * la salud de la conexión, que es donde se mira.
 *
 * La importación es dinámica para no cargar el conector —y su cliente HTTP—
 * en cada acción de citas que no lo necesita.
 */
interface CitaParaGoogle {
  id: string
  companyId: string
  googleEventId: string | null
  inicio: Date
  duracionMin: number
  servicio: string | null
  clienteNombre: string | null
  tz: string
}

async function llevarCitaAGoogle(cita: CitaParaGoogle): Promise<void> {
  // Con id guardado no se vuelve a crear: primera línea de defensa contra el
  // duplicado (la segunda es el id determinista, que Google rechaza con 409).
  if (cita.googleEventId) return
  const { tz } = cita
  try {
    const { crearEventoCalendario } = await import('@/modules/connect/googleCalendar')
    const res = await crearEventoCalendario({
      companyId: cita.companyId,
      citaId: cita.id,
      evento: {
        titulo: `${cita.servicio ?? 'Cita'} · ${cita.clienteNombre ?? 'Cliente'}`,
        descripcion: 'Cita confirmada desde MembeGo.',
        inicio: cita.inicio,
        fin: new Date(cita.inicio.getTime() + cita.duracionMin * 60_000),
        zonaHoraria: tz,
      },
    })
    if (!res.ok || !res.eventoId) return
    const eventoId = res.eventoId
    // El id se guarda para poder borrarlo al cancelar y no crearlo dos veces.
    await conEmpresa(cita.companyId, (tx) =>
      tx.cita.update({ where: { id: cita.id }, data: { googleEventId: eventoId } })
    )
  } catch (e) {
    console.error('[citas] no se pudo crear el evento en Google:', e)
  }
}

async function quitarCitaDeGoogle(
  cita: Pick<CitaParaGoogle, 'id' | 'companyId' | 'googleEventId'>
): Promise<void> {
  if (!cita.googleEventId) return
  try {
    const { eliminarEventoCalendario } = await import('@/modules/connect/googleCalendar')
    const res = await eliminarEventoCalendario({
      companyId: cita.companyId,
      eventoId: cita.googleEventId,
    })
    if (!res.ok) return
    await conEmpresa(cita.companyId, (tx) =>
      tx.cita.update({ where: { id: cita.id }, data: { googleEventId: null } })
    )
  } catch (e) {
    console.error('[citas] no se pudo quitar el evento de Google:', e)
  }
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
    // A un const: dentro del closure de sinEmpresa/conEmpresa, TS pierde el
    // estrechamiento de user.metadata.clienteId (la función podría llamarse
    // después), y `string | null` rompe el `where` — que a su vez colapsa el
    // tipo del select y esconde la relación `company`.
    const clienteId = user.metadata.clienteId
    if (!(await formSubmitLimiter(`cita:${clienteId}`))) {
      return { error: 'Demasiados intentos. Espera un momento.' }
    }

    const ymd = String(formData.get('fecha') ?? '').trim()
    const hm = String(formData.get('hora') ?? '').trim()
    const vehiculoId = String(formData.get('vehiculoId') ?? '').trim() || null
    let servicio = String(formData.get('servicio') ?? '').trim().slice(0, 300) || null
    // Cita para canjear una recompensa gratis (habilita su QR al agendar).
    const compraId = String(formData.get('compraId') ?? '').trim() || null
    if (!YMD_RE.test(ymd) || !HM_RE.test(hm)) return { error: 'Elige día y hora.' }

    const cliente = await sinEmpresa('citas: buscar cliente por id (se usa su empresa después)', (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: {
          id: true,
          nombre: true,
          companyId: true,
          company: { select: { zonaHoraria: true, idioma: true } },
        },
      })
    )
    if (!cliente) return { error: 'Cliente no encontrado.' }
    const tz = cliente.company.zonaHoraria
    const companyId = cliente.companyId

    const cfg = await getAgendaConfig(companyId)
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
      const veh = await conEmpresa(companyId, (tx) =>
        tx.vehiculo.findFirst({
          where: { id: vehiculoId, clienteId: cliente.id },
          select: { id: true },
        })
      )
      if (!veh) return { error: 'Vehículo no válido.' }
    }

    // La recompensa (si viene) debe ser del cliente y estar disponible.
    let compraTitulo: string | null = null
    if (compraId) {
      const compra = await conEmpresa(companyId, (tx) =>
        tx.productoCompra.findFirst({
          where: {
            id: compraId,
            clienteId: cliente.id,
            companyId,
            estado: 'ACTIVA',
            usosRestantes: { gt: 0 },
          },
          select: { promocion: { select: { titulo: true } } },
        })
      )
      if (!compra) return { error: 'Esa recompensa ya no está disponible.' }
      compraTitulo = compra.promocion?.titulo ?? 'Recompensa'
      if (!servicio) servicio = `Canje: ${compraTitulo}`.slice(0, 300)
    }

    // Límites del día natural en la TZ del negocio.
    const inicioDia = utcDesdeLocal(ymd, '00:00', tz)
    const finDia = utcDesdeLocal(sumarDias(ymd, 1), '00:00', tz)

    // Cupos + creación en una transacción (revalida contra carreras).
    const resultado = await conEmpresa(companyId, async (tx) => {
      const [enSlot, enDia, mias] = await Promise.all([
        tx.cita.count({
          where: {
            companyId,
            inicio: slot.inicio,
            estado: { in: [...ESTADOS_ACTIVOS] },
          },
        }),
        tx.cita.count({
          where: {
            companyId,
            inicio: { gte: inicioDia, lt: finDia },
            estado: { in: [...ESTADOS_ACTIVOS] },
          },
        }),
        tx.cita.count({
          where: {
            clienteId: cliente.id,
            companyId,
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
          companyId,
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
      await conEmpresa(companyId, (tx) =>
        tx.cita.update({ where: { id: resultado.cita.id }, data: { compraId } })
      ).catch((e) => console.error('[citas] vincular compra:', e))
    }

    // Con la agenda en autoconfirmación la cita nace CONFIRMADA y tiene que
    // llegar a la agenda de Google igual que si la confirmara el negocio.
    // Antes solo llegaban las confirmadas a mano: con autoconfirmación no
    // llegaba ninguna.
    if (resultado.cita.estado === 'CONFIRMADA') {
      await llevarCitaAGoogle({
        id: resultado.cita.id,
        companyId,
        googleEventId: null,
        inicio: slot.inicio,
        duracionMin: cfg.duracionMin,
        servicio,
        clienteNombre: cliente.nombre,
        tz,
      })
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
    // Contra TODAS sus fichas: el listado de citas es de la persona y muestra
    // las de todos sus negocios. Comprobando solo la ficha activa, el botón
    // «Cancelar» de una cita de otro negocio respondía «Cita no encontrada»
    // sobre una cita que la propia pantalla acababa de mostrarle.
    const misFichas = await misClienteIds(user.supabaseId)
    const citaId = String(formData.get('citaId') ?? '').trim()
    const cita = await sinEmpresa('citas: buscar cita por id entre MIS fichas', (tx) =>
      tx.cita.findFirst({
        where: { id: citaId, clienteId: { in: misFichas } },
        include: {
          cliente: { select: { nombre: true } },
          company: { select: { zonaHoraria: true } },
        },
      })
    )
    if (!cita) return { error: 'Cita no encontrada.' }
    if (!ESTADOS_ACTIVOS.includes(cita.estado as (typeof ESTADOS_ACTIVOS)[number])) {
      return { error: 'Esta cita ya no se puede cancelar.' }
    }
    if (cita.inicio.getTime() <= Date.now()) {
      return { error: 'La cita ya comenzó; contacta al negocio.' }
    }

    await conEmpresa(cita.companyId, (tx) =>
      tx.cita.update({
        where: { id: cita.id },
        data: { estado: 'CANCELADA', canceladaPor: 'CLIENTE' },
      })
    )
    // El evento no puede quedarse en la agenda de una cita que ya no existe.
    await quitarCitaDeGoogle({
      id: cita.id,
      companyId: cita.companyId,
      googleEventId: cita.googleEventId,
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
    const user = await requireSection('citas', 'gestionar')
    if (!user) return { error: 'No autorizado.' }

    const citaId = String(formData.get('citaId') ?? '').trim()
    const accion = String(formData.get('accion') ?? '').trim()
    const motivo = String(formData.get('motivo') ?? '').trim() || null

    const cita = await sinEmpresa('citas: buscar cita por id (se usa su empresa después)', (tx) =>
      tx.cita.findUnique({
        where: { id: citaId },
        include: {
          cliente: { select: { nombre: true, supabaseId: true } },
          company: { select: { zonaHoraria: true } },
        },
      })
    )
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
      await conEmpresa(cita.companyId, (tx) =>
        tx.cita.update({ where: { id: cita.id }, data: { estado: 'CONFIRMADA' } })
      )
      notifCliente = {
        tipo: 'CITA_CONFIRMADA',
        titulo: 'Tu cita fue confirmada',
        mensaje: `Te esperamos el ${cuando}. ¡No faltes!`,
      }

      // Y a la agenda de Google del negocio, si la tiene conectada (Membego
      // Connect). Best-effort: ver `llevarCitaAGoogle`.
      await llevarCitaAGoogle({
        id: cita.id,
        companyId: cita.companyId,
        googleEventId: cita.googleEventId,
        inicio: cita.inicio,
        duracionMin: cita.duracionMin,
        servicio: cita.servicio,
        clienteNombre: cita.cliente?.nombre ?? null,
        tz,
      })
    } else if (accion === 'completar') {
      if (!activa) return { error: 'Esta cita no está activa.' }
      await conEmpresa(cita.companyId, (tx) =>
        tx.cita.update({
          where: { id: cita.id },
          data: { estado: 'COMPLETADA', atendidaPorId: user.metadata.dbUserId ?? null },
        })
      )
    } else if (accion === 'no_asistio') {
      if (!activa) return { error: 'Esta cita no está activa.' }
      await conEmpresa(cita.companyId, (tx) =>
        tx.cita.update({ where: { id: cita.id }, data: { estado: 'NO_ASISTIO' } })
      )
    } else if (accion === 'cancelar') {
      if (!activa) return { error: 'Esta cita no está activa.' }
      if (!motivo) return { error: 'Indica el motivo de la cancelación.' }
      await conEmpresa(cita.companyId, (tx) =>
        tx.cita.update({
          where: { id: cita.id },
          data: { estado: 'CANCELADA', canceladaPor: 'NEGOCIO', motivoCancelacion: motivo },
        })
      )
      // El evento no puede quedarse en la agenda de una cita que ya no existe.
      await quitarCitaDeGoogle({
        id: cita.id,
        companyId: cita.companyId,
        googleEventId: cita.googleEventId,
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
      const clienteUser = await sinEmpresa('citas: buscar usuario por supabaseId (cross-tenant)', (tx) =>
        tx.user.findUnique({
          where: { supabaseId: cita.cliente.supabaseId },
          select: { id: true },
        })
      )
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
    // Módulo de Permisos: llevar la agenda y CONFIGURARLA son poderes
    // distintos — se puede dejar el módulo de citas y negar solo este.
    if (!(await usuarioPuedeFuncion(user, 'citas', 'configurar'))) {
      return { error: 'No tienes permiso para configurar la agenda.' }
    }
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

    await conEmpresa(companyId, (tx) =>
      tx.agendaConfig.upsert({
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
    )

    revalidatePath('/admin/citas')
    revalidatePath('/admin/citas/configuracion')
    revalidatePath('/cliente/citas')
    return { success: true, mensaje: 'Agenda guardada.' }
  } catch (e) {
    console.error('[citas] guardar config:', e)
    return { error: 'No se pudo guardar la configuración.' }
  }
}
