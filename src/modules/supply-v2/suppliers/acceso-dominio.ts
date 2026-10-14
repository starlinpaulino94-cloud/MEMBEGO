import type { SupplyV2SupplierAccessStatus, SupplyV2SupplierStatus } from '@prisma/client'
import type { AppRole } from '@/types'
import type { PermisosUsuario } from '@/lib/auth/permissions'
import type { Capacidad } from '@/modules/capacidades/catalogo'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · acceso operativo del proveedor: reglas puras.
 *
 * Dos preguntas distintas, dos columnas distintas:
 *
 *   `status`        ¿Membego sigue negociando con él?            (comercial)
 *   `accessStatus`  ¿Puede operar lo que le debe a Membego?       (operativo)
 *
 * El ciclo del acceso:
 *
 *   DRAFT → INVITED → ACTIVATION_PENDING → ACTIVE ⇄ SUSPENDED → TERMINATED
 *
 * ACTIVE exige la LISTA DE PREPARACIÓN completa (`evaluarPreparacion`) o una
 * dispensa con motivo. Un proveedor histórico (anterior a esta fase) llega en
 * DRAFT o en ACTIVE con dispensa `LEGACY_BACKFILL`: sus acuerdos no se tocan.
 */

export const TRANSICIONES_ACCESO: Record<SupplyV2SupplierAccessStatus, readonly SupplyV2SupplierAccessStatus[]> = {
  DRAFT: ['INVITED', 'ACTIVE', 'TERMINATED'],
  INVITED: ['INVITED', 'ACTIVATION_PENDING', 'ACTIVE', 'TERMINATED'],
  ACTIVATION_PENDING: ['ACTIVE', 'SUSPENDED', 'TERMINATED'],
  ACTIVE: ['SUSPENDED', 'TERMINATED'],
  SUSPENDED: ['ACTIVE', 'ACTIVATION_PENDING', 'TERMINATED'],
  TERMINATED: [],
}

export function puedeTransicionarAcceso(de: SupplyV2SupplierAccessStatus, a: SupplyV2SupplierAccessStatus): boolean {
  return TRANSICIONES_ACCESO[de].includes(a)
}

export const ACCESS_STATUS_LABELS: Record<SupplyV2SupplierAccessStatus, string> = {
  DRAFT: 'Sin acceso',
  INVITED: 'Invitado',
  ACTIVATION_PENDING: 'Activación pendiente',
  ACTIVE: 'Operativo',
  SUSPENDED: 'Acceso suspendido',
  TERMINATED: 'Acceso dado de baja',
}

// ── Lista de preparación (§8) ────────────────────────────────────────────────

export interface HechosDePreparacion {
  /** Hay al menos una cuenta de administrador pleno en la empresa del proveedor. */
  usuarioActivo: boolean
  /** Hay al menos una sucursal activa. */
  sucursalConfigurada: boolean
  /** Hay al menos una persona que puede escanear (el dueño cuenta). */
  operadorConfigurado: boolean
  contratoAceptado: boolean
  qrProbado: boolean
}

export type PasoDePreparacion = keyof HechosDePreparacion

export const PASOS_DE_PREPARACION: readonly PasoDePreparacion[] = [
  'usuarioActivo',
  'sucursalConfigurada',
  'operadorConfigurado',
  'contratoAceptado',
  'qrProbado',
]

export const PASO_LABELS: Record<PasoDePreparacion, string> = {
  usuarioActivo: 'Cuenta del dueño activada',
  sucursalConfigurada: 'Sucursal de canje configurada',
  operadorConfigurado: 'Operador que escanea configurado',
  contratoAceptado: 'Contrato de proveedor aceptado',
  qrProbado: 'Escáner probado con un QR de prueba',
}

export interface Preparacion {
  pasos: { paso: PasoDePreparacion; label: string; hecho: boolean }[]
  completos: number
  total: number
  lista: boolean
  pendientes: PasoDePreparacion[]
}

export function evaluarPreparacion(h: HechosDePreparacion): Preparacion {
  const pasos = PASOS_DE_PREPARACION.map((paso) => ({ paso, label: PASO_LABELS[paso], hecho: h[paso] }))
  const pendientes = pasos.filter((p) => !p.hecho).map((p) => p.paso)
  return { pasos, completos: pasos.length - pendientes.length, total: pasos.length, lista: pendientes.length === 0, pendientes }
}

/**
 * ¿Puede este proveedor recibir acuerdos NUEVOS y ofertas NUEVAS? (§8, §61)
 *
 *   · ACTIVE: sí.
 *   · DRAFT (nunca invitado): sí, salvo en modo estricto. Es la compatibilidad
 *     con los proveedores anteriores a esta fase; el panel avisa.
 *   · INVITED / ACTIVATION_PENDING / SUSPENDED / TERMINATED: no — una vez que
 *     el proveedor entra en el ciclo de acceso, tiene que completarlo.
 *   · La dispensa con motivo siempre pasa.
 */
export function motivoNoOperativo(
  p: { accessStatus: SupplyV2SupplierAccessStatus; readinessWaivedAt: Date | null; status: SupplyV2SupplierStatus },
  estricto = false
): string | null {
  if (p.status !== 'ACTIVE') return `El proveedor está ${SUPPLIER_STATUS_TEXTO[p.status]} comercialmente.`
  if (p.readinessWaivedAt) return null
  switch (p.accessStatus) {
    case 'ACTIVE':
      return null
    case 'DRAFT':
      return estricto ? 'El proveedor no tiene acceso operativo: invítalo y espera a que complete su activación.' : null
    case 'INVITED':
      return 'El proveedor fue invitado pero todavía no activó su cuenta.'
    case 'ACTIVATION_PENDING':
      return 'El proveedor no completó su lista de preparación (sucursal, operador, contrato y prueba de QR).'
    case 'SUSPENDED':
      return 'El acceso operativo del proveedor está suspendido.'
    case 'TERMINATED':
      return 'El acceso operativo del proveedor fue dado de baja.'
  }
}

const SUPPLIER_STATUS_TEXTO: Record<SupplyV2SupplierStatus, string> = { ACTIVE: 'activo', INACTIVE: 'inactivo', BLOCKED: 'bloqueado' }

// ── Clasificación del relevamiento (§61) ─────────────────────────────────────

export type ClaseDeProveedor = 'ACTIVE_WITH_ACCESS' | 'ACTIVE_WITHOUT_ACCESS' | 'LEGACY' | 'INACTIVE'

export const CLASE_LABELS: Record<ClaseDeProveedor, string> = {
  ACTIVE_WITH_ACCESS: 'Activo con acceso',
  ACTIVE_WITHOUT_ACCESS: 'Activo sin acceso (invitar)',
  LEGACY: 'Histórico (acceso con dispensa)',
  INACTIVE: 'Inactivo',
}

export function clasificarProveedor(p: {
  status: SupplyV2SupplierStatus
  accessStatus: SupplyV2SupplierAccessStatus
  readinessWaivedAt: Date | null
  fulfillmentReadyAt: Date | null
}): ClaseDeProveedor {
  if (p.status !== 'ACTIVE') return 'INACTIVE'
  if (p.accessStatus === 'ACTIVE') return p.fulfillmentReadyAt ? 'ACTIVE_WITH_ACCESS' : p.readinessWaivedAt ? 'LEGACY' : 'ACTIVE_WITH_ACCESS'
  return 'ACTIVE_WITHOUT_ACCESS'
}

// ── Tipo de organización (§4): derivado de las capacidades, sin enum nuevo ───

export type TipoDeOrganizacion = 'SUPPLIER_ONLY' | 'MERCHANT_ONLY' | 'MERCHANT_SUPPLIER' | 'NONE'

export const CAPACIDADES_DE_COMERCIO_MERCHANT: readonly Capacidad[] = ['CATALOGO_UNIFICADO', 'PEDIDOS_MEMBEGO', 'DEALS_MARKETPLACE']

export function tipoDeOrganizacion(capacidadesActivas: readonly string[], esProveedor: boolean): TipoDeOrganizacion {
  const merchant = CAPACIDADES_DE_COMERCIO_MERCHANT.some((c) => capacidadesActivas.includes(c))
  const supplier = esProveedor && capacidadesActivas.includes('MEMBEGO_SUPPLIER')
  if (merchant && supplier) return 'MERCHANT_SUPPLIER'
  if (supplier) return 'SUPPLIER_ONLY'
  if (merchant) return 'MERCHANT_ONLY'
  return 'NONE'
}

/**
 * Overrides de capacidades con los que nace una empresa SUPPLIER LITE: solo
 * lo que necesita para operar sus obligaciones. Nada del Business OS
 * comercial. Se encienden luego, UNA a una, al aprobar su solicitud de
 * Merchant —sobre la misma empresa—.
 */
export const OVERRIDES_SUPPLIER_LITE: Partial<Record<Capacidad, boolean>> = {
  MEMBEGO_SUPPLIER: true,
  MEMBEGO_SUPPLY_FULFILLMENT: true,
  CATALOGO_UNIFICADO: false,
  PEDIDOS_MEMBEGO: false,
  DEALS_MARKETPLACE: false,
  POS_MEMBEGO: false,
  CITAS: false,
  SEGUIMIENTO: false,
  GIFT_CARDS: false,
  POS_CAJA: false,
  PAGO_TRANSFERENCIA: false,
  CRM: false,
  MENSAJERIA: false,
  PUBLICACIONES: false,
  RULETA: false,
  CITA_ANTES_DEL_QR: false,
  EXCURSIONES: false,
}

// ── Roles del proveedor (§7): presets sobre el RBAC existente ────────────────

export type RolDeProveedor = 'SUPPLIER_OWNER' | 'SUPPLIER_OPERATOR' | 'SUPPLIER_FINANCE' | 'SUPPLIER_VIEWER'

export const ROLES_DE_PROVEEDOR: readonly RolDeProveedor[] = ['SUPPLIER_OWNER', 'SUPPLIER_OPERATOR', 'SUPPLIER_FINANCE', 'SUPPLIER_VIEWER']

/** Funciones de la sección `supply` (catálogo en `src/lib/auth/funciones.ts`). */
export const FUNCIONES_SUPPLY = ['escanear', 'ventas_adicionales', 'inventario', 'liquidaciones', 'personal', 'configuracion', 'solicitud_merchant'] as const
export type FuncionSupply = (typeof FUNCIONES_SUPPLY)[number]

export interface PresetDeRolProveedor {
  rol: RolDeProveedor
  label: string
  descripcion: string
  /** Rol de plataforma que recibe la cuenta. */
  appRole: AppRole
  /** Funciones de `supply` que se le NIEGAN (todo lo demás, permitido). */
  negadas: readonly FuncionSupply[]
}

export const PRESETS_ROL_PROVEEDOR: Record<RolDeProveedor, PresetDeRolProveedor> = {
  SUPPLIER_OWNER: {
    rol: 'SUPPLIER_OWNER',
    label: 'Dueño',
    descripcion: 'Ve y hace todo lo relativo a su organización como proveedor: contratos, canjes, extras, liquidaciones, personal y la solicitud para vender en Membego.',
    appRole: 'ADMINISTRADOR',
    negadas: [],
  },
  SUPPLIER_OPERATOR: {
    rol: 'SUPPLIER_OPERATOR',
    label: 'Operador',
    descripcion: 'Escanea QR, entrega, registra ventas adicionales y consulta la operación. No ve liquidaciones ni administra personal.',
    appRole: 'CAJERO',
    negadas: ['liquidaciones', 'personal', 'configuracion', 'solicitud_merchant'],
  },
  SUPPLIER_FINANCE: {
    rol: 'SUPPLIER_FINANCE',
    label: 'Finanzas',
    descripcion: 'Consulta liquidaciones, obligaciones y el inventario Membego. No escanea ni registra ventas.',
    appRole: 'GERENTE',
    negadas: ['escanear', 'ventas_adicionales', 'personal', 'configuracion', 'solicitud_merchant'],
  },
  SUPPLIER_VIEWER: {
    rol: 'SUPPLIER_VIEWER',
    label: 'Solo lectura',
    descripcion: 'Ve la operación y las cifras sin poder cambiar nada.',
    appRole: 'SUPERVISOR',
    negadas: ['escanear', 'ventas_adicionales', 'personal', 'configuracion', 'solicitud_merchant'],
  },
}

/**
 * Permisos (formato `User.permisos`) que materializan un preset: se CONCEDE la
 * sección `supply` (los roles acotados no la traen) y se NIEGAN las funciones
 * del preset. El dueño no necesita ajustes: ADMINISTRADOR lo trae todo.
 */
export function permisosDePreset(rol: RolDeProveedor): PermisosUsuario | null {
  const preset = PRESETS_ROL_PROVEEDOR[rol]
  if (preset.negadas.length === 0 && preset.appRole === 'ADMINISTRADOR') return null
  const funciones: Record<string, false> = {}
  for (const f of preset.negadas) funciones[f] = false
  return {
    v: 1,
    secciones: { supply: true },
    ...(preset.negadas.length > 0 ? { funciones: { supply: funciones } } : {}),
  }
}

export function esRolDeProveedor(v: unknown): v is RolDeProveedor {
  return typeof v === 'string' && (ROLES_DE_PROVEEDOR as readonly string[]).includes(v)
}

// ── Código de prueba del escáner (§8 «QR probado») ───────────────────────────

export const PREFIJO_CODIGO_PRUEBA = 'TEST-'

export function esCodigoDePrueba(codigo: string): boolean {
  return codigo.toUpperCase().startsWith(PREFIJO_CODIGO_PRUEBA)
}

// ── Motivo de dispensa ───────────────────────────────────────────────────────

export function validarMotivoDispensa(motivo: string | null | undefined): string | null {
  const m = motivo?.trim() ?? ''
  if (m.length < 8) return 'Escribe el motivo de la dispensa (al menos 8 caracteres).'
  if (m.length > 500) return 'El motivo es demasiado largo.'
  return null
}
