import { unstable_cache } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import type { AdminSection } from '@/lib/auth/permissions'
import {
  CAPACIDAD_DE_SECCION,
  capacidadesDeEmpresa,
  type Capacidad,
  type CategoriaNegocio,
  type EmpresaParaCapacidades,
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

/**
 * Fila mínima de la empresa, tolerante a la columna sin migrar.
 *
 * `tipoNegocioCodigo` SE LEE. No se leía, y por eso este resolutor —que decide a
 * qué secciones puede entrar cada empresa— resolvía la categoría con el `type`
 * heredado aunque el superadmin hubiera asignado el vertical correcto. Es el
 * mismo fallo que las fases anteriores corrigieron en el registro y en la
 * elegibilidad; aquí se había quedado.
 */
async function leerEmpresa(companyId: string): Promise<EmpresaParaCapacidades> {
  try {
    const c = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({
        where: { id: companyId },
        select: { type: true, tipoNegocioCodigo: true, capacidades: true },
      })
    )
    return {
      type: c?.type ?? null,
      tipoNegocioCodigo: c?.tipoNegocioCodigo ?? null,
      capacidades: c?.capacidades ?? null,
    }
  } catch {
    // Columna aún sin migrar: solo el type (paquete base de la categoría).
    const c = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({ where: { id: companyId }, select: { type: true } })
    ).catch(() => null)
    return { type: c?.type ?? null, tipoNegocioCodigo: null, capacidades: null }
  }
}

export const getCapacidadesEmpresa = unstable_cache(
  async (companyId: string): Promise<CapacidadesEmpresa> => {
    const empresa = await leerEmpresa(companyId)
    const { categoria, activas } = capacidadesDeEmpresa(empresa)
    return {
      categoria,
      activas: [...activas],
      navegacionV2: activas.has('NAVEGACION_V2'),
    }
  },
  ['capacidades-empresa'],
  { revalidate: 300, tags: [CAPACIDADES_TAG] }
)

/** ¿La empresa tiene esta capacidad encendida? Fail-closed ante cualquier error. */
export async function tieneCapacidad(
  companyId: string | null | undefined,
  capacidad: Capacidad
): Promise<boolean> {
  if (!companyId) return true // contexto de plataforma (superadmin) — sin gate
  try {
    const c = await getCapacidadesEmpresa(companyId)
    return c.activas.includes(capacidad)
  } catch {
    return false
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

/**
 * La MISMA decisión que `seccionPermitidaPorCapacidades`, resuelta de una vez
 * para todas las secciones.
 *
 * Existe para las pantallas que tienen que explicar el mapa entero y no
 * pueden preguntar sección por sección: una llamada por cada una de las 44,
 * multiplicada por cada miembro del equipo, es una tabla de consultas para
 * contestar algo que sale de una sola lectura.
 *
 * Mantiene las dos reglas de la versión de una en una, porque son las que
 * hacen que la respuesta signifique lo mismo: sin empresa (contexto de
 * plataforma) no hay gate, y una sección sin capacidad mapeada siempre pasa.
 * Ante un fallo de lectura niega lo mapeado, igual que `tieneCapacidad`.
 */
export async function filtroDeCapacidades(
  companyId: string | null | undefined
): Promise<(section: AdminSection) => boolean> {
  if (!companyId) return () => true
  let activas: Capacidad[] | null = null
  try {
    activas = (await getCapacidadesEmpresa(companyId)).activas
  } catch {
    activas = null
  }
  return (section: AdminSection) => {
    const capacidad = CAPACIDAD_DE_SECCION[section]
    if (!capacidad) return true
    return activas ? activas.includes(capacidad) : false
  }
}
