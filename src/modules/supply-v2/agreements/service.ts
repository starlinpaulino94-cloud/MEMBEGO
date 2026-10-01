import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { exigirTransicion, TRANSICIONES_ACUERDO } from '../core/estados'
import { siguienteNumero } from '../core/numeracion'
import { resolverAcuerdoComision, snapshotDeAcuerdo, validarAcuerdo, type DatosAcuerdo } from './domain'

export interface AcuerdoComisionResuelto {
  agreementId: string
  agreementVersionId: string
  code: string
  version: number
  scope: 'ITEM' | 'CATEGORY' | 'CATALOG'
  commissionPercentage: Prisma.Decimal
  paymentTermsDays: number | null
}

/**
 * Slice 5 (§9): QUÉ acuerdo a comisión rige este producto hoy, con
 * precedencia ITEM > CATEGORY > CATALOG. Lee los acuerdos vigentes del
 * proveedor del producto y la versión activa de cada uno. `null` si ninguno
 * cubre el producto (no se puede vender a comisión sin acuerdo).
 */
export async function resolverAcuerdoComisionDeItemEnTx(tx: Tx, catalogItemId: string, ahora = new Date()): Promise<AcuerdoComisionResuelto | null> {
  const item = await tx.supplyV2CatalogItem.findUnique({ where: { id: catalogItemId }, select: { id: true, category: true, supplierId: true } })
  if (!item) fallo('ITEM_NO_ENCONTRADO', 'El producto no existe.')
  const candidatos = await tx.supplyV2Agreement.findMany({
    where: { supplierId: item.supplierId, type: 'COMMISSION', status: 'ACTIVE' },
    select: { id: true, code: true, status: true, type: true, scope: true, catalogItemId: true, category: true, startsAt: true, endsAt: true, version: true, commissionPercentage: true, paymentTermsDays: true },
  })
  const ganador = resolverAcuerdoComision(candidatos, item, ahora)
  if (!ganador) return null
  if (ganador.commissionPercentage == null) fallo('ACUERDO_SIN_COMISION', `El acuerdo ${ganador.code} no tiene porcentaje de comisión.`)
  const v = await tx.supplyV2AgreementVersion.findUnique({ where: { agreementId_version: { agreementId: ganador.id, version: ganador.version } }, select: { id: true } })
  if (!v) fallo('ACUERDO_SIN_VERSION', `El acuerdo ${ganador.code} no tiene versión activa.`)
  return { agreementId: ganador.id, agreementVersionId: v.id, code: ganador.code, version: ganador.version, scope: ganador.scope, commissionPercentage: ganador.commissionPercentage, paymentTermsDays: ganador.paymentTermsDays }
}

export interface AcuerdoCreado {
  id: string
  code: string
  version: number
  status: string
}

/** Crea el acuerdo en DRAFT con su código correlativo. */
export async function crearAcuerdoEnTx(tx: Tx, d: DatosAcuerdo, ctx: ContextoAuditoria): Promise<AcuerdoCreado> {
  const error = validarAcuerdo(d)
  if (error) fallo('ACUERDO_INVALIDO', error)
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Un acuerdo necesita quién lo crea.')

  const proveedor = await tx.supplyV2Supplier.findUnique({
    where: { id: d.supplierId },
    select: { id: true, status: true, currency: true, companyId: true },
  })
  if (!proveedor) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (proveedor.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'El proveedor no está activo.')

  const scope = d.scope ?? 'ITEM'
  if (d.catalogItemId) {
    const item = await tx.supplyV2CatalogItem.findUnique({
      where: { id: d.catalogItemId },
      select: { supplierId: true, status: true },
    })
    if (!item || item.supplierId !== proveedor.id) fallo('ITEM_AJENO', 'El producto no pertenece a este proveedor.')
    if (item.status === 'ARCHIVED') fallo('ITEM_ARCHIVADO', 'El producto está archivado.')
  }

  const code = await siguienteNumero(tx, 'MBG-AG', async (prefijo) => {
    const u = await tx.supplyV2Agreement.findFirst({
      where: { code: { startsWith: prefijo } },
      orderBy: { code: 'desc' },
      select: { code: true },
    })
    return u?.code ?? null
  }, d.startsAt)

  const creado = await tx.supplyV2Agreement.create({
    data: {
      supplierId: proveedor.id,
      code,
      version: 0,
      type: d.type,
      scope,
      catalogItemId: scope === 'ITEM' ? d.catalogItemId : null,
      category: scope === 'CATEGORY' ? d.category?.trim() ?? null : null,
      currency: (d.currency?.trim() || proveedor.currency).toUpperCase().slice(0, 3),
      negotiatedUnitCost:
        d.negotiatedUnitCost != null && d.negotiatedUnitCost !== '' ? new Prisma.Decimal(d.negotiatedUnitCost) : null,
      discountPercentage:
        d.discountPercentage != null && d.discountPercentage !== '' ? new Prisma.Decimal(d.discountPercentage) : null,
      commissionPercentage:
        d.commissionPercentage != null && d.commissionPercentage !== '' ? new Prisma.Decimal(d.commissionPercentage) : null,
      paymentTermsDays: d.paymentTermsDays ?? null,
      // Slice 5: a comisión la deuda nace SIEMPRE al entregar.
      payableRecognition: d.type === 'COMMISSION' ? 'ON_REDEMPTION' : d.payableRecognition ?? 'ON_INVOICE',
      allowDepositApplication: d.allowDepositApplication ?? true,
      settlementFrequency: d.settlementFrequency?.trim() || null,
      commissionBase: d.commissionBase ?? 'CONTRACTUAL_SALE_VALUE',
      startsAt: d.startsAt,
      endsAt: d.endsAt ?? null,
      notes: d.notes?.trim() || null,
      status: 'DRAFT',
      createdById: ctx.actorId,
    },
    select: { id: true, code: true, version: true, status: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_AGREEMENT_CREATED', 'SupplyV2Agreement', creado.id, {
    code: creado.code,
    supplierId: proveedor.id,
    type: d.type,
    scope,
  }, proveedor.companyId)
  return creado
}

/**
 * Activa un acuerdo. La PRIMERA activación crea la versión 1 (§11); una
 * reactivación desde SUSPENDED no crea versión porque las condiciones no
 * cambiaron. Idempotente: activar dos veces devuelve lo mismo.
 */
export async function activarAcuerdoEnTx(
  tx: Tx,
  agreementId: string,
  ctx: ContextoAuditoria
): Promise<{ id: string; version: number; versionId: string }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Activar un acuerdo necesita quién lo activa.')
  const a = await tx.supplyV2Agreement.findUnique({
    where: { id: agreementId },
    include: { supplier: { select: { companyId: true } } },
  })
  if (!a) fallo('ACUERDO_NO_ENCONTRADO', 'El acuerdo no existe.')

  if (a.status === 'ACTIVE') {
    const v = await tx.supplyV2AgreementVersion.findUniqueOrThrow({
      where: { agreementId_version: { agreementId: a.id, version: a.version } },
      select: { id: true },
    })
    return { id: a.id, version: a.version, versionId: v.id }
  }
  exigirTransicion(TRANSICIONES_ACUERDO, a.status, 'ACTIVE', 'Acuerdo')

  const nuevaVersion = a.version === 0 ? 1 : a.version
  await tx.supplyV2Agreement.update({
    where: { id: a.id },
    data: {
      status: 'ACTIVE',
      version: nuevaVersion,
      ...(a.approvedById ? {} : { approvedById: ctx.actorId, approvedAt: new Date() }),
    },
  })
  let versionId: string
  if (a.version === 0) {
    const v = await tx.supplyV2AgreementVersion.create({
      data: {
        agreementId: a.id,
        version: 1,
        snapshot: snapshotDeAcuerdo(a) as Prisma.InputJsonValue,
        createdById: ctx.actorId,
      },
      select: { id: true },
    })
    versionId = v.id
  } else {
    const v = await tx.supplyV2AgreementVersion.findUniqueOrThrow({
      where: { agreementId_version: { agreementId: a.id, version: a.version } },
      select: { id: true },
    })
    versionId = v.id
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_AGREEMENT_ACTIVATED', 'SupplyV2Agreement', a.id, {
    code: a.code,
    antes: a.status,
    despues: 'ACTIVE',
    version: nuevaVersion,
  }, a.supplier.companyId)
  return { id: a.id, version: nuevaVersion, versionId }
}

/**
 * Cambia las condiciones de un acuerdo vigente: nueva versión con nueva foto.
 * Las órdenes que apuntan a versiones anteriores no cambian. (Fuera del
 * recorrido del Slice 1; existe para que el versionado sea real y probable.)
 */
export async function modificarCondicionesEnTx(
  tx: Tx,
  agreementId: string,
  cambios: { negotiatedUnitCost?: number | string | null; paymentTermsDays?: number | null; endsAt?: Date | null; notes?: string | null },
  ctx: ContextoAuditoria
): Promise<{ version: number; versionId: string }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Modificar un acuerdo necesita quién lo modifica.')
  const a = await tx.supplyV2Agreement.findUnique({ where: { id: agreementId } })
  if (!a) fallo('ACUERDO_NO_ENCONTRADO', 'El acuerdo no existe.')
  if (a.status !== 'ACTIVE') fallo('ACUERDO_NO_VIGENTE', 'Solo se versiona un acuerdo vigente.')
  if (cambios.negotiatedUnitCost != null && Number(cambios.negotiatedUnitCost) < 0) {
    fallo('ACUERDO_INVALIDO', 'El costo negociado no puede ser negativo.')
  }
  if (cambios.endsAt && cambios.endsAt <= a.startsAt) {
    fallo('ACUERDO_INVALIDO', 'La fecha de fin tiene que ser posterior a la de inicio.')
  }
  const actualizado = await tx.supplyV2Agreement.update({
    where: { id: a.id },
    data: {
      version: a.version + 1,
      ...(cambios.negotiatedUnitCost != null ? { negotiatedUnitCost: new Prisma.Decimal(cambios.negotiatedUnitCost) } : {}),
      ...(cambios.paymentTermsDays !== undefined ? { paymentTermsDays: cambios.paymentTermsDays } : {}),
      ...(cambios.endsAt !== undefined ? { endsAt: cambios.endsAt } : {}),
      ...(cambios.notes !== undefined ? { notes: cambios.notes } : {}),
    },
  })
  const v = await tx.supplyV2AgreementVersion.create({
    data: {
      agreementId: a.id,
      version: actualizado.version,
      snapshot: snapshotDeAcuerdo(actualizado) as Prisma.InputJsonValue,
      createdById: ctx.actorId,
    },
    select: { id: true },
  })
  return { version: actualizado.version, versionId: v.id }
}
