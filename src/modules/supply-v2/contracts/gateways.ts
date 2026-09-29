/**
 * MEMBEGO SUPPLY 2.0 · CONTRATOS CON MEMBEGO CORE (§5).
 *
 * Supply 2.0 no importa servicios internos de Membego a discreción: lo que
 * necesita del Core pasa por estas interfaces, y los adaptadores
 * (`adapters.ts`) son el único sitio que sabe cómo se resuelven contra la
 * infraestructura actual (Prisma, Supabase Auth, RBAC).
 *
 * Referencias, no copias: un `CompanyRef` es un puntero legible a una
 * `Company`; nunca una tabla nueva.
 */

export interface CompanyRef {
  id: string
  name: string
  slug: string
  city: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  legalName: string | null
  currency: string
  /** Si ya tiene relación comercial en Supply 2.0, el id del proveedor. */
  supplierId: string | null
}

export interface UserRef {
  id: string
  name: string | null
  email: string
  role: string
}

export interface BranchRef {
  id: string
  name: string
  address: string | null
}

export const SUPPLY_V2_PERMISSIONS = [
  'SUPPLY_V2_VIEW',
  'SUPPLY_V2_SUPPLIER_MANAGE',
  'SUPPLY_V2_AGREEMENT_MANAGE',
  'SUPPLY_V2_PURCHASE_CREATE',
  'SUPPLY_V2_PURCHASE_APPROVE',
  'SUPPLY_V2_RECEIVE',
] as const
export type SupplyV2Permission = (typeof SUPPLY_V2_PERMISSIONS)[number]

export const SUPPLY_V2_PERMISSION_LABELS: Record<SupplyV2Permission, string> = {
  SUPPLY_V2_VIEW: 'Ver Supply 2.0',
  SUPPLY_V2_SUPPLIER_MANAGE: 'Registrar proveedores y su catálogo',
  SUPPLY_V2_AGREEMENT_MANAGE: 'Crear y activar acuerdos',
  SUPPLY_V2_PURCHASE_CREATE: 'Crear y enviar órdenes de compra',
  SUPPLY_V2_PURCHASE_APPROVE: 'Aprobar o rechazar órdenes de compra',
  SUPPLY_V2_RECEIVE: 'Registrar recepciones',
}

export interface CompanyGateway {
  findById(id: string): Promise<CompanyRef | null>
  search(query: string): Promise<CompanyRef[]>
}

export interface UserGateway {
  /** Usuario de la petición actual. Lanza si no hay sesión. */
  current(): Promise<UserRef>
  findById(id: string): Promise<UserRef | null>
}

export interface BranchGateway {
  listForCompany(companyId: string): Promise<BranchRef[]>
}

export interface AuthorizationGateway {
  can(userId: string, permission: SupplyV2Permission): Promise<boolean>
}
