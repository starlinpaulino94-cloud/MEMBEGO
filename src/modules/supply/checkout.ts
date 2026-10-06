import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { cobroMembegoDisponible } from './cobro'
import { valorDeBono } from './ventas'
import { redondear2, repartirVenta } from './dinero'

/**
 * MEMBEGO SUPPLY · CHECKOUT del cliente (encargo 2026-09 bis, §19).
 *
 * Arma el desglose que el cliente tiene que ver ANTES de comprometerse:
 * precio original, descuento de Membego, bono aplicable, diferencia y total.
 * Todo sale de la base; el navegador no manda precios.
 *
 * Dos objetos posibles:
 *   · una OFERTA (asignación con precio): unidad precomprada por Membego;
 *   · una VENTA a comisión (acuerdo COMISION): Membego vende lo del proveedor
 *     y aquí es donde un bono del cliente puede cubrir parte del valor (§17).
 */

export interface BonoAplicable {
  derechoId: string
  producto: string
  valor: number
  venceAt: Date
}

export interface ResumenCheckout {
  tipo: 'OFERTA' | 'VENTA'
  id: string
  producto: string
  variante: string | null
  proveedor: string
  proveedorId: string
  cantidad: number
  precioOriginal: number
  descuentoMembego: number
  precioMembego: number
  subtotal: number
  bonos: BonoAplicable[]
  cobrable: boolean
  esGratis: boolean
  disponibles: number
}

export async function resumenCheckout(d: {
  clienteIds: readonly string[]
  asignacionId?: string | null
  acuerdoId?: string | null
  cantidad?: number
}): Promise<ResumenCheckout | null> {
  const cantidad = Math.max(1, Math.min(20, Math.floor(d.cantidad ?? 1)))
  const cobrable = await cobroMembegoDisponible()
  return sinEmpresa('Membego Supply: desglose del checkout del cliente', async (tx) => {
    if (d.asignacionId) {
      const a = await tx.supplyAsignacion.findUnique({
        where: { id: d.asignacionId },
        select: {
          id: true, activa: true, cantidad: true, emitidas: true, liberadas: true, precioCliente: true, inicioAt: true, finAt: true,
          lote: { select: { estado: true, venceAt: true, snapshotItemNombre: true, snapshotVariante: true, snapshotPrecioReferencia: true, snapshotCostoUnitario: true, proveedorId: true, proveedor: { select: { name: true } } } },
        },
      })
      if (!a || !a.activa || a.lote.estado !== 'ACTIVO') return null
      const ahora = new Date()
      if ((a.inicioAt && a.inicioAt > ahora) || (a.finAt && a.finAt <= ahora) || a.lote.venceAt <= ahora) return null
      const precioMembego = Number(a.precioCliente)
      const original = a.lote.snapshotPrecioReferencia != null ? Number(a.lote.snapshotPrecioReferencia) : precioMembego
      return {
        tipo: 'OFERTA', id: a.id, producto: a.lote.snapshotItemNombre, variante: a.lote.snapshotVariante,
        proveedor: a.lote.proveedor.name, proveedorId: a.lote.proveedorId, cantidad: 1,
        precioOriginal: original, descuentoMembego: redondear2(Math.max(0, original - precioMembego)), precioMembego,
        subtotal: precioMembego, bonos: [], cobrable, esGratis: precioMembego === 0,
        disponibles: Math.max(0, a.cantidad - a.emitidas - a.liberadas),
      }
    }
    if (d.acuerdoId) {
      const ac = await tx.supplyAcuerdo.findUnique({
        where: { id: d.acuerdoId },
        select: { id: true, estado: true, modeloComercial: true, itemNombre: true, varianteEtiqueta: true, precioReferencia: true, comisionPorcentaje: true, descuentoPorcentaje: true, cantidad: true, proveedorId: true, inicioAt: true, finAt: true, proveedor: { select: { name: true } } },
      })
      if (!ac || ac.modeloComercial !== 'COMISION' || ac.estado !== 'ACTIVO' || !ac.precioReferencia) return null
      const ahora = new Date()
      if (ac.inicioAt > ahora || ac.finAt <= ahora) return null
      const vendidas = await tx.supplyVentaDirecta.aggregate({ where: { acuerdoId: ac.id, estado: { in: ['INICIADA', 'PAGADA', 'ENTREGADA'] } }, _sum: { cantidad: true } })
      const reparto = repartirVenta(Number(ac.precioReferencia), cantidad, Number(ac.comisionPorcentaje ?? 0))
      const bonos = d.clienteIds.length === 0 ? [] : await tx.supplyDerecho.findMany({
        where: {
          clienteId: { in: [...d.clienteIds] }, proveedorId: ac.proveedorId, estado: 'ACTIVO', vencAt: { gt: ahora },
          vouchers: { some: { estado: 'ACTIVO' } },
          OR: [{ ventaComoBono: null }, { ventaComoBono: { estado: { in: ['CANCELADA', 'REEMBOLSADA'] } } }],
        },
        select: { id: true, vencAt: true, lote: { select: { snapshotItemNombre: true, snapshotPrecioReferencia: true, snapshotCostoUnitario: true } } },
        orderBy: { vencAt: 'asc' },
        take: 10,
      })
      const precioUnit = Number(ac.precioReferencia)
      const descuentoPct = Number(ac.descuentoPorcentaje ?? 0)
      return {
        tipo: 'VENTA', id: ac.id, producto: ac.itemNombre, variante: ac.varianteEtiqueta, proveedor: ac.proveedor.name, proveedorId: ac.proveedorId,
        cantidad,
        precioOriginal: descuentoPct > 0 ? redondear2(precioUnit / (1 - descuentoPct / 100)) : precioUnit,
        descuentoMembego: descuentoPct > 0 ? redondear2(precioUnit / (1 - descuentoPct / 100) - precioUnit) : 0,
        precioMembego: precioUnit,
        subtotal: reparto.montoBruto,
        bonos: bonos
          .map((b) => ({ derechoId: b.id, producto: b.lote.snapshotItemNombre, valor: valorDeBono(b.lote), venceAt: b.vencAt }))
          .filter((b) => b.valor > 0 && reparto.montoProveedor - Math.min(b.valor, reparto.montoBruto) >= 0),
        cobrable, esGratis: false,
        disponibles: Math.max(0, ac.cantidad - (vendidas._sum.cantidad ?? 0)),
      }
    }
    return null
  })
}
