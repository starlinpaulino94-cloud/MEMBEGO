import 'server-only'
import type { ConfigOauthConector } from '@/modules/connect/oauth'
import { definicionDe } from '@/modules/connect/conectores'

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
 * De dónde sale la configuración OAuth de cada conector.
 *
 * La define el conector (`modules/connect/conectores.ts`) y se resuelve en el
 * momento, leyendo el entorno: los secretos NUNCA viven en una tabla ni en una
 * constante del código — cada definición guarda el NOMBRE de su variable
 * (`clientSecretEnv`) y el valor se lee al canjear.
 *
 * Devuelve null cuando el conector no es de OAuth o cuando su app no está
 * configurada en este despliegue. La ruta de inicio contesta entonces «esa
 * aplicación todavía no está disponible» en vez de mandar al usuario a una
 * pantalla de consentimiento rota.
 */
export function configOauthDe(slug: string): ConfigOauthConector | null {
  const def = definicionDe(slug)
  if (!def || def.authTipo !== 'OAUTH2' || !def.disponible()) return null
  return def.oauth?.() ?? null
}
