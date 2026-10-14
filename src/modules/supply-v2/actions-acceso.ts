'use server'

import { revalidatePath } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { mandarCorreoDeInvitacion } from './suppliers/correo-invitacion'
import { exigirPermisoSupplyV2, exigirProveedorSupplyV2, FUNCION_PORTAL } from './permisos'
import { comoError, contextoDeAuditoria, refrescarSupplyV2, texto, type EstadoAccion } from './actions-util'
import { RUTA_PORTAL_PROVEEDOR } from './core/catalogo'
import {
  aceptarContratoDeProveedorEnTx,
  codigoDePruebaEnTx,
  darDeBajaAccesoEnTx,
  dispensarPreparacionEnTx,
  invitarDuenoDeProveedorEnTx,
  invitarPersonalDeProveedorEnTx,
  reactivarAccesoEnTx,
  reevaluarPreparacionEnTx,
  suspenderAccesoEnTx,
  type InvitacionDePersonal,
  type InvitacionDeProveedor,
} from './suppliers/acceso'
import { PRESETS_ROL_PROVEEDOR, esRolDeProveedor, type Preparacion } from './suppliers/acceso-dominio'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 1 · server actions del acceso.
 *
 * Superadmin: invitar al dueño, suspender, reactivar, dar de baja, dispensar.
 * Proveedor (portal): aceptar el contrato, pedir un código de prueba, invitar
 * a su personal. Cada action: GUARDIA → REGLA (en el módulo) → BITÁCORA
 * (misma transacción) → correo FUERA de la transacción.
 */

function refrescarProveedor(supplierId: string): void {
  refrescarSupplyV2('proveedores', `proveedores/${supplierId}`)
  revalidatePath(RUTA_PORTAL_PROVEEDOR)
  revalidatePath(`${RUTA_PORTAL_PROVEEDOR}/configuracion`)
  revalidatePath(`${RUTA_PORTAL_PROVEEDOR}/personal`)
}

// ── Superadmin ───────────────────────────────────────────────────────────────

export async function invitarDuenoDeProveedorAction(_prev: EstadoAccion<InvitacionDeProveedor>, fd: FormData): Promise<EstadoAccion<InvitacionDeProveedor>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const supplierId = texto(fd, 'supplierId', 60)
    const email = texto(fd, 'email', 160)
    if (!email) return { error: 'Escribe el correo del dueño del proveedor.' }
    const inv = await sinEmpresa('Supply: invitar al dueño del proveedor a su portal', (tx) => invitarDuenoDeProveedorEnTx(tx, { supplierId, email }, ctx))
    await mandarCorreoDeInvitacion({ email: inv.email, companyName: inv.companyName, token: inv.token, dueno: true })
    refrescarProveedor(supplierId)
    return { success: inv.reenviada ? `Invitación reenviada a ${inv.email}.` : `Invitación enviada a ${inv.email}.${inv.empresaCreada ? ' Se creó su empresa Supplier Lite (sin vitrina).' : ''}`, id: inv.supplierId, data: inv }
  } catch (e) {
    return comoError(e, 'invitarDuenoDeProveedor')
  }
}

export async function suspenderAccesoProveedorAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const supplierId = texto(fd, 'supplierId', 60)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe el motivo de la suspensión.' }
    await sinEmpresa('Supply: suspender el acceso de un proveedor', (tx) => suspenderAccesoEnTx(tx, { supplierId, motivo }, ctx))
    refrescarProveedor(supplierId)
    return { success: 'Acceso suspendido: el proveedor no puede entrar a su portal hasta reactivarlo.', id: supplierId }
  } catch (e) {
    return comoError(e, 'suspenderAccesoProveedor')
  }
}

export async function reactivarAccesoProveedorAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const supplierId = texto(fd, 'supplierId', 60)
    await sinEmpresa('Supply: reactivar el acceso de un proveedor', (tx) => reactivarAccesoEnTx(tx, { supplierId, motivo: texto(fd, 'motivo', 500) || null }, ctx))
    refrescarProveedor(supplierId)
    return { success: 'Acceso reactivado.', id: supplierId }
  } catch (e) {
    return comoError(e, 'reactivarAccesoProveedor')
  }
}

export async function darDeBajaAccesoProveedorAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const supplierId = texto(fd, 'supplierId', 60)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe el motivo de la baja.' }
    await sinEmpresa('Supply: dar de baja el acceso de un proveedor', (tx) => darDeBajaAccesoEnTx(tx, { supplierId, motivo }, ctx))
    refrescarProveedor(supplierId)
    return { success: 'Acceso dado de baja. Sus acuerdos y su historial se conservan.', id: supplierId }
  } catch (e) {
    return comoError(e, 'darDeBajaAccesoProveedor')
  }
}

export async function dispensarPreparacionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const supplierId = texto(fd, 'supplierId', 60)
    await sinEmpresa('Supply: dispensar la lista de preparación de un proveedor', (tx) => dispensarPreparacionEnTx(tx, { supplierId, motivo: texto(fd, 'motivo', 500) }, ctx))
    refrescarProveedor(supplierId)
    return { success: 'Preparación dispensada: el proveedor puede recibir acuerdos y ofertas nuevos.', id: supplierId }
  } catch (e) {
    return comoError(e, 'dispensarPreparacion')
  }
}

// ── Portal del proveedor ─────────────────────────────────────────────────────

export async function aceptarContratoProveedorAction(_prev: EstadoAccion<Preparacion>, _fd: FormData): Promise<EstadoAccion<Preparacion>> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.configuracion)
    const ctx = await contextoDeAuditoria(p)
    const r = await sinEmpresa('Supply: el dueño del proveedor acepta el contrato', async (tx) => {
      const a = await aceptarContratoDeProveedorEnTx(tx, { supplierId: p.supplierId, userId: p.id }, ctx)
      return { ...a, preparacion: await reevaluarPreparacionEnTx(tx, p.supplierId, ctx) }
    })
    refrescarProveedor(p.supplierId)
    return { success: r.yaAceptado ? 'El contrato ya estaba aceptado.' : 'Contrato aceptado.', data: r.preparacion }
  } catch (e) {
    return comoError(e, 'aceptarContratoProveedor')
  }
}

export async function generarCodigoDePruebaAction(_prev: EstadoAccion<{ codigo: string }>, _fd: FormData): Promise<EstadoAccion<{ codigo: string }>> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.configuracion)
    const codigo = await sinEmpresa('Supply: código de prueba del escáner del proveedor', (tx) => codigoDePruebaEnTx(tx, p.supplierId))
    refrescarProveedor(p.supplierId)
    return { success: 'Código de prueba listo: escanéalo o escríbelo en el escáner.', data: { codigo } }
  } catch (e) {
    return comoError(e, 'generarCodigoDePrueba')
  }
}

export async function invitarPersonalProveedorAction(_prev: EstadoAccion<InvitacionDePersonal>, fd: FormData): Promise<EstadoAccion<InvitacionDePersonal>> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.personal)
    const ctx = await contextoDeAuditoria(p)
    const email = texto(fd, 'email', 160)
    const rol = texto(fd, 'rol', 40)
    if (!email) return { error: 'Escribe el correo de la persona.' }
    if (!esRolDeProveedor(rol)) return { error: 'Elige el rol dentro del proveedor.' }
    if (rol === 'SUPPLIER_OWNER' && !['ADMINISTRADOR', 'ADMIN_EMPRESA', 'SUPERADMIN'].includes(p.user.metadata.role)) {
      return { error: 'Solo el dueño puede invitar a otro dueño.' }
    }
    const inv = await sinEmpresa('Supply: el proveedor invita a su personal', (tx) =>
      invitarPersonalDeProveedorEnTx(tx, { supplierId: p.supplierId, companyId: p.companyId, email, rol }, ctx)
    )
    await mandarCorreoDeInvitacion({ email: inv.email, companyName: inv.companyName, token: inv.token, dueno: false })
    refrescarProveedor(p.supplierId)
    revalidatePath('/admin/empleados')
    return { success: `${inv.reenviada ? 'Invitación reenviada' : 'Invitación enviada'} a ${inv.email} como ${PRESETS_ROL_PROVEEDOR[rol].label.toLowerCase()}.`, data: inv }
  } catch (e) {
    return comoError(e, 'invitarPersonalProveedor')
  }
}
