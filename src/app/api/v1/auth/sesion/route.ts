import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { respuestaDeSesion } from '@/lib/auth/sesion-ligera'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/auth/sesion — ¿hay sesión y de qué tipo? (separación landing/app · F2)
 *
 * Lo pregunta la LANDING desde un componente de cliente para elegir su enlace de
 * traspaso (iniciar sesión, entrar directo a la ficha, o ir al propio panel). La
 * landing es estática y no puede leer la sesión en servidor sin volverse
 * dinámica entera.
 *
 * Solo contesta «hay sesión», el ROL y su casa. Ni correo, ni nombre, ni ids: no
 * es una forma de averiguar quién es nadie. Nunca se guarda en caché. No concede
 * nada: es información para elegir un enlace, y cada destino sigue
 * protegiéndose por su cuenta.
 */
export async function GET() {
  const user = await getUser().catch(() => null)
  return NextResponse.json(respuestaDeSesion(user?.metadata.role), {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
