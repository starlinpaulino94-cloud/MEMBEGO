import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { sinEmpresa } from '@/lib/tenant'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { getRegalosCliente } from '@/modules/ofertas/queries'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

const PENDIENTES = ['SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION', 'APROBADA', 'RECHAZADA']

/**
 * BFF · Mis promociones (beneficios) para la app RN.
 *
 * Espejo de `/cliente/mis-promociones` (web): compras de TODAS las fichas de
 * la persona + regalos VIP reclamados + resumen (activas / pendientes / usos).
 */
export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    if (!user.metadata.clienteId) {
      return NextResponse.json({
        compras: [],
        regalos: [],
        resumen: { activas: 0, pendientes: 0, usosDisponibles: 0 },
      }, { headers: corsHeaders(request) })
    }

    const clienteIds = await misClienteIds(user.supabaseId).catch(() => [])
    const [regalos, compras] = await Promise.all([
      getRegalosCliente(clienteIds).catch(() => []),
      sinEmpresa(
        'mis beneficios: la persona los ve de todos los negocios donde tiene ficha',
        (tx) =>
          tx.productoCompra.findMany({
            where: { clienteId: { in: clienteIds } },
            select: {
              id: true,
              estado: true,
              usosRestantes: true,
              usosIncluidos: true,
              createdAt: true,
              promocion: { select: { titulo: true, imagenUrl: true, tipo: true } },
              company: { select: { name: true, colorPrimario: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          })
      ).catch(() => []),
    ])

    const activas = compras.filter((c) => c.estado === 'ACTIVA')
    const pendientes = compras.filter((c) => PENDIENTES.includes(c.estado))
    const historial = compras.filter(
      (c) => !PENDIENTES.includes(c.estado) && c.estado !== 'ACTIVA'
    )
    const usosDisponibles = activas.reduce((s, c) => s + c.usosRestantes, 0)

    return NextResponse.json({
      compras,
      regalos,
      historial,
      resumen: {
        activas: activas.length,
        pendientes: pendientes.length,
        usosDisponibles,
      },
    }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/mis-promociones] Error cargando beneficios:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar tus beneficios' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
