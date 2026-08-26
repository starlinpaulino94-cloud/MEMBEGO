/**
 * MEMBRESÍAS · ¿ESTA SE PUEDE BORRAR? — NÚCLEO PURO (sin Prisma, sin red).
 *
 * Borrar una membresía no es como borrar un borrador: de ella cuelga la
 * historia entera del cliente con la empresa —sus visitas, sus comprobantes,
 * sus pagos— y esa historia es el respaldo de dinero que ya cambió de manos.
 *
 * LA REGLA, EN UNA FRASE: se borra lo que nunca llegó a pasar.
 *
 * Una membresía que no tiene ni una visita, ni un comprobante, ni un pago
 * confirmado es exactamente eso: un registro que se creó y no vivió. Es la
 * basura que dejan las pruebas. En cuanto aparece cualquiera de esas tres
 * cosas, hay historia real detrás y el borrado se niega — no por prudencia
 * genérica, sino porque destruiría el rastro de una transacción.
 *
 * Se decide AQUÍ, en una función pura, y no dentro de la acción de servidor,
 * por dos motivos: se puede probar sin base de datos, y la misma regla sirve
 * para pintar el botón y para autorizar el borrado. Un botón que promete algo
 * que el servidor va a negar es la forma más barata de perder la confianza en
 * una interfaz.
 */

/** Lo que hay que contar antes de decidir. Todo son cantidades, no registros. */
export interface HistorialMembresia {
  /** Visitas o lavados consumidos. */
  visitas: number
  /** Comprobantes emitidos. */
  comprobantes: number
  /**
   * Pagos que llegaron a confirmarse. Los intentos FALLIDOS no cuentan: un
   * cobro que nunca prosperó no es historia financiera, es ruido — y ese es
   * justo el rastro que dejan las pruebas.
   */
  pagosConfirmados: number
}

export type MotivoNoBorrable = 'visitas' | 'comprobantes' | 'pagos'

export interface VeredictoBorrado {
  borrable: boolean
  /** Qué lo impide, en orden de aparición. Vacío si se puede borrar. */
  motivos: MotivoNoBorrable[]
}

const ETIQUETA: Record<MotivoNoBorrable, (n: number) => string> = {
  visitas: (n) => (n === 1 ? '1 visita registrada' : `${n} visitas registradas`),
  comprobantes: (n) => (n === 1 ? '1 comprobante emitido' : `${n} comprobantes emitidos`),
  pagos: (n) => (n === 1 ? '1 pago confirmado' : `${n} pagos confirmados`),
}

/**
 * ¿Se puede borrar esta membresía?
 *
 * Falla CERRADO: cualquier cantidad negativa o no finita —que solo puede venir
 * de un conteo que salió mal— se trata como «hay historia». Ante la duda sobre
 * si existe un rastro financiero, no se borra.
 */
export function puedeBorrarseMembresia(historial: HistorialMembresia): VeredictoBorrado {
  const motivos: MotivoNoBorrable[] = []
  const sospechoso = (n: number) => !Number.isFinite(n) || n < 0
  if (sospechoso(historial.visitas) || historial.visitas > 0) motivos.push('visitas')
  if (sospechoso(historial.comprobantes) || historial.comprobantes > 0) {
    motivos.push('comprobantes')
  }
  if (sospechoso(historial.pagosConfirmados) || historial.pagosConfirmados > 0) {
    motivos.push('pagos')
  }
  return { borrable: motivos.length === 0, motivos }
}

/**
 * El «por qué no» en palabras del cliente, ya listo para la pantalla.
 *
 * Dice QUÉ lo impide y QUÉ hacer en su lugar. «No se puede eliminar» a secas
 * deja al administrador probando el botón otra vez, que nunca va a funcionar.
 */
export function explicarNoBorrable(historial: HistorialMembresia): string | null {
  const { borrable, motivos } = puedeBorrarseMembresia(historial)
  if (borrable) return null
  const cuenta: Record<MotivoNoBorrable, number> = {
    visitas: historial.visitas,
    comprobantes: historial.comprobantes,
    pagos: historial.pagosConfirmados,
  }
  const partes = motivos.map((m) => ETIQUETA[m](Math.max(0, cuenta[m] || 0)))
  const lista =
    partes.length === 1
      ? partes[0]
      : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
  return `No se puede eliminar: esta membresía tiene ${lista}. Cancélala para darla de baja sin perder el historial.`
}
