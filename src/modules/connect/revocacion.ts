import 'server-only'
import { anotarConector } from '@/modules/connect/bitacora'
import { leerCredencial } from '@/modules/connect/credenciales'
import { configOauthDe } from '@/modules/connect/oauthRutas'

/**
 * REVOCAR EN EL PROVEEDOR antes de borrar la credencial.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA CON BORRAR
 *
 * Borrar nuestro sello deja el refresh token VIVO en Google: la empresa cree
 * que desconectó y la app sigue apareciendo en «Aplicaciones con acceso a tu
 * cuenta», con permiso para crear eventos hasta que alguien lo quite a mano.
 * Google además lo exige para verificar una app que pide permisos sensibles.
 *
 * Con el refresh token se revoca todo (los access tokens emitidos con él caen
 * con él); si no hubiera refresh, se manda el access token.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BEST-EFFORT, Y EN SU PROPIO MÓDULO
 *
 * Un fallo aquí NO impide desconectar: el remedio para un token que no se
 * pudo revocar es borrar nuestra copia igualmente, que es lo que hace el
 * llamador después. El resultado queda en la bitácora.
 *
 * Vive aparte de `oauth.ts` porque `oauth.ts` importa `registro.ts` (para la
 * salud) y `registro.ts` es quien desconecta: meter la revocación en
 * `oauth.ts` cerraría un ciclo de imports.
 */

const TIMEOUT_MS = 8_000

export type ResultadoRevocacion = 'revocado' | 'sin_revocacion' | 'sin_credencial' | 'fallo'

export async function revocarTokensOauth(input: {
  companyId: string
  conexionId: string
  /** Slug del conector, para resolver dónde se revoca. */
  slug: string
}): Promise<ResultadoRevocacion> {
  const config = configOauthDe(input.slug)
  // Un proveedor sin punto de revocación (o sin OAuth) no tiene nada que revocar.
  if (!config?.urlRevocacion) return 'sin_revocacion'

  const cred = await leerCredencial({
    companyId: input.companyId,
    conexionId: input.conexionId,
    tipo: 'OAUTH_TOKENS',
  })
  if (!cred.ok) return 'sin_credencial'

  let token: string | null = null
  try {
    const tokens = JSON.parse(cred.secreto) as { accessToken?: string; refreshToken?: string | null }
    token = tokens.refreshToken ?? tokens.accessToken ?? null
  } catch {
    return 'sin_credencial'
  }
  if (!token) return 'sin_credencial'

  try {
    const resp = await fetch(config.urlRevocacion, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // Google responde 200 al revocar y 400 si el token ya no valía (revocado
    // a mano, caducado). Para nosotros es el mismo resultado: ya no sirve.
    const hecho = resp.ok || resp.status === 400
    await anotarConector({
      companyId: input.companyId,
      origen: 'CONEXION',
      origenId: input.conexionId,
      nivel: hecho ? 'INFO' : 'WARN',
      evento: hecho ? 'oauth.revocado' : 'oauth.revocacion_fallida',
      detalle: hecho ? undefined : { estado: resp.status },
    })
    return hecho ? 'revocado' : 'fallo'
  } catch {
    await anotarConector({
      companyId: input.companyId,
      origen: 'CONEXION',
      origenId: input.conexionId,
      nivel: 'WARN',
      evento: 'oauth.revocacion_fallida',
      detalle: { motivo: 'red' },
    })
    return 'fallo'
  }
}
