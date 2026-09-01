import type { ConfigOauthConector } from '@/modules/connect/oauthNucleo'
import { metadatosObligatorios } from '@/modules/connect/proveedores/metadatos'
import type { DefinicionProveedor } from '@/modules/connect/proveedores/tipos'

/**
 * GOOGLE CALENDAR · el proveedor con el que se demuestra el framework.
 *
 * Depende de la plataforma: la app de Google es de Membego, no de cada
 * empresa. Sin sus dos variables el conector NO se ofrece — un botón que lleva
 * a una pantalla de error de Google enseña que Membego no funciona.
 *
 * Los pasos declarados aquí son el guion COMPLETO del alta que se construirá
 * en la Fase 12. Se declaran ya porque la página de detalle los enseña: «esto
 * es lo que va a pasar cuando pulses Conectar» es información que la persona
 * necesita ANTES, no después.
 */
export const GOOGLE_CALENDAR: DefinicionProveedor = {
  metadatos: metadatosObligatorios('google-calendar'),
  clase: 'NATIVA',
  autorizacion: {
    tipo: 'OAUTH2',
    // Google admite las dos formas. Se elige REDIRECCIÓN porque nuestro estado
    // firmado ya lleva el destino de vuelta y ya está validado; el popup
    // añadiría un canal de mensajes entre ventanas y las cabeceras que lo
    // gobiernan, a cambio de estética. Lo que Google SÍ prohíbe —una vista web
    // incrustada— no se hace en ninguna de las dos formas.
    patron: 'REDIRECCION',
  },
  capacidades: ['calendario.leer', 'calendario.escribir', 'disponibilidad.leer'],
  pasos: [
    {
      id: 'autorizar',
      titulo: 'Autoriza con tu cuenta de Google',
      descripcion:
        'Te llevamos a Google para que des permiso. Membego no ve ni guarda tu contraseña.',
      tipo: 'AUTORIZACION',
    },
    {
      id: 'calendario',
      titulo: 'Elige el calendario',
      descripcion: 'En cuál de tus calendarios quieres que aparezcan las citas confirmadas.',
      tipo: 'ELECCION',
    },
    {
      id: 'opciones',
      titulo: 'Ajusta la sincronización',
      descripcion: 'Qué citas se llevan a la agenda y con cuánta antelación se avisa.',
      tipo: 'FORMULARIO',
    },
    {
      id: 'validacion',
      titulo: 'Comprobamos que funciona',
      descripcion: 'Verificamos el acceso al calendario elegido antes de darlo por conectado.',
      tipo: 'VALIDACION',
    },
  ],
  versionAlta: 1,
  disponible: () =>
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  queFalta: 'Faltan las variables GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET.',
}

/**
 * La configuración OAuth. Se resuelve EN EL MOMENTO leyendo el entorno: los
 * secretos no viven en una tabla ni en una constante, solo el NOMBRE de su
 * variable.
 *
 * LOS PERMISOS NO CAMBIAN EN ESTA FASE. Para ofrecer «elige tu calendario»
 * hará falta además poder leer la lista de calendarios, y ampliar permisos
 * obliga a que las conexiones existentes vuelvan a autorizar. Ese cambio va en
 * la Fase 12, después de comprobar en producción cuántas conexiones hay.
 */
export function oauthGoogleCalendar(): ConfigOauthConector | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) return null
  return {
    urlAutorizacion: 'https://accounts.google.com/o/oauth2/v2/auth',
    urlToken: 'https://oauth2.googleapis.com/token',
    clientId,
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    extra: {
      // Sin `access_type=offline` Google NO manda refresh token, y la conexión
      // moriría en una hora sin forma de renovarse.
      access_type: 'offline',
      // Y sin `prompt=consent` no lo vuelve a mandar si el usuario ya había
      // concedido antes — así que una reconexión se quedaría sin él.
      prompt: 'consent',
    },
  }
}
