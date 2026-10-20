import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import {
  getAgendaConfig,
  getDisponibilidadDia,
  diasDeVentana,
  ESTADOS_ACTIVOS,
} from '@/modules/citas/queries'
import { sumarDias, utcDesdeLocal } from '@/modules/citas/disponibilidad'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const fecha = (searchParams.get('fecha') ?? '').trim()
    if (fecha && !YMD_RE.test(fecha)) {
      return NextResponse.json({ error: 'La fecha no es válida.' }, { status: 400, headers: corsHeaders(request) })
    }

    const compra = await sinEmpresa(
      'consultar agenda para el canje: el beneficio puede ser de cualquier negocio de la persona',
      (tx) => tx.productoCompra.findUnique({
        where: { id },
        select: { id: true, clienteId: true, companyId: true, estado: true, usosRestantes: true },
      }),
    )
    if (!compra || !(await misClienteIds(user.supabaseId)).includes(compra.clienteId)) {
      return NextResponse.json({ error: 'No encontrada' }, { status: 404, headers: corsHeaders(request) })
    }
    if (compra.estado !== 'ACTIVA' || compra.usosRestantes <= 0) {
      return NextResponse.json({ error: 'Esa recompensa ya no está disponible.' }, { status: 400, headers: corsHeaders(request) })
    }

    const [agenda, company] = await Promise.all([
      getAgendaConfig(compra.companyId),
      conEmpresa(compra.companyId, (tx) =>
        tx.company.findUnique({ where: { id: compra.companyId }, select: { name: true, zonaHoraria: true } }),
      ),
    ])
    const zonaHoraria = company?.zonaHoraria ?? 'America/Santo_Domingo'
    const empresa = { name: company?.name ?? 'Negocio', zonaHoraria }
    if (!agenda?.activa) {
      return NextResponse.json(
        { agenda, dias: [], disponibilidad: null, empresa, yaTieneCita: false },
        { headers: corsHeaders(request) },
      )
    }

    const dias = diasDeVentana(agenda, zonaHoraria)
    const fechaValida = fecha && dias.some((dia) => dia.ymd === fecha) ? fecha : null
    const disponibilidad = fechaValida
      ? await getDisponibilidadDia(compra.companyId, agenda, fechaValida, zonaHoraria)
      : null
    let yaTieneCita = false
    if (fechaValida) {
      const inicioDia = utcDesdeLocal(fechaValida, '00:00', zonaHoraria)
      const finDia = utcDesdeLocal(sumarDias(fechaValida, 1), '00:00', zonaHoraria)
      yaTieneCita = Boolean(await conEmpresa(compra.companyId, (tx) =>
        tx.cita.findFirst({
          where: {
            clienteId: compra.clienteId,
            companyId: compra.companyId,
            inicio: { gte: inicioDia, lt: finDia },
            estado: { in: [...ESTADOS_ACTIVOS] },
          },
          select: { id: true },
        }),
      ))
    }

    return NextResponse.json(
      { agenda, dias, disponibilidad, empresa, yaTieneCita },
      { headers: corsHeaders(request) },
    )
  } catch (error) {
    console.error('[api/v1/cliente/mis-promociones/[id]/agendar] Error cargando disponibilidad:', error)
    return NextResponse.json(
      { error: 'No se pudo cargar la disponibilidad. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) },
    )
  }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
