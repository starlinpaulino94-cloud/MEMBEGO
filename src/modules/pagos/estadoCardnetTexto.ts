/**
 * QUÉ LE DICE EL PANEL DE ADMINISTRACIÓN SOBRE LA TARJETA — lógica pura.
 *
 * Existe por un caso concreto: «la tarjeta se registra pero el código de
 * verificación no llega». Con la pasarela en AMBIENTE DE PRUEBAS, CardNET no
 * hace el cargo de verificación de RD$1.00 y el banco nunca muestra ningún
 * código; el flujo se ve idéntico al de producción hasta ese último paso, y
 * desde la pantalla del cliente eso parece una demora del banco.
 *
 * El dato que lo delata —el ambiente— vivía solo en una variable de entorno y
 * en una sonda de API. Aquí se lleva al panel que el administrador mira
 * cuando un cobro no cierra, en texto, sin tocar ninguna llave.
 *
 * Sin `server-only` a propósito: es texto, lo prueban las pruebas.
 */
export type AmbienteCardnet = 'pruebas' | 'produccion'

export interface EstadoCardnetEntrada {
  /** Capacidad PAGO_CARDNET encendida para la empresa. */
  capacidad: boolean
  /** Las dos llaves de tokenización presentes en el servidor. */
  configurado: boolean
  /** Ambiente al que apuntan esas llaves. `null` = no se pudo determinar. */
  ambiente: AmbienteCardnet | null
}

export interface EstadoCardnetTexto {
  /** ¿La tarjeta se está ofreciendo de verdad a los clientes? */
  activo: boolean
  detalle: string
  /**
   * Aviso que merece color propio: la pasarela funciona, pero en modo de
   * pruebas. Cobra con tarjetas de laboratorio y NO envía códigos reales.
   */
  avisoPruebas: string | null
}

export const AVISO_AMBIENTE_PRUEBAS =
  'Pasarela en modo de PRUEBAS: los cobros no son reales y el banco no envía el código de verificación de la tarjeta. ' +
  'Para cobrar de verdad, configura CARDNET_TOKENS_AMBIENTE=produccion con las llaves de producción.'

export function textoEstadoCardnet(e: EstadoCardnetEntrada): EstadoCardnetTexto {
  if (!e.capacidad) {
    return { activo: false, detalle: 'Apagada para esta empresa.', avisoPruebas: null }
  }
  if (!e.configurado) {
    return {
      activo: false,
      detalle: 'Encendida, pero faltan las credenciales en el servidor. No se ofrece.',
      avisoPruebas: null,
    }
  }
  if (e.ambiente === 'pruebas') {
    return {
      activo: true,
      detalle: 'Cobrando con tarjeta · ambiente de PRUEBAS.',
      avisoPruebas: AVISO_AMBIENTE_PRUEBAS,
    }
  }
  return { activo: true, detalle: 'Cobrando con tarjeta · producción.', avisoPruebas: null }
}
