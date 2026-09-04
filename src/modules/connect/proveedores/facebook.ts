import { faltantesConnectPlataforma } from '@/lib/env'
import { metaPaginasConfigurado } from '@/modules/connect/metaNucleo'
import { metadatosObligatorios } from '@/modules/connect/proveedores/metadatos'
import type { DefinicionProveedor } from '@/modules/connect/proveedores/tipos'

/**
 * FACEBOOK E INSTAGRAM · una sola conexión con Meta (Meta · Fase 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA Y NO DOS
 *
 * Meta entrega en UN login las Páginas de Facebook y, por cada Página, la
 * cuenta profesional de Instagram que tiene enlazada. Pedir dos logins para
 * lo que Meta da en uno sería el doble de tokens que custodiar y el doble de
 * pantallas de consentimiento para la empresa. La tarjeta «Instagram» del
 * catálogo existe para que quien la busque la encuentre, y lleva aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MISMO PATRÓN QUE WHATSAPP: POPUP DEL SDK Y CÓDIGO AL SERVIDOR
 *
 * Facebook Login for Business documenta el diálogo con `config_id` para el
 * SDK de JavaScript («config_id ha sustituido a scope») y el canje del código
 * en servidor (`GET /oauth/access_token?client_id&client_secret&code`). La
 * URL manual del diálogo con `config_id` NO está verificada, así que no se
 * usa: el diálogo lo abre el SDK, el código viaja a una acción de servidor y
 * de ahí no sale nada hacia el navegador.
 *
 * Lo que se guarda: el token de USUARIO de larga duración (sellado, con su
 * caducidad de ~60 días) para volver a pedir Páginas, y por cada Página
 * elegida su token de Página de larga duración —que no caduca— sellado en
 * el activo. Los mensajes se envían con el de Página.
 */
export const FACEBOOK: DefinicionProveedor = {
  metadatos: metadatosObligatorios('facebook'),
  clase: 'NATIVA',
  autorizacion: { tipo: 'OAUTH2', patron: 'POPUP' },
  tipoCredencial: 'OAUTH_TOKENS',
  capacidades: ['paginas.leer', 'mensajes.recibir', 'mensajes.enviar'],
  pasos: () => [
    {
      id: 'requisitos',
      titulo: 'Antes de empezar',
      descripcion:
        'Necesitas administrar una Página de Facebook. Si quieres recibir mensajes de Instagram, la cuenta profesional de Instagram tiene que estar enlazada a esa Página y con «Permitir acceso a mensajes» activado en la app de Instagram.',
      tipo: 'INFORMATIVO',
    },
    {
      id: 'autorizar',
      titulo: 'Conéctate con Facebook',
      descripcion:
        'Se abre una ventana de Meta donde eliges qué Páginas y cuentas de Instagram puede ver Membego. Membego no ve ni guarda tu contraseña.',
      tipo: 'COMPONENTE',
      componente: 'AltaMetaPaginas',
      // El canje guarda el token sellado: el paso se cumple porque existe.
      cumpleCon: 'autorizado',
    },
    {
      id: 'paginas',
      titulo: 'Elige tus Páginas',
      descripcion:
        'Cuáles de tus Páginas quieres atender desde Membego. Por cada una, si tiene Instagram enlazado, también lo conectamos.',
      tipo: 'COMPONENTE',
      componente: 'ElegirPaginasMeta',
    },
  ],
  versionAlta: 1,
  disponible: () => metaPaginasConfigurado() && faltantesConnectPlataforma().length === 0,
  queFalta:
    'Faltan las variables de la app de Meta (NEXT_PUBLIC_META_APP_ID, NEXT_PUBLIC_META_CONFIG_ID_PAGES, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN) o las de la plataforma (PLATFORM_TOKEN_SECRET, CONNECT_CLAVES_MAESTRAS).',
  configDesdeAlta: (datos) => ({
    paginas: Array.isArray(datos.paginas) ? datos.paginas.filter((p) => typeof p === 'string') : [],
  }),
}
