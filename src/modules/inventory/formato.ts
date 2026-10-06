import type { InventoryMovementType } from '@prisma/client'
import type { EstadoStock } from './domain'

/**
 * COMMERCE CORE · inventario — textos y formato para la interfaz.
 *
 * Puro y sin dependencias de servidor: lo importan también los componentes de
 * cliente (que NO pueden importar el servicio ni las lecturas, arrastrarían
 * Prisma al navegador).
 */

export const ETIQUETA_MOVIMIENTO: Record<InventoryMovementType, string> = {
  PURCHASE: 'Entrada de mercancía',
  SALE: 'Venta',
  RETURN: 'Devolución',
  TRANSFER_IN: 'Transferencia recibida',
  TRANSFER_OUT: 'Transferencia enviada',
  ADJUSTMENT: 'Ajuste',
  DAMAGE: 'Daño',
  RESERVATION: 'Reserva',
  RESERVATION_RELEASE: 'Reserva liberada',
}

export const ETIQUETA_ESTADO_STOCK: Record<EstadoStock, string> = {
  AGOTADO: 'Agotado',
  BAJO: 'Stock bajo',
  OK: 'En stock',
}

export const BADGE_ESTADO_STOCK: Record<EstadoStock, 'destructive' | 'warning' | 'success'> = {
  AGOTADO: 'destructive',
  BAJO: 'warning',
  OK: 'success',
}

/** «Camiseta · Grande»; una variante automática (`isDefault`) no se nombra: es el producto. */
export function nombreCompleto(itemNombre: string, nombreVariante: string, esDefault: boolean): string {
  return esDefault ? itemNombre : `${itemNombre} · ${nombreVariante}`
}

export function formatearCantidad(n: number): string {
  return n.toLocaleString('es-DO')
}

/** Lo que un movimiento hizo a la existencia: «+10», «−3» o «—» si solo cambió de cubeta. */
export function efectoLegible(efecto: number): string {
  if (efecto > 0) return `+${formatearCantidad(efecto)}`
  if (efecto < 0) return `−${formatearCantidad(-efecto)}`
  return '—'
}

/** De dónde viene un movimiento, en palabras; null si no hay nada útil que decir. */
export function describirReferencia(tipo: string | null, id: string | null): string | null {
  if (!tipo) return null
  switch (tipo) {
    case 'TRANSFER':
      return 'Transferencia entre sucursales'
    case 'STOCK_COUNT':
      return 'Conteo físico'
    case 'RESERVATION':
      return 'Reserva'
    case 'ORDER':
      return id ? `Pedido ${id.slice(-8)}` : 'Pedido'
    default:
      return id ? `${tipo} ${id.slice(-8)}` : tipo
  }
}

/**
 * Las operaciones manuales del formulario de una sucursal. `motivo`: si la base
 * lo exige (ajuste, daño) el campo es obligatorio. `soloConDanados`: solo tiene
 * sentido si hay unidades dañadas que resolver.
 */
export type OperacionManual = 'ENTRADA' | 'DEVOLUCION' | 'AJUSTE_SOBRANTE' | 'AJUSTE_FALTANTE' | 'CONTEO' | 'DANO' | 'DANADO_VENDIBLE' | 'DANADO_BAJA'

export const OPERACIONES: ReadonlyArray<{
  valor: OperacionManual
  etiqueta: string
  ayuda: string
  /** Etiqueta del campo numérico. */
  campo: string
  motivoObligatorio: boolean
  soloConDanados?: boolean
}> = [
  { valor: 'ENTRADA', etiqueta: 'Entrada de mercancía', ayuda: 'Llegó mercancía: se suma a lo disponible.', campo: 'Cantidad que llegó', motivoObligatorio: false },
  { valor: 'DEVOLUCION', etiqueta: 'Devolución de un cliente', ayuda: 'Un cliente devolvió mercancía en buen estado.', campo: 'Cantidad devuelta', motivoObligatorio: false },
  { valor: 'CONTEO', etiqueta: 'Conteo físico', ayuda: 'Cuenta lo que hay (disponible + apartado) y el sistema calcula la diferencia.', campo: 'Cantidad contada', motivoObligatorio: false },
  { valor: 'AJUSTE_SOBRANTE', etiqueta: 'Ajuste: sobrante', ayuda: 'Hay más de lo que dice el sistema.', campo: 'Cantidad sobrante', motivoObligatorio: true },
  { valor: 'AJUSTE_FALTANTE', etiqueta: 'Ajuste: faltante', ayuda: 'Hay menos de lo que dice el sistema (merma, pérdida).', campo: 'Cantidad faltante', motivoObligatorio: true },
  { valor: 'DANO', etiqueta: 'Mercancía dañada', ayuda: 'Pasa de disponible a dañado: deja de venderse.', campo: 'Cantidad dañada', motivoObligatorio: true },
  { valor: 'DANADO_VENDIBLE', etiqueta: 'Lo dañado sí se puede vender', ayuda: 'Vuelve de dañado a disponible.', campo: 'Cantidad recuperada', motivoObligatorio: true, soloConDanados: true },
  { valor: 'DANADO_BAJA', etiqueta: 'Dar de baja lo dañado', ayuda: 'Sale del inventario para siempre.', campo: 'Cantidad dada de baja', motivoObligatorio: true, soloConDanados: true },
]
