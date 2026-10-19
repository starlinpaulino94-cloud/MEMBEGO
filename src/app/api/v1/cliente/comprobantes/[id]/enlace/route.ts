import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { ticketParaCliente } from '@/modules/transacciones/comprobanteCliente'
import {
  firmarEnlaceComprobante,
  rutaComprobantePublico,
  VIGENCIA_ENLACE_MIN,
} from '@/modules/transacciones/enlaceComprobante'
import { appUrlFor } from '@/lib/site'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * La app pide aquí, con su sesión (Bearer), un enlace firmado y de vida corta
 * al comprobante de UNA venta suya; lo abre en el navegador del teléfono,
 * donde el cliente imprime o guarda el PDF. Sin propiedad → 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }
  const { id } = await params
  const ticket = await ticketParaCliente(id, user.supabaseId)
  if (!ticket) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404, headers: corsHeaders(request) })
  }
  const token = firmarEnlaceComprobante(id)
  return NextResponse.json(
    {
      url: appUrlFor(rutaComprobantePublico(token)),
      vigenciaSegundos: VIGENCIA_ENLACE_MIN * 60,
      codigo: ticket.transaccion.codigo,
    },
    { headers: corsHeaders(request) }
  )
}
