import { NextResponse, type NextRequest } from 'next/server'
import { createRateLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { comparacionConstante } from '@/lib/secretos'

/**
 * Guard compartido para los endpoints de operación sensibles
 * (/api/bootstrap-superadmin, /api/admin-reset-password).
 *
 * Estos endpoints pueden crear un SUPERADMIN o restablecer la contraseña de
 * cualquier cuenta, así que su exposición debe ser mínima:
 *
 *  1. Apagado por defecto: solo funcionan si BOOTSTRAP_ENABLED === 'true'.
 *     Así se desactivan sin redeploy: basta con quitar/poner en false la
 *     variable en Vercel una vez terminado el arranque.
 *  2. Secreto obligatorio y suficientemente largo (>= 24 chars).
 *  3. Comparación en tiempo constante (evita timing attacks).
 *  4. Rate limit por IP (evita fuerza bruta del secreto).
 *
 * Devuelve `null` si la petición está autorizada, o un `NextResponse` de error
 * que el handler debe retornar tal cual.
 */

const bootstrapLimiter = createRateLimiter({
  interval: 15 * 60 * 1000, // 15 minutos
  maxRequests: 5, // 5 intentos por IP cada 15 min
})

// La comparación en tiempo constante vive en `@/lib/secretos`: estaba aquí
// como función privada, así que los crons no podían usarla y comparaban
// con `!==`. Se mantiene el nombre local para no tocar las llamadas de abajo.
const constantTimeEqual = comparacionConstante

export async function checkBootstrapAccess(
  req: NextRequest
): Promise<NextResponse | null> {
  // 1. Debe estar explícitamente habilitado.
  if (process.env.BOOTSTRAP_ENABLED !== 'true') {
    return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  }

  // 2. Secreto configurado y con largo mínimo.
  const secret = process.env.BOOTSTRAP_SECRET
  if (!secret || secret.length < 24) {
    return NextResponse.json(
      { error: 'BOOTSTRAP_SECRET no está configurado correctamente en el servidor.' },
      { status: 500 }
    )
  }

  // 3. Rate limit por IP antes de comparar el secreto.
  const ip = getClientIdentifier(req)
  if (!(await bootstrapLimiter(`bootstrap:${ip}`))) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta de nuevo más tarde.' },
      { status: 429 }
    )
  }

  // 4. Comparación en tiempo constante del header.
  const provided = req.headers.get('x-bootstrap-secret') ?? ''
  if (!constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  return null
}
