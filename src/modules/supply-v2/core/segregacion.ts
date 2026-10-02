/**
 * MEMBEGO SUPPLY 2.0 · AUTOAPROBACIÓN, en un solo sitio.
 *
 * La segregación de funciones —quien crea algo no lo aprueba— se retiró a
 * propósito. Membego opera con un solo administrador de plataforma, y el rol
 * `SUPERADMIN` es el único que existe a ese nivel: no hay a quién pasarle el
 * trabajo. El veto no protegía nada, solo dejaba órdenes, facturas y pagos
 * atascados sin que existiera nadie capaz de desatascarlos.
 *
 * La salvaguarda pasa a ser el RASTRO: quien aprueba lo que él mismo creó
 * queda marcado como tal en el evento y en la bitácora, que es justo lo que
 * alguien irá a buscar en una auditoría. Marcar no es lo mismo que impedir,
 * pero es lo que SÍ se puede sostener con una sola persona.
 *
 * Volver al veto el día que haya dos personas autorizadas es añadir una
 * condición AQUÍ: los ocho puntos de aprobación de Supply 2.0 ya pasan por
 * esta función, así que no hay que buscarlos uno por uno.
 *
 * PURO: se prueba sin base de datos.
 */

/** Queda en el evento y en la bitácora cuando alguien aprueba lo que él creó. */
export const MOTIVO_AUTOAPROBACION =
  'Aprobada por la misma persona que la creó: Membego opera con un solo administrador de plataforma.'

/** ¿El actor está aprobando algo que creó él mismo? Solo para dejar rastro. */
export function esAutoaprobacion(creadorId: string | null, actorId: string): boolean {
  return Boolean(creadorId) && creadorId === actorId
}
