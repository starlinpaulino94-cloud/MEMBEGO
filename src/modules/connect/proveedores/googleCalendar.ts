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
  // Sube a 2 con la ampliación de permisos de la Fase 12: una conexión hecha
  // con la versión 1 no concedió el permiso de listar calendarios.
  versionAlta: 2,
  disponible: () =>
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  queFalta: 'Faltan las variables GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET.',
  /**
   * Lo que sobrevive al alta. Nótese lo que NO pasa: ni el paso de
   * autorización ni el de validación dejan rastro aquí — eran trámites, no
   * ajustes.
   */
  configDesdeAlta: (datos) => {
    const opciones =
      datos.opciones && typeof datos.opciones === 'object' && !Array.isArray(datos.opciones)
        ? (datos.opciones as Record<string, unknown>)
        : {}
    return {
      calendarId: typeof datos.calendario === 'string' ? datos.calendario : null,
      zonaHoraria: typeof opciones.zonaHoraria === 'string' ? opciones.zonaHoraria : null,
      // Por defecto SÍ: quien conecta un calendario lo conecta para esto.
      sincronizarConfirmadas: opciones.sincronizarConfirmadas !== false,
    }
  },
}

/**
 * La configuración OAuth. Se resuelve EN EL MOMENTO leyendo el entorno: los
 * secretos no viven en una tabla ni en una constante, solo el NOMBRE de su
 * variable.
 *
 * LOS PERMISOS SE AMPLIARON EN LA FASE 12, y solo después de comprobarlo en
 * producción: el diagnóstico de la migración anterior confirmó CERO conexiones
 * de Google Calendar vivas, así que nadie tiene que volver a autorizar. Si
 * hubiera habido alguna, este cambio la habría dejado en PERMISSIONS —con
 * «vuelve a conectar tu cuenta»— hasta que su dueño reautorizara.
 */
export function oauthGoogleCalendar(): ConfigOauthConector | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) return null
  return {
    urlAutorizacion: 'https://accounts.google.com/o/oauth2/v2/auth',
    urlToken: 'https://oauth2.googleapis.com/token',
    clientId,
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    scopes: [
      // Escribir las citas confirmadas. Es el permiso que hace el trabajo.
      'https://www.googleapis.com/auth/calendar.events',
      // Y LEER LA LISTA de calendarios, para poder ofrecer «elige cuál» en vez
      // de escribir a ciegas en el principal. Es el permiso MÁS ESTRECHO que
      // permite eso: `calendar.readonly` también dejaría leer el contenido de
      // todos los eventos del cliente, que no necesitamos para nada.
      //
      // NO VERIFICADO contra la consola de Google: si su pantalla de
      // consentimiento rechazara este permiso granular, la alternativa
      // documentada es `calendar.readonly`. Se cambia solo aquí.
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ],
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
