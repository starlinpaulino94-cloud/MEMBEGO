// Engagement Engine · Fase 7 — personalización del motor por empresa.
// Lógica PURA (segura en cliente): normaliza el JSON guardado en
// Company.engagementConfig a una forma estable con valores por defecto.

export interface EngagementConfig {
  /** Color de acento del motor en el cliente (hex #rrggbb). */
  color: string
  gamificacion: boolean
  campanas: boolean
  carruseles: boolean
  /** Popups inteligentes en el Home (Fase 8). */
  popups: boolean
}

export const DEFAULT_COLOR = '#0ea5e9'

const HEX = /^#[0-9a-fA-F]{6}$/

function colorValido(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v.trim())
}

/**
 * Normaliza el config crudo. Ausente/incompleto → todo activado y color =
 * fallback (color de marca de la empresa) o el color por defecto del motor.
 */
export function normalizeEngagementConfig(
  raw: unknown,
  fallbackColor?: string | null
): EngagementConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def)
  const color = colorValido(o.color)
    ? o.color.trim()
    : colorValido(fallbackColor)
      ? fallbackColor.trim()
      : DEFAULT_COLOR
  return {
    color,
    gamificacion: bool(o.gamificacion, true),
    // `pruebaSocial` existió hasta 2026-09-09: la sección EN VIVO se retiró
    // del Inicio por decisión del usuario. La clave puede seguir viva en el
    // JSON guardado de empresas viejas; simplemente se ignora.
    campanas: bool(o.campanas, true),
    carruseles: bool(o.carruseles, true),
    popups: bool(o.popups, true),
  }
}
