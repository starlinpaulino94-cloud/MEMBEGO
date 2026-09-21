'use strict'

const { urlApi } = require('./autenticacion')

/**
 * BÚSQUEDA: encontrar un cliente por un identificador exacto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA BÚSQUEDA Y NINGUNA ACCIÓN DE ESCRITURA
 *
 * Una app solo de disparadores sirve para «cuando pase algo en MembeGo, haz
 * algo fuera», que es la mitad de los Zaps que la gente escribe. La otra mitad
 * —«cuando pase algo fuera, crea un cliente en MembeGo»— necesitaría escribir, y
 * la API v1 reserva las escrituras a la credencial de un satélite a propósito:
 * necesitan saber qué sistema respalda la operación, porque un canje sin sistema
 * no se audita.
 *
 * Esa política no se cambia de paso mientras se escribe una app de Zapier. Y
 * mientras tanto esa mitad ya tiene respuesta: un webhook ENTRANTE de MembeGo
 * (hallazgo B-1) recibe de Zapier lo que sea, sin que Zapier necesite saber nada
 * de nuestra API.
 *
 * Una búsqueda, en cambio, es una lectura: encaja con lo que una clave de
 * empresa puede hacer hoy, y es lo que convierte un Zap de «me llegó un aviso»
 * en uno que puede decidir según quién es el cliente.
 */

const buscarCliente = {
  key: 'buscarCliente',
  noun: 'Cliente',
  display: {
    label: 'Buscar cliente',
    description:
      'Busca un cliente por su correo, su teléfono o su placa. Devuelve el que coincide exactamente.',
  },
  operation: {
    inputFields: [
      {
        key: 'criterio',
        label: 'Buscar por',
        type: 'string',
        required: true,
        choices: { email: 'Correo', phone: 'Teléfono', plate: 'Placa' },
        altersDynamicFields: false,
      },
      {
        key: 'valor',
        label: 'Valor',
        type: 'string',
        required: true,
        helpText: 'El valor EXACTO. Esta búsqueda no hace coincidencias parciales.',
      },
    ],
    perform: async (z, bundle) => {
      const resp = await z.request({
        url: urlApi(z, bundle, '/customers/resolve'),
        // Un solo criterio: la API rechaza dos a la vez a propósito («con dos,
        // ¿cuál manda?»), así que el formulario también pide uno.
        params: { [bundle.inputData.criterio]: bundle.inputData.valor },
        // No encontrarlo NO es un error: es el resultado «no hay». Zapier
        // distingue una búsqueda vacía de una fallida, y si esto lanzara, el
        // Zap se detendría en vez de seguir por su rama de «no encontrado».
        skipThrowForStatus: true,
      })
      if (resp.status === 404) return []
      if (resp.status >= 400) throw new z.errors.Error('MembeGo no pudo buscar.', 'ERROR', resp.status)

      // La ruta devuelve el cliente DIRECTAMENTE, no envuelto en `{customer}`:
      // es un recurso único, no una colección de uno.
      const cliente = resp.data
      return cliente && cliente.id ? [cliente] : []
    },
    // Los cuatro campos de `customerDTO`, ni uno más: una muestra con campos
    // que la API no devuelve invita a mapearlos y a que el Zap falle al correr.
    sample: {
      id: 'cli_ejemplo',
      nombre: 'Juan Pérez',
      email: 'juan@correo.com',
      telefono: '8095551234',
    },
  },
}

module.exports = { busquedas: { buscarCliente } }
