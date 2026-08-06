import { conEmpresa } from '@/lib/tenant'

/**
 * Seguimiento de beneficios gratis · Fase S3: parametrización por empresa
 * (docs/SEGUIMIENTO-BENEFICIOS.md §2.7). Se guarda como JSON en
 * `companies.seguimientoConfig`; lo no definido usa estos defaults.
 *
 * Tolerante a la migración pendiente: si la columna aún no existe en la BD,
 * la lectura devuelve los defaults (el módulo sigue funcionando) y solo el
 * guardado pedirá correr la migración.
 */

export interface SeguimientoConfig {
  /** Una recompensa SIN USAR que vence en ≤ N días se marca "por vencer". */
  umbralPorVencerDias: number
  /** Recordatorio automático diario (cron) a los que no han usado su QR. */
  recordatorioAuto: boolean
  /** Enviar el recordatorio cuando falten ≤ N días para vencer. */
  recordatorioDiasAntes: number
  /** No repetir recordatorio (manual o automático) antes de N días. */
  recordatorioFrecuenciaDias: number
  /** Plantilla del mensaje: {cliente} {empresa} {recompensa} {vence}. */
  plantillaMensaje: string
  /** IDs de promociones gratis EXCLUIDAS del rastreo. */
  promosExcluidas: string[]
}

export const SEGUIMIENTO_DEFAULTS: SeguimientoConfig = {
  umbralPorVencerDias: 7,
  recordatorioAuto: true,
  recordatorioDiasAntes: 5,
  recordatorioFrecuenciaDias: 7,
  plantillaMensaje:
    'Hola {cliente} 👋 Te escribimos de {empresa}: tienes "{recompensa}" GRATIS sin usar. Ven a disfrutarla {vence} — solo presenta tu QR desde la app. ¡Te esperamos!',
  promosExcluidas: [],
}

export function resolverSeguimientoConfig(raw: unknown): SeguimientoConfig {
  const cfg = (raw ?? {}) as Partial<Record<keyof SeguimientoConfig, unknown>>
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const int = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : d
  }
  const texto = (v: unknown, d: string) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : d
  return {
    umbralPorVencerDias: int(cfg.umbralPorVencerDias, SEGUIMIENTO_DEFAULTS.umbralPorVencerDias, 1, 90),
    recordatorioAuto: bool(cfg.recordatorioAuto, SEGUIMIENTO_DEFAULTS.recordatorioAuto),
    recordatorioDiasAntes: int(cfg.recordatorioDiasAntes, SEGUIMIENTO_DEFAULTS.recordatorioDiasAntes, 1, 90),
    recordatorioFrecuenciaDias: int(
      cfg.recordatorioFrecuenciaDias,
      SEGUIMIENTO_DEFAULTS.recordatorioFrecuenciaDias,
      1,
      90
    ),
    plantillaMensaje: texto(cfg.plantillaMensaje, SEGUIMIENTO_DEFAULTS.plantillaMensaje),
    promosExcluidas: Array.isArray(cfg.promosExcluidas)
      ? cfg.promosExcluidas.filter((x): x is string => typeof x === 'string').slice(0, 100)
      : [],
  }
}

/** Configuración efectiva de la empresa (defaults si no hay fila/JSON/columna). */
export async function getSeguimientoConfig(companyId: string): Promise<SeguimientoConfig> {
  if (!companyId) return SEGUIMIENTO_DEFAULTS
  try {
    const company = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({
        where: { id: companyId },
        select: { seguimientoConfig: true },
      })
    )
    return resolverSeguimientoConfig(company?.seguimientoConfig)
  } catch (e) {
    console.error('[seguimiento] getSeguimientoConfig', e)
    return SEGUIMIENTO_DEFAULTS
  }
}

/**
 * Mensaje de contacto/recordatorio a partir de la plantilla. `vence` es la
 * fecha ya formateada o null (→ "cuanto antes").
 */
export function renderMensajeSeguimiento(
  plantilla: string,
  vars: { cliente: string; empresa: string; recompensa: string; vence: string | null }
): string {
  return plantilla
    .replace(/\{cliente\}/g, vars.cliente)
    .replace(/\{empresa\}/g, vars.empresa)
    .replace(/\{recompensa\}/g, vars.recompensa)
    .replace(/\{vence\}/g, vars.vence ? `antes del ${vars.vence}` : 'cuanto antes')
}
