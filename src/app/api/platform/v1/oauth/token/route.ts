import { randomBytes } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { getPlatformTokenSecret } from '@/lib/env'
import { createRateLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { hashearSecreto, scopesPedidos, secretoValido } from '@/modules/plataforma/credenciales'
import { errorApi, nuevoRequestId } from '@/modules/plataforma/errores'
import { crearToken } from '@/modules/plataforma/token'
import { anotarUso } from '@/modules/plataforma/api'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/oauth/token — OAuth2 *client credentials*.
 *
 *   grant_type=client_credentials
 *   client_id=mgc_…  client_secret=mgs_…  [scope="customers:read benefits:read"]
 *
 * Se aceptan tanto `application/x-www-form-urlencoded` (RFC 6749) como JSON:
 * el RFC manda, pero todo el resto de esta API habla JSON y obligar a cambiar
 * de codificación solo para pedir el token es la clase de detalle que cuesta
 * una tarde a quien integra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ TODOS LOS FALLOS SON EL MISMO ERROR
 *
 * `client_id` inexistente, secreto incorrecto, credencial revocada y credencial
 * caducada devuelven exactamente `INVALID_CLIENT`. Distinguirlos convertiría
 * este endpoint en un oráculo para averiguar qué `client_id` existen.
 *
 * Y el secreto se comprueba con scrypt INCLUSO cuando el `client_id` no existe,
 * contra un hash señuelo. Sin eso, «no existe» respondería en un milisegundo y
 * «existe pero la clave está mal» en cincuenta: el propio tiempo de respuesta
 * sería el oráculo que el mensaje común pretende evitar.
 */

/** Límite por IP: aquí se prueban secretos, y probar debe ser caro. */
const limiteToken = createRateLimiter({
  interval: 60_000,
  maxRequests: 20,
  name: 'platform-token',
})

/**
 * Hash señuelo con el mismo coste que uno real. Se deriva de un valor aleatorio
 * al cargar el módulo, así que no corresponde a ningún secreto que nadie pueda
 * tener — y se genera en vez de escribirse a mano para que no pueda quedar
 * malformado, que lo haría fallar rápido y devolvernos el oráculo de tiempos.
 */
const HASH_SENUELO = hashearSecreto(randomBytes(32).toString('hex'))

interface Credenciales {
  clientId: string
  clientSecret: string
  grantType: string
  scope: string | null
}

async function leerCredenciales(req: NextRequest): Promise<Credenciales | null> {
  const tipo = req.headers.get('content-type') ?? ''
  try {
    if (tipo.includes('application/json')) {
      const b = (await req.json()) as Record<string, unknown>
      return {
        clientId: String(b.client_id ?? ''),
        clientSecret: String(b.client_secret ?? ''),
        grantType: String(b.grant_type ?? ''),
        scope: typeof b.scope === 'string' ? b.scope : null,
      }
    }
    const f = await req.formData()
    return {
      clientId: String(f.get('client_id') ?? ''),
      clientSecret: String(f.get('client_secret') ?? ''),
      grantType: String(f.get('grant_type') ?? ''),
      scope: f.get('scope') ? String(f.get('scope')) : null,
    }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const requestId = nuevoRequestId()

  const secretoFirma = getPlatformTokenSecret()
  if (!secretoFirma) return errorApi('PLATFORM_API_UNCONFIGURED', requestId)

  if (!(await limiteToken(getClientIdentifier(req)))) {
    return errorApi('RATE_LIMITED', requestId)
  }

  const cred = await leerCredenciales(req)
  if (!cred || !cred.clientId || !cred.clientSecret) {
    return errorApi('INVALID_REQUEST', requestId, {
      message: 'client_id and client_secret are required.',
    })
  }
  if (cred.grantType !== 'client_credentials') {
    return errorApi('INVALID_REQUEST', requestId, {
      message: 'Only grant_type=client_credentials is supported.',
    })
  }

  const fila = await sinEmpresa(
    'api de plataforma: credencial por clientId para emitir token (previa a la empresa)',
    (tx) =>
      tx.credencialSistema.findUnique({
        where: { clientId: cred.clientId },
        select: {
          id: true,
          clientSecretHash: true,
          estado: true,
          scopes: true,
          expiresAt: true,
          sistema: { select: { estado: true } },
        },
      })
  ).catch(() => null)

  // Se verifica SIEMPRE, contra el señuelo si hace falta: el coste de la
  // respuesta no puede depender de si el cliente existe.
  const coincide = secretoValido(cred.clientSecret, fila?.clientSecretHash ?? HASH_SENUELO)

  const utilizable =
    fila !== null &&
    coincide &&
    fila.estado === 'ACTIVE' &&
    fila.sistema.estado === 'ACTIVE' &&
    (fila.expiresAt === null || fila.expiresAt.getTime() > Date.now())

  if (!utilizable) {
    console.warn('[platform-token] credencial rechazada:', cred.clientId, requestId)
    return errorApi('INVALID_CLIENT', requestId)
  }

  const scopes = scopesPedidos(cred.scope, fila.scopes)
  const { token, expiraEn } = crearToken(secretoFirma, { cid: cred.clientId, scopes })
  anotarUso(fila.id)

  return NextResponse.json(
    {
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiraEn,
      scope: scopes.join(' '),
    },
    {
      headers: {
        'X-Request-Id': requestId,
        // Un token en una caché compartida es un token de otro. Aquí el
        // `no-store` no es higiene, es la diferencia entre ceder credenciales
        // y no cederlas.
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    }
  )
}
