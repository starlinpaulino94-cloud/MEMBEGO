import { faltantesConnectPlataforma } from '@/lib/env'
import { metaPaginasConfigurado } from '@/modules/connect/metaNucleo'
import { metadatosObligatorios } from '@/modules/connect/proveedores/metadatos'
import type { DefinicionProveedor } from '@/modules/connect/proveedores/tipos'

/**
 * INSTAGRAM · tarjeta ADAPTADA sobre la conexión «Facebook e Instagram»
 * (Meta · Fase 3).
 *
 * Instagram no tiene conexión propia: Meta entrega la cuenta profesional
 * enlazada a cada Página dentro del mismo login. Esta tarjeta existe para que
 * quien busque «Instagram» en el catálogo lo encuentre, LEE su estado de los
 * activos IG_ACCOUNT de la conexión de Facebook (adaptadores.ts) y
 * «Gestionar» lleva a esa conexión. Un solo dueño del estado, como CardNET.
 */
export const INSTAGRAM: DefinicionProveedor = {
  metadatos: metadatosObligatorios('instagram'),
  clase: 'ADAPTADA',
  autorizacion: { tipo: 'OAUTH2', patron: 'POPUP' },
  tipoCredencial: 'OAUTH_TOKENS',
  capacidades: ['mensajes.recibir', 'mensajes.enviar'],
  // Vacío a propósito: se da de alta desde «Facebook e Instagram».
  pasos: () => [],
  versionAlta: 1,
  disponible: () => metaPaginasConfigurado() && faltantesConnectPlataforma().length === 0,
  queFalta:
    'Faltan las variables de la app de Meta (NEXT_PUBLIC_META_APP_ID, NEXT_PUBLIC_META_CONFIG_ID_PAGES, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN) o las de la plataforma (PLATFORM_TOKEN_SECRET, CONNECT_CLAVES_MAESTRAS).',
  rutaGestionExterna: '/admin/integraciones/facebook',
}
