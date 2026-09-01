import 'server-only'
import { appUrl } from '@/lib/site'
import type { ConfigOauthConector } from '@/modules/connect/oauthNucleo'
import { oauthDe } from '@/modules/connect/proveedores/indice'

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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SALE DE `appUrl()`, QUE ES EL ÚNICO DUEÑO DE LAS URLS DE LA APLICACIÓN
 *
 * Antes se leía `NEXT_PUBLIC_APP_URL` a mano, saltándose la abstracción de
 * dominios de `lib/site.ts`. Eso funcionaba solo mientras la landing y la
 * aplicación compartieran dominio: el día que la aplicación se mude a su
 * propio host, `NEXT_PUBLIC_APP_URL` seguiría apuntando a la landing y la
 * `redirect_uri` dejaría de coincidir con la registrada en el proveedor. Todas
 * las conexiones OAuth se romperían a la vez, y el motivo no estaría escrito
 * en ningún sitio.
 *
 * Hoy `appUrl()` devuelve exactamente lo mismo (`NEXT_PUBLIC_APP_ORIGIN` no
 * está definida y cae a `NEXT_PUBLIC_APP_URL`), así que este cambio NO mueve
 * la URL: `https://membego.com/api/connect/oauth/callback` antes y después.
 * Cuando llegue la separación, bastará definir `NEXT_PUBLIC_APP_ORIGIN` y
 * registrar la URI nueva en el proveedor ANTES de desplegar.
 */
export function redirectUriDeCallback(): string {
  return `${appUrl()}/api/connect/oauth/callback`
}

/**
 * De dónde sale la configuración OAuth de cada conector.
 *
 * La define el proveedor (`modules/connect/proveedores/`) y se resuelve en el
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
  return oauthDe(slug)
}
