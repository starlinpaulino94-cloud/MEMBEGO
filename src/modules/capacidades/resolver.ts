import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import type { AdminSection } from '@/lib/auth/permissions'
import {
  CAPACIDAD_DE_SECCION,
  capacidadesEfectivas,
  type Capacidad,
  type CategoriaNegocio,
} from './catalogo'

/**
 * Plataforma modular · E1 — RESOLUTOR de capacidades por empresa.
 *
 * empresa → categoría (type u override) → paquete base → overrides →
 * capacidades activas. TODO fail-open: si la columna `capacidades` no existe
 * (migración 20260758 pendiente), la BD falla o la empresa no aparece, la
 * respuesta es "todo lo actual permitido" — nada visible cambia (regla D4).
 *
 * El panel de capacidades (E4) debe invalidar con
 * `revalidateTag(CAPACIDADES_TAG)` al guardar.
 */

export const CAPACIDADES_TAG = 'capacidades'

export interface CapacidadesEmpresa {
  categoria: CategoriaNegocio
  activas: Capacidad[]
  /** Interruptor D7: launchpad + shell (E2). Apagado por defecto. */
  navegacionV2: boolean
}

/** Fila mínima de la empresa, tolerante a la columna sin migrar. */
async function leerEmpresa(companyId: string): Promise<{ type: string | null; raw: unknown }> {
  try {
    const c = await prisma.company.findUnique({
      where: { id: companyId },
      select: { type: true, capacidades: true },
    })
    return { type: c?.type ?? null, raw: c?.capacidades ?? null }
  } catch {
    // Columna aún sin migrar: solo el type (paquete base de la categoría).
    const c = await prisma.company
      .findUnique({ where: { id: companyId }, select: { type: true } })
      .catch(() => null)
    return { type: c?.type ?? null, raw: null }
  }
}

export const getCapacidadesEmpresa = unstable_cache(
  async (companyId: string): Promise<CapacidadesEmpresa> => {
    const { type, raw } = await leerEmpresa(companyId)
    const { categoria, activas } = capacidadesEfectivas(type, raw)
    return {
      categoria,
      activas: [...activas],
      navegacionV2: activas.has('NAVEGACION_V2'),
    }
  },
  ['capacidades-empresa'],
  { revalidate: 300, tags: [CAPACIDADES_TAG] }
)

/** ¿La empresa tiene esta capacidad encendida? Fail-open ante cualquier error. */
export async function tieneCapacidad(
  companyId: string | null | undefined,
  capacidad: Capacidad
): Promise<boolean> {
  if (!companyId) return true // contexto de plataforma (superadmin) — sin gate
  try {
    const c = await getCapacidadesEmpresa(companyId)
    return c.activas.includes(capacidad)
  } catch (e) {
    console.error('[capacidades] tieneCapacidad', e)
    return true
  }
}

/**
 * Capa de CAPACIDADES sobre los permisos por sección (la consume
 * `requireSection`): una sección no mapeada a ninguna capacidad siempre pasa
 * (el núcleo no puede apagarse); una mapeada exige la capacidad encendida.
 */
export async function seccionPermitidaPorCapacidades(
  companyId: string | null | undefined,
  section: AdminSection
): Promise<boolean> {
  const capacidad = CAPACIDAD_DE_SECCION[section]
  if (!capacidad) return true
  return tieneCapacidad(companyId, capacidad)
}
