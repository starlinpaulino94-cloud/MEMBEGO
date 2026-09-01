import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { getUser } from '@/lib/auth'
import { getPlatformTokenSecret } from '@/lib/env'
import { crearToken, verificarToken } from '@/modules/plataforma/token'

/**
 * DIAGNÓSTICO TEMPORAL del token de plataforma. NO revela el secreto.
 *
 * Existe para cazar un `INVALID_TOKEN` que persiste con credencial válida: si
 * Membego firma con un secreto y verifica con otro, el token propio no supera
 * su propia verificación. Este endpoint lo prueba EN EL MISMO proceso.
 *
 * Devuelve solo datos no sensibles:
 *   - commit / env del deployment (para ver si corre el código esperado),
 *   - si el secreto está configurado y su longitud (una longitud rara delata
 *     un espacio o salto pegado por error),
 *   - una HUELLA corta (sha256, 12 hex) del secreto — no reversible,
 *   - roundTrip: firma un token y lo verifica con el MISMO secreto. `ok:true`
 *     significa que firmar y verificar son consistentes en este deployment.
 *
 * BORRAR cuando el problema quede resuelto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO SUPERADMIN (Connect · Fase 6)
 *
 * Nació público, y eso lo convertía en algo que no pretendía ser: cualquiera
 * en internet podía leer la LONGITUD del secreto de firma de la plataforma y
 * una huella suya. La huella no es reversible, pero sí permite CONFIRMAR un
 * secreto adivinado sin hacer una sola petición más — y la longitud recorta
 * el espacio de búsqueda antes de empezar.
 *
 * No se borra: sigue siendo útil y es de quien lo escribió. Se cierra a la
 * sesión de superadmin, que es exactamente como se usó para depurar CardNET:
 * abriendo la URL en el navegador con la sesión iniciada.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const user = await getUser()
  if (user?.metadata.role !== 'SUPERADMIN') {
    return Response.json({ error: 'No autorizado.' }, { status: 401 })
  }

  const secret = getPlatformTokenSecret()
  const fingerprint = secret
    ? createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 12)
    : null

  let roundTrip: { ok: true } | { ok: false; fallo: string } | 'no-secret' = 'no-secret'
  if (secret) {
    const { token } = crearToken(secret, { cid: 'diag', scopes: [] })
    const v = verificarToken(secret, token)
    roundTrip = v.ok ? { ok: true } : { ok: false, fallo: v.fallo }
  }

  return Response.json({
    nota: 'Diagnóstico temporal. No se revela ningún secreto.',
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    env: process.env.VERCEL_ENV ?? null,
    secretConfigured: Boolean(secret),
    secretLen: secret?.length ?? 0,
    secretFingerprint: fingerprint,
    roundTrip,
  })
}
