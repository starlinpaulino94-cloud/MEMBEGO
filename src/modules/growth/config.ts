/**
 * Growth Engine 3.0 · Configuración del programa por empresa.
 *
 * Server-internal (SIN 'use server'). Cada empresa administra su propio
 * programa: qué eventos premia y la duración por defecto de sus enlaces
 * (req #12). Si aún no configuró nada, se aplican valores por defecto seguros
 * sin crear filas (la fila se crea al guardar desde el panel admin).
 */

import { conEmpresa } from '@/lib/tenant'
import type { GrowthConfig } from '@prisma/client'

/** Duraciones ofrecidas para un enlace de invitación (req #2). */
export const GROWTH_DURACIONES: { horas: number; label: string }[] = [
  { horas: 1, label: '1 hora' },
  { horas: 6, label: '6 horas' },
  { horas: 12, label: '12 horas' },
  { horas: 24, label: '24 horas' },
  { horas: 72, label: '3 días' },
  { horas: 168, label: '7 días' },
]

export const DURACION_HORAS_VALIDAS = GROWTH_DURACIONES.map((d) => d.horas)

export interface GrowthConfigResuelta {
  landingActiva: boolean
  duracionHorasDefault: number
  premiaClic: boolean
  premiaRegistro: boolean
  premiaMembresia: boolean
  premiaCompra: boolean
  premiaRenovacion: boolean
}

const DEFECTOS: GrowthConfigResuelta = {
  landingActiva: true,
  duracionHorasDefault: 24,
  premiaClic: false,
  premiaRegistro: true,
  premiaMembresia: true,
  premiaCompra: true,
  premiaRenovacion: false,
}

/** Configuración efectiva de la empresa (con defaults si no existe la fila). */
export async function getGrowthConfig(companyId: string): Promise<GrowthConfigResuelta> {
  if (!companyId) return DEFECTOS
  try {
    const cfg = await conEmpresa(companyId, (tx) =>
      tx.growthConfig.findUnique({ where: { companyId } })
    )
    if (!cfg) return DEFECTOS
    return resolver(cfg)
  } catch (e) {
    console.error('[growth] getGrowthConfig', e)
    return DEFECTOS
  }
}

function resolver(cfg: GrowthConfig): GrowthConfigResuelta {
  return {
    landingActiva: cfg.landingActiva,
    duracionHorasDefault: cfg.duracionHorasDefault,
    premiaClic: cfg.premiaClic,
    premiaRegistro: cfg.premiaRegistro,
    premiaMembresia: cfg.premiaMembresia,
    premiaCompra: cfg.premiaCompra,
    premiaRenovacion: cfg.premiaRenovacion,
  }
}
