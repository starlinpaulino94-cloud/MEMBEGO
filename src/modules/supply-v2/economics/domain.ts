import { Prisma } from '@prisma/client'
import { decimal, type Decimal } from '../core/dinero'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 4 · ECONOMÍA DEL SUPPLY: reglas PURAS (§29–§32).
 *
 * DEFINICIONES (no se mezclan):
 *   GMV          valor vendido al cliente (lo que el cliente pagó)
 *   Revenue      ingreso reconocido por Membego (en prepago, = GMV)
 *   Cost         costo del supply asociado a lo vendido (costo REAL del lote,
 *                congelado en el derecho; nunca el precio público)
 *   Gross Margin Revenue − Cost
 *   Breakage     derechos emitidos que vencieron sin redimirse
 *
 * MODELO DE COSTO: el costo se reconoce UNA sola vez, al emitir el derecho
 * (venta PAID). Redimir, reversar y vencer son operacionales.
 */

export interface EventoEconomico {
  type: 'SALE_REVENUE' | 'REDEMPTION_COST' | 'EXPIRATION_COST' | 'BREAKAGE' | 'REVERSAL' | 'ADJUSTMENT' | 'COMMISSION_REVENUE'
  units: number
  gmvAmount: Decimal | string | number
  revenueAmount: Decimal | string | number
  costAmount: Decimal | string | number
  grossMarginAmount: Decimal | string | number
}

export interface Economia {
  gmv: Decimal
  revenue: Decimal
  cost: Decimal
  grossMargin: Decimal
  /** 0–100, o null sin ingreso. */
  marginPct: number | null
  unitsSold: number
  unitsRedeemed: number
  unitsExpired: number
  /** 0–100, o null sin ventas. */
  breakageRate: number | null
  /** Supply comprado que venció SIN venderse: unidades y costo real perdido. */
  expiredSupplyUnits: number
  expiredSupplyCost: Decimal
  /** Slice 5 (§53–§56): la venta a comisión, separada. GMV = lo que pagó el cliente; ingreso = comisión; neto = lo del proveedor. */
  commission: {
    gmv: Decimal
    revenue: Decimal
    supplierNet: Decimal
    unitsSold: number
  }
  /** Supply adquirido (prepago / pagar después), separado del anterior. */
  prepurchase: {
    gmv: Decimal
    revenue: Decimal
    cost: Decimal
    unitsSold: number
  }
}

const CERO = new Prisma.Decimal(0)

/** Agrega eventos económicos y redenciones vivas del periodo. Sin base de datos. */
export function agregarEconomia(eventos: readonly EventoEconomico[], unidadesRedimidas: number): Economia {
  let gmv = CERO
  let revenue = CERO
  let cost = CERO
  let grossMargin = CERO
  let unitsSold = 0
  let unitsExpired = 0
  let expiredSupplyUnits = 0
  let expiredSupplyCost = CERO
  const commission = { gmv: CERO, revenue: CERO, supplierNet: CERO, unitsSold: 0 }
  const prepurchase = { gmv: CERO, revenue: CERO, cost: CERO, unitsSold: 0 }
  for (const e of eventos) {
    switch (e.type) {
      case 'SALE_REVENUE':
      case 'REDEMPTION_COST':
      case 'REVERSAL':
      case 'ADJUSTMENT':
        gmv = gmv.plus(decimal(e.gmvAmount))
        revenue = revenue.plus(decimal(e.revenueAmount))
        cost = cost.plus(decimal(e.costAmount))
        grossMargin = grossMargin.plus(decimal(e.grossMarginAmount))
        if (e.type === 'SALE_REVENUE') {
          unitsSold += e.units
          prepurchase.unitsSold += e.units
          prepurchase.gmv = prepurchase.gmv.plus(decimal(e.gmvAmount))
          prepurchase.revenue = prepurchase.revenue.plus(decimal(e.revenueAmount))
          prepurchase.cost = prepurchase.cost.plus(decimal(e.costAmount))
        }
        break
      case 'COMMISSION_REVENUE': {
        // GMV completo; ingreso SOLO la comisión; sin costo (Membego no compró nada); el neto NO es ni ingreso ni costo.
        const g = decimal(e.gmvAmount)
        const rev = decimal(e.revenueAmount)
        gmv = gmv.plus(g)
        revenue = revenue.plus(rev)
        grossMargin = grossMargin.plus(decimal(e.grossMarginAmount))
        unitsSold += e.units
        commission.unitsSold += e.units
        commission.gmv = commission.gmv.plus(g)
        commission.revenue = commission.revenue.plus(rev)
        commission.supplierNet = commission.supplierNet.plus(g.minus(rev))
        break
      }
      case 'BREAKAGE':
        unitsExpired += e.units
        // Sin dinero: el costo ya se reconoció al vender (§28).
        break
      case 'EXPIRATION_COST':
        expiredSupplyUnits += e.units
        expiredSupplyCost = expiredSupplyCost.plus(decimal(e.costAmount))
        break
    }
  }
  return {
    gmv,
    revenue,
    cost,
    grossMargin,
    marginPct: revenue.greaterThan(0) ? Number(grossMargin.dividedBy(revenue).times(100).toDecimalPlaces(2)) : null,
    unitsSold,
    unitsRedeemed: unidadesRedimidas,
    unitsExpired,
    breakageRate: unitsSold > 0 ? Number(new Prisma.Decimal(unitsExpired).dividedBy(unitsSold).times(100).toDecimalPlaces(2)) : null,
    expiredSupplyUnits,
    expiredSupplyCost,
    commission,
    prepurchase,
  }
}

/** La foto económica de UNA venta (un derecho), reconstruible sin precios actuales (§30). */
export interface SnapshotVenta {
  customerPaid: Decimal
  publicPrice: Decimal
  discount: Decimal
  actualUnitCost: Decimal
  grossMargin: Decimal
}

export function snapshotDeVenta(d: { customerUnitPrice: Decimal | string | number; publicUnitPrice: Decimal | string | number; actualUnitCost: Decimal | string | number }): SnapshotVenta {
  const customerPaid = decimal(d.customerUnitPrice)
  const publicPrice = decimal(d.publicUnitPrice)
  const actualUnitCost = decimal(d.actualUnitCost)
  return {
    customerPaid,
    publicPrice,
    discount: publicPrice.minus(customerPaid),
    actualUnitCost,
    grossMargin: customerPaid.minus(actualUnitCost),
  }
}

export type VentanaEconomia = 'HOY' | '7D' | '30D' | 'MES' | 'RANGO'

/** Rango [desde, hasta) de una ventana del reporte (§68), en la zona del servidor. */
export function rangoDeVentana(ventana: VentanaEconomia, ahora = new Date(), desde?: Date | null, hasta?: Date | null): { desde: Date; hasta: Date } {
  const fin = new Date(ahora.getTime() + 1)
  const inicioDia = new Date(ahora)
  inicioDia.setHours(0, 0, 0, 0)
  switch (ventana) {
    case 'HOY':
      return { desde: inicioDia, hasta: fin }
    case '7D':
      return { desde: new Date(inicioDia.getTime() - 6 * 86_400_000), hasta: fin }
    case '30D':
      return { desde: new Date(inicioDia.getTime() - 29 * 86_400_000), hasta: fin }
    case 'MES': {
      const d = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
      return { desde: d, hasta: fin }
    }
    case 'RANGO': {
      const d = desde ?? new Date(inicioDia.getTime() - 29 * 86_400_000)
      const h = hasta ? new Date(hasta.getTime()) : fin
      return { desde: d, hasta: h > d ? h : fin }
    }
  }
}
