import { NextResponse, type NextRequest } from 'next/server'
import { destinoDeEnlace } from '@/modules/excursiones/vendedores/queries'

export const dynamic = 'force-dynamic'

/**
 * EL ENLACE DEL VENDEDOR (§10): membego.com/e/<slug> — lo que viaja dentro de
 * su QR y en sus mensajes de WhatsApp. Redirige al registro de SU empresa con
 * el código del vendedor; la Fase 4 registra aquí la atribución de VISITA.
 * Enlace desconocido o vendedor no activo → a la portada, sin filtrar nada.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const destino = await destinoDeEnlace(slug.trim().toLowerCase())
  return NextResponse.redirect(new URL(destino ?? '/', req.nextUrl.origin))
}
