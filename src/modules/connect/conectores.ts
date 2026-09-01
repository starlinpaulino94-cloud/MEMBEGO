import 'server-only'
import type { ConfigOauthConector } from '@/modules/connect/oauth'

/**
 * LOS CONECTORES NATIVOS (Membego Connect · Fase 6).
 *
 * Dos, y elegidos por lo que resuelven aquí:
 *
 *   whatsapp         el canal que las empresas de RD piden. Convierte en real
 *                    la acción `send_whatsapp`, que el motor de
 *                    automatizaciones lleva desde su primer día registrando
 *                    como intención simulada.
 *   google-calendar  lleva las citas confirmadas a la agenda del negocio, que
 *                    es donde su equipo ya mira.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO ESTÁ CONFIGURADO NO SE OFRECE
 *
 * `disponible()` mira si existe de verdad lo que hace falta para conectar. Un
 * conector en el catálogo cuya app no está dada de alta produce un botón que
 * lleva a una pantalla de error del proveedor — y quien lo pulsa concluye,
 * con razón, que MembeGo no funciona. La fila puede estar sembrada en la base
 * desde el primer día; lo que decide si se enseña es esto.
 */

export type AuthConector = 'OAUTH2' | 'API_KEY'

export interface DefinicionConector {
  slug: string
  nombre: string
  descripcion: string
  categoria: string
  authTipo: AuthConector
  /** ¿Está lo necesario para conectarlo en ESTE despliegue? */
  disponible: () => boolean
  /** Solo para OAUTH2. */
  oauth?: () => ConfigOauthConector | null
  /** Qué le falta al administrador, dicho para que se pueda arreglar. */
  queFalta: string
}

/**
 * WHATSAPP · Meta Cloud API.
 *
 * POR QUÉ CREDENCIAL Y NO OAUTH (se aparta de lo previsto en la Fase 0, D7)
 *
 * El alta incrustada de Meta (Embedded Signup), que es su flujo OAuth, exige
 * Verificación de Negocio y Revisión de la App: semanas de trámite ANTES de
 * poder probar una sola línea. El camino que funciona hoy es el token
 * permanente de Usuario del Sistema, que Meta emite desde el propio panel del
 * negocio y que cada empresa pega aquí una vez.
 *
 * No es un atajo: es el mismo secreto, guardado con el mismo cifrado
 * (AES-256-GCM), y el envío es idéntico. Cuando la app esté verificada, añadir
 * el flujo OAuth encima no cambia nada de lo que ya funciona — la credencial
 * se guarda en el mismo sitio.
 */
const WHATSAPP: DefinicionConector = {
  slug: 'whatsapp',
  nombre: 'WhatsApp',
  descripcion:
    'Envía mensajes a tus clientes desde tus automatizaciones, con el número de WhatsApp de tu negocio.',
  categoria: 'COMUNICACION',
  authTipo: 'API_KEY',
  // No depende de configuración de la plataforma: cada empresa trae su token
  // y su número. Por eso está disponible siempre.
  disponible: () => true,
  queFalta: '',
}

/**
 * GOOGLE CALENDAR · OAuth 2.0.
 *
 * Sí depende de la plataforma: la app de Google es de MembeGo, no de cada
 * empresa. Sin sus dos variables, el conector no se ofrece.
 */
const GOOGLE_CALENDAR: DefinicionConector = {
  slug: 'google-calendar',
  nombre: 'Google Calendar',
  descripcion: 'Lleva las citas confirmadas a la agenda de Google de tu negocio, automáticamente.',
  categoria: 'CALENDARIO',
  authTipo: 'OAUTH2',
  disponible: () =>
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  oauth: () => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    if (!clientId) return null
    return {
      urlAutorizacion: 'https://accounts.google.com/o/oauth2/v2/auth',
      urlToken: 'https://oauth2.googleapis.com/token',
      clientId,
      clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
      extra: {
        // Sin `access_type=offline` Google NO manda refresh token, y la
        // conexión moriría en una hora sin forma de renovarse.
        access_type: 'offline',
        // Y sin `prompt=consent` no lo vuelve a mandar si el usuario ya había
        // concedido antes — así que una reconexión se quedaría sin él.
        prompt: 'consent',
      },
    }
  },
  queFalta: 'Faltan las variables GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET.',
}

export const CONECTORES: DefinicionConector[] = [WHATSAPP, GOOGLE_CALENDAR]

export function definicionDe(slug: string): DefinicionConector | null {
  return CONECTORES.find((c) => c.slug === slug) ?? null
}

/** Slugs que este despliegue puede ofrecer de verdad. */
export function slugsDisponibles(): string[] {
  return CONECTORES.filter((c) => c.disponible()).map((c) => c.slug)
}
