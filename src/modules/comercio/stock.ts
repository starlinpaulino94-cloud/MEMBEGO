import { disponible, estadoDeStock, type EstadoStock } from '@/modules/inventory/domain'

/**
 * COMERCIO · resumen de stock de un ítem para listas, a partir de los niveles
 * crudos que devuelve el catálogo (que no sabe de inventario: solo los lee).
 */
export interface NivelCrudo {
  onHand: number
  reserved: number
  lowStockThreshold: number
}

export interface ResumenStock {
  disponible: number
  estado: EstadoStock
}

/** null = el ítem no controla inventario (un servicio, por ejemplo). */
export function resumenDeStock(controlaInventario: boolean, niveles: readonly NivelCrudo[]): ResumenStock | null {
  if (!controlaInventario) return null
  const total = niveles.reduce((a, n) => a + disponible(n), 0)
  // El peor estado entre los niveles: si una sucursal está agotada y otra baja,
  // la lista avisa «Stock bajo»; si todas están agotadas (o no hay niveles), «Agotado».
  const estados = niveles.map((n) => estadoDeStock(n))
  const estado: EstadoStock =
    niveles.length === 0 || estados.every((e) => e === 'AGOTADO') ? 'AGOTADO' : estados.includes('BAJO') || estados.includes('AGOTADO') ? 'BAJO' : 'OK'
  return { disponible: total, estado }
}

/**
 * Lo que ve el CONSUMIDOR: nunca la cantidad exacta. «Pocas unidades» solo si la
 * empresa fijó un umbral de aviso (si no, el cliente ve «Disponible» hasta que se
 * acaba). Es la única proyección pública del stock.
 */
export type DisponibilidadPublica = 'DISPONIBLE' | 'POCAS_UNIDADES' | 'AGOTADO'

export function disponibilidadPublica(niveles: readonly NivelCrudo[], controlaInventario: boolean): DisponibilidadPublica {
  if (!controlaInventario) return 'DISPONIBLE'
  const r = resumenDeStock(true, niveles)
  if (!r || r.disponible <= 0) return 'AGOTADO'
  return r.estado === 'BAJO' ? 'POCAS_UNIDADES' : 'DISPONIBLE'
}

export const ETIQUETA_DISPONIBILIDAD: Record<DisponibilidadPublica, string> = {
  DISPONIBLE: 'Disponible',
  POCAS_UNIDADES: 'Pocas unidades',
  AGOTADO: 'Agotado',
}
