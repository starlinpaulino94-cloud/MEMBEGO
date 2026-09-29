import type { SupplyDiscrepanciaTipo } from '@prisma/client'
import { redondear2 } from './dinero'

/**
 * MEMBEGO SUPPLY · comparación de cifras Membego vs proveedor (§18). PURO.
 *
 * Recibe los números de los dos lados y devuelve las discrepancias con su
 * tipo. Vive aparte de `conciliacion-proveedor.ts` (server-only) para poder
 * probarse sin base de datos.
 */

export interface DiscrepanciaNueva {
  tipo: SupplyDiscrepanciaTipo
  titulo: string
  detalle: string
  cantidadMembego?: number | null
  cantidadProveedor?: number | null
  montoMembego?: number | null
  montoProveedor?: number | null
  montoDiferencia?: number | null
  entidad?: string | null
  entidadId?: string | null
}

/**
 * Compara lo que dice Membego con lo que declaró el proveedor. PURO: recibe
 * las cifras y devuelve las discrepancias. Se exporta para probarlo.
 */
export function compararCifras(m: {
  membegoRedenciones: number
  membegoMonto: number
  membegoVentas: number
  membegoVentasMonto: number
  proveedorRedenciones: number
  proveedorMonto: number
  proveedorVentas: number
  proveedorVentasMonto: number
}): DiscrepanciaNueva[] {
  const out: DiscrepanciaNueva[] = []
  const dRed = m.membegoRedenciones - m.proveedorRedenciones
  if (dRed > 0) {
    out.push({
      tipo: 'MISSING_REDEMPTION',
      titulo: `${dRed} redención(es) que el proveedor no registró`,
      detalle: `Membego registró ${m.membegoRedenciones} y el proveedor declara ${m.proveedorRedenciones}.`,
      cantidadMembego: m.membegoRedenciones, cantidadProveedor: m.proveedorRedenciones,
      entidad: 'redenciones',
    })
  } else if (dRed < 0) {
    out.push({
      tipo: 'DUPLICATE',
      titulo: `El proveedor cuenta ${-dRed} redención(es) de más`,
      detalle: `El proveedor declara ${m.proveedorRedenciones} y Membego registró ${m.membegoRedenciones}.`,
      cantidadMembego: m.membegoRedenciones, cantidadProveedor: m.proveedorRedenciones,
      entidad: 'redenciones',
    })
  }
  const dMonto = redondear2(m.membegoMonto - m.proveedorMonto)
  if (Math.abs(dMonto) >= 0.01 && dRed === 0) {
    // Mismo número de entregas y distinto dinero: es de VALOR, no de conteo.
    out.push({
      tipo: 'VALUE_DIFFERENCE',
      titulo: `Diferencia de ${Math.abs(dMonto).toFixed(2)} en el valor de las redenciones`,
      detalle: `Membego calcula ${m.membegoMonto.toFixed(2)} y el proveedor declara ${m.proveedorMonto.toFixed(2)}.`,
      montoMembego: m.membegoMonto, montoProveedor: m.proveedorMonto, montoDiferencia: dMonto,
      entidad: 'redenciones',
    })
  } else if (Math.abs(dMonto) >= 0.01) {
    // Con conteos distintos, el dinero se anota en la misma discrepancia.
    const ultima = out[out.length - 1]
    if (ultima) Object.assign(ultima, { montoMembego: m.membegoMonto, montoProveedor: m.proveedorMonto, montoDiferencia: dMonto })
  }
  const dVen = m.membegoVentas - m.proveedorVentas
  const dVenMonto = redondear2(m.membegoVentasMonto - m.proveedorVentasMonto)
  if (dVen !== 0 || Math.abs(dVenMonto) >= 0.01) {
    out.push({
      tipo: dVen !== 0 ? 'PRODUCT_DIFFERENCE' : 'PAYMENT_DIFFERENCE',
      titulo: dVen !== 0 ? `Diferencia de ${Math.abs(dVen)} venta(s) entregada(s)` : `Diferencia de ${Math.abs(dVenMonto).toFixed(2)} en lo debido por ventas`,
      detalle: `Membego: ${m.membegoVentas} ventas por ${m.membegoVentasMonto.toFixed(2)} · proveedor: ${m.proveedorVentas} por ${m.proveedorVentasMonto.toFixed(2)}.`,
      cantidadMembego: m.membegoVentas, cantidadProveedor: m.proveedorVentas,
      montoMembego: m.membegoVentasMonto, montoProveedor: m.proveedorVentasMonto, montoDiferencia: dVenMonto,
      entidad: 'ventas',
    })
  }
  return out
}
