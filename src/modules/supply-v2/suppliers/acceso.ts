import { randomBytes } from 'node:crypto'
import type { Prisma, SupplyV2SupplierAccessStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { FULL_ADMIN_ROLES, type AppRole } from '@/types'
import { funcionPermitida, resolverPermisosUsuario, seccionPermitida } from '@/lib/auth/permissions'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { preparacionEstricta } from '../core/config'
import {
  OVERRIDES_SUPPLIER_LITE,
  PREFIJO_CODIGO_PRUEBA,
  PRESETS_ROL_PROVEEDOR,
  clasificarProveedor,
  esCodigoDePrueba,
  evaluarPreparacion,
  motivoNoOperativo,
  permisosDePreset,
  puedeTransicionarAcceso,
  validarMotivoDispensa,
  type ClaseDeProveedor,
  type HechosDePreparacion,
  type Preparacion,
  type RolDeProveedor,
} from './acceso-dominio'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 1 · acceso operativo del proveedor.
 *
 * Todo dentro de la `tx` de quien llama. Reglas en `acceso-dominio.ts`.
 *
 * LA REGLA DE ORO (§2): NUNCA una segunda `Company`. Si el proveedor ya tiene
 * empresa (REGISTERED_COMPANY), se reutiliza; si es EXTERNAL, se le crea UNA
 * empresa Supplier Lite (sin vitrina, solo con la capacidad de proveedor) y
 * esa misma empresa será la que reciba las capacidades de Merchant cuando se
 * apruebe su solicitud. `organizationId`, usuarios, sucursales, acuerdos,
 * lotes y redenciones se conservan en todo el ciclo.
 */

const DIAS_VALIDEZ_INVITACION = 7
export const ORIGEN_INVITACION_PROVEEDOR = 'SUPPLIER_PORTAL'

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

async function slugUnicoEnTx(tx: Tx, nombre: string): Promise<string> {
  const base = slugify(nombre) || 'proveedor'
  let slug = base
  let n = 1
  while (await tx.company.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

const SELECT_ACCESO = {
  id: true,
  commercialName: true,
  legalName: true,
  email: true,
  phone: true,
  whatsapp: true,
  address: true,
  city: true,
  countryCode: true,
  currency: true,
  companyId: true,
  source: true,
  status: true,
  accessStatus: true,
  invitedEmail: true,
  invitedAt: true,
  termsAcceptedAt: true,
  qrTestCode: true,
  qrTestedAt: true,
  fulfillmentReadyAt: true,
  readinessWaivedAt: true,
  readinessWaivedReason: true,
  activatedAt: true,
  accessStatusReason: true,
} as const

async function proveedorBloqueado(tx: Tx, supplierId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_suppliers" WHERE "id" = ${supplierId} FOR UPDATE`
  const p = await tx.supplyV2Supplier.findUnique({ where: { id: supplierId }, select: SELECT_ACCESO })
  if (!p) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  return p
}

async function cambiarAccesoEnTx(
  tx: Tx,
  p: { id: string; companyId: string | null; accessStatus: SupplyV2SupplierAccessStatus },
  a: SupplyV2SupplierAccessStatus,
  ctx: ContextoAuditoria,
  extra: Record<string, unknown> & { accessStatusReason?: string | null; activatedAt?: Date } = {}
): Promise<void> {
  if (p.accessStatus === a && a !== 'INVITED') return
  if (!puedeTransicionarAcceso(p.accessStatus, a)) {
    fallo('TRANSICION_ACCESO_INVALIDA', `El acceso del proveedor no puede pasar de ${p.accessStatus} a ${a}.`)
  }
  const { accessStatusReason, activatedAt, ...payload } = extra
  await tx.supplyV2Supplier.update({
    where: { id: p.id },
    data: {
      accessStatus: a,
      ...(accessStatusReason !== undefined ? { accessStatusReason } : {}),
      ...(activatedAt ? { activatedAt } : {}),
    },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SUPPLIER_ACCESS_CHANGED', 'SupplyV2Supplier', p.id, { antes: p.accessStatus, despues: a, ...payload }, p.companyId)
}

// ── Empresa Supplier Lite (§1, §2) ───────────────────────────────────────────

/**
 * Garantiza que el proveedor tenga UNA empresa. Si ya la tiene, la devuelve;
 * si no, crea una Supplier Lite: sin vitrina (`isPublished=false`), con solo
 * la capacidad de proveedor encendida y una sucursal principal con los datos
 * que Membego ya conoce (no se piden otra vez, §43).
 */
export async function asegurarEmpresaSupplierLiteEnTx(tx: Tx, supplierId: string, ctx: ContextoAuditoria): Promise<{ companyId: string; creada: boolean }> {
  const p = await proveedorBloqueado(tx, supplierId)
  if (p.companyId) return { companyId: p.companyId, creada: false }

  const slug = await slugUnicoEnTx(tx, p.commercialName)
  const company = await tx.company.create({
    data: {
      name: p.commercialName,
      slug,
      type: 'proveedor',
      razonSocial: p.legalName,
      email: p.email,
      telefono: p.phone,
      whatsapp: p.whatsapp,
      direccion: p.address,
      ciudad: p.city,
      pais: p.countryCode,
      moneda: p.currency,
      isActive: true,
      // SIN VITRINA: un Supplier Lite no es una empresa del Marketplace (§15, §49).
      isPublished: false,
      capacidades: { overrides: OVERRIDES_SUPPLIER_LITE },
    },
    select: { id: true },
  })
  await tx.sucursal.create({
    data: {
      companyId: company.id,
      nombre: 'Principal',
      direccion: [p.address, p.city].filter(Boolean).join(', ') || null,
      telefono: p.phone,
    },
  })
  await tx.supplyV2Supplier.update({ where: { id: p.id }, data: { companyId: company.id } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SUPPLIER_INVITED', 'SupplyV2Supplier', p.id, { paso: 'empresa_supplier_lite_creada', companyId: company.id, slug }, company.id)
  return { companyId: company.id, creada: true }
}

/**
 * Una empresa que YA existe (Merchant) y pasa a ser también proveedora recibe
 * la capacidad MEMBEGO_SUPPLIER sobre sus overrides, sin tocar las demás:
 * `MERCHANT + MEMBEGO_SUPPLIER` en la misma organización (§2).
 */
export async function encenderCapacidadProveedorEnTx(tx: Tx, companyId: string): Promise<boolean> {
  const c = await tx.company.findUnique({ where: { id: companyId }, select: { capacidades: true } })
  if (!c) fallo('EMPRESA_NO_ENCONTRADA', 'La empresa no existe en Membego.')
  const raw = (c.capacidades && typeof c.capacidades === 'object' && !Array.isArray(c.capacidades) ? c.capacidades : {}) as Record<string, unknown>
  const overrides = (raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) ? raw.overrides : {}) as Record<string, boolean>
  if (overrides.MEMBEGO_SUPPLIER === true) return false
  await tx.company.update({
    where: { id: companyId },
    data: { capacidades: { ...raw, overrides: { ...overrides, MEMBEGO_SUPPLIER: true, MEMBEGO_SUPPLY_FULFILLMENT: true } } },
  })
  return true
}

// ── Invitación del dueño (§8: invitado) ──────────────────────────────────────

export interface InvitacionDeProveedor {
  supplierId: string
  companyId: string
  companyName: string
  email: string
  token: string
  expiraEn: Date
  reenviada: boolean
  empresaCreada: boolean
}

/**
 * El superadmin invita al DUEÑO del proveedor a su portal. Crea (o reutiliza)
 * la empresa, enciende la capacidad de proveedor, deja la invitación de
 * equipo con rol ADMINISTRADOR (reutiliza `Invitacion` y `aceptarInvitacion`)
 * y marca el acceso como INVITED. El correo lo manda quien llama, FUERA de la
 * transacción: si esto se deshace, no sale ningún correo.
 */
export async function invitarDuenoDeProveedorEnTx(
  tx: Tx,
  d: { supplierId: string; email: string },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<InvitacionDeProveedor> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Invitar a un proveedor necesita quién lo invita.')
  const email = d.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fallo('CORREO_INVALIDO', 'El correo del dueño no es válido.')

  const p = await proveedorBloqueado(tx, d.supplierId)
  if (p.status !== 'ACTIVE') fallo('PROVEEDOR_INACTIVO', 'Solo se invita a un proveedor comercialmente activo.')
  if (p.accessStatus === 'TERMINATED') fallo('ACCESO_DADO_DE_BAJA', 'El acceso de este proveedor fue dado de baja; reactívalo antes de invitar.')
  if (p.accessStatus === 'ACTIVE' || p.accessStatus === 'ACTIVATION_PENDING' || p.accessStatus === 'SUSPENDED') {
    fallo('YA_TIENE_ACCESO', 'Este proveedor ya activó su cuenta: invita a su personal desde el portal.')
  }

  const { companyId, creada } = await asegurarEmpresaSupplierLiteEnTx(tx, p.id, ctx)
  await encenderCapacidadProveedorEnTx(tx, companyId)
  const empresa = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } })

  const existente = await tx.user.findUnique({ where: { email }, select: { id: true, companyId: true, role: true } })
  if (existente) {
    if (existente.companyId === companyId) fallo('YA_ES_MIEMBRO', 'Esa persona ya pertenece a la empresa del proveedor.')
    fallo('CORREO_CON_CUENTA', 'Ese correo ya tiene una cuenta en Membego en otra empresa. Dale acceso con «Cuenta existente» desde Empresas, o usa otro correo.')
  }

  const expiraEn = new Date(ahora.getTime() + DIAS_VALIDEZ_INVITACION * 86_400_000)
  const pendiente = await tx.invitacion.findFirst({ where: { companyId, email, estado: 'PENDIENTE' }, select: { id: true } })
  const inv = pendiente
    ? await tx.invitacion.update({ where: { id: pendiente.id }, data: { rol: 'ADMINISTRADOR', expiraEn, origen: ORIGEN_INVITACION_PROVEEDOR, permisos: undefined }, select: { token: true } })
    : await tx.invitacion.create({
        data: { companyId, email, rol: 'ADMINISTRADOR', expiraEn, invitadoPor: ctx.actorId, origen: ORIGEN_INVITACION_PROVEEDOR },
        select: { token: true },
      })

  await tx.supplyV2Supplier.update({ where: { id: p.id }, data: { invitedEmail: email, invitedAt: ahora } })
  await cambiarAccesoEnTx(tx, { ...p, companyId }, 'INVITED', ctx, { email, reenviada: Boolean(pendiente) })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SUPPLIER_INVITED', 'SupplyV2Supplier', p.id, { email, companyId, reenviada: Boolean(pendiente), empresaCreada: creada }, companyId)

  return { supplierId: p.id, companyId, companyName: empresa.name, email, token: inv.token, expiraEn, reenviada: Boolean(pendiente), empresaCreada: creada }
}

/**
 * Gancho de `aceptarInvitacion`: cuando se acepta una invitación de origen
 * SUPPLIER_PORTAL, el proveedor pasa de INVITED a ACTIVATION_PENDING (ya hay
 * una persona dentro) y se reevalúa la lista de preparación. Idempotente.
 */
export async function alAceptarInvitacionDeProveedorEnTx(tx: Tx, companyId: string, ctx: ContextoAuditoria): Promise<void> {
  const p = await tx.supplyV2Supplier.findUnique({ where: { companyId }, select: { id: true, accessStatus: true, companyId: true } })
  if (!p) return
  if (p.accessStatus === 'INVITED') await cambiarAccesoEnTx(tx, p, 'ACTIVATION_PENDING', ctx, { motivo: 'invitación aceptada' })
  await reevaluarPreparacionEnTx(tx, p.id, ctx)
}

// ── Lista de preparación (§8) ────────────────────────────────────────────────

function puedeEscanear(role: AppRole, permisosRaw: unknown): boolean {
  const permisos = resolverPermisosUsuario(permisosRaw)
  return seccionPermitida(role, 'supply', permisos) && funcionPermitida(role, 'supply', 'escanear', permisos)
}

export async function hechosDePreparacionEnTx(tx: Tx, supplierId: string): Promise<HechosDePreparacion> {
  const p = await tx.supplyV2Supplier.findUnique({ where: { id: supplierId }, select: { companyId: true, termsAcceptedAt: true, qrTestedAt: true } })
  if (!p) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  if (!p.companyId) {
    return { usuarioActivo: false, sucursalConfigurada: false, operadorConfigurado: false, contratoAceptado: Boolean(p.termsAcceptedAt), qrProbado: Boolean(p.qrTestedAt) }
  }
  const [usuarios, sucursales] = await Promise.all([
    tx.user.findMany({ where: { companyId: p.companyId, role: { not: 'CLIENTE' } }, select: { role: true, permisos: true } }),
    tx.sucursal.count({ where: { companyId: p.companyId, activa: true } }),
  ])
  return {
    usuarioActivo: usuarios.some((u) => FULL_ADMIN_ROLES.includes(u.role)),
    sucursalConfigurada: sucursales > 0,
    operadorConfigurado: usuarios.some((u) => puedeEscanear(u.role, u.permisos)),
    contratoAceptado: Boolean(p.termsAcceptedAt),
    qrProbado: Boolean(p.qrTestedAt),
  }
}

export async function preparacionDelProveedorEnTx(tx: Tx, supplierId: string): Promise<Preparacion> {
  return evaluarPreparacion(await hechosDePreparacionEnTx(tx, supplierId))
}

/**
 * Si la lista está completa y el acceso está pendiente, el proveedor queda
 * OPERATIVO (`fulfillmentReadyAt`, ACTIVE). Idempotente; nunca degrada solo
 * —suspender es una decisión del superadmin—.
 */
export async function reevaluarPreparacionEnTx(tx: Tx, supplierId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<Preparacion> {
  const p = await proveedorBloqueado(tx, supplierId)
  const prep = await preparacionDelProveedorEnTx(tx, supplierId)
  if (!prep.lista) return prep
  if (!p.fulfillmentReadyAt) {
    await tx.supplyV2Supplier.update({ where: { id: p.id }, data: { fulfillmentReadyAt: ahora } })
  }
  if (p.accessStatus === 'ACTIVATION_PENDING' || p.accessStatus === 'INVITED') {
    await cambiarAccesoEnTx(tx, p, 'ACTIVE', ctx, { motivo: 'lista de preparación completa', activatedAt: p.activatedAt ?? ahora })
  }
  return prep
}

export async function aceptarContratoDeProveedorEnTx(tx: Tx, d: { supplierId: string; userId: string }, ctx: ContextoAuditoria, ahora = new Date()): Promise<{ yaAceptado: boolean }> {
  const p = await proveedorBloqueado(tx, d.supplierId)
  if (p.termsAcceptedAt) return { yaAceptado: true }
  await tx.supplyV2Supplier.update({ where: { id: p.id }, data: { termsAcceptedAt: ahora, termsAcceptedById: d.userId } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SUPPLIER_TERMS_ACCEPTED', 'SupplyV2Supplier', p.id, { userId: d.userId }, p.companyId)
  await reevaluarPreparacionEnTx(tx, p.id, ctx, ahora)
  return { yaAceptado: false }
}

/** Genera (o devuelve) el código de prueba del escáner. Vale hasta que se use. */
export async function codigoDePruebaEnTx(tx: Tx, supplierId: string): Promise<string> {
  const p = await proveedorBloqueado(tx, supplierId)
  if (p.qrTestCode) return p.qrTestCode
  const code = `${PREFIJO_CODIGO_PRUEBA}${randomBytes(6).toString('hex').toUpperCase()}`
  await tx.supplyV2Supplier.update({ where: { id: p.id }, data: { qrTestCode: code } })
  return code
}

/**
 * El escáner leyó un código `TEST-…`: si es el vigente del proveedor, la
 * prueba queda hecha (y el código se consume). Devuelve null si el código no
 * es de prueba (quien llama sigue con el flujo normal).
 */
export async function registrarPruebaDeEscanerEnTx(
  tx: Tx,
  d: { supplierId: string; userId: string; codigo: string },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<{ ok: boolean; mensaje: string } | null> {
  if (!esCodigoDePrueba(d.codigo)) return null
  const p = await proveedorBloqueado(tx, d.supplierId)
  const leido = d.codigo.trim().toUpperCase()
  if (!p.qrTestCode || p.qrTestCode !== leido) {
    return { ok: false, mensaje: p.qrTestedAt ? 'La prueba del escáner ya se hizo; este código ya no vale.' : 'Ese código de prueba no es el vigente. Genera uno nuevo desde Configuración.' }
  }
  await tx.supplyV2Supplier.update({ where: { id: p.id }, data: { qrTestedAt: ahora, qrTestCode: null } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SUPPLIER_QR_TESTED', 'SupplyV2Supplier', p.id, { userId: d.userId }, p.companyId)
  await reevaluarPreparacionEnTx(tx, p.id, ctx, ahora)
  return { ok: true, mensaje: 'Prueba del escáner completada.' }
}

// ── Superadmin: suspender, reactivar, dar de baja, dispensar ─────────────────

export async function suspenderAccesoEnTx(tx: Tx, d: { supplierId: string; motivo: string }, ctx: ContextoAuditoria): Promise<void> {
  const motivo = d.motivo.trim()
  if (!motivo) fallo('MOTIVO_OBLIGATORIO', 'Suspender el acceso exige un motivo.')
  const p = await proveedorBloqueado(tx, d.supplierId)
  await cambiarAccesoEnTx(tx, p, 'SUSPENDED', ctx, { motivo, accessStatusReason: motivo })
}

export async function reactivarAccesoEnTx(tx: Tx, d: { supplierId: string; motivo?: string | null }, ctx: ContextoAuditoria, ahora = new Date()): Promise<void> {
  const p = await proveedorBloqueado(tx, d.supplierId)
  if (p.accessStatus !== 'SUSPENDED') fallo('NO_SUSPENDIDO', 'Solo se reactiva un acceso suspendido.')
  const listo = Boolean(p.fulfillmentReadyAt || p.readinessWaivedAt)
  await cambiarAccesoEnTx(tx, p, listo ? 'ACTIVE' : 'ACTIVATION_PENDING', ctx, { motivo: d.motivo?.trim() || 'reactivado', accessStatusReason: null, ...(listo ? { activatedAt: p.activatedAt ?? ahora } : {}) })
}

export async function darDeBajaAccesoEnTx(tx: Tx, d: { supplierId: string; motivo: string }, ctx: ContextoAuditoria): Promise<void> {
  const motivo = d.motivo.trim()
  if (!motivo) fallo('MOTIVO_OBLIGATORIO', 'Dar de baja el acceso exige un motivo.')
  const p = await proveedorBloqueado(tx, d.supplierId)
  await cambiarAccesoEnTx(tx, p, 'TERMINATED', ctx, { motivo, accessStatusReason: motivo })
  // Las invitaciones vivas dejan de valer: nadie entra a un acceso dado de baja.
  if (p.companyId) await tx.invitacion.updateMany({ where: { companyId: p.companyId, estado: 'PENDIENTE', origen: ORIGEN_INVITACION_PROVEEDOR }, data: { estado: 'CANCELADA' } })
}

/**
 * Dispensa de la lista de preparación (§61, migración): el proveedor opera
 * sin completarla. Siempre con motivo y siempre auditada. Si estaba
 * pendiente, pasa a ACTIVE.
 */
export async function dispensarPreparacionEnTx(tx: Tx, d: { supplierId: string; motivo: string }, ctx: ContextoAuditoria, ahora = new Date()): Promise<void> {
  const error = validarMotivoDispensa(d.motivo)
  if (error) fallo('MOTIVO_INVALIDO', error)
  const p = await proveedorBloqueado(tx, d.supplierId)
  if (p.accessStatus === 'TERMINATED') fallo('ACCESO_DADO_DE_BAJA', 'No se dispensa un acceso dado de baja.')
  await tx.supplyV2Supplier.update({ where: { id: p.id }, data: { readinessWaivedAt: ahora, readinessWaivedReason: d.motivo.trim() } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SUPPLIER_READINESS_WAIVED', 'SupplyV2Supplier', p.id, { motivo: d.motivo.trim(), accessStatus: p.accessStatus }, p.companyId)
  if (p.accessStatus === 'DRAFT' || p.accessStatus === 'INVITED' || p.accessStatus === 'ACTIVATION_PENDING') {
    await cambiarAccesoEnTx(tx, p, 'ACTIVE', ctx, { motivo: 'dispensa', activatedAt: p.activatedAt ?? ahora })
  }
}

// ── La barrera para acuerdos y ofertas nuevos (§8, §61) ──────────────────────

/**
 * Lanza si el proveedor no está en condiciones de recibir un acuerdo u oferta
 * NUEVOS. No toca nada existente: los acuerdos y lotes históricos siguen.
 */
export async function exigirProveedorOperativoEnTx(tx: Tx, supplierId: string, que: 'acuerdo' | 'oferta'): Promise<void> {
  const p = await tx.supplyV2Supplier.findUnique({ where: { id: supplierId }, select: { status: true, accessStatus: true, readinessWaivedAt: true, commercialName: true } })
  if (!p) fallo('PROVEEDOR_NO_ENCONTRADO', 'El proveedor no existe.')
  const motivo = motivoNoOperativo(p, preparacionEstricta())
  if (motivo) fallo('PROVEEDOR_NO_OPERATIVO', `No se puede ${que === 'acuerdo' ? 'activar un acuerdo' : 'publicar una oferta'} con ${p.commercialName}: ${motivo}`)
}

// ── Personal del proveedor (§7): invitar con un preset ───────────────────────

export interface InvitacionDePersonal {
  token: string
  email: string
  companyId: string
  companyName: string
  rol: RolDeProveedor
  expiraEn: Date
  reenviada: boolean
}

export async function invitarPersonalDeProveedorEnTx(
  tx: Tx,
  d: { supplierId: string; companyId: string; email: string; rol: RolDeProveedor },
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<InvitacionDePersonal> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Invitar necesita quién invita.')
  const email = d.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fallo('CORREO_INVALIDO', 'El correo no es válido.')
  const p = await tx.supplyV2Supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, companyId: true, accessStatus: true } })
  if (!p || p.companyId !== d.companyId) fallo('PROVEEDOR_AJENO', 'Ese proveedor no es el de tu empresa.')
  if (p.accessStatus === 'TERMINATED' || p.accessStatus === 'SUSPENDED') fallo('ACCESO_NO_OPERATIVO', 'El acceso de tu organización no está operativo.')

  const existente = await tx.user.findUnique({ where: { email }, select: { companyId: true } })
  if (existente?.companyId === d.companyId) fallo('YA_ES_MIEMBRO', 'Esa persona ya pertenece a tu equipo.')
  if (existente) fallo('CORREO_CON_CUENTA', 'Ese correo ya tiene una cuenta en Membego. Pídele que use otro correo o contáctanos.')

  const preset = PRESETS_ROL_PROVEEDOR[d.rol]
  const permisos = permisosDePreset(d.rol)
  const expiraEn = new Date(ahora.getTime() + DIAS_VALIDEZ_INVITACION * 86_400_000)
  const pendiente = await tx.invitacion.findFirst({ where: { companyId: d.companyId, email, estado: 'PENDIENTE' }, select: { id: true } })
  const data = { rol: preset.appRole, expiraEn, origen: ORIGEN_INVITACION_PROVEEDOR, permisos: permisos ? (permisos as unknown as Prisma.InputJsonValue) : undefined }
  const inv = pendiente
    ? await tx.invitacion.update({ where: { id: pendiente.id }, data, select: { token: true } })
    : await tx.invitacion.create({ data: { ...data, companyId: d.companyId, email, invitadoPor: ctx.actorId }, select: { token: true } })
  const empresa = await tx.company.findUniqueOrThrow({ where: { id: d.companyId }, select: { name: true } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_SUPPLIER_STAFF_INVITED', 'SupplyV2Supplier', p.id, { email, rol: d.rol, appRole: preset.appRole, reenviada: Boolean(pendiente) }, d.companyId)
  return { token: inv.token, email, companyId: d.companyId, companyName: empresa.name, rol: d.rol, expiraEn, reenviada: Boolean(pendiente) }
}

// ── Relevamiento (§61) ───────────────────────────────────────────────────────

export interface ProveedorRelevado {
  id: string
  commercialName: string
  companyId: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED'
  accessStatus: SupplyV2SupplierAccessStatus
  clase: ClaseDeProveedor
  invitedEmail: string | null
  acuerdosActivos: number
  lotesActivos: number
}

export async function relevarProveedoresEnTx(tx: Tx): Promise<ProveedorRelevado[]> {
  const filas = await tx.supplyV2Supplier.findMany({
    orderBy: { commercialName: 'asc' },
    select: {
      id: true,
      commercialName: true,
      companyId: true,
      status: true,
      accessStatus: true,
      readinessWaivedAt: true,
      fulfillmentReadyAt: true,
      invitedEmail: true,
      _count: { select: { agreements: { where: { status: 'ACTIVE' } }, lots: { where: { status: 'ACTIVE' } } } },
    },
  })
  return filas.map((f) => ({
    id: f.id,
    commercialName: f.commercialName,
    companyId: f.companyId,
    status: f.status,
    accessStatus: f.accessStatus,
    clase: clasificarProveedor(f),
    invitedEmail: f.invitedEmail,
    acuerdosActivos: f._count.agreements,
    lotesActivos: f._count.lots,
  }))
}
