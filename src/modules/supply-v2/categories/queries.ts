import 'server-only'

import { sinEmpresa } from '@/lib/tenant'

/**
 * MEMBEGO SUPPLY 2.0 · lecturas del catálogo de categorías de vehículo.
 *
 * `sinEmpresa` porque el catálogo es de Membego y no tiene `companyId`: no hay
 * inquilino por el que filtrar. No es una fuga —estas cuatro filas son las
 * mismas para todo el mundo y cualquiera que mire una oferta las ve—.
 */

export interface CategoriaVehiculoFila {
  id: string
  code: string
  nombre: string
  nivelTarifario: number
  orden: number
  activo: boolean
  descripcion: string | null
}

/** Todas, activas e inactivas, para la pantalla de administración. */
export async function categoriasVehiculo(): Promise<CategoriaVehiculoFila[]> {
  return sinEmpresa('Supply 2.0: catálogo de categorías de vehículo', (tx) =>
    tx.supplyV2VehicleCategory.findMany({
      select: { id: true, code: true, nombre: true, nivelTarifario: true, orden: true, activo: true, descripcion: true },
      orderBy: [{ orden: 'asc' }, { nivelTarifario: 'asc' }],
    })
  )
}

/**
 * Solo las activas, que son las que resuelven precios. Es la lectura que usará
 * el checkout, y por eso devuelve lo que `casarCategoria` necesita y nada más.
 */
export async function categoriasVehiculoActivas(): Promise<CategoriaVehiculoFila[]> {
  return sinEmpresa('Supply 2.0: categorías de vehículo activas', (tx) =>
    tx.supplyV2VehicleCategory.findMany({
      where: { activo: true },
      select: { id: true, code: true, nombre: true, nivelTarifario: true, orden: true, activo: true, descripcion: true },
      orderBy: [{ orden: 'asc' }, { nivelTarifario: 'asc' }],
    })
  )
}
