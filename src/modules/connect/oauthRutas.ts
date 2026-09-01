import 'server-only'
import type { ConfigOauthConector } from '@/modules/connect/oauth'

// Puro y por tanto probable: vive en el núcleo, se reexporta desde aquí para
// que las rutas lo importen de un solo sitio.
export { destinoDeVueltaSeguro } from '@/modules/connect/oauthNucleo'

/**
 * De dónde salen las URLs del flujo OAuth y qué destinos de vuelta se aceptan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA `redirect_uri` ES FIJA Y SE CALCULA AQUÍ
 *
 * Nunca se toma del navegador. Una `redirect_uri` que quien llama puede elegir
 * es la forma clásica de robar códigos de autorización: se pide el permiso con
 * el destino del atacante y el proveedor le entrega el código. Los proveedores
 * exigen registrarla precisamente por eso — y el registro no sirve de nada si
 * nosotros la aceptamos variable.
 */
export function redirectUriDeCallback(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '')
  return `${base.replace(/\/$/, '')}/api/connect/oauth/callback`
}

/**
 * CATÁLOGO DE PROVEEDORES OAUTH.
 *
 * VACÍO A PROPÓSITO. La fontanería de la Fase 5 está completa y probada, pero
 * los conectores nativos llegan en la Fase 6: añadir aquí a Google o Meta
 * ahora dejaría un botón que lleva a una pantalla de consentimiento con un
 * `client_id` inexistente. Cuando se añadan, el flujo ya está esperándolos.
 *
 * Los secretos NUNCA entran en esta tabla: cada entrada guarda el NOMBRE de la
 * variable de entorno (`clientSecretEnv`) donde vive el suyo, y el valor se lee
 * en el momento del canje. Un catálogo con secretos dentro acabaría, tarde o
 * temprano, en un volcado de la base o en una captura de pantalla.
 */
export const PROVEEDORES_OAUTH: Record<string, ConfigOauthConector> = {}

export function configOauthDe(slug: string): ConfigOauthConector | null {
  return PROVEEDORES_OAUTH[slug] ?? null
}
