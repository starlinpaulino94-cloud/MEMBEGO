/**
 * MEMBEGO SUPPLY · configuración del Slice 2.
 *
 * El TTL de la reserva del checkout vive AQUÍ y solo aquí (§25): quien lo
 * necesite lo lee de esta función. En producción viene de la variable de
 * entorno; sin ella, 15 minutos.
 */

export const TTL_RESERVA_POR_DEFECTO_MIN = 15

export function ttlReservaMinutos(): number {
  const crudo = process.env.SUPPLY_V2_RESERVATION_TTL_MINUTES
  const n = crudo ? Number(crudo) : NaN
  return Number.isFinite(n) && n > 0 ? n : TTL_RESERVA_POR_DEFECTO_MIN
}

export function vencimientoDeReserva(desde = new Date(), minutos = ttlReservaMinutos()): Date {
  return new Date(desde.getTime() + minutos * 60_000)
}

// ── Slice 3 ─────────────────────────────────────────────────────────────────

/** TTL del QR temporal (§9): un solo sitio. Sin variable de entorno, 5 minutos. */
export const TTL_QR_POR_DEFECTO_MIN = 5

export function ttlQrMinutos(): number {
  const crudo = process.env.SUPPLY_V2_QR_TTL_MINUTES
  const n = crudo ? Number(crudo) : NaN
  return Number.isFinite(n) && n > 0 ? n : TTL_QR_POR_DEFECTO_MIN
}

export function vencimientoDeQr(desde = new Date(), minutos = ttlQrMinutos()): Date {
  return new Date(desde.getTime() + minutos * 60_000)
}

// ── Supplier & Fulfillment Commerce ─────────────────────────────────────────

/**
 * Modo ESTRICTO de la preparación del proveedor (§8, §61): con
 * `SUPPLY_V2_READINESS_STRICT=1`, un proveedor que nunca fue invitado (DRAFT)
 * tampoco recibe acuerdos ni ofertas nuevos. Apagado por defecto durante la
 * migración: los proveedores históricos siguen operando mientras se les
 * invita; los NUEVOS, en cuanto entran al ciclo de acceso, tienen que
 * completarlo.
 */
export function preparacionEstricta(): boolean {
  const v = (process.env.SUPPLY_V2_READINESS_STRICT ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'si' || v === 'sí'
}
