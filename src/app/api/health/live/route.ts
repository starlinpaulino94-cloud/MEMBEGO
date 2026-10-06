import { NextResponse } from 'next/server'
import { liveness } from '@/modules/supply-v2/operations/salud'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health/live · LIVENESS (§7).
 *
 * ¿Está vivo el proceso? Y nada más.
 *
 * NO toca la base de datos y NO llama a nadie de fuera, y eso es justamente el
 * punto: si liveness dependiera de un tercero, un proveedor caído haría que el
 * orquestador reiniciara una aplicación perfectamente sana —y reiniciar no
 * arregla el proveedor de otro—. Para «¿puede operar?» está `/ready`.
 *
 * Público y sin secretos: lo único que revela es que hay un proceso atendiendo.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(liveness(), { headers: { 'cache-control': 'no-store' } })
}
