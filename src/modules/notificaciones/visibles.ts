/**
 * LO QUE LA PERSONA VE DE SU BANDEJA: todo menos lo que eliminó.
 *
 * Eliminar un aviso marca `eliminadaEn`, no borra la fila: la clave de
 * deduplicación `(userId, dedupeKey)` es lo que impide que los avisos por lote
 * (renovaciones, regalos, ofertas) se reenvíen al repetirse el barrido. Toda
 * lectura pensada para la persona —lista, contador, pantalla de avisos— la usa.
 * Las lecturas internas (deduplicar, métricas, historial del CRM) NO: ahí la
 * fila sigue existiendo.
 */
export const NOTIFICACIONES_VISIBLES = { eliminadaEn: null } as const
