import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { sinEmpresa } from '@/lib/tenant'
import { getMetodosParaCompraNueva, ofrecerTransferencia, getCuentasTransferencia } from '@/modules/pagos/metodosDisponibles'
import { calcularPagoCambioPlan } from '@/modules/membresia/prorrateo'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }

  const { membershipId } = await params
  try {
    const membership = await sinEmpresa('api: detalle de membresía para su propietario', (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: {
          cliente: {
            select: {
              supabaseId: true,
              company: { select: { id: true, name: true, logoUrl: true, colorPrimario: true } },
            },
          },
          plan: { select: { id: true, nombre: true, precio: true, vigenciaDias: true } },
          planSolicitado: { select: { id: true, nombre: true, precio: true, vigenciaDias: true } },
          metodoPago: { select: { id: true, nombre: true, tipo: true } },
        },
      })
    )
    if (!membership) {
      return NextResponse.json({ error: 'Membresía no encontrada.' }, { status: 404, headers: corsHeaders(request) })
    }
    if (membership.cliente.supabaseId !== user.supabaseId) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403, headers: corsHeaders(request) })
    }

    const esCambio = membership.estado === 'ACTIVA' && membership.planSolicitado != null
    const esperaPago = ['PENDIENTE', 'PENDIENTE_PAGO', 'RECHAZADA'].includes(membership.estado)
    const necesitaPago = esperaPago || esCambio
    const compromisoTransferencia = membership.metodoPago?.tipo === 'TRANSFERENCIA' || membership.comprobanteUrl != null
    const transferenciaActiva = necesitaPago
      ? await ofrecerTransferencia(membership.companyId, compromisoTransferencia)
      : false
    const opciones = necesitaPago
      ? await getMetodosParaCompraNueva(membership.companyId).catch(() => null)
      : null
    const transferencias = necesitaPago && transferenciaActiva
      ? await getCuentasTransferencia(membership.companyId)
      : []

    const planAPagar = esCambio ? membership.planSolicitado : membership.plan
    const descuentoBienvenida = !esCambio && membership.fechaInicio == null
      ? Number(membership.descuentoBienvenida ?? 0)
      : 0
    const importeAPagar = esCambio && membership.planSolicitado
      ? calcularPagoCambioPlan({
          precioNuevo: Number(membership.planSolicitado.precio),
          precioVigente: Number(membership.plan.precio),
          fechaVencimiento: membership.fechaVencimiento,
          vigenciaDias: membership.plan.vigenciaDias,
        }).aPagar
      : Math.max(0, Number(planAPagar?.precio ?? 0) - descuentoBienvenida)

    return NextResponse.json({
      membresia: {
        id: membership.id,
        estado: membership.estado,
        fechaVencimiento: membership.fechaVencimiento,
        plan: {
          id: membership.plan.id,
          nombre: membership.plan.nombre,
          precio: Number(membership.plan.precio),
          vigenciaDias: membership.plan.vigenciaDias,
        },
        planSolicitado: membership.planSolicitado
          ? {
              id: membership.planSolicitado.id,
              nombre: membership.planSolicitado.nombre,
              precio: Number(membership.planSolicitado.precio),
              vigenciaDias: membership.planSolicitado.vigenciaDias,
            }
          : null,
        company: membership.cliente.company,
        tieneComprobante: membership.comprobanteUrl != null,
        comprobanteNota: membership.comprobanteNota,
        rechazadoReason: membership.rechazadoReason,
        metodoPago: membership.metodoPago,
      },
      pago: necesitaPago
        ? {
            importeAPagar,
            descuentoBienvenida,
            transferenciaActiva,
            cuentas: transferencias,
            metodosDisponibles: opciones?.disponibles ?? [],
          }
        : null,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/membresias/:id] Error cargando membresía:', error)
    return NextResponse.json({ error: 'No pudimos cargar la información de pago.' }, { status: 500, headers: corsHeaders(request) })
  }
}
