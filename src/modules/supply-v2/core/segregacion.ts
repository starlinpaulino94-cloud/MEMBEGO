/**
 * MEMBEGO SUPPLY 2.0 · SEGREGACIÓN DE FUNCIONES, en un solo sitio.
 *
 * Quien crea algo no lo aprueba — MIENTRAS HAYA A QUIÉN PASÁRSELO. La regla
 * protege porque obliga a que miren dos pares de ojos; con una sola persona
 * autorizada no protege nada: solo deja el trabajo atascado sin que exista
 * nadie capaz de desatascarlo. Cuando no hay segunda persona, la salvaguarda
 * deja de ser el veto y pasa a ser el RASTRO: quien aprueba lo suyo queda
 * registrado como tal en el evento y en la bitácora.
 *
 * Este módulo es PURO: se prueba sin base de datos. Quién cuenta como persona
 * autorizada lo resuelve `contarPersonasAutorizadasEnTx` en los adaptadores,
 * que es el único sitio que sabe cómo el Core guarda usuarios y roles.
 */

export const MENSAJES_SEGREGACION = {
  ordenCompra: 'Una orden de compra no la puede aprobar quien la creó: pídele a otra persona autorizada que la apruebe.',
  factura: 'Una factura no la aprueba la misma persona que la registró.',
  pago: 'Un pago no lo confirma la misma persona que lo registró: pídele a otra persona autorizada que lo confirme.',
  liquidacion: 'Una liquidación no la aprueba la misma persona que la generó: pídele a otra persona autorizada que la apruebe.',
  beneficio: 'Un beneficio no lo aprueba la misma persona que lo creó: pídele a otra persona autorizada que lo apruebe.',
  campana: 'Una campaña no la aprueba la misma persona que la creó: pídele a otra persona autorizada que la apruebe.',
  programaFidelizacion: 'Un programa de fidelización no lo aprueba la misma persona que lo creó: pídele a otra persona autorizada que lo apruebe.',
  recompensa: 'Una recompensa no la aprueba la misma persona que la creó: pídele a otra persona autorizada que la apruebe.',
} as const

export type ClaveSegregacion = keyof typeof MENSAJES_SEGREGACION

export type Segregacion =
  /** `autoaprobada`: el actor aprueba lo que él mismo creó, por ser el único autorizado. */
  | { permitido: true; autoaprobada: boolean }
  | { permitido: false; motivo: string }

/** Motivo que se guarda en el evento cuando no había segunda persona. */
export const MOTIVO_AUTOAPROBACION =
  'Aprobada por la única persona autorizada: no había segunda persona para segregar.'

export function revisarSegregacion(
  creadorId: string | null,
  actorId: string,
  personasAutorizadas: number,
  clave: ClaveSegregacion
): Segregacion {
  const esQuienLoCreo = Boolean(creadorId) && creadorId === actorId
  if (!esQuienLoCreo) return { permitido: true, autoaprobada: false }
  if (personasAutorizadas > 1) return { permitido: false, motivo: MENSAJES_SEGREGACION[clave] }
  return { permitido: true, autoaprobada: true }
}
