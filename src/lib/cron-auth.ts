import { NextResponse, type NextRequest } from 'next/server'
import { comparacionConstante } from '@/lib/secretos'

/**
 * Guard compartido de los endpoints de cron.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Las tres rutas de cron (`automatizaciones`, `integraciones`,
 * `renovaciones-tarjeta`) hacían lo mismo copiado a mano, y no exactamente
 * igual: dos devolvían 503 cuando faltaba `CRON_SECRET` y una devolvía 401,
 * que es la respuesta equivocada —401 dice "tu credencial no vale" cuando la
 * verdad es "el servidor no está configurado", y manda a depurar el lado que
 * no tiene el problema.
 *
 * Las tres comparaban además con `!==`, que no es de tiempo constante. Con el
 * secreto llegando en una cabecera y el endpoint respondiendo público, eso es
 * justo el escenario donde un ataque de tiempos es viable.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FALTA `CRON_SECRET` → 503, NO 401
 *
 * Un cron sin secreto configurado no está "no autorizado": está roto. El 503
 * lo distingue en los registros de Vercel de un intento real de entrar sin
 * credencial, que es lo que se quiere poder mirar.
 *
 * Devuelve `null` si la petición está autorizada, o el `NextResponse` de error
 * que el handler debe retornar tal cual.
 */
export function autorizarCron(req: NextRequest): NextResponse | null {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    return NextResponse.json(
      { error: 'CRON_SECRET no configurado en el servidor.' },
      { status: 503 }
    )
  }

  const auth = req.headers.get('authorization')
  // Sin cabecera no hay nada que comparar en tiempo constante: no se filtra
  // nada al cortar aquí, porque la ausencia de cabecera ya es observable.
  if (!auth) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  if (!comparacionConstante(auth, `Bearer ${secreto}`)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  return null
}
