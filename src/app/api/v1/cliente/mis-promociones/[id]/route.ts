import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { sinEmpresa } from '@/lib/tenant'
import { misClienteIds } from '@/modules/cliente/afiliacion'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Detalle de una compra (beneficio) para la app RN.
 *
 * Espejo de `/cliente/mis-promociones/[id]` (web): la compra puede ser de
 * cualquier negocio donde la persona tenga ficha; la pertenencia se valida
 * contra `misClienteIds`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { id } = await params
    const compra = await sinEmpresa(
      'detalle del beneficio: puede ser de cualquier negocio donde la persona tenga ficha',
      (tx) =>
        tx.productoCompra.findUnique({
          where: { id },
          include: {
            promocion: true,
            company: { select: { name: true, zonaHoraria: true } },
            metodoPago: true,
            transiciones: { orderBy: { createdAt: 'asc' } },
            qrTokens: { where: { activo: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            campanaPaso: {
              select: {
                orden: true,
                campanaId: true,
                campana: { select: { nombre: true } },
              },
            },
          },
        })
    )
    if (!compra || !(await misClienteIds(user.supabaseId)).includes(compra.clienteId)) {
      return NextResponse.json({ error: 'No encontrada' }, { status: 404, headers: corsHeaders(request) })
    }

    return NextResponse.json({
      id: compra.id,
      clienteId: compra.clienteId,
      companyId: compra.companyId,
      estado: compra.estado,
      usosRestantes: compra.usosRestantes,
      usosIncluidos: compra.usosIncluidos,
      precioCongelado: Number(compra.precioCongelado ?? 0),
      createdAt: compra.createdAt,
      fechaActivacion: compra.fechaActivacion,
      fechaVencimiento: compra.fechaVencimiento,
      comprobanteUrl: compra.comprobanteUrl,
      comprobanteNota: compra.comprobanteNota,
      rechazadoReason: compra.rechazadoReason,
      promocion: compra.promocion,
      company: compra.company,
      metodoPago: compra.metodoPago,
      transiciones: compra.transiciones,
      qr: compra.qrTokens[0] ?? null,
      campanaPaso: compra.campanaPaso,
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/mis-promociones/[id]] Error cargando beneficio:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar el beneficio' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}