import { after, NextResponse } from 'next/server'
import { recibirAvisoDeProveedor } from '@/modules/identidad/eventos'

/**
 * `POST /api/webhooks/identidad/<proveedor>` — los avisos del proveedor de verificación.
 *
 * La ruta es pública por necesidad (el proveedor no lleva credenciales nuestras) y está
 * fuera del `matcher` del proxy de sesión (`/api/webhooks`). Lo que la protege NO es la
 * sesión: es la firma, que se verifica sobre los bytes crudos ANTES de tocar la base.
 * Todo el camino (firma → forma → bandeja → proceso) vive en
 * `modules/identidad/eventos.ts`, que se prueba sin levantar Next.
 *
 * Responde 200 en cuanto el aviso quedó guardado (el proveedor corta a los 5 s) y procesa
 * DESPUÉS con `after`: preguntar la decisión al proveedor y borrar la sesión tarda más.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Cabeceras que se le pasan al verificador. Lista cerrada. */
const CABECERAS = ['x-signature-v2', 'x-signature', 'x-timestamp'] as const

export async function POST(request: Request, { params }: { params: Promise<{ proveedor: string }> }): Promise<NextResponse> {
  const { proveedor } = await params
  // El cuerpo se lee UNA vez y en crudo: la firma se calcula sobre los bytes que llegaron.
  const cuerpoCrudo = await request.text()
  const cabeceras: Record<string, string | null> = {}
  for (const nombre of CABECERAS) cabeceras[nombre] = request.headers.get(nombre)

  const respuesta = await recibirAvisoDeProveedor({ proveedor, cuerpoCrudo, cabeceras })
  if (respuesta.despues) after(respuesta.despues)
  return NextResponse.json(respuesta.body, { status: respuesta.status, headers: { 'Cache-Control': 'no-store' } })
}
