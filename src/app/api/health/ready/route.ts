import { NextResponse, type NextRequest } from 'next/server'
import { readiness } from '@/modules/supply-v2/operations/salud'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health/ready · READINESS (§7, §26).
 *
 * ¿Puede Supply operar? Comprueba base, esquema, configuración crítica,
 * cuenta de la integración, secreto de la pasarela cuando la capacidad está
 * encendida, y la cola de trabajos.
 *
 * LO QUE NO HACE: llamar al proveedor externo. Readiness se consulta muchas
 * veces por minuto; hacerlo convertiría cada sonda en tráfico hacia un tercero
 * y su latencia en nuestra indisponibilidad.
 *
 * Y distingue las dos cosas que no son lo mismo:
 *
 *   capacidad apagada a propósito      → 200, el componente dice NOT_CONFIGURED
 *   capacidad encendida sin configurar → 503, no se puede operar
 *
 * El detalle por componente va en el cuerpo porque es lo que hace útil la
 * sonda, y no lleva ni un valor de configuración: solo estados y frases.
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const r = await readiness()
  // `degraded` responde 200: hay trabajo acumulado y el servicio atiende. Un
  // 503 ahí haría que el balanceador sacara una instancia que funciona.
  const http = r.status === 'not_ready' ? 503 : 200
  return NextResponse.json(r, { status: http, headers: { 'cache-control': 'no-store' } })
}
