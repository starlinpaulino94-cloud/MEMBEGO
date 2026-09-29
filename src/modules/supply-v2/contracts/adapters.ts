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
