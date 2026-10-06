import type { SupplyV2IncidentType, SupplyV2RedemptionChannel } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { vencimientoDeQr } from '../core/config'
import { fallo } from '../core/errores'
import { exigirTransicion, TRANSICIONES_DERECHO, TRANSICIONES_VOUCHER } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { registrarAsientoEnTx } from '../pool/lotes'
import { cancelarObligacionDeRedencionEnTx, reconocerObligacionPorRedencionEnTx } from '../finance/obligations'
import { registrarBreakageEnTx } from '../economics/service'
import {
  MENSAJES_RECHAZO,
  motivoNoCanjeable,
  motivoSinVoucher,
  nonceConFormatoValido,
  nuevoCodigoVoucher,
  nuevoNonce,
  previewRechazado,
  type CanjeParaValidar,
  type CodigoRechazo,
  type RedeemPreview,
} from './domain'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 3 · VOUCHER → QR → PREVIEW → ENTREGA → REVERSA.
 *
 * TODO dentro de la `tx` de quien llama. Orden de candados fijo para que dos
 * confirmaciones del mismo derecho (o dos escáneres con el mismo QR) se
 * serialicen y nunca se bloqueen mutuamente:
 *
 *   derecho → voucher → sesión QR → lote (lo bloquea `registrarAsientoEnTx`)
 *
 * La validación se hace DOS veces (§23): en el preview, sin cambiar nada, y
 * otra vez dentro de la transacción de confirmación con las filas bloqueadas.
 *
 * Movimientos:
 *   confirmar  ISSUED   → REDEEMED  (REDEMPTION, referencia la redención)
 *   reversar   REDEEMED → ISSUED    (REVERSAL,   referencia la redención)
 */

/** Quien escanea, ya resuelto desde la SESIÓN (§47): nunca desde el formulario. */
export interface EmpleadoProveedor {
  userId: string
  companyId: string
  supplierId: string
}

const DISPOSITIVO_MAX = 200
const dispositivo = (s: string | null | undefined) => (s ? s.slice(0, DISPOSITIVO_MAX) : null)

// ── Voucher (§5–§6) ──────────────────────────────────────────────────────────

async function derechoBloqueado(tx: Tx, entitlementId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_entitlements" WHERE "id" = ${entitlementId} FOR UPDATE`
  const d = await tx.supplyV2Entitlement.findUnique({
    where: { id: entitlementId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      customerId: true,
      supplierId: true,
      catalogItemId: true,
      lotId: true,
      actualUnitCost: true,
      customerUnitPrice: true,
      currency: true,
      supplier: { select: { id: true, status: true, companyId: true, commercialName: true } },
      catalogItem: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      lot: { select: { quantityIssued: true, status: true } },
    },
  })
  if (!d) fallo('DERECHO_NO_ENCONTRADO', 'El beneficio no existe.')
  return d
}

/**
 * Devuelve el voucher ACTIVE del derecho, creándolo si no existe. Un derecho
 * REDEEMED, CANCELLED o EXPIRED no genera voucher utilizable (§6). Si hubo
 * vouchers anteriores (revocados, vencidos), el nuevo queda auditado como
 * reemisión y los viejos se conservan.
 */
export async function emitirVoucherEnTx(tx: Tx, entitlementId: string, customerId: string, ctx: ContextoAuditoria): Promise<{ id: string; code: string; reemitido: boolean }> {
  const d = await derechoBloqueado(tx, entitlementId)
  const veto = motivoSinVoucher(d, customerId)
  if (veto) fallo(veto, MENSAJES_RECHAZO[veto])
  const activo = await tx.supplyV2Voucher.findFirst({ where: { entitlementId, status: 'ACTIVE' }, select: { id: true, code: true, validUntil: true } })
  if (activo) {
    if (activo.validUntil && activo.validUntil.getTime() <= Date.now()) {
      await tx.supplyV2Voucher.update({ where: { id: activo.id }, data: { status: 'EXPIRED' } })
    } else {
      return { id: activo.id, code: activo.code, reemitido: false }
    }
  }
  const previos = await tx.supplyV2Voucher.count({ where: { entitlementId } })
  const v = await tx.supplyV2Voucher.create({
    data: {
      entitlementId,
      customerId: d.customerId,
      supplierId: d.supplierId,
      catalogItemId: d.catalogItemId,
      code: nuevoCodigoVoucher(),
      status: 'ACTIVE',
      validUntil: d.expiresAt,
    },
    select: { id: true, code: true },
  })
  await auditarEnTx(tx, ctx, previos > 0 ? 'SUPPLY_V2_VOUCHER_REISSUED' : 'SUPPLY_V2_VOUCHER_CREATED', 'SupplyV2Voucher', v.id, {
    entitlementId,
    previos,
  }, d.supplier.companyId)
  return { id: v.id, code: v.code, reemitido: previos > 0 }
}

// ── Sesión QR (§7–§13) ───────────────────────────────────────────────────────

export interface SesionQrAbierta {
  id: string
  nonce: string
  expiresAt: Date
  voucherId: string
}

/**
 * «Usar beneficio»: valida ownership y estados, obtiene/crea el voucher,
 * deja históricas las sesiones vivas anteriores del voucher (no se borran) y
 * abre una nueva con un nonce fresco. Solo el nonce viaja en el QR.
 */
export async function abrirSesionQrEnTx(
  tx: Tx,
  d: { entitlementId: string; customerId: string; branchId?: string | null; deviceInfo?: string | null },
  ctx: ContextoAuditoria
): Promise<SesionQrAbierta> {
  const derecho = await derechoBloqueado(tx, d.entitlementId)
  const veto = motivoSinVoucher(derecho, d.customerId)
  if (veto) fallo(veto, MENSAJES_RECHAZO[veto])
  if (derecho.supplier.status !== 'ACTIVE') fallo('SUPPLIER_INACTIVE', MENSAJES_RECHAZO.SUPPLIER_INACTIVE)
  const voucher = await emitirVoucherEnTx(tx, d.entitlementId, d.customerId, ctx)

  let branchId: string | null = null
  if (d.branchId) {
    const s = await tx.sucursal.findFirst({ where: { id: d.branchId, companyId: derecho.supplier.companyId ?? '', activa: true }, select: { id: true } })
    if (!s) fallo('WRONG_BRANCH', 'Esa sucursal no es de este comercio.')
    branchId = s.id
  }

  const ahora = new Date()
  // Las sesiones vivas anteriores quedan históricas: consumidas por el sistema, no por un empleado.
  await tx.supplyV2QrSession.updateMany({
    where: { voucherId: voucher.id, consumedAt: null, expiresAt: { gt: ahora } },
    data: { consumedAt: ahora, consumedDeviceInfo: 'reemplazada por una sesión nueva' },
  })
  const sesion = await tx.supplyV2QrSession.create({
    data: {
      voucherId: voucher.id,
      nonce: nuevoNonce(),
      expiresAt: vencimientoDeQr(ahora),
      branchId,
      openedByCustomerId: d.customerId,
      deviceInfo: dispositivo(d.deviceInfo),
    },
    select: { id: true, nonce: true, expiresAt: true, voucherId: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_QR_SESSION_CREATED', 'SupplyV2QrSession', sesion.id, {
    entitlementId: d.entitlementId,
    voucherId: voucher.id,
    expiresAt: sesion.expiresAt.toISOString(),
    branchId,
  }, derecho.supplier.companyId)
  return sesion
}

// ── Resolver un nonce (§16, §19, §49) ────────────────────────────────────────

const SELECT_SESION = {
  id: true,
  nonce: true,
  expiresAt: true,
  consumedAt: true,
  branchId: true,
  branch: { select: { nombre: true } },
  voucher: {
    select: {
      id: true,
      status: true,
      validUntil: true,
      entitlement: {
        select: {
          id: true,
          status: true,
          expiresAt: true,
          customerId: true,
          supplierId: true,
          catalogItemId: true,
          lotId: true,
          currency: true,
          supplier: { select: { id: true, status: true, companyId: true, commercialName: true } },
          catalogItem: { select: { name: true } },
          customer: { select: { name: true, email: true } },
          lot: { select: { quantityIssued: true } },
        },
      },
    },
  },
} as const

type SesionCargada = NonNullable<Awaited<ReturnType<typeof cargarSesion>>>

async function cargarSesion(tx: Tx, nonce: string) {
  return tx.supplyV2QrSession.findUnique({ where: { nonce }, select: SELECT_SESION })
}

async function sucursalDelEmpleado(tx: Tx, empleado: EmpleadoProveedor, branchId: string | null | undefined) {
  if (!branchId) return null
  return tx.sucursal.findUnique({ where: { id: branchId }, select: { id: true, companyId: true, activa: true, nombre: true } })
}

async function armarValidacion(tx: Tx, s: SesionCargada, empleado: EmpleadoProveedor, branchId: string | null | undefined): Promise<{ c: CanjeParaValidar; sucursal: { id: string; nombre: string } | null }> {
  const e = s.voucher.entitlement
  const sucursal = await sucursalDelEmpleado(tx, empleado, branchId)
  const tieneSucursales = (await tx.sucursal.count({ where: { companyId: empleado.companyId, activa: true } })) > 0
  const c: CanjeParaValidar = {
    sesion: { expiresAt: s.expiresAt, consumedAt: s.consumedAt, branchId: s.branchId },
    voucher: { status: s.voucher.status, validUntil: s.voucher.validUntil },
    derecho: { status: e.status, expiresAt: e.expiresAt, supplierId: e.supplierId, customerId: e.customerId },
    proveedor: { status: e.supplier.status, companyId: e.supplier.companyId },
    empleado: { supplierId: empleado.supplierId, companyId: empleado.companyId },
    sucursal: sucursal ? { id: sucursal.id, companyId: sucursal.companyId, activa: sucursal.activa } : null,
    proveedorTieneSucursales: tieneSucursales,
    // Slice 5: un derecho a comisión no tiene lote; el ledger no opina.
    lotIssued: e.lot ? e.lot.quantityIssued : null,
  }
  return { c, sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null }
}

function nombreCliente(c: { name: string | null; email: string }): string {
  return c.name?.trim() || c.email.split('@')[0]!
}

/**
 * PREVIEW: el escáner manda un nonce y recibe qué entregar, o el motivo del
 * rechazo. No cambia el estado de nada; solo audita los rechazos (§55).
 */
export async function previsualizarCanjeEnTx(
  tx: Tx,
  d: { nonce: string; empleado: EmpleadoProveedor; branchId?: string | null },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<RedeemPreview> {
  const rechazar = async (reason: CodigoRechazo, sesionId: string | null) => {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_REDEMPTION_REJECTED', 'SupplyV2QrSession', sesionId ?? 'sin-sesion', {
      fase: 'preview',
      reason,
      nonceVisto: d.nonce.slice(0, 6),
      branchId: d.branchId ?? null,
    }, d.empleado.companyId)
    return previewRechazado(reason)
  }
  if (!nonceConFormatoValido(d.nonce)) return rechazar('INVALID_QR', null)
  const s = await cargarSesion(tx, d.nonce)
  if (!s) return rechazar('INVALID_QR', null)
  const { c, sucursal } = await armarValidacion(tx, s, d.empleado, d.branchId)
  const veto = motivoNoCanjeable(c, ahora)
  if (veto) return rechazar(veto, s.id)
  const e = s.voucher.entitlement
  return {
    valid: true,
    sessionId: s.id,
    entitlementId: e.id,
    customerName: nombreCliente(e.customer),
    productName: e.catalogItem.name,
    supplierName: e.supplier.commercialName,
    branchName: sucursal?.nombre ?? null,
    quantity: 1,
    customerPaysMerchant: '0.00',
    currency: e.currency,
    expiresAt: s.expiresAt,
  }
}

// ── Confirmar entrega (§21–§25, §30, §68–§70) ────────────────────────────────

export interface EntregaConfirmada {
  id: string
  number: string
  entitlementId: string
  customerName: string
  productName: string
  branchName: string | null
  redeemedAt: Date
  repetida: boolean
}

export async function confirmarEntregaEnTx(
  tx: Tx,
  d: {
    nonce: string
    empleado: EmpleadoProveedor
    branchId?: string | null
    idempotencyKey?: string | null
    deviceInfo?: string | null
    channel?: SupplyV2RedemptionChannel
  },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<EntregaConfirmada> {
  // 0. Idempotencia (§70): el mismo escáner reenviando la misma confirmación recibe la misma redención.
  if (d.idempotencyKey) {
    const previa = await tx.supplyV2Redemption.findUnique({
      where: { idempotencyKey: d.idempotencyKey },
      select: { id: true, number: true, entitlementId: true, redeemedAt: true, reversedAt: true, employeeId: true, customer: { select: { name: true, email: true } }, catalogItem: { select: { name: true } }, branch: { select: { nombre: true } } },
    })
    if (previa) {
      if (previa.employeeId !== d.empleado.userId) fallo('CLAVE_AJENA', 'Esa confirmación no es tuya.')
      if (!previa.reversedAt) {
        return { id: previa.id, number: previa.number, entitlementId: previa.entitlementId, customerName: nombreCliente(previa.customer), productName: previa.catalogItem.name, branchName: previa.branch?.nombre ?? null, redeemedAt: previa.redeemedAt, repetida: true }
      }
    }
  }
  if (!nonceConFormatoValido(d.nonce)) fallo('INVALID_QR', MENSAJES_RECHAZO.INVALID_QR)
  const referencia = await tx.supplyV2QrSession.findUnique({ where: { nonce: d.nonce }, select: { id: true, voucher: { select: { id: true, entitlementId: true } } } })
  if (!referencia) fallo('INVALID_QR', MENSAJES_RECHAZO.INVALID_QR)

  // 1. Candados en orden fijo: derecho → voucher → sesión.
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_entitlements" WHERE "id" = ${referencia.voucher.entitlementId} FOR UPDATE`
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_vouchers" WHERE "id" = ${referencia.voucher.id} FOR UPDATE`
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_qr_sessions" WHERE "id" = ${referencia.id} FOR UPDATE`

  // 2. Validar TODO de nuevo con las filas bloqueadas (§23).
  const s = await cargarSesion(tx, d.nonce)
  if (!s) fallo('INVALID_QR', MENSAJES_RECHAZO.INVALID_QR)
  const { c, sucursal } = await armarValidacion(tx, s, d.empleado, d.branchId)
  const veto = motivoNoCanjeable(c, ahora)
  if (veto) {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_REDEMPTION_REJECTED', 'SupplyV2QrSession', s.id, { fase: 'confirm', reason: veto, branchId: d.branchId ?? null }, d.empleado.companyId)
    fallo(veto, MENSAJES_RECHAZO[veto])
  }
  const e = s.voucher.entitlement
  const derecho = await tx.supplyV2Entitlement.findUniqueOrThrow({ where: { id: e.id }, select: { actualUnitCost: true, customerUnitPrice: true, currency: true, status: true, sourceType: true, commissionPercentage: true, commissionAmount: true, supplierNet: true, contractualUnitValue: true, supplierDiscountAmount: true, membegoSubsidyAmount: true } })
  exigirTransicion(TRANSICIONES_DERECHO, derecho.status, 'REDEEMED', 'Beneficio')
  exigirTransicion(TRANSICIONES_VOUCHER, s.voucher.status, 'REDEEMED', 'Voucher')

  // 3. Consumir la sesión (anti-replay, §25): solo si nadie la consumió entre medias.
  const consumida = await tx.supplyV2QrSession.updateMany({
    where: { id: s.id, consumedAt: null },
    data: { consumedAt: ahora, consumedByUserId: d.empleado.userId, consumedDeviceInfo: dispositivo(d.deviceInfo) },
  })
  if (consumida.count !== 1) fallo('QR_CONSUMED', MENSAJES_RECHAZO.QR_CONSUMED)

  // 4. Voucher y derecho → REDEEMED (condicionados al estado, por si acaso).
  const v = await tx.supplyV2Voucher.updateMany({ where: { id: s.voucher.id, status: 'ACTIVE' }, data: { status: 'REDEEMED' } })
  if (v.count !== 1) fallo('ALREADY_REDEEMED', MENSAJES_RECHAZO.ALREADY_REDEEMED)
  const der = await tx.supplyV2Entitlement.updateMany({ where: { id: e.id, status: 'ACTIVE' }, data: { status: 'REDEEMED' } })
  if (der.count !== 1) fallo('ALREADY_REDEEMED', MENSAJES_RECHAZO.ALREADY_REDEEMED)

  // 5. La redención: quién, dónde, cuándo, qué, con snapshots.
  const number = await siguienteNumero(tx, 'MBG-RD', async (pref) => {
    const u = await tx.supplyV2Redemption.findFirst({ where: { number: { startsWith: pref } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  })
  const r = await tx.supplyV2Redemption.create({
    data: {
      number,
      entitlementId: e.id,
      voucherId: s.voucher.id,
      qrSessionId: s.id,
      customerId: e.customerId,
      supplierId: e.supplierId,
      catalogItemId: e.catalogItemId,
      lotId: e.lotId,
      branchId: sucursal?.id ?? null,
      employeeId: d.empleado.userId,
      quantity: 1,
      unitCostSnapshot: derecho.actualUnitCost,
      customerUnitPriceSnapshot: derecho.customerUnitPrice,
      customerPaysMerchant: 0,
      // Slice 5: la foto de la comisión viaja con la entrega (de ella nace el neto del proveedor).
      sourceType: derecho.sourceType,
      commissionPercentageSnapshot: derecho.sourceType === 'COMMISSION' ? derecho.commissionPercentage : null,
      commissionAmountSnapshot: derecho.sourceType === 'COMMISSION' ? derecho.commissionAmount : null,
      supplierNetSnapshot: derecho.sourceType === 'COMMISSION' ? derecho.supplierNet : null,
      // Slice 6 (§23, §32): la financiación de la unidad entregada, congelada.
      contractualValueSnapshot: derecho.contractualUnitValue,
      supplierDiscountSnapshot: derecho.supplierDiscountAmount,
      membegoSubsidySnapshot: derecho.membegoSubsidyAmount,
      currency: derecho.currency,
      channel: d.channel ?? 'QR_SCAN',
      deviceInfo: dispositivo(d.deviceInfo),
      redeemedAt: ahora,
      idempotencyKey: d.idempotencyKey ?? null,
    },
    select: { id: true, number: true, redeemedAt: true },
  })

  // 6. Ledger: ISSUED → REDEEMED en el lote real del derecho (§30).
  //    Slice 5: en COMISIÓN no hay lote y NO se escribe ningún asiento (§27).
  if (e.lotId) {
    await registrarAsientoEnTx(
      tx,
      e.lotId,
      { type: 'REDEMPTION', sourceBucket: 'ISSUED', destinationBucket: 'REDEEMED', quantity: 1, reason: `Entrega ${r.number} al cliente.` },
      { referenceType: 'REDEMPTION', referenceId: r.id },
      ctx.actorId
    )
  }

  // 6b. Slice 4 (§2, §19): la deuda con el proveedor nace aquí SOLO si la versión
  //     del acuerdo del lote dice ON_REDEMPTION. PREPAID no crea CxP nueva.
  //     Slice 5 (§28–§30): en COMISIÓN la entrega ES el cumplimiento: nace la
  //     obligación por el neto del proveedor (idempotente por redención).
  await reconocerObligacionPorRedencionEnTx(tx, r.id, ctx)

  // 7. Bitácora.
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_QR_SESSION_CONSUMED', 'SupplyV2QrSession', s.id, { redemptionId: r.id, employeeId: d.empleado.userId }, d.empleado.companyId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REDEMPTION_CONFIRMED', 'SupplyV2Redemption', r.id, {
    number: r.number,
    entitlementId: e.id,
    voucherId: s.voucher.id,
    qrSessionId: s.id,
    customerId: e.customerId,
    supplierId: e.supplierId,
    branchId: sucursal?.id ?? null,
    employeeId: d.empleado.userId,
    lotId: e.lotId,
    channel: d.channel ?? 'QR_SCAN',
  }, d.empleado.companyId)

  return { id: r.id, number: r.number, entitlementId: e.id, customerName: nombreCliente(e.customer), productName: e.catalogItem.name, branchName: sucursal?.nombre ?? null, redeemedAt: r.redeemedAt, repetida: false }
}

// ── Reversa (§36–§40) ────────────────────────────────────────────────────────

export interface ReversaHecha {
  id: string
  number: string
  entitlementId: string
  voucherReactivado: boolean
}

export async function reversarRedencionEnTx(tx: Tx, redemptionId: string, motivo: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<ReversaHecha> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Reversar necesita quién lo hace.')
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Reversar una redención exige un motivo.')
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_redemptions" WHERE "id" = ${redemptionId} FOR UPDATE`
  const r = await tx.supplyV2Redemption.findUnique({
    where: { id: redemptionId },
    select: { id: true, number: true, entitlementId: true, voucherId: true, lotId: true, reversedAt: true, supplier: { select: { companyId: true } } },
  })
  if (!r) fallo('REDENCION_NO_ENCONTRADA', 'La redención no existe.')
  if (r.reversedAt) fallo('ALREADY_REVERSED', `La redención ${r.number} ya fue reversada.`)

  await tx.$queryRaw`SELECT "id" FROM "supply_v2_entitlements" WHERE "id" = ${r.entitlementId} FOR UPDATE`
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_vouchers" WHERE "id" = ${r.voucherId} FOR UPDATE`
  const derecho = await tx.supplyV2Entitlement.findUniqueOrThrow({ where: { id: r.entitlementId }, select: { status: true, expiresAt: true, lot: { select: { quantityRedeemed: true } } } })
  if (derecho.status !== 'REDEEMED') fallo('INCONSISTENTE', `El beneficio está ${derecho.status}, no REDEEMED: no se puede reversar.`)
  if (derecho.lot && derecho.lot.quantityRedeemed < 1) fallo('LEDGER_INCONSISTENT', MENSAJES_RECHAZO.LEDGER_INCONSISTENT)
  const otraViva = await tx.supplyV2Redemption.count({ where: { entitlementId: r.entitlementId, reversedAt: null, id: { not: r.id } } })
  if (otraViva > 0) fallo('INCONSISTENTE', 'Hay otra redención viva de este beneficio.')

  // 1. Marcar la reversa (nunca se borra).
  await tx.supplyV2Redemption.update({ where: { id: r.id }, data: { reversedAt: ahora, reversedById: ctx.actorId, reversalReason: motivo.trim() } })

  // 2. Derecho REDEEMED → ACTIVE; voucher REDEEMED → ACTIVE si sigue vigente, si no queda vencido y «Usar beneficio» emitirá uno nuevo (§38).
  exigirTransicion(TRANSICIONES_DERECHO, 'REDEEMED', 'ACTIVE', 'Beneficio')
  await tx.supplyV2Entitlement.update({ where: { id: r.entitlementId }, data: { status: 'ACTIVE' } })
  const voucher = await tx.supplyV2Voucher.findUniqueOrThrow({ where: { id: r.voucherId }, select: { status: true, validUntil: true } })
  let voucherReactivado = false
  if (voucher.status === 'REDEEMED') {
    const vigente = !voucher.validUntil || voucher.validUntil.getTime() > ahora.getTime()
    exigirTransicion(TRANSICIONES_VOUCHER, 'REDEEMED', 'ACTIVE', 'Voucher')
    await tx.supplyV2Voucher.update({ where: { id: r.voucherId }, data: { status: vigente ? 'ACTIVE' : 'EXPIRED' } })
    voucherReactivado = vigente
  }
  // La sesión QR consumida NO se «desconsume» (§38): el cliente genera una nueva.

  // 3. Ledger: REDEEMED → ISSUED. (Slice 5: sin lote, sin asiento.)
  if (r.lotId) {
    await registrarAsientoEnTx(
      tx,
      r.lotId,
      { type: 'REVERSAL', sourceBucket: 'REDEEMED', destinationBucket: 'ISSUED', quantity: 1, reason: `Reversa de ${r.number}: ${motivo.trim()}` },
      { referenceType: 'REDEMPTION', referenceId: r.id },
      ctx.actorId
    )
  }

  // 3b. Slice 4: si la entrega había creado deuda (ON_REDEMPTION) y nadie la pagó, se cancela.
  //     Slice 5 (§33): si ya se pagó (liquidada), NO se deshace en silencio: queda una incidencia explícita.
  const obligacion = await cancelarObligacionDeRedencionEnTx(tx, r.id, `Reversa de ${r.number}: ${motivo.trim()}`, ctx)

  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REDEMPTION_REVERSED', 'SupplyV2Redemption', r.id, {
    number: r.number,
    entitlementId: r.entitlementId,
    motivo: motivo.trim(),
    voucherReactivado,
    obligacion,
  }, r.supplier.companyId)
  return { id: r.id, number: r.number, entitlementId: r.entitlementId, voucherReactivado }
}

// ── Incidencia mínima (§41) ──────────────────────────────────────────────────

export async function registrarIncidenciaEnTx(
  tx: Tx,
  d: { empleado: EmpleadoProveedor; branchId?: string | null; type: SupplyV2IncidentType; notes?: string | null; codeSeen?: string | null },
  ctx: ContextoAuditoria
): Promise<{ id: string }> {
  let branchId: string | null = null
  if (d.branchId) {
    const s = await tx.sucursal.findFirst({ where: { id: d.branchId, companyId: d.empleado.companyId }, select: { id: true } })
    if (!s) fallo('WRONG_BRANCH', 'Esa sucursal no es de tu empresa.')
    branchId = s.id
  }
  let qrSessionId: string | null = null
  const codeSeen = d.codeSeen ? d.codeSeen.slice(0, 64) : null
  if (codeSeen && nonceConFormatoValido(codeSeen)) {
    const s = await tx.supplyV2QrSession.findUnique({ where: { nonce: codeSeen }, select: { id: true } })
    qrSessionId = s?.id ?? null
  }
  const inc = await tx.supplyV2RedemptionIncident.create({
    data: { supplierId: d.empleado.supplierId, branchId, employeeId: d.empleado.userId, qrSessionId, codeSeen: qrSessionId ? null : codeSeen, type: d.type, notes: d.notes?.trim().slice(0, 500) || null },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_REDEMPTION_INCIDENT', 'SupplyV2RedemptionIncident', inc.id, { type: d.type, branchId, qrSessionId }, d.empleado.companyId)
  return inc
}

// ── Cron (§58): vencimientos, idempotente ────────────────────────────────────

export async function expirarVouchersEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<number> {
  const vencidos = await tx.supplyV2Voucher.findMany({ where: { status: 'ACTIVE', validUntil: { lte: ahora } }, select: { id: true, supplier: { select: { companyId: true } } }, take: limite })
  let n = 0
  for (const v of vencidos) {
    const r = await tx.supplyV2Voucher.updateMany({ where: { id: v.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } })
    if (r.count === 1) {
      n++
      await auditarEnTx(tx, ctx, 'SUPPLY_V2_VOUCHER_EXPIRED', 'SupplyV2Voucher', v.id, {}, v.supplier.companyId)
    }
  }
  return n
}

/**
 * Un derecho vencido deja de ser canjeable Y cierra su unidad (Slice 4, §27, §66):
 *
 *   entitlement ACTIVE + vencido → EXPIRED → ledger ISSUED → CLOSED → BREAKAGE +1
 *
 * Nunca vuelve a AVAILABLE: esa unidad ya se vendió. El ingreso se conserva y
 * el costo no se duplica (ya se reconoció al vender). Devuelve `false` si el
 * derecho ya no estaba ACTIVE o todavía no venció (idempotente).
 */
export async function expirarDerechoEnTx(tx: Tx, entitlementId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<boolean> {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_entitlements" WHERE "id" = ${entitlementId} FOR UPDATE`
  const d = await tx.supplyV2Entitlement.findUnique({ where: { id: entitlementId }, select: { id: true, status: true, expiresAt: true, lotId: true, quantity: true, supplier: { select: { companyId: true } } } })
  if (!d || d.status !== 'ACTIVE' || !d.expiresAt || d.expiresAt > ahora) return false
  const r = await tx.supplyV2Entitlement.updateMany({ where: { id: d.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } })
  if (r.count !== 1) return false
  await tx.supplyV2Voucher.updateMany({ where: { entitlementId: d.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } })
  // Slice 5: un derecho a comisión no tiene lote; vence sin asiento y sin deuda al proveedor (no se entregó).
  if (d.lotId) {
    await registrarAsientoEnTx(
      tx,
      d.lotId,
      { type: 'EXPIRATION', sourceBucket: 'ISSUED', destinationBucket: 'CLOSED', quantity: d.quantity, reason: 'Derecho vencido sin redimir (breakage).' },
      { referenceType: 'ENTITLEMENT', referenceId: d.id },
      ctx.actorId
    )
  }
  await registrarBreakageEnTx(tx, d.id, ctx, ahora)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ENTITLEMENT_EXPIRED', 'SupplyV2Entitlement', d.id, { ledger: d.lotId ? 'ISSUED→CLOSED' : 'sin lote (comisión)', breakage: 1 }, d.supplier.companyId)
  return true
}

/** Candidatos a vencer: derechos ACTIVE con fecha de vencimiento pasada. */
export async function derechosPorVencerEnTx(tx: Tx, ahora = new Date(), limite = 200): Promise<string[]> {
  const filas = await tx.supplyV2Entitlement.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: ahora } }, select: { id: true }, take: limite, orderBy: { expiresAt: 'asc' } })
  return filas.map((f) => f.id)
}

/** Todos los vencidos en UNA transacción (para pruebas y usos pequeños); el cron va uno a uno. */
export async function expirarDerechosEnTx(tx: Tx, ctx: ContextoAuditoria, ahora = new Date(), limite = 200): Promise<number> {
  let n = 0
  for (const id of await derechosPorVencerEnTx(tx, ahora, limite)) if (await expirarDerechoEnTx(tx, id, ctx, ahora)) n++
  return n
}
