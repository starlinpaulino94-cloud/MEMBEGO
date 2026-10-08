import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import {
  getAgendaConfig,
  getCitasCliente,
  getDisponibilidadDia,
  diasDeVentana,
  ESTADOS_ACTIVOS,
} from '@/modules/citas/queries'
import {
  slotsDelDia,
  utcDesdeLocal,
  sumarDias,
  ymdEnTz,
  etiquetaDia,
} from '@/modules/citas/disponibilidad'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { anotarFallo } from '@/lib/prisma-errors'
import { formSubmitLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

// ─── Google Calendar (best-effort, mismo flujo que la acción web) ────────────
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
    await conEmpresa(cita.companyId, (tx) =>
      tx.cita.update({ where: { id: cita.id }, data: { googleEventId: res.eventoId } })
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

/**
 * GET /api/v1/cliente/citas
 * - Sin `?fecha=`: lista de citas de la persona (todas sus fichas) + agenda de
 *   la empresa activa + días de la ventana + vehículos (para reservar).
 * - Con `?fecha=YYYY-MM-DD`: además, disponibilidad del día.
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { searchParams } = new URL(request.url)
    const fecha = (searchParams.get('fecha') ?? '').trim()
    const clienteId = user.metadata.clienteId

    if (!clienteId) {
      return NextResponse.json(
        { citas: [], agenda: null, dias: [], disponibilidad: null, vehiculos: [] },
        { headers: corsHeaders(request) }
      )
    }

    const [citas, cliente] = await Promise.all([
      getCitasCliente(await misClienteIds(user.supabaseId)),
      sinEmpresa('citas: ficha del cliente (BFF)', (tx) =>
        tx.cliente.findUnique({
          where: { id: clienteId },
          select: {
            id: true,
            companyId: true,
            vehiculos: {
              select: { id: true, marca: true, modelo: true },
              orderBy: { createdAt: 'desc' },
            },
            company: { select: { name: true, zonaHoraria: true, idioma: true } },
          },
        })
      ),
    ])
    if (!cliente) {
      return NextResponse.json(
        { citas, agenda: null, dias: [], disponibilidad: null, vehiculos: [] },
        { headers: corsHeaders(request) }
      )
    }

    const tz = cliente.company.zonaHoraria
    const cfg = await getAgendaConfig(cliente.companyId)
    const dias = cfg?.activa ? diasDeVentana(cfg, tz) : []
    const fechaValida =
      fecha && YMD_RE.test(fecha) && dias.some((d) => d.ymd === fecha) ? fecha : null
    const disponibilidad =
      cfg?.activa && fechaValida
        ? await getDisponibilidadDia(cliente.companyId, cfg, fechaValida, tz)
        : null

    return NextResponse.json(
      {
        citas,
        agenda: cfg,
        dias,
        disponibilidad,
        vehiculos: cliente.vehiculos,
        empresa: { name: cliente.company.name, zonaHoraria: tz },
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/citas] Error cargando citas:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar citas' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

/**
 * POST /api/v1/cliente/citas — reservar.
 * Body: { fecha: "YYYY-MM-DD", hora: "HH:MM", vehiculoId?, servicio?, compraId? }
 * Revalida todo contra la base (agenda activa, ventana, turno, anticipación,
 * cupo por turno/día, 1 cita activa por día) dentro de una transacción.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const clienteId = user.metadata.clienteId
    if (!clienteId) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
    }
    if (!(await formSubmitLimiter(`cita:${clienteId}`))) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Espera un momento.' },
        { status: 429, headers: corsHeaders(request) }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400, headers: corsHeaders(request) })
    }
    const ymd = String((body as Record<string, unknown>).fecha ?? '').trim()
    const hm = String((body as Record<string, unknown>).hora ?? '').trim()
    const vehiculoId = String((body as Record<string, unknown>).vehiculoId ?? '').trim() || null
    let servicio = String((body as Record<string, unknown>).servicio ?? '').trim().slice(0, 300) || null
    const compraId = String((body as Record<string, unknown>).compraId ?? '').trim() || null
    if (!YMD_RE.test(ymd) || !HM_RE.test(hm)) {
      return NextResponse.json({ error: 'Elige día y hora.' }, { status: 400, headers: corsHeaders(request) })
    }

    const cliente = await sinEmpresa('citas: buscar cliente por id (BFF)', (tx) =>
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
    if (!cliente) {
      return NextResponse.json({ error: 'Cliente no encontrado.' }, { status: 404, headers: corsHeaders(request) })
    }
    const tz = cliente.company.zonaHoraria
    const companyId = cliente.companyId

    const cfg = await getAgendaConfig(companyId)
    if (!cfg?.activa) {
      return NextResponse.json(
        { error: 'Esta empresa no tiene la agenda de citas activa.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const hoy = ymdEnTz(new Date(), tz)
    if (ymd < hoy || ymd > sumarDias(hoy, cfg.ventanaDias - 1)) {
      return NextResponse.json(
        { error: 'Ese día está fuera de la ventana de reservas.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const slot = slotsDelDia(cfg.horarios, ymd, cfg.duracionMin, tz).find((s) => s.hm === hm)
    if (!slot) {
      return NextResponse.json({ error: 'Ese horario no está disponible.' }, { status: 400, headers: corsHeaders(request) })
    }
    if (slot.inicio.getTime() < Date.now() + cfg.anticipacionHoras * 3600_000) {
      return NextResponse.json(
        { error: `Reserva con al menos ${cfg.anticipacionHoras} h de anticipación.` },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    if (vehiculoId) {
      const veh = await conEmpresa(companyId, (tx) =>
        tx.vehiculo.findFirst({
          where: { id: vehiculoId, clienteId: cliente.id },
          select: { id: true },
        })
      )
      if (!veh) {
        return NextResponse.json({ error: 'Vehículo no válido.' }, { status: 400, headers: corsHeaders(request) })
      }
    }

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
      if (!compra) {
        return NextResponse.json(
          { error: 'Esa recompensa ya no está disponible.' },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      compraTitulo = compra.promocion?.titulo ?? 'Recompensa'
      if (!servicio) servicio = `Canje: ${compraTitulo}`.slice(0, 300)
    }

    const inicioDia = utcDesdeLocal(ymd, '00:00', tz)
    const finDia = utcDesdeLocal(sumarDias(ymd, 1), '00:00', tz)

    const resultado = await conEmpresa(companyId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "companies" WHERE id = ${companyId} FOR UPDATE`
      const [enSlot, enDia, mias] = await Promise.all([
        tx.cita.count({
          where: { companyId, inicio: slot.inicio, estado: { in: [...ESTADOS_ACTIVOS] } },
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
          ...(compraId ? { compraId } : {}),
        },
        select: { id: true, estado: true },
      })
      return { cita }
    })
    if ('error' in resultado) {
      return NextResponse.json({ error: resultado.error }, { status: 409, headers: corsHeaders(request) })
    }

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

    const mensaje = compraId
      ? `Cita para tu ${compraTitulo ?? 'recompensa'} el ${cuando}. ¡Tu QR quedó habilitado!`
      : cfg.autoConfirmar
        ? `Cita confirmada para el ${cuando}.`
        : `Cita reservada para el ${cuando}. El negocio la confirmará pronto.`

    return NextResponse.json(
      { success: true, mensaje, cita: resultado.cita },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/citas] Error reservando:', error)
    return NextResponse.json(
      { error: 'No se pudo reservar. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

/**
 * DELETE /api/v1/cliente/citas — cancelar la propia cita (mientras no empezó).
 * Body: { citaId }
 */
export async function DELETE(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const body = await request.json().catch(() => null)
    const citaId = String((body as Record<string, unknown> | null)?.citaId ?? '').trim()
    if (!citaId) {
      return NextResponse.json({ error: 'citaId requerido.' }, { status: 400, headers: corsHeaders(request) })
    }

    const misFichas = await misClienteIds(user.supabaseId)
    const cita = await sinEmpresa('citas: buscar cita por id entre MIS fichas (BFF)', (tx) =>
      tx.cita.findFirst({
        where: { id: citaId, clienteId: { in: misFichas } },
        include: {
          cliente: { select: { nombre: true } },
          company: { select: { zonaHoraria: true } },
        },
      })
    )
    if (!cita) {
      return NextResponse.json({ error: 'Cita no encontrada.' }, { status: 404, headers: corsHeaders(request) })
    }
    if (!ESTADOS_ACTIVOS.includes(cita.estado as (typeof ESTADOS_ACTIVOS)[number])) {
      return NextResponse.json(
        { error: 'Esta cita ya no se puede cancelar.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }
    if (cita.inicio.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'La cita ya comenzó; contacta al negocio.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    await conEmpresa(cita.companyId, (tx) =>
      tx.cita.update({
        where: { id: cita.id },
        data: { estado: 'CANCELADA', canceladaPor: 'CLIENTE' },
      })
    )
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

    return NextResponse.json(
      { success: true, mensaje: 'Cita cancelada.' },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/citas] Error cancelando:', error)
    return NextResponse.json(
      { error: 'No se pudo cancelar. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}