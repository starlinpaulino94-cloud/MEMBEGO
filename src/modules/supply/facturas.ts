import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyFacturaEstado, SupplyFacturaTipo } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { codigoFactura } from './codigos'
import { crearCuentaPorCobrarEnTx, crearCuentaPorPagarEnTx, moverCuenta } from './cuentas'
import { redondear2 } from './dinero'

/**
 * MEMBEGO SUPPLY · FACTURAS DEL PROVEEDOR (§21).
 *
 * No se implementa legislación fiscal: se guarda el documento tal como lo
 * emitió el proveedor y se crea la relación financiera correcta. Una FACTURA
 * o una NOTA DE DÉBITO nacen con su cuenta por pagar; una NOTA DE CRÉDITO,
 * con su cuenta por cobrar. A partir de ahí la factura es un espejo de su
 * cuenta: se salda por pago, por depósito o por liquidación, y la cuenta lo
 * refleja en la factura (`cuentas.ts`).
 */

export interface DatosFactura {
  proveedorId: string
  acuerdoId?: string | null
  ordenId?: string | null
  tipo?: SupplyFacturaTipo
  numero: string
  fechaEmision: Date
  fechaVencimiento?: Date | null
  subtotal: number
  impuestos?: number
  moneda?: string
  documentoPath?: string | null
  notas?: string | null
  registradoPorId?: string | null
  claveIdempotencia?: string | null
}

export async function registrarFactura(d: DatosFactura): Promise<{ id: string; codigo: string; total: number; reutilizada: boolean }> {
  if (!d.numero.trim()) throw new Error('La factura necesita el número del proveedor.')
  if (!Number.isFinite(d.subtotal) || d.subtotal < 0) throw new Error('El subtotal no puede ser negativo.')
  const impuestos = redondear2(d.impuestos ?? 0)
  if (impuestos < 0) throw new Error('Los impuestos no pueden ser negativos.')
  const total = redondear2(d.subtotal + impuestos)
  if (total <= 0) throw new Error('Una factura de cero no genera obligación.')
  const tipo = d.tipo ?? 'FACTURA'

  return sinEmpresa('Membego Supply: registrar una factura de proveedor', async (tx) => {
    if (d.claveIdempotencia) {
      const previa = await tx.supplyFacturaProveedor.findUnique({
        where: { claveIdempotencia: d.claveIdempotencia },
        select: { id: true, codigo: true, total: true },
      })
      if (previa) return { id: previa.id, codigo: previa.codigo, total: Number(previa.total), reutilizada: true }
    }
    const repetida = await tx.supplyFacturaProveedor.findUnique({
      where: { proveedorId_numero: { proveedorId: d.proveedorId, numero: d.numero.trim() } },
      select: { id: true },
    })
    if (repetida) throw new Error(`El proveedor ya tiene registrada la factura ${d.numero.trim()}.`)

    if (d.acuerdoId) {
      const acuerdo = await tx.supplyAcuerdo.findUnique({ where: { id: d.acuerdoId }, select: { proveedorId: true } })
      if (!acuerdo || acuerdo.proveedorId !== d.proveedorId) throw new Error('El acuerdo no es de este proveedor.')
    }
    if (d.ordenId) {
      const orden = await tx.supplyOrden.findUnique({ where: { id: d.ordenId }, select: { proveedorId: true } })
      if (!orden || orden.proveedorId !== d.proveedorId) throw new Error('La orden no es de este proveedor.')
    }

    const secuencia = (await tx.supplyFacturaProveedor.count()) + 1
    const factura = await tx.supplyFacturaProveedor.create({
      data: {
        codigo: codigoFactura(secuencia),
        numero: d.numero.trim(),
        proveedorId: d.proveedorId,
        acuerdoId: d.acuerdoId ?? null,
        ordenId: d.ordenId ?? null,
        tipo,
        estado: 'REGISTRADA',
        fechaEmision: d.fechaEmision,
        fechaVencimiento: d.fechaVencimiento ?? null,
        subtotal: new Prisma.Decimal(redondear2(d.subtotal)),
        impuestos: new Prisma.Decimal(impuestos),
        total: new Prisma.Decimal(total),
        moneda: d.moneda ?? 'DOP',
        documentoPath: d.documentoPath ?? null,
        notas: d.notas ?? null,
        registradoPorId: d.registradoPorId ?? null,
        claveIdempotencia: d.claveIdempotencia ?? null,
      },
      select: { id: true, codigo: true },
    })

    const descripcion = `${tipo === 'FACTURA' ? 'Factura' : tipo === 'NOTA_DEBITO' ? 'Nota de débito' : 'Nota de crédito'} ${d.numero.trim()} del proveedor`
    if (tipo === 'NOTA_CREDITO') {
      await crearCuentaPorCobrarEnTx(tx, {
        proveedorId: d.proveedorId,
        acuerdoId: d.acuerdoId ?? null,
        origen: 'NOTA_CREDITO',
        descripcion,
        monto: total,
        moneda: d.moneda ?? 'DOP',
        vencimientoAt: d.fechaVencimiento ?? null,
        facturaId: factura.id,
        creadoPorId: d.registradoPorId ?? null,
      })
    } else {
      await crearCuentaPorPagarEnTx(tx, {
        proveedorId: d.proveedorId,
        acuerdoId: d.acuerdoId ?? null,
        origen: 'FACTURA_PROVEEDOR',
        descripcion,
        montoBruto: redondear2(d.subtotal),
        impuestos,
        moneda: d.moneda ?? 'DOP',
        vencimientoAt: d.fechaVencimiento ?? null,
        facturaId: factura.id,
        creadoPorId: d.registradoPorId ?? null,
      })
    }
    return { id: factura.id, codigo: factura.codigo, total, reutilizada: false }
  })
}

/**
 * Disputar o anular una factura es disputar o cancelar su cuenta: la factura
 * es el documento; la obligación vive en la cuenta.
 */
export async function moverFactura(
  facturaId: string,
  hasta: Extract<SupplyFacturaEstado, 'DISPUTADA' | 'ANULADA' | 'REGISTRADA'>,
  motivo: string,
  actorId?: string | null
): Promise<void> {
  const f = await sinEmpresa('Membego Supply: cuenta de una factura', (tx) =>
    tx.supplyFacturaProveedor.findUnique({
      where: { id: facturaId },
      select: { estado: true, cuentaPorPagar: { select: { id: true } }, cuentaPorCobrar: { select: { id: true } } },
    })
  )
  if (!f) throw new Error('Factura no encontrada.')
  const lado = f.cuentaPorPagar ? ('CXP' as const) : ('CXC' as const)
  const cuentaId = f.cuentaPorPagar?.id ?? f.cuentaPorCobrar?.id
  if (!cuentaId) throw new Error('La factura no tiene cuenta asociada.')
  const estadoCuenta = hasta === 'ANULADA' ? 'CANCELADA' : hasta === 'DISPUTADA' ? 'DISPUTADA' : 'ABIERTA'
  await moverCuenta(lado, cuentaId, estadoCuenta, motivo, actorId)
  if (lado === 'CXC') {
    // `moverCuenta` solo espeja el estado en la factura para CxP.
    await sinEmpresa('Membego Supply: espejo del estado en la nota de crédito', (tx) =>
      tx.supplyFacturaProveedor.update({ where: { id: facturaId }, data: { estado: hasta } })
    )
  }
}

export async function listarFacturas(f: { proveedorId?: string; estado?: SupplyFacturaEstado; limite?: number } = {}) {
  return sinEmpresa('Membego Supply: facturas de proveedor', (tx) =>
    tx.supplyFacturaProveedor.findMany({
      where: { ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}), ...(f.estado ? { estado: f.estado } : {}) },
      orderBy: [{ estado: 'asc' }, { fechaVencimiento: 'asc' }, { createdAt: 'desc' }],
      take: f.limite ?? 300,
      select: {
        id: true, codigo: true, numero: true, tipo: true, estado: true, fechaEmision: true, fechaVencimiento: true,
        subtotal: true, impuestos: true, total: true, montoSaldado: true, moneda: true, documentoPath: true, createdAt: true,
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true } },
        orden: { select: { id: true, numero: true } },
        cuentaPorPagar: { select: { id: true, codigo: true, estado: true, liquidacionId: true } },
        cuentaPorCobrar: { select: { id: true, codigo: true, estado: true } },
        registradoPor: { select: { name: true } },
      },
    })
  )
}
