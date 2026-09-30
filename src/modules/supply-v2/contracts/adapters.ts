import 'server-only'

import type { AppRole } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import type {
  AuthorizationGateway,
  BranchGateway,
  BranchRef,
  CompanyGateway,
  CompanyRef,
  CustomerGateway,
  PaymentAccountGateway,
  PaymentAccountRef,
  SupplyV2Permission,
  UserGateway,
} from './gateways'

/**
 * MEMBEGO SUPPLY 2.0 · adaptadores de los contratos sobre la infraestructura
 * actual de Membego. Es el ÚNICO lugar de Supply 2.0 que sabe cómo el Core
 * guarda empresas, usuarios, sucursales y roles.
 */

const SELECT_EMPRESA = {
  id: true,
  name: true,
  slug: true,
  ciudad: true,
  email: true,
  telefono: true,
  whatsapp: true,
  razonSocial: true,
  moneda: true,
  supplyV2Supplier: { select: { id: true } },
} as const

type FilaEmpresa = {
  id: string
  name: string
  slug: string
  ciudad: string | null
  email: string | null
  telefono: string | null
  whatsapp: string | null
  razonSocial: string | null
  moneda: string
  supplyV2Supplier: { id: string } | null
}

function aCompanyRef(c: FilaEmpresa): CompanyRef {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    city: c.ciudad,
    email: c.email,
    phone: c.telefono,
    whatsapp: c.whatsapp,
    legalName: c.razonSocial,
    currency: c.moneda,
    supplierId: c.supplyV2Supplier?.id ?? null,
  }
}

export const companyGateway: CompanyGateway = {
  async findById(id) {
    const c = await sinEmpresa('Supply 2.0: leer una empresa como posible proveedora', (tx) =>
      tx.company.findUnique({ where: { id }, select: SELECT_EMPRESA })
    )
    return c ? aCompanyRef(c) : null
  },
  async search(query) {
    const q = query.trim()
    if (q.length < 2) return []
    const filas = await sinEmpresa('Supply 2.0: buscar empresas para vincular como proveedor', (tx) =>
      tx.company.findMany({
        where: {
          esDemo: false,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { razonSocial: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: { name: 'asc' },
        take: 10,
        select: SELECT_EMPRESA,
      })
    )
    return filas.map(aCompanyRef)
  },
}

export const userGateway: UserGateway = {
  async current() {
    const user = await getUser()
    if (!user?.metadata.dbUserId) throw new Error('Se requiere iniciar sesión.')
    return {
      id: user.metadata.dbUserId,
      name: null,
      email: user.email,
      role: user.metadata.role,
    }
  },
  async findById(id) {
    const u = await sinEmpresa('Supply 2.0: leer un usuario por id', (tx) =>
      tx.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, role: true } })
    )
    return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null
  },
}

export const branchGateway: BranchGateway = {
  async listForCompany(companyId): Promise<BranchRef[]> {
    const filas = await sinEmpresa('Supply 2.0: sucursales de un proveedor registrado', (tx) =>
      tx.sucursal.findMany({
        where: { companyId, activa: true },
        orderBy: { nombre: 'asc' },
        select: { id: true, nombre: true, direccion: true },
      })
    )
    return filas.map((s) => ({ id: s.id, name: s.nombre, address: s.direccion }))
  },
}

/**
 * Política del Slice 1: todos los permisos de Supply 2.0 son de PLATAFORMA y
 * los tiene el rol SUPERADMIN. Se resuelve contra el rol del RBAC existente:
 * no hay una segunda tabla de permisos. Cuando el Slice 2 abra el lado
 * proveedor, esta función crecerá; la firma no cambia.
 */
export const ROLES_CON_SUPPLY_V2: readonly AppRole[] = ['SUPERADMIN']

export function rolPuede(role: string, _permission: SupplyV2Permission): boolean {
  return (ROLES_CON_SUPPLY_V2 as readonly string[]).includes(role)
}

export const authorizationGateway: AuthorizationGateway = {
  async can(userId, permission) {
    const u = await userGateway.findById(userId)
    return u ? rolPuede(u.role, permission) : false
  },
}

// ── Slice 2 · cliente y cuentas de cobro ────────────────────────────────────

/**
 * EL CLIENTE ES EL USUARIO. Una ficha `Cliente` de Membego pertenece a UNA
 * empresa (es la afiliación de una persona a un comercio); una compra a
 * Membego no pertenece a ningún comercio, así que Supply 2.0 referencia al
 * `User` con rol CLIENTE. Cuando el Slice 3 entregue en una sucursal, el
 * puente hacia la ficha de esa empresa se resuelve con `misClienteIds`, sin
 * tabla nueva.
 */
export const customerGateway: CustomerGateway = {
  async current() {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE') throw new Error('Inicia sesión como cliente para comprar.')
    if (!user.metadata.dbUserId) throw new Error('La sesión no tiene un usuario asociado.')
    return { id: user.metadata.dbUserId, email: user.email, name: null }
  },
}

/**
 * Las cuentas a las que un cliente le paga a MEMBEGO son las de
 * `supply_cuentas_cobro`: la única entidad del proyecto que representa un
 * cobro a nombre de la plataforma (todo lo demás cobra a nombre de una
 * empresa). Se LEE por este adaptador; Supply 2.0 nunca escribe en ella y la
 * orden congela una foto de la cuenta, sin clave foránea.
 */
export const paymentAccountGateway: PaymentAccountGateway = {
  async activas(): Promise<PaymentAccountRef[]> {
    return sinEmpresa('Supply 2.0: cuentas de cobro de la plataforma', (tx) =>
      tx.supplyCuentaCobro.findMany({
        where: { activa: true },
        orderBy: { nombre: 'asc' },
        select: { id: true, tipo: true, nombre: true, titular: true, numeroCuenta: true, tipoCuenta: true, instrucciones: true, moneda: true },
      })
    )
  },
  async findById(id) {
    return sinEmpresa('Supply 2.0: una cuenta de cobro por id', (tx) =>
      tx.supplyCuentaCobro.findFirst({
        where: { id, activa: true },
        select: { id: true, tipo: true, nombre: true, titular: true, numeroCuenta: true, tipoCuenta: true, instrucciones: true, moneda: true },
      })
    )
  },
}
