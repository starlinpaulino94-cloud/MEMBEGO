import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { normalizarProveedor, validarProveedorExterno, type DatosProveedorExterno } from './domain'

/**
 * MEMBEGO SUPPLY · proveedores: escritura, siempre dentro de una `tx`
 * que abre quien llama (action, seed o prueba). Este archivo no abre
 * transacciones: así ninguna puede anidarse.
 */

export interface ProveedorCreado {
  id: string
  commercialName: string
  source: 'REGISTERED_COMPANY' | 'EXTERNAL'
  companyId: string | null
  currency: string
  /** true si ya existía y se devolvió el existente. */
  reutilizado: boolean
}

/** Alta de un proveedor que todavía no usa Membego (§7, companyId nulo). */
export async function crearProveedorExternoEnTx(
  tx: Tx,
  d: DatosProveedorExterno,
  ctx: ContextoAuditoria
): Promise<ProveedorCreado> {
  const error = validarProveedorExterno(d)
  if (error) fallo('PROVEEDOR_INVALIDO', error)
  const datos = normalizarProveedor(d)

  const creado = await tx.supplyV2Supplier.create({
    data: { ...datos, source: 'EXTERNAL', status: 'ACTIVE', createdById: ctx.actorId },
    select: { id: true, commercialName: true, source: true, companyId: true, currency: true },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SUPPLIER_CREATED', 'SupplyV2Supplier', creado.id, {
    source: 'EXTERNAL',
    commercialName: creado.commercialName,
  })
  return { ...creado, reutilizado: false }
}

/**
 * Vincula una `Company` existente como proveedora (§7, regla crítica): NO se
 * crea otra empresa. Idempotente: si la empresa ya es proveedora, devuelve
 * ese proveedor.
 */
export async function vincularEmpresaComoProveedorEnTx(
  tx: Tx,
  companyId: string,
  extra: Partial<DatosProveedorExterno>,
  ctx: ContextoAuditoria
): Promise<ProveedorCreado> {
  const empresa = await tx.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      razonSocial: true,
      email: true,
      telefono: true,
      whatsapp: true,
      direccion: true,
      ciudad: true,
      pais: true,
      moneda: true,
      supplyV2Supplier: { select: { id: true, commercialName: true, source: true, companyId: true, currency: true } },
    },
  })
  if (!empresa) fallo('EMPRESA_NO_ENCONTRADA', 'La empresa no existe en Membego.')
  if (empresa.supplyV2Supplier) return { ...empresa.supplyV2Supplier, reutilizado: true }

  const datos = normalizarProveedor({
    commercialName: empresa.name,
    legalName: extra.legalName ?? empresa.razonSocial,
    taxId: extra.taxId,
    contactName: extra.contactName,
    phone: extra.phone ?? empresa.telefono,
    whatsapp: extra.whatsapp ?? empresa.whatsapp,
    email: extra.email ?? empresa.email,
    address: extra.address ?? empresa.direccion,
    city: extra.city ?? empresa.ciudad,
    countryCode: extra.countryCode ?? (empresa.pais ? empresa.pais.slice(0, 2) : null),
    currency: extra.currency ?? empresa.moneda,
    paymentTermsDays: extra.paymentTermsDays,
    paymentTermsText: extra.paymentTermsText,
    notes: extra.notes,
  })
  const creado = await tx.supplyV2Supplier.create({
    data: { ...datos, companyId: empresa.id, source: 'REGISTERED_COMPANY', status: 'ACTIVE', createdById: ctx.actorId },
    select: { id: true, commercialName: true, source: true, companyId: true, currency: true },
  })
  await auditarEnTx(
    tx,
    ctx,
    'SUPPLY_V2_SUPPLIER_CREATED',
    'SupplyV2Supplier',
    creado.id,
    { source: 'REGISTERED_COMPANY', companyId: empresa.id, commercialName: creado.commercialName },
    empresa.id
  )
  return { ...creado, reutilizado: false }
}
