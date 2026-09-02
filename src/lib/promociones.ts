// F4.2: catálogo de tipos y visibilidades de promoción (fuente única para
// formularios, validación en actions y etiquetas en tarjetas).

export const PROMO_TIPOS = [
  { value: 'descuento', label: 'Descuento %' },
  { value: 'monto_fijo', label: 'Monto fijo de descuento' },
  { value: '2x1', label: '2x1' },
  { value: '3x2', label: '3x2' },
  { value: 'happy_hour', label: 'Happy Hour' },
  { value: 'upgrade', label: 'Upgrade de servicio' },
  { value: 'servicio_gratis', label: 'Servicio gratis' },
  { value: 'regalo', label: 'Regalo' },
  { value: 'cupon', label: 'Cupón' },
  { value: 'vip', label: 'Beneficio VIP' },
  { value: 'temporada', label: 'Por temporada' },
  { value: 'general', label: 'General' },
] as const

export type PromoTipo = (typeof PROMO_TIPOS)[number]['value']

export const PROMO_TIPO_LABEL: Record<string, string> = Object.fromEntries(
  PROMO_TIPOS.map((t) => [t.value, t.label])
)

export function esTipoValido(tipo: string): tipo is PromoTipo {
  return PROMO_TIPOS.some((t) => t.value === tipo)
}

/** Tipos cuyo campo `descuento` se interpreta como porcentaje. */
export const TIPOS_CON_PORCENTAJE = ['descuento', 'happy_hour', 'temporada']
/** Tipos cuyo campo `descuento` se interpreta como monto fijo (RD$). */
export const TIPOS_CON_MONTO = ['monto_fijo']

export function formatDescuento(descuento: number, tipo: string): string {
  if (TIPOS_CON_MONTO.includes(tipo)) {
    return `RD$${descuento.toLocaleString('es-DO')}`
  }
  return `-${descuento}%`
}

/**
 * Efecto monetario de una promoción, derivado de `tipo` + `descuento`, en la
 * forma ESTABLE que un sistema satélite (car wash, POS externo) usa para rebajar
 * su propia factura. La fuente única de la semántica de `tipo`/`descuento` vive
 * aquí, así que el contrato de la Platform API no la reimplementa.
 *
 * - `PERCENT`: `value` = porcentaje 0–100 sobre el servicio cubierto.
 * - `AMOUNT` : `amountCents` = monto fijo de descuento en centavos (RD$ × 100).
 * - `FREE`   : el servicio cubierto va gratis (100%).
 * - `NONE`   : no hay una rebaja automática computable (2x1, upgrade, regalo,
 *              cupón…). El satélite la muestra pero NO la aplica sola: cobrarla
 *              mal en cualquier sentido cuesta dinero, así que ante la duda no
 *              se toca la factura.
 */
export type EfectoPromocion =
  | { kind: 'PERCENT'; value: number; label: string }
  | { kind: 'AMOUNT'; amountCents: number; label: string }
  | { kind: 'FREE'; label: string }
  | { kind: 'NONE'; label: string }

export function efectoPromocion(tipo: string, descuento: number | null): EfectoPromocion {
  const d = descuento ?? 0
  if (tipo === 'servicio_gratis') return { kind: 'FREE', label: 'Servicio gratis' }
  if (TIPOS_CON_MONTO.includes(tipo) && d > 0) {
    return { kind: 'AMOUNT', amountCents: Math.round(d * 100), label: formatDescuento(d, tipo) }
  }
  if (TIPOS_CON_PORCENTAJE.includes(tipo) && d > 0) {
    return { kind: 'PERCENT', value: Math.min(100, d), label: formatDescuento(d, tipo) }
  }
  return { kind: 'NONE', label: PROMO_TIPO_LABEL[tipo] ?? 'Promoción' }
}

export const PROMO_VISIBILIDADES = [
  { value: 'publica', label: 'Pública — visible para todo MembeGo' },
  { value: 'privada', label: 'Privada — solo miembros de tu empresa' },
] as const

export type PromoVisibilidad = (typeof PROMO_VISIBILIDADES)[number]['value']

export function esVisibilidadValida(v: string): v is PromoVisibilidad {
  return PROMO_VISIBILIDADES.some((x) => x.value === v)
}
