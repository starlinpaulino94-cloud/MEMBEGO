import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { proveedoresElegibles } from './proveedores'

/**
 * MEMBEGO SUPPLY · opciones para los selectores de las pantallas de finanzas.
 *
 * Proveedores con los que se puede contratar y acuerdos vivos, en la forma
 * mínima que necesita un `<select>`. Vive en un módulo y no en cada página
 * para que todas enseñen la misma lista.
 */

export interface OpcionesFinanzas {
  proveedores: { value: string; label: string }[]
  acuerdos: { value: string; label: string; proveedorId: string }[]
}

export async function opcionesFinanzas(): Promise<OpcionesFinanzas> {
  const [proveedores, acuerdos] = await Promise.all([
    proveedoresElegibles(),
    sinEmpresa('Membego Supply: acuerdos vivos para los selectores', (tx) =>
      tx.supplyAcuerdo.findMany({
        where: { estado: { in: ['APROBADO', 'ACTIVO', 'SUSPENDIDO', 'COMPLETADO', 'VENCIDO'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, codigo: true, itemNombre: true, proveedorId: true, proveedor: { select: { name: true } } },
      })
    ),
  ])
  return {
    proveedores: proveedores.map((p) => ({ value: p.id, label: p.origen === 'EXTERNA' ? `${p.nombre} (externo)` : p.nombre })),
    acuerdos: acuerdos.map((a) => ({ value: a.id, label: `${a.codigo} · ${a.itemNombre} · ${a.proveedor.name}`, proveedorId: a.proveedorId })),
  }
}

/** Cuentas por pagar vivas de un proveedor, para elegir a cuál aplicar un depósito o un pago. */
export async function cuentasPorPagarAbiertas(proveedorId: string) {
  const filas = await sinEmpresa('Membego Supply: cuentas por pagar abiertas de un proveedor', (tx) =>
    tx.supplyCuentaPorPagar.findMany({
      where: { proveedorId, estado: { in: ['ABIERTA', 'PARCIALMENTE_SALDADA'] }, liquidacionId: null },
      orderBy: [{ vencimientoAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, codigo: true, descripcion: true, montoNeto: true, montoSaldado: true },
    })
  )
  return filas.map((c) => ({
    value: c.id,
    label: `${c.codigo} · ${c.descripcion.slice(0, 40)} · pendiente ${(Number(c.montoNeto) - Number(c.montoSaldado)).toFixed(2)}`,
    pendiente: Number(c.montoNeto) - Number(c.montoSaldado),
  }))
}
