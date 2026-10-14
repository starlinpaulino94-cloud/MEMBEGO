import type { Prisma, SupplyV2MerchantApplication, SupplyV2MerchantApplicationStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { exigirTransicion } from '@/lib/commerce-primitives/estados'
import { CAPACIDADES_OVERRIDE_TENANT_NUEVO, capacidadesDeEmpresa, type Capacidad } from '@/modules/capacidades/catalogo'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { emitirEfectoEnTx } from '../operations/outbox'
import { OVERRIDES_SUPPLIER_LITE, tipoDeOrganizacion } from './acceso-dominio'
import {
  capacidadesQueEnciendeLaAprobacion,
  ESTADOS_VIVOS_SOLICITUD,
  prellenarSolicitud,
  TRANSICIONES_SOLICITUD_MERCHANT,
  type DatosSolicitudMerchant,
  type DecisionSolicitud,
} from './solicitud-merchant-dominio'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Supplier → Merchant (§39–§41).
 *
 * El proveedor pide, desde su portal, operar también como empresa Membego.
 * Membego revisa (más información, rechazo o aprobación) y la aprobación
 * ENCIENDE las capacidades de comercio en la MISMA `Company`: nada se
 * duplica, nada se migra. Lo que el proveedor ya tiene (acuerdos, lotes,
 * ofertas de Membego, visitas) sigue colgando de esa misma empresa (§41).
 */

const AGG = 'SupplyV2MerchantApplication'

export interface SolicitudMerchant {
  id: string
  status: SupplyV2MerchantApplicationStatus
  datos: DatosSolicitudMerchant
  submittedAt: Date
  moreInfoRequest: string | null
  moreInfoResponse: string | null
  reviewedAt: Date | null
  decisionReason: string | null
  internalNotes: string | null
  capabilitiesGranted: string[] | null
  supplierId: string
  companyId: string
}

function aSolicitud(a: SupplyV2MerchantApplication): SolicitudMerchant {
  return {
    id: a.id,
    status: a.status,
    datos: a.datos as unknown as DatosSolicitudMerchant,
    submittedAt: a.submittedAt,
    moreInfoRequest: a.moreInfoRequest,
    moreInfoResponse: a.moreInfoResponse,
    reviewedAt: a.reviewedAt,
    decisionReason: a.decisionReason,
    internalNotes: a.internalNotes,
    capabilitiesGranted: Array.isArray(a.capabilitiesGranted) ? (a.capabilitiesGranted as string[]) : null,
    supplierId: a.supplierId,
    companyId: a.companyId,
  }
}

/** La última solicitud del proveedor (viva o decidida), para enseñar su estado. */
export async function ultimaSolicitudEnTx(tx: Tx, supplierId: string): Promise<SolicitudMerchant | null> {
  const a = await tx.supplyV2MerchantApplication.findFirst({ where: { supplierId }, orderBy: { submittedAt: 'desc' } })
  return a ? aSolicitud(a) : null
}

export async function solicitudVivaEnTx(tx: Tx, supplierId: string): Promise<SolicitudMerchant | null> {
  const a = await tx.supplyV2MerchantApplication.findFirst({ where: { supplierId, status: { in: [...ESTADOS_VIVOS_SOLICITUD] } }, orderBy: { submittedAt: 'desc' } })
  return a ? aSolicitud(a) : null
}

async function empresaDelProveedorEnTx(tx: Tx, supplierId: string) {
  const p = await tx.supplyV2Supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true, commercialName: true, legalName: true, taxId: true, phone: true, address: true, companyId: true, accessStatus: true,
      company: { select: { id: true, name: true, type: true, description: true, telefono: true, direccion: true, ciudad: true, capacidades: true, tipoNegocioCodigo: true, sucursales: { where: { activa: true }, select: { nombre: true, direccion: true }, orderBy: { createdAt: 'asc' } } } },
    },
  })
  if (!p) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (!p.company || !p.companyId) fallo('PROVEEDOR_SIN_EMPRESA', 'Este proveedor no tiene acceso operativo (sin empresa en Membego).')
  return { ...p, company: p.company, companyId: p.companyId }
}

/** Es ya Merchant (alguna capacidad de comercio encendida) → no hay nada que pedir. */
export async function yaEsMerchantEnTx(tx: Tx, supplierId: string): Promise<boolean> {
  const p = await empresaDelProveedorEnTx(tx, supplierId)
  const caps = capacidadesDeEmpresa(p.company)
  return tipoDeOrganizacion([...caps.activas], true) === 'MERCHANT_SUPPLIER'
}

/** El formulario prellenado con lo que Membego ya sabe de la empresa y del proveedor (§40). */
export async function prellenadoDeSolicitudEnTx(tx: Tx, supplierId: string): Promise<DatosSolicitudMerchant> {
  const p = await empresaDelProveedorEnTx(tx, supplierId)
  return prellenarSolicitud({ empresa: p.company, proveedor: p, sucursales: p.company.sucursales })
}

// ── El proveedor envía (o responde) ─────────────────────────────────────────

export async function enviarSolicitudMerchantEnTx(
  tx: Tx,
  d: { supplierId: string; companyId: string; userId: string; datos: DatosSolicitudMerchant },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ id: string; status: SupplyV2MerchantApplicationStatus; repetida: boolean; respondida: boolean }> {
  const p = await empresaDelProveedorEnTx(tx, d.supplierId)
  if (p.companyId !== d.companyId) fallo('PROVEEDOR_AJENO', 'Ese proveedor no es el de tu empresa.')
  if (p.accessStatus === 'SUSPENDED' || p.accessStatus === 'TERMINATED') fallo('ACCESO_CERRADO', 'Tu acceso de proveedor está cerrado; no puedes solicitar ser empresa Membego.')
  if (await yaEsMerchantEnTx(tx, d.supplierId)) fallo('YA_ES_MERCHANT', 'Tu empresa ya opera como empresa Membego.')

  const viva = await tx.supplyV2MerchantApplication.findFirst({ where: { supplierId: d.supplierId, status: { in: [...ESTADOS_VIVOS_SOLICITUD] } } })
  if (viva && viva.status !== 'MORE_INFO_REQUIRED') return { id: viva.id, status: viva.status, repetida: true, respondida: false }

  const datos = d.datos as unknown as Prisma.InputJsonValue
  if (viva) {
    // Responde a «falta información»: vuelve a la cola con los datos nuevos.
    exigirTransicion(TRANSICIONES_SOLICITUD_MERCHANT, viva.status, 'SUBMITTED', 'Solicitud')
    await tx.supplyV2MerchantApplication.update({ where: { id: viva.id }, data: { status: 'SUBMITTED', datos, moreInfoResponse: d.datos.notas || 'Información actualizada.', submittedAt: ahora, submittedById: d.userId } })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_MERCHANT_APPLICATION_SUBMITTED', AGG, viva.id, { supplierId: d.supplierId, respuesta: true }, d.companyId)
    await emitirEfectoEnTx(tx, { eventType: 'supplier.merchant_application_submitted', aggregateType: AGG, aggregateId: viva.id, payload: { supplierId: d.supplierId, companyId: d.companyId, nombre: d.datos.nombreComercial, respuesta: true }, correlationId: viva.id, dedupeKey: `supplier.merchant_application_submitted:${viva.id}:${ahora.getTime()}` })
    return { id: viva.id, status: 'SUBMITTED', repetida: false, respondida: true }
  }

  const creada = await tx.supplyV2MerchantApplication.create({
    data: { supplierId: d.supplierId, companyId: d.companyId, status: 'SUBMITTED', datos, submittedById: d.userId, submittedAt: ahora },
    select: { id: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MERCHANT_APPLICATION_SUBMITTED', AGG, creada.id, { supplierId: d.supplierId, nombre: d.datos.nombreComercial, tipoNegocio: d.datos.tipoNegocio }, d.companyId)
  await emitirEfectoEnTx(tx, { eventType: 'supplier.merchant_application_submitted', aggregateType: AGG, aggregateId: creada.id, payload: { supplierId: d.supplierId, companyId: d.companyId, nombre: d.datos.nombreComercial, respuesta: false }, correlationId: creada.id, dedupeKey: `supplier.merchant_application_submitted:${creada.id}` })
  return { id: creada.id, status: 'SUBMITTED', repetida: false, respondida: false }
}

export async function retirarSolicitudMerchantEnTx(tx: Tx, d: { applicationId: string; supplierId: string }, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ repetida: boolean }> {
  const a = await tx.supplyV2MerchantApplication.findUnique({ where: { id: d.applicationId } })
  if (!a || a.supplierId !== d.supplierId) fallo('SOLICITUD_NO_ENCONTRADA', 'Esa solicitud no es tuya.')
  if (a.status === 'WITHDRAWN') return { repetida: true }
  exigirTransicion(TRANSICIONES_SOLICITUD_MERCHANT, a.status, 'WITHDRAWN', 'Solicitud')
  await tx.supplyV2MerchantApplication.update({ where: { id: a.id }, data: { status: 'WITHDRAWN', reviewedAt: ahora } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MERCHANT_APPLICATION_WITHDRAWN', AGG, a.id, { supplierId: a.supplierId }, a.companyId)
  return { repetida: false }
}

// ── Membego revisa (§41) ────────────────────────────────────────────────────

/**
 * Enciende las capacidades de comercio en la MISMA empresa (§41, §80). Quita
 * los apagados del Supplier Lite para que la categoría del negocio vuelva a
 * mandar sobre el paquete base; conserva lo que todo tenant nuevo trae
 * apagado y la capacidad de proveedor. Devuelve lo que quedó encendido.
 */
export async function encenderCapacidadesMerchantEnTx(tx: Tx, companyId: string, tipoNegocio: string | null): Promise<Capacidad[]> {
  const c = await tx.company.findUnique({ where: { id: companyId }, select: { capacidades: true, type: true } })
  if (!c) fallo('EMPRESA_NO_ENCONTRADA', 'La empresa no existe en Membego.')
  const raw = (c.capacidades && typeof c.capacidades === 'object' && !Array.isArray(c.capacidades) ? c.capacidades : {}) as Record<string, unknown>
  const overrides = { ...((raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) ? raw.overrides : {}) as Record<string, boolean>) }
  for (const [cap, valor] of Object.entries(OVERRIDES_SUPPLIER_LITE)) {
    if (valor === false && overrides[cap] === false) delete overrides[cap]
  }
  const encendidas = capacidadesQueEnciendeLaAprobacion()
  const nuevos: Record<string, boolean> = { ...CAPACIDADES_OVERRIDE_TENANT_NUEVO, ...overrides, MEMBEGO_SUPPLIER: true, MEMBEGO_SUPPLY_FULFILLMENT: true }
  for (const cap of encendidas) nuevos[cap] = true
  // Una empresa nacida como Supplier Lite tiene `type: 'proveedor'`: el tipo que eligió en la solicitud pasa a mandar.
  const type = c.type === 'proveedor' && tipoNegocio ? tipoNegocio : c.type
  await tx.company.update({ where: { id: companyId }, data: { capacidades: { ...raw, overrides: nuevos }, type } })
  return [...encendidas]
}

export interface RevisionDeSolicitud {
  applicationId: string
  decision: DecisionSolicitud
  /** Motivo visible para el proveedor (obligatorio al rechazar; opcional al aprobar). */
  motivo?: string | null
  /** Qué falta (obligatorio en MORE_INFO_REQUIRED). */
  peticion?: string | null
  /** Notas internas de Membego. */
  notasInternas?: string | null
}

export async function revisarSolicitudMerchantEnTx(tx: Tx, d: RevisionDeSolicitud, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ id: string; status: SupplyV2MerchantApplicationStatus; capacidades: string[]; repetida: boolean }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Revisar una solicitud necesita quién la revisa.')
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_merchant_applications" WHERE "id" = ${d.applicationId} FOR UPDATE`
  const a = await tx.supplyV2MerchantApplication.findUnique({ where: { id: d.applicationId } })
  if (!a) fallo('SOLICITUD_NO_ENCONTRADA', 'La solicitud no existe.')
  if (a.status === d.decision) return { id: a.id, status: a.status, capacidades: [], repetida: true }
  if (a.status === 'APPROVED' || a.status === 'REJECTED' || a.status === 'WITHDRAWN') fallo('SOLICITUD_CERRADA', `La solicitud ya está ${a.status === 'APPROVED' ? 'aprobada' : a.status === 'REJECTED' ? 'rechazada' : 'retirada'}.`)
  exigirTransicion(TRANSICIONES_SOLICITUD_MERCHANT, a.status, d.decision, 'Solicitud')
  const motivo = d.motivo?.trim() || null
  const peticion = d.peticion?.trim() || null
  const notasInternas = d.notasInternas?.trim() || a.internalNotes
  const datos = a.datos as unknown as DatosSolicitudMerchant

  if (d.decision === 'UNDER_REVIEW') {
    await tx.supplyV2MerchantApplication.update({ where: { id: a.id }, data: { status: 'UNDER_REVIEW', reviewerId: ctx.actorId, internalNotes: notasInternas } })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_MERCHANT_APPLICATION_REVIEWED', AGG, a.id, { paso: 'UNDER_REVIEW' }, a.companyId)
    return { id: a.id, status: 'UNDER_REVIEW', capacidades: [], repetida: false }
  }
  if (d.decision === 'MORE_INFO_REQUIRED') {
    if (!peticion) fallo('PETICION_OBLIGATORIA', 'Di qué información falta.')
    await tx.supplyV2MerchantApplication.update({ where: { id: a.id }, data: { status: 'MORE_INFO_REQUIRED', moreInfoRequest: peticion, moreInfoResponse: null, reviewerId: ctx.actorId, reviewedAt: ahora, internalNotes: notasInternas } })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_MERCHANT_APPLICATION_REVIEWED', AGG, a.id, { paso: 'MORE_INFO_REQUIRED', peticion }, a.companyId)
    await emitirEfectoEnTx(tx, { eventType: 'supplier.merchant_application_more_info', aggregateType: AGG, aggregateId: a.id, payload: { companyId: a.companyId, peticion }, correlationId: a.id, dedupeKey: `supplier.merchant_application_more_info:${a.id}:${ahora.getTime()}` })
    return { id: a.id, status: 'MORE_INFO_REQUIRED', capacidades: [], repetida: false }
  }
  if (d.decision === 'REJECTED') {
    if (!motivo) fallo('MOTIVO_OBLIGATORIO', 'Rechazar exige un motivo que el proveedor pueda leer.')
    await tx.supplyV2MerchantApplication.update({ where: { id: a.id }, data: { status: 'REJECTED', decisionReason: motivo, reviewerId: ctx.actorId, reviewedAt: ahora, internalNotes: notasInternas } })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_MERCHANT_APPLICATION_REJECTED', AGG, a.id, { motivo }, a.companyId)
    await emitirEfectoEnTx(tx, { eventType: 'supplier.merchant_rejected', aggregateType: AGG, aggregateId: a.id, payload: { companyId: a.companyId, motivo }, correlationId: a.id, dedupeKey: `supplier.merchant_rejected:${a.id}` })
    return { id: a.id, status: 'REJECTED', capacidades: [], repetida: false }
  }

  // APPROVED: la misma empresa, con las capacidades de comercio encendidas (§41). Nunca una segunda organización.
  const capacidades = await encenderCapacidadesMerchantEnTx(tx, a.companyId, datos.tipoNegocio)
  // El perfil de la empresa se completa con lo que el proveedor llenó, SOLO donde estaba vacío: el onboarding arranca avanzado.
  const empresa = await tx.company.findUniqueOrThrow({ where: { id: a.companyId }, select: { description: true, telefono: true, direccion: true, ciudad: true } })
  await tx.company.update({
    where: { id: a.companyId },
    data: {
      ...(empresa.description ? {} : { description: datos.descripcion || null }),
      ...(empresa.telefono ? {} : { telefono: datos.telefono || null }),
      ...(empresa.direccion ? {} : { direccion: datos.direccion || null }),
      ...(empresa.ciudad ? {} : { ciudad: datos.ciudad || null }),
    },
  })
  await tx.supplyV2MerchantApplication.update({
    where: { id: a.id },
    data: { status: 'APPROVED', decisionReason: motivo, reviewerId: ctx.actorId, reviewedAt: ahora, internalNotes: notasInternas, capabilitiesGranted: capacidades },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_MERCHANT_APPLICATION_APPROVED', AGG, a.id, { capacidades, motivo, mismaEmpresa: a.companyId }, a.companyId)
  await auditarEnTx(tx, ctx, 'CAPACIDADES_ACTUALIZADAS', 'Company', a.companyId, { origen: 'SUPPLY_V2_MERCHANT_APPLICATION', applicationId: a.id, encendidas: capacidades }, a.companyId)
  await emitirEfectoEnTx(tx, { eventType: 'supplier.merchant_approved', aggregateType: AGG, aggregateId: a.id, payload: { companyId: a.companyId, supplierId: a.supplierId, capacidades }, correlationId: a.id, dedupeKey: `supplier.merchant_approved:${a.id}` })
  return { id: a.id, status: 'APPROVED', capacidades, repetida: false }
}

// ── Lecturas para el superadmin ─────────────────────────────────────────────

export interface SolicitudEnLista extends SolicitudMerchant {
  proveedor: string
  empresa: string
  empresaSlug: string
  enviadaPor: string
  revisadaPor: string | null
}

export async function solicitudesMerchantEnTx(tx: Tx, f: { estado?: SupplyV2MerchantApplicationStatus; soloVivas?: boolean } = {}, limite = 200): Promise<SolicitudEnLista[]> {
  const filas = await tx.supplyV2MerchantApplication.findMany({
    where: { ...(f.estado ? { status: f.estado } : {}), ...(f.soloVivas ? { status: { in: [...ESTADOS_VIVOS_SOLICITUD] } } : {}) },
    orderBy: { submittedAt: 'desc' },
    take: limite,
    include: { supplier: { select: { commercialName: true } }, company: { select: { name: true, slug: true } }, submittedBy: { select: { name: true, email: true } }, reviewer: { select: { name: true, email: true } } },
  })
  const nombre = (u: { name: string | null; email: string } | null) => (u ? u.name?.trim() || u.email : null)
  return filas.map((a) => ({ ...aSolicitud(a), proveedor: a.supplier.commercialName, empresa: a.company.name, empresaSlug: a.company.slug, enviadaPor: nombre(a.submittedBy) ?? '—', revisadaPor: nombre(a.reviewer) }))
}

export async function solicitudMerchantPorIdEnTx(tx: Tx, id: string): Promise<SolicitudEnLista | null> {
  const r = await solicitudesMerchantEnTx(tx, {}, 1000)
  return r.find((s) => s.id === id) ?? null
}
