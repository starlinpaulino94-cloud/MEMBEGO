'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import type { SupplyV2ResolutionType, SupplyV2SettlementFrequency, SupplyV2SupplierPaymentMethod } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { exigirPermisoSupplyV2 } from './permisos'
import { comoError, contextoDeAuditoria, entero, fecha, numero, refrescarSupplyV2, texto, type EstadoAccion } from './actions-util'
import { RUTA_FINANZAS } from './core/catalogo'
import { aprobarFacturaEnTx, cancelarFacturaEnTx, crearFacturaEnTx, type FacturaCreada } from './finance/invoices'
import { cancelarPagoProveedorEnTx, confirmarPagoProveedorEnTx, crearPagoEnTx, METODOS_PAGO_PROVEEDOR, type PagoConfirmadoProveedor, type PagoCreado } from './finance/payments'
import { crearDepositoDesdePagoEnTx, type DepositoCreado } from './finance/deposits'
import { aplicarEnTx, reversarAplicacionEnTx, type AplicacionHecha, type ReversaAplicacion } from './finance/applications'
import { crearConciliacionComisionEnTx, crearConciliacionEnTx, registrarCifrasDelProveedorEnTx, registrarMontoDelProveedorEnTx, resolverConciliacionEnTx, type ConciliacionComisionCreada, type ConciliacionCreada } from './finance/reconciliation'
import { aprobarLiquidacionEnTx, cancelarLiquidacionEnTx, generarLiquidacionEnTx, type LiquidacionCreada } from './finance/settlements'
import { resolverIncidenciaFinancieraEnTx } from './finance/incidents'
import { RUTA_PORTAL_PROVEEDOR } from './core/catalogo'
import type { LineaFacturaEntrada } from './finance/domain'
import { guardarAdjuntoEnTx } from './finance/attachments'

/**
 * MEMBEGO SUPPLY · SLICE 4 · server actions de finanzas.
 *
 * GUARDIA (permiso separado por operación, §40) → REGLA (en `finance/`) →
 * BITÁCORA (misma transacción). La segregación de funciones la impone el
 * servicio, no la pantalla (§41). Toda escritura lleva clave de idempotencia
 * cuando el formulario la manda (§53).
 */

function refrescarFinanzas(...sufijos: string[]): void {
  refrescarSupplyV2('finanzas', 'economia', 'proveedores', 'compras')
  for (const s of sufijos) revalidatePath(`${RUTA_FINANZAS}/${s}`)
}

// ── Facturas ─────────────────────────────────────────────────────────────────

export async function crearFacturaAction(_prev: EstadoAccion<FacturaCreada>, fd: FormData): Promise<EstadoAccion<FacturaCreada>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_INVOICE_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const documentDate = fecha(fd, 'documentDate')
    if (!documentDate) return { error: 'Hace falta la fecha de la factura.' }
    const lineIds = fd.getAll('lineId').map(String)
    const lines: LineaFacturaEntrada[] = []
    if (lineIds.length > 0) {
      const qtys = fd.getAll('lineQuantity').map(String)
      const costs = fd.getAll('lineUnitCost').map(String)
      const descs = fd.getAll('lineDescription').map(String)
      lineIds.forEach((id, i) => {
        const q = Math.trunc(Number(qtys[i] ?? '0'))
        if (q > 0) lines.push({ purchaseOrderLineId: id || null, quantity: q, unitCost: costs[i] ?? '0', description: descs[i] ?? null })
      })
    } else {
      const q = entero(fd, 'quantity')
      if (q && q > 0) lines.push({ quantity: q, unitCost: texto(fd, 'unitCost', 20), description: texto(fd, 'description', 200) })
    }
    if (lines.length === 0) return { error: 'Indica al menos una línea con cantidad mayor que cero.' }
    const creada = await sinEmpresa('Supply: registrar factura de proveedor', (tx) =>
      crearFacturaEnTx(
        tx,
        {
          supplierId: texto(fd, 'supplierId', 60),
          purchaseOrderId: texto(fd, 'purchaseOrderId', 60) || null,
          supplierInvoiceNumber: texto(fd, 'supplierInvoiceNumber', 80) || null,
          documentDate,
          dueDate: fecha(fd, 'dueDate'),
          taxRate: texto(fd, 'taxRate', 10) || null,
          lines,
          attachmentPath: texto(fd, 'attachmentPath', 300) || null,
          notes: texto(fd, 'notes', 2000) || null,
          idempotencyKey: texto(fd, 'idempotencyKey', 80) || null,
        },
        ctx
      )
    )
    refrescarFinanzas('facturas', `facturas/${creada.id}`)
    return { success: creada.repetida ? `La factura ${creada.number} ya estaba registrada.` : `Factura ${creada.number} registrada. Otra persona debe aprobarla.`, id: creada.id, data: creada }
  } catch (e) {
    return comoError(e, 'crearFactura')
  }
}

export async function aprobarFacturaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_INVOICE_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'invoiceId', 60)
    const r = await sinEmpresa('Supply: aprobar factura de proveedor', (tx) => aprobarFacturaEnTx(tx, id, ctx))
    refrescarFinanzas('facturas', `facturas/${id}`, 'obligaciones')
    return { success: r.repetida ? `La factura ${r.number} ya estaba aprobada.` : `Factura ${r.number} aprobada: la deuda con el proveedor quedó reconocida.`, id }
  } catch (e) {
    return comoError(e, 'aprobarFactura')
  }
}

export async function cancelarFacturaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_INVOICE_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'invoiceId', 60)
    await sinEmpresa('Supply: cancelar factura de proveedor', (tx) => cancelarFacturaEnTx(tx, id, texto(fd, 'motivo', 500), ctx))
    refrescarFinanzas('facturas', `facturas/${id}`, 'obligaciones')
    return { success: 'Factura cancelada.', id }
  } catch (e) {
    return comoError(e, 'cancelarFactura')
  }
}

// ── Pagos ────────────────────────────────────────────────────────────────────

export async function crearPagoProveedorAction(_prev: EstadoAccion<PagoCreado>, fd: FormData): Promise<EstadoAccion<PagoCreado>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const method = texto(fd, 'method', 20) as SupplyV2SupplierPaymentMethod
    if (!METODOS_PAGO_PROVEEDOR.includes(method)) return { error: 'Elige la forma de pago.' }
    const monto = numero(fd, 'amount')
    if (monto == null || monto <= 0) return { error: 'Indica el monto del pago.' }
    const destino = texto(fd, 'destino', 20)
    const creado = await sinEmpresa('Supply: registrar pago a proveedor', (tx) =>
      crearPagoEnTx(
        tx,
        {
          supplierId: texto(fd, 'supplierId', 60),
          method,
          amount: texto(fd, 'amount', 20),
          paidAt: fecha(fd, 'paidAt'),
          reference: texto(fd, 'reference', 120) || null,
          proofPath: texto(fd, 'proofPath', 300) || null,
          notes: texto(fd, 'notes', 1000) || null,
          invoiceId: destino === 'FACTURA' ? texto(fd, 'invoiceId', 60) || null : null,
          obligationId: destino === 'OBLIGACION' ? texto(fd, 'obligationId', 60) || null : null,
          // Slice 5: una liquidación aprobada; al confirmar se reparte entre sus obligaciones.
          settlementId: destino === 'LIQUIDACION' ? texto(fd, 'settlementId', 60) || null : null,
          asDeposit: destino === 'DEPOSITO',
          idempotencyKey: texto(fd, 'idempotencyKey', 80) || randomUUID(),
        },
        ctx
      )
    )
    refrescarFinanzas('pagos', `pagos/${creado.id}`, 'facturas', 'liquidaciones', `liquidaciones/${texto(fd, 'settlementId', 60)}`)
    return { success: creado.repetido ? `El pago ${creado.number} ya estaba registrado.` : `Pago ${creado.number} registrado. Otra persona autorizada debe confirmarlo.`, id: creado.id, data: creado }
  } catch (e) {
    return comoError(e, 'crearPagoProveedor')
  }
}

export async function confirmarPagoProveedorAction(_prev: EstadoAccion<PagoConfirmadoProveedor>, fd: FormData): Promise<EstadoAccion<PagoConfirmadoProveedor>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'paymentId', 60)
    const r = await sinEmpresa('Supply: confirmar pago a proveedor', (tx) => confirmarPagoProveedorEnTx(tx, id, ctx))
    refrescarFinanzas('pagos', `pagos/${id}`, 'facturas', 'depositos', 'obligaciones', 'liquidaciones')
    revalidatePath(RUTA_PORTAL_PROVEEDOR, 'layout')
    const detalle = r.depositId ? ' y quedó como depósito' : Number(r.aplicado) > 0 ? `: ${r.aplicado} aplicado${Number(r.sinAplicar) > 0 ? `, ${r.sinAplicar} sin aplicar` : ''}` : ''
    return { success: r.repetido ? `El pago ${r.number} ya estaba confirmado.` : `Pago ${r.number} confirmado${detalle}.`, id, data: r }
  } catch (e) {
    return comoError(e, 'confirmarPagoProveedor')
  }
}

export async function cancelarPagoProveedorAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'paymentId', 60)
    await sinEmpresa('Supply: cancelar pago a proveedor', (tx) => cancelarPagoProveedorEnTx(tx, id, texto(fd, 'motivo', 500), ctx))
    refrescarFinanzas('pagos', `pagos/${id}`)
    return { success: 'Pago cancelado.', id }
  } catch (e) {
    return comoError(e, 'cancelarPagoProveedor')
  }
}

// ── Aplicaciones y depósitos ─────────────────────────────────────────────────

export async function aplicarDepositoAction(_prev: EstadoAccion<AplicacionHecha>, fd: FormData): Promise<EstadoAccion<AplicacionHecha>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_DEPOSIT_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: aplicar depósito', (tx) =>
      aplicarEnTx(tx, { depositId: texto(fd, 'depositId', 60), invoiceId: texto(fd, 'invoiceId', 60) || null, obligationId: texto(fd, 'obligationId', 60) || null, amount: texto(fd, 'amount', 20), idempotencyKey: texto(fd, 'idempotencyKey', 80) || null }, ctx)
    )
    refrescarFinanzas('facturas', `facturas/${texto(fd, 'invoiceId', 60)}`, 'depositos', 'obligaciones')
    return { success: `Depósito aplicado: ${r.amount}${r.invoiceStatus === 'PAID' ? '. La factura quedó pagada.' : '.'}`, data: r }
  } catch (e) {
    return comoError(e, 'aplicarDeposito')
  }
}

export async function aplicarPagoAction(_prev: EstadoAccion<AplicacionHecha>, fd: FormData): Promise<EstadoAccion<AplicacionHecha>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: aplicar pago confirmado', (tx) =>
      aplicarEnTx(tx, { paymentId: texto(fd, 'paymentId', 60), invoiceId: texto(fd, 'invoiceId', 60) || null, obligationId: texto(fd, 'obligationId', 60) || null, amount: texto(fd, 'amount', 20), idempotencyKey: texto(fd, 'idempotencyKey', 80) || null }, ctx)
    )
    refrescarFinanzas('facturas', `facturas/${texto(fd, 'invoiceId', 60)}`, 'pagos', 'obligaciones')
    return { success: `Pago aplicado: ${r.amount}${r.invoiceStatus === 'PAID' ? '. La factura quedó pagada.' : '.'}`, data: r }
  } catch (e) {
    return comoError(e, 'aplicarPago')
  }
}

export async function reversarAplicacionAction(_prev: EstadoAccion<ReversaAplicacion>, fd: FormData): Promise<EstadoAccion<ReversaAplicacion>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_PAYMENT_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: reversar aplicación', (tx) => reversarAplicacionEnTx(tx, texto(fd, 'applicationId', 60), texto(fd, 'motivo', 500), ctx))
    refrescarFinanzas('facturas', 'pagos', 'depositos', 'obligaciones')
    return { success: `Aplicación de ${r.amount} reversada.`, data: r }
  } catch (e) {
    return comoError(e, 'reversarAplicacion')
  }
}

export async function convertirEnDepositoAction(_prev: EstadoAccion<DepositoCreado>, fd: FormData): Promise<EstadoAccion<DepositoCreado>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_DEPOSIT_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const paymentId = texto(fd, 'paymentId', 60)
    const r = await sinEmpresa('Supply: convertir excedente de pago en depósito', (tx) => crearDepositoDesdePagoEnTx(tx, { paymentId, amount: texto(fd, 'amount', 20) || null, notes: texto(fd, 'notes', 500) || null, idempotencyKey: texto(fd, 'idempotencyKey', 80) || null }, ctx))
    refrescarFinanzas('pagos', `pagos/${paymentId}`, 'depositos')
    return { success: r.repetido ? `Ese pago ya financia el depósito ${r.number}.` : `Depósito ${r.number} creado por ${r.originalAmount}.`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'convertirEnDeposito')
  }
}

// ── Conciliación ─────────────────────────────────────────────────────────────

export async function crearConciliacionAction(_prev: EstadoAccion<ConciliacionCreada>, fd: FormData): Promise<EstadoAccion<ConciliacionCreada>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_RECONCILE')
    const ctx = await contextoDeAuditoria(actor)
    const periodStart = fecha(fd, 'periodStart')
    const periodEnd = fecha(fd, 'periodEnd')
    if (!periodStart || !periodEnd) return { error: 'Indica el periodo a conciliar.' }
    periodEnd.setUTCHours(23, 59, 59, 999)
    const r = await sinEmpresa('Supply: abrir conciliación', (tx) => crearConciliacionEnTx(tx, { supplierId: texto(fd, 'supplierId', 60), periodStart, periodEnd, supplierAmount: texto(fd, 'supplierAmount', 20) || null, notes: texto(fd, 'notes', 2000) || null }, ctx))
    refrescarFinanzas('conciliaciones', `conciliaciones/${r.id}`)
    return { success: r.repetida ? `Ese periodo ya tiene la conciliación ${r.number}.` : `Conciliación ${r.number} abierta con ${r.lineas} líneas.`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'crearConciliacion')
  }
}

export async function registrarMontoProveedorAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_RECONCILE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'reconciliationId', 60)
    const monto = texto(fd, 'supplierAmount', 20)
    if (!monto) return { error: 'Indica el monto del estado de cuenta del proveedor.' }
    const r = await sinEmpresa('Supply: registrar el estado de cuenta del proveedor', (tx) => registrarMontoDelProveedorEnTx(tx, id, monto, ctx))
    refrescarFinanzas('conciliaciones', `conciliaciones/${id}`)
    return { success: r.status === 'MATCHED' ? 'Cuadra con el proveedor.' : `Diferencia de ${r.differenceAmount}.`, id }
  } catch (e) {
    return comoError(e, 'registrarMontoProveedor')
  }
}

// ── Slice 5 · liquidaciones (§35–§47) ────────────────────────────────────────

function refrescarLiquidaciones(id?: string): void {
  refrescarFinanzas('liquidaciones', 'obligaciones', 'pagos', ...(id ? [`liquidaciones/${id}`] : []))
  revalidatePath(RUTA_PORTAL_PROVEEDOR, 'layout')
}

export async function generarLiquidacionAction(_prev: EstadoAccion<LiquidacionCreada>, fd: FormData): Promise<EstadoAccion<LiquidacionCreada>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SETTLEMENT_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const frequency = (texto(fd, 'frequency', 20) || 'MANUAL') as SupplyV2SettlementFrequency
    const r = await sinEmpresa('Supply: generar liquidación', (tx) =>
      generarLiquidacionEnTx(
        tx,
        {
          supplierId: texto(fd, 'supplierId', 60),
          frequency,
          periodStart: fecha(fd, 'periodStart'),
          periodEnd: fecha(fd, 'periodEnd'),
          referencia: fecha(fd, 'referencia'),
          notes: texto(fd, 'notes', 2000) || null,
          idempotencyKey: texto(fd, 'idempotencyKey', 80) || randomUUID(),
        },
        ctx
      )
    )
    refrescarLiquidaciones(r.id)
    return { success: r.repetida ? `La liquidación ${r.number} ya existía.` : `Liquidación ${r.number} generada: ${r.lineas} entrega(s), neto ${r.supplierNet}. Otra persona debe aprobarla.`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'generarLiquidacion')
  }
}

export async function aprobarLiquidacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'settlementId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SETTLEMENT_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: aprobar liquidación', (tx) => aprobarLiquidacionEnTx(tx, id, ctx))
    refrescarLiquidaciones(id)
    return { success: r.repetida ? `La liquidación ${r.number} ya estaba aprobada.` : `Liquidación ${r.number} aprobada: ya se puede pagar.`, id }
  } catch (e) {
    return comoError(e, 'aprobarLiquidacion')
  }
}

export async function cancelarLiquidacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'settlementId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SETTLEMENT_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: cancelar liquidación', (tx) => cancelarLiquidacionEnTx(tx, id, texto(fd, 'motivo', 500), ctx))
    refrescarLiquidaciones(id)
    return { success: 'Liquidación cancelada: sus entregas vuelven a quedar pendientes de liquidar.', id }
  } catch (e) {
    return comoError(e, 'cancelarLiquidacion')
  }
}

export async function resolverIncidenciaFinancieraAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'incidentId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SETTLEMENT_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: resolver incidencia financiera', (tx) => resolverIncidenciaFinancieraEnTx(tx, id, texto(fd, 'notas', 2000), ctx))
    refrescarFinanzas('incidencias')
    return { success: 'Incidencia resuelta.', id }
  } catch (e) {
    return comoError(e, 'resolverIncidenciaFinanciera')
  }
}

// ── Slice 5 · conciliación de comisión (§48–§52) ─────────────────────────────

export async function crearConciliacionComisionAction(_prev: EstadoAccion<ConciliacionComisionCreada>, fd: FormData): Promise<EstadoAccion<ConciliacionComisionCreada>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_COMMISSION_RECONCILE')
    const ctx = await contextoDeAuditoria(actor)
    const periodStart = fecha(fd, 'periodStart')
    const periodEnd = fecha(fd, 'periodEnd')
    if (!periodStart || !periodEnd) return { error: 'Indica el periodo a conciliar.' }
    periodEnd.setUTCHours(23, 59, 59, 999)
    const r = await sinEmpresa('Supply: abrir conciliación de comisión', (tx) =>
      crearConciliacionComisionEnTx(tx, { supplierId: texto(fd, 'supplierId', 60), periodStart, periodEnd, grossClaimed: texto(fd, 'grossClaimed', 20) || null, commissionClaimed: texto(fd, 'commissionClaimed', 20) || null, netClaimed: texto(fd, 'netClaimed', 20) || null, notes: texto(fd, 'notes', 2000) || null }, ctx)
    )
    refrescarFinanzas('conciliaciones', `conciliaciones/${r.id}`)
    return { success: r.repetida ? `La conciliación ${r.number} ya existía para ese periodo.` : `Conciliación de comisión ${r.number} abierta (${r.status}).`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'crearConciliacionComision')
  }
}

export async function registrarCifrasProveedorAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'reconciliationId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_COMMISSION_RECONCILE')
    const ctx = await contextoDeAuditoria(actor)
    const net = texto(fd, 'netClaimed', 20)
    if (!net) return { error: 'Indica el neto que reclama el proveedor.' }
    const r = await sinEmpresa('Supply: registrar las cifras del proveedor', (tx) => registrarCifrasDelProveedorEnTx(tx, id, { grossClaimed: texto(fd, 'grossClaimed', 20) || null, commissionClaimed: texto(fd, 'commissionClaimed', 20) || null, netClaimed: net }, ctx))
    refrescarFinanzas('conciliaciones', `conciliaciones/${id}`)
    return { success: r.status === 'MATCHED' ? 'Las cifras cuadran.' : `Hay una diferencia de ${r.differenceAmount}.`, id }
  } catch (e) {
    return comoError(e, 'registrarCifrasProveedor')
  }
}

export async function resolverConciliacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_RECONCILE')
    const ctx = await contextoDeAuditoria(actor)
    const id = texto(fd, 'reconciliationId', 60)
    const resolutionType = (texto(fd, 'resolutionType', 20) || null) as SupplyV2ResolutionType | null
    await sinEmpresa('Supply: resolver conciliación', (tx) => resolverConciliacionEnTx(tx, id, texto(fd, 'notas', 2000), ctx, resolutionType))
    refrescarFinanzas('conciliaciones', `conciliaciones/${id}`)
    return { success: 'Conciliación resuelta.', id }
  } catch (e) {
    return comoError(e, 'resolverConciliacion')
  }
}

// ── Adjuntos (§42) ───────────────────────────────────────────────────────────

export async function adjuntarArchivoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const entidad = texto(fd, 'entidad', 10)
    const actor = await exigirPermisoSupplyV2(entidad === 'factura' ? 'SUPPLY_V2_INVOICE_MANAGE' : 'SUPPLY_V2_PAYMENT_CREATE')
    void actor
    const id = texto(fd, 'id', 60)
    const path = texto(fd, 'path', 300)
    if (entidad !== 'factura' && entidad !== 'pago') return { error: 'Entidad no válida.' }
    if (!path) return { error: 'Primero sube el archivo.' }
    await sinEmpresa('Supply: guardar adjunto', (tx) => guardarAdjuntoEnTx(tx, entidad, id, path))
    refrescarFinanzas(entidad === 'factura' ? `facturas/${id}` : `pagos/${id}`)
    return { success: 'Archivo guardado.', id }
  } catch (e) {
    return comoError(e, 'adjuntarArchivo')
  }
}
