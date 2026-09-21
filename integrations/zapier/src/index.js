'use strict'

const { version } = require('../package.json')
const { version: platformVersion } = require('zapier-platform-core')
const { autenticacion, ponerClave, traducirErrores } = require('./autenticacion')
const { disparadores } = require('./disparadores')
const { busquedas } = require('./busquedas')

/**
 * APP DE MEMBEGO PARA ZAPIER (hallazgo B-2).
 *
 * No forma parte del despliegue de MembeGo: vive en la infraestructura de
 * Zapier y llama a nuestra API pública. Está en este repositorio porque su
 * contrato es el nuestro — si cambia un evento o un campo, el cambio tiene que
 * verse en el mismo commit que lo provoca, no descubrirse tres semanas después
 * porque un Zap dejó de disparar.
 */
module.exports = {
  version,
  platformVersion,
  authentication: autenticacion,
  // El orden importa: la clave se pone en TODA petición, incluidas las de los
  // disparadores, y los errores se traducen antes de que Zapier los enseñe.
  beforeRequest: [ponerClave],
  afterResponse: [traducirErrores],
  triggers: disparadores,
  searches: busquedas,
  creates: {},
}
