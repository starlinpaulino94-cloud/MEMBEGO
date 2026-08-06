import { conEmpresa } from '@/lib/tenant'

/**
 * Regalos P2P · configuración por empresa (docs/REGALOS-P2P.md §3.4).
 * Se guarda como JSON en `companies.regalosConfig`; lo no definido usa estos
 * defaults, así que una empresa recién creada ya tiene el sistema listo.
 */

export interface RegalosConfig {
  /** Permitir transferir usos propios a otros usuarios. */
  permitirTransferencias: boolean
  /** Permitir regalar compras/membresías nuevas (pagadas por el remitente). */
  permitirRegalos: boolean
  /** Máximo de transferencias que un cliente puede ENVIAR por mes. */
  maxTransferenciasMes: number
  /** Horas que un regalo queda PENDIENTE antes de expirar y devolverse. */
  vigenciaHoras: number
  /** Permitir comprar gift cards de monto abierto para otros. */
  permitirGiftCards: boolean
  /** Monto mínimo/máximo (RD$) de una gift card. */
  giftCardMontoMin: number
  giftCardMontoMax: number
}

export const REGALOS_DEFAULTS: RegalosConfig = {
  permitirTransferencias: true,
  permitirRegalos: true,
  maxTransferenciasMes: 3,
  vigenciaHoras: 72,
  permitirGiftCards: true,
  giftCardMontoMin: 500,
  giftCardMontoMax: 10000,
}

function resolver(raw: unknown): RegalosConfig {
  const cfg = (raw ?? {}) as Partial<Record<keyof RegalosConfig, unknown>>
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const int = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : d
  }
  return {
    permitirTransferencias: bool(cfg.permitirTransferencias, REGALOS_DEFAULTS.permitirTransferencias),
    permitirRegalos: bool(cfg.permitirRegalos, REGALOS_DEFAULTS.permitirRegalos),
    maxTransferenciasMes: int(cfg.maxTransferenciasMes, REGALOS_DEFAULTS.maxTransferenciasMes, 0, 100),
    vigenciaHoras: int(cfg.vigenciaHoras, REGALOS_DEFAULTS.vigenciaHoras, 1, 24 * 30),
    permitirGiftCards: bool(cfg.permitirGiftCards, REGALOS_DEFAULTS.permitirGiftCards),
    giftCardMontoMin: int(cfg.giftCardMontoMin, REGALOS_DEFAULTS.giftCardMontoMin, 50, 1_000_000),
    giftCardMontoMax: int(cfg.giftCardMontoMax, REGALOS_DEFAULTS.giftCardMontoMax, 50, 1_000_000),
  }
}

/** Configuración efectiva de la empresa (defaults si no hay fila/JSON). */
export async function getRegalosConfig(companyId: string): Promise<RegalosConfig> {
  if (!companyId) return REGALOS_DEFAULTS
  try {
    const company = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({
        where: { id: companyId },
        select: { regalosConfig: true },
      })
    )
    return resolver(company?.regalosConfig)
  } catch (e) {
    console.error('[regalos] getRegalosConfig', e)
    return REGALOS_DEFAULTS
  }
}
