/**
 * MEMBEGO SUPPLY · catálogo de HALLAZGOS de conciliación.
 *
 * Separado de `conciliacion.ts` (que es `server-only`) porque la lista de qué
 * puede estar mal y cuánto importa es vocabulario, no acceso a datos: lo usan
 * las pantallas, las notificaciones y las pruebas.
 */

export const TIPOS_HALLAZGO = [
  'DERIVA_CONTADORES',
  'INVARIANTE_ROTO',
  'CUBETA_NEGATIVA',
  'REDENCION_DUPLICADA',
  'ASIENTO_FALTANTE',
  'REVERSA_INVALIDA',
  'SOBRE_ASIGNACION',
  'DERECHO_VENCIDO_ACTIVO',
  'VOUCHER_HUERFANO',
  'CAPACIDAD_EXCEDIDA',
] as const
export type TipoHallazgo = (typeof TIPOS_HALLAZGO)[number]

export const HALLAZGO_LABELS: Record<TipoHallazgo, string> = {
  DERIVA_CONTADORES: 'Los contadores del lote no coinciden con el ledger',
  INVARIANTE_ROTO: 'Las cubetas no suman lo comprado',
  CUBETA_NEGATIVA: 'Una cubeta quedó en negativo',
  REDENCION_DUPLICADA: 'Un voucher tiene más de una redención viva',
  ASIENTO_FALTANTE: 'Una redención no tiene su asiento en el ledger',
  REVERSA_INVALIDA: 'Una reversa sin redención original',
  SOBRE_ASIGNACION: 'Una campaña emitió más de lo que se le asignó',
  DERECHO_VENCIDO_ACTIVO: 'Un derecho vencido sigue marcado como activo',
  VOUCHER_HUERFANO: 'Un voucher activo sobre un derecho que ya no lo está',
  CAPACIDAD_EXCEDIDA: 'Un día superó la capacidad pactada',
}

export type Gravedad = 'CRITICA' | 'ALTA' | 'MEDIA'

/** Qué tan grave es cada hallazgo. Ordena la lista y decide a quién se avisa. */
export const GRAVEDAD_HALLAZGO: Record<TipoHallazgo, Gravedad> = {
  // Estos tres significan que las cifras de supply son mentira: nada por
  // encima (reportes, liquidaciones, unit economics) se puede creer.
  INVARIANTE_ROTO: 'CRITICA',
  CUBETA_NEGATIVA: 'CRITICA',
  REDENCION_DUPLICADA: 'CRITICA',
  ASIENTO_FALTANTE: 'CRITICA',
  DERIVA_CONTADORES: 'ALTA',
  SOBRE_ASIGNACION: 'ALTA',
  REVERSA_INVALIDA: 'ALTA',
  VOUCHER_HUERFANO: 'ALTA',
  DERECHO_VENCIDO_ACTIVO: 'MEDIA',
  CAPACIDAD_EXCEDIDA: 'MEDIA',
}
