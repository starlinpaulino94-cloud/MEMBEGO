import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { getAgendaConfig, ESTADOS_ACTIVOS } from '@/modules/citas/queries'
import { slotsDelDia, ymdEnTz, sumarDias, utcDesdeLocal } from '@/modules/citas/disponibilidad'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * BFF · Agendar cita para canjear un beneficio (app RN).
 *
 * Espejo de la server action `reservarCita` (web) acotado al caso "cita para
 * una compra": misma validación (agenda activa, ventana, turno, anticipación,
 * vehículo, compra disponible) y misma transacción con candado por empresa.
 *
 * ponytail: la server action web es cookie-bound (`getUser()`), no reutilizable
 * desde un Bearer token; se reusan sus helpers de disponibilidad y agenda.
 * Omitidos los efectos best-effort de la web (Google Calendar, notificaciones,
 * revalidatePath) — la cita se crea igual; añadir si la app RN los necesita.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => null)
    const ymd = String(body?.fecha ?? '').trim()
    const hm = String(body?.hora ?? '').trim()
    const vehiculoId = String(body?.vehiculoId ?? '').trim() || null
    let servicio = String(body?.servicio ?? '').trim().slice(0, 300) || null
    if (!YMD_RE.test(ymd) || !HM_RE.test(hm)) {
      return NextResponse.json({ error: 'Elige día y hora.' }, { status: 400, headers: corsHeaders(request) })
    }

    // La compra puede ser de cualquier negocio donde la persona tenga ficha.
    const compra = await sinEmpresa(
      'agendar el canje: el beneficio puede ser de cualquier negocio de la persona',
      (tx) =>
        tx.productoCompra.findUnique({
          where: { id },
          select: {
            id: true,
            clienteId: true,
            companyId: true,
            estado: true,
            usosRestantes: true,
            promocion: { select: { titulo: true } },
          },
        })
    )
    if (!compra || !(await misClienteIds(user.supabaseId)).includes(compra.clienteId)) {
      return NextResponse.json({ error: 'No encontrada' }, { status: 404, headers: corsHeaders(request) })
    }

    const cfg = await getAgendaConfig(compra.companyId).catch(() => null)
    if (!cfg?.activa) {
      return NextResponse.json(
        { error: 'Esta empresa no tiene la agenda de citas activa.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const company = await conEmpresa(compra.companyId, (tx) =>
      tx.company.findUnique({ where: { id: compra.companyId }, select: { zonaHoraria: true } })
    ).catch(() => null)
    const tz = company?.zonaHoraria ?? 'America/Santo_Domingo'

    // Ventana de reserva: entre hoy y hoy + ventanaDias - 1 (en la TZ del negocio).
    const hoy = ymdEnTz(new Date(), tz)
    if (ymd < hoy || ymd > sumarDias(hoy, cfg.ventanaDias - 1)) {
      return NextResponse.json(
        { error: 'Ese día está fuera de la ventana de reservas.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const slot = slotsDelDia(cfg.horarios, ymd, cfg.duracionMin, tz).find((s) => s.hm === hm)
    if (!slot) {
      return NextResponse.json(
        { error: 'Ese horario no está disponible.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }
    if (slot.inicio.getTime() < Date.now() + cfg.anticipacionHoras * 3600_000) {
      return NextResponse.json(
        { error: `Reserva con al menos ${cfg.anticipacionHoras} h de anticipación.` },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    // El vehículo (si viene) debe ser del cliente.
    if (vehiculoId) {
      const veh = await conEmpresa(compra.companyId, (tx) =>
        tx.vehiculo.findFirst({
          where: { id: vehiculoId, clienteId: compra.clienteId },
          select: { id: true },
        })
      ).catch(() => null)
      if (!veh) {
        return NextResponse.json({ error: 'Vehículo no válido.' }, { status: 400, headers: corsHeaders(request) })
      }
    }

    // La recompensa debe estar disponible para canjear.
    if (compra.estado !== 'ACTIVA' || compra.usosRestantes <= 0) {
      return NextResponse.json(
        { error: 'Esa recompensa ya no está disponible.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }
    if (!servicio) servicio = `Canje: ${compra.promocion?.titulo ?? 'Recompensa'}`.slice(0, 300)

    // Límites del día natural en la TZ del negocio.
    const inicioDia = utcDesdeLocal(ymd, '00:00', tz)
    const finDia = utcDesdeLocal(sumarDias(ymd, 1), '00:00', tz)

    // Cupos + creación en una transacción (revalida contra carreras).
    const resultado = await conEmpresa(compra.companyId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "companies" WHERE id = ${compra.companyId} FOR UPDATE`
      const [enSlot, enDia, mias] = await Promise.all([
        tx.cita.count({
          where: { companyId: compra.companyId, inicio: slot.inicio, estado: { in: [...ESTADOS_ACTIVOS] } },
        }),
        tx.cita.count({
          where: {
            companyId: compra.companyId,
            inicio: { gte: inicioDia, lt: finDia },
            estado: { in: [...ESTADOS_ACTIVOS] },
          },
        }),
        tx.cita.count({
          where: {
            clienteId: compra.clienteId,
            companyId: compra.companyId,
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
          companyId: compra.companyId,
          clienteId: compra.clienteId,
          vehiculoId,
          inicio: slot.inicio,
          duracionMin: cfg.duracionMin,
          servicio,
          estado: cfg.autoConfirmar ? 'CONFIRMADA' : 'PENDIENTE',
          compraId: compra.id,
        },
        select: { id: true, estado: true },
      })
      return { cita }
    })

    if ('error' in resultado) {
      return NextResponse.json({ error: resultado.error }, { status: 400, headers: corsHeaders(request) })
    }

    return NextResponse.json({
      success: true,
      cita: resultado.cita,
      mensaje: `Cita para tu ${compra.promocion?.titulo ?? 'recompensa'} el ${ymd} a las ${hm}.`,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/mis-promociones/[id]/agendar] Error reservando cita:', error)
    return NextResponse.json(
      { error: 'No se pudo reservar. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}