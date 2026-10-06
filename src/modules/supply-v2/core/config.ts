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
