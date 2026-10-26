import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import {
  activarRenovacionDelCliente,
  desactivarRenovacionDelCliente,
  renovacionParaLaApp,
} from '@/modules/pagos/renovacionPuerta'

export const dynamic = 'force-dynamic'

/**
 * LA RENOVACIÓN AUTOMÁTICA DE UNA MEMBRESÍA, para la app móvil.
 *
 * Es la misma puerta que usa la web (`renovacionPuerta.ts`): las mismas
 * comprobaciones y los mismos mensajes. Este archivo solo autentica y traduce HTTP.
 *
 * EL SERVIDOR MANDA. El texto del consentimiento lo escribe el servidor (la app lo
 * muestra tal cual) y la aceptación lleva la versión que la persona vio: si el texto
 * cambió entre que lo cargó y que lo aceptó, no se registra. La app no decide si la
 * renovación es elegible ni qué tarjetas sirven.
 */

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

async function clienteDeLaPeticion(request: Request) {
  const user = await getApiClientUser(request)
  if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) return null
  return { supabaseId: user.supabaseId, clienteId: user.metadata.clienteId }
}

const NO_AUTORIZADO = (request: Request) =>
  NextResponse.json({ error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  const quien = await clienteDeLaPeticion(request)
  if (!quien) return NO_AUTORIZADO(request)
  const { membershipId } = await params
  const r = await renovacionParaLaApp(quien, membershipId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.estado, headers: corsHeaders(request) })
  return NextResponse.json(r.cuerpo, { headers: corsHeaders(request) })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  const quien = await clienteDeLaPeticion(request)
  if (!quien) return NO_AUTORIZADO(request)
  const { membershipId } = await params
  const body: unknown = await request.json().catch(() => null)
  const campos = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const r = await activarRenovacionDelCliente(quien, {
    membershipId,
    tarjetaId: typeof campos.tarjetaId === 'string' ? campos.tarjetaId.trim() : '',
    // Solo `true` es aceptar: ni «true» como texto, ni 1, ni la ausencia del campo.
    acepto: campos.acepto === true,
    textoVersionVista: typeof campos.textoVersion === 'string' ? campos.textoVersion : null,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.estado, headers: corsHeaders(request) })
  revalidatePath(`/membresia/${membershipId}`)
  return NextResponse.json({ ok: true }, { headers: corsHeaders(request) })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  const quien = await clienteDeLaPeticion(request)
  if (!quien) return NO_AUTORIZADO(request)
  const { membershipId } = await params
  const r = await desactivarRenovacionDelCliente(quien, membershipId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.estado, headers: corsHeaders(request) })
  revalidatePath(`/membresia/${membershipId}`)
  return NextResponse.json({ ok: true }, { headers: corsHeaders(request) })
}
