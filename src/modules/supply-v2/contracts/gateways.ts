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
  'SUPPLY_V2_OFFER_MANAGE',
  'SUPPLY_V2_OFFER_PUBLISH',
  // Slice 3
  'SUPPLY_V2_REDEEM',
  'SUPPLY_V2_REDEMPTION_VIEW',
  'SUPPLY_V2_REDEMPTION_REVERSE',
  // Slice 4 · finanzas (§40): permisos separados, no uno solo
  'SUPPLY_V2_FINANCE_VIEW',
  'SUPPLY_V2_INVOICE_MANAGE',
  'SUPPLY_V2_DEPOSIT_MANAGE',
  'SUPPLY_V2_PAYMENT_CREATE',
  'SUPPLY_V2_PAYMENT_APPROVE',
  'SUPPLY_V2_RECONCILE',
] as const
export type SupplyV2Permission = (typeof SUPPLY_V2_PERMISSIONS)[number]

export const SUPPLY_V2_PERMISSION_LABELS: Record<SupplyV2Permission, string> = {
  SUPPLY_V2_VIEW: 'Ver Supply 2.0',
  SUPPLY_V2_SUPPLIER_MANAGE: 'Registrar proveedores y su catálogo',
  SUPPLY_V2_AGREEMENT_MANAGE: 'Crear y activar acuerdos',
  SUPPLY_V2_PURCHASE_CREATE: 'Crear y enviar órdenes de compra',
  SUPPLY_V2_PURCHASE_APPROVE: 'Aprobar o rechazar órdenes de compra',
  SUPPLY_V2_RECEIVE: 'Registrar recepciones',
  SUPPLY_V2_OFFER_MANAGE: 'Crear, pausar y finalizar ofertas; confirmar pagos de clientes',
  SUPPLY_V2_OFFER_PUBLISH: 'Publicar ofertas (aparta supply)',
  SUPPLY_V2_REDEEM: 'Escanear y confirmar entregas (proveedor)',
  SUPPLY_V2_REDEMPTION_VIEW: 'Ver redenciones',
  SUPPLY_V2_REDEMPTION_REVERSE: 'Reversar redenciones',
  SUPPLY_V2_FINANCE_VIEW: 'Ver finanzas y economía de Supply 2.0',
  SUPPLY_V2_INVOICE_MANAGE: 'Registrar, aprobar y cancelar facturas de proveedor',
  SUPPLY_V2_DEPOSIT_MANAGE: 'Crear y aplicar depósitos de proveedor',
  SUPPLY_V2_PAYMENT_CREATE: 'Registrar pagos a proveedores',
  SUPPLY_V2_PAYMENT_APPROVE: 'Confirmar pagos a proveedores y reversar aplicaciones',
  SUPPLY_V2_RECONCILE: 'Conciliar con proveedores',
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

/** Cliente de la plataforma: el USUARIO con rol CLIENTE (ver auditoría del Slice 2). */
export interface CustomerRef {
  id: string
  email: string
  name: string | null
}

export interface CustomerGateway {
  /** Cliente de la petición actual. Lanza si no hay sesión de cliente. */
  current(): Promise<CustomerRef>
}

/** Una cuenta a la que un cliente puede pagarle a Membego (transferencia o depósito). */
export interface PaymentAccountRef {
  id: string
  tipo: string
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
  moneda: string
}

export interface PaymentAccountGateway {
  activas(): Promise<PaymentAccountRef[]>
  findById(id: string): Promise<PaymentAccountRef | null>
}
