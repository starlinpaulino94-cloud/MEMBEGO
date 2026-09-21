'use strict'

/**
 * AUTENTICACIÓN: la clave de API de la empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ CLAVE Y NO OAUTH
 *
 * OAuth exigiría que MembeGo fuese servidor de autorización: apps registradas,
 * pantalla de consentimiento, tokens de refresco. Eso es el hallazgo A-3 de la
 * auditoría y es un programa entero, no un paso previo a esta app.
 *
 * Con una clave, además, la empresa controla el acceso desde su propio panel:
 * ve cuándo se usó por última vez y la revoca en un clic. Con OAuth tendría que
 * venir a buscarnos.
 */

/** Dónde vive la API. Configurable para poder probar contra un despliegue propio. */
const BASE_POR_DEFECTO = 'https://www.membego.com'

function baseDe(z, bundle) {
  const puesta = (bundle.authData.baseUrl || '').trim().replace(/\/$/, '')
  return puesta || BASE_POR_DEFECTO
}

function urlApi(z, bundle, ruta) {
  return `${baseDe(z, bundle)}/api/platform/v1${ruta}`
}

/**
 * Añade la clave a TODA petición saliente.
 *
 * Como middleware y no en cada `perform`: una petición que se olvide de la
 * cabecera no falla de forma evidente —recibe un 401 que parece un problema de
 * credenciales del usuario— y esa confusión cuesta un ticket de soporte por
 * cada disparador que se añada mal.
 */
const ponerClave = (request, z, bundle) => {
  if (bundle.authData.apiKey) {
    request.headers = request.headers || {}
    request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`
  }
  return request
}

/**
 * Traduce los errores de MembeGo a algo que Zapier sepa enseñar.
 *
 * Nuestra API devuelve `{ error: { code, message, requestId } }`. Sin esto,
 * Zapier enseña el JSON crudo y quien integra no sabe si el problema es su
 * clave, su plan o nuestro servidor. El `requestId` se conserva a propósito: es
 * lo único que permite encontrar la llamada en nuestros registros.
 */
const traducirErrores = (response, z) => {
  if (response.status < 400) return response

  let cuerpo = {}
  try {
    cuerpo = JSON.parse(response.content || '{}')
  } catch {
    cuerpo = {}
  }
  const error = cuerpo.error || {}
  const detalle = error.requestId ? ` (referencia: ${error.requestId})` : ''

  if (response.status === 401 || response.status === 403) {
    if (error.code === 'QUOTA_EXCEEDED') {
      throw new z.errors.Error(
        `Tu plan de MembeGo no permite más avisos. Pídele a MembeGo que amplíe el límite.${detalle}`,
        error.code,
        response.status
      )
    }
    if (error.code === 'INSUFFICIENT_SCOPE') {
      throw new z.errors.Error(
        `A tu clave de MembeGo le falta el permiso «Crear y retirar avisos». Créala de nuevo marcándolo.${detalle}`,
        error.code,
        response.status
      )
    }
    // `RefreshAuthError` le dice a Zapier que vuelva a pedir credenciales, que
    // es lo correcto cuando la clave fue revocada.
    throw new z.errors.RefreshAuthError(
      `MembeGo no aceptó la clave. Compruébala o crea una nueva.${detalle}`
    )
  }

  throw new z.errors.Error(
    `${error.message || 'MembeGo devolvió un error.'}${detalle}`,
    error.code || 'ERROR',
    response.status
  )
}

/**
 * La prueba de conexión.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE PRUEBA CONTRA `/webhooks`, Y NO ES CASUAL
 *
 * Es el recurso que exige `webhooks:manage`, o sea el permiso sin el cual esta
 * app no puede hacer su trabajo. Probar contra una lectura cualquiera daría una
 * conexión «correcta» con la que ningún Zap se puede encender — y el fallo
 * aparecería más tarde, en otra pantalla, diciendo otra cosa. Aquí falla en el
 * momento de conectar, que es cuando la persona todavía tiene delante el
 * formulario donde arreglarlo.
 *
 * La etiqueta lleva el PREFIJO de la clave, nunca la clave. Es la mitad pública
 * —la que identifica la fila en el panel de MembeGo— y sirve para distinguir
 * dos cuentas conectadas; enseñar la clave entera la dejaría a la vista de
 * cualquiera que mire la lista de conexiones de Zapier.
 */
const probar = async (z, bundle) => {
  await z.request({ url: urlApi(z, bundle, '/webhooks') })
  const prefijo = String(bundle.authData.apiKey || '').split('.')[0]
  return { label: prefijo || 'MembeGo' }
}

module.exports = {
  urlApi,
  ponerClave,
  traducirErrores,
  autenticacion: {
    type: 'custom',
    test: probar,
    fields: [
      {
        key: 'apiKey',
        label: 'Clave de API',
        required: true,
        type: 'password',
        helpText:
          'En MembeGo: Integraciones → Desarrolladores → Claves de API. Marca el permiso ' +
          '**Crear y retirar avisos**, o los Zaps no podrán encenderse.',
      },
      {
        key: 'baseUrl',
        label: 'Dirección de MembeGo',
        required: false,
        type: 'string',
        helpText: `Déjalo vacío salvo que uses un despliegue propio. Por defecto: ${BASE_POR_DEFECTO}`,
      },
    ],
    connectionLabel: '{{label}}',
  },
}
