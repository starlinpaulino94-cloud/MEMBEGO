'use server'

import { revalidatePath } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { exigirPermisoSupplyV2, exigirProveedorSupplyV2, FUNCION_PORTAL } from './permisos'
import { comoError, contextoDeAuditoria, refrescarSupplyV2, texto, type EstadoAccion } from './actions-util'
import { RUTA_PORTAL_PROVEEDOR, RUTA_PORTAL_SOLICITUD_MERCHANT, RUTA_SOLICITUDES_MERCHANT } from './core/catalogo'
import { validarDecision, validarSolicitud } from './suppliers/solicitud-merchant-dominio'
import { enviarSolicitudMerchantEnTx, retirarSolicitudMerchantEnTx, revisarSolicitudMerchantEnTx } from './suppliers/solicitud-merchant'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · server actions de la solicitud
 * Supplier → Merchant (§39–§41). El proveedor con la función
 * `solicitud_merchant`; Membego con permiso de plataforma sobre proveedores.
 */

function leerSucursales(fd: FormData): { nombre: string; direccion: string }[] {
  try {
    const crudo = JSON.parse(String(fd.get('sucursales') ?? '[]'))
    return Array.isArray(crudo) ? crudo : []
  } catch {
    return []
  }
}

export async function enviarSolicitudMerchantAction(_prev: EstadoAccion<{ status: string }>, fd: FormData): Promise<EstadoAccion<{ status: string }>> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.solicitud_merchant)
    const ctx = await contextoDeAuditoria(p)
    const v = validarSolicitud({
      nombreComercial: texto(fd, 'nombreComercial', 120),
      tipoNegocio: texto(fd, 'tipoNegocio', 40),
      descripcion: texto(fd, 'descripcion', 1000),
      telefono: texto(fd, 'telefono', 40),
      direccion: texto(fd, 'direccion', 200),
      ciudad: texto(fd, 'ciudad', 80),
      rnc: texto(fd, 'rnc', 20),
      sucursales: leerSucursales(fd),
      queVende: texto(fd, 'queVende', 1000),
      notas: texto(fd, 'notas', 1000),
    })
    if ('error' in v) return { error: v.error }
    const r = await sinEmpresa('Supply: el proveedor solicita ser empresa Membego', (tx) =>
      enviarSolicitudMerchantEnTx(tx, { supplierId: p.supplierId, companyId: p.companyId, userId: p.id, datos: v.datos }, ctx)
    )
    revalidatePath(RUTA_PORTAL_SOLICITUD_MERCHANT)
    revalidatePath(RUTA_PORTAL_PROVEEDOR)
    refrescarSupplyV2('proveedores', 'proveedores/solicitudes')
    return { success: r.repetida ? 'Tu solicitud ya está en revisión.' : r.respondida ? 'Gracias: enviamos tu respuesta a Membego.' : 'Solicitud enviada. Membego la revisará y te avisaremos.', id: r.id, data: { status: r.status } }
  } catch (e) {
    return comoError(e, 'enviarSolicitudMerchant')
  }
}

export async function retirarSolicitudMerchantAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const p = await exigirProveedorSupplyV2(FUNCION_PORTAL.solicitud_merchant)
    const ctx = await contextoDeAuditoria(p)
    const applicationId = texto(fd, 'applicationId', 60)
    if (!applicationId) return { error: 'Falta la solicitud.' }
    const r = await sinEmpresa('Supply: el proveedor retira su solicitud', (tx) => retirarSolicitudMerchantEnTx(tx, { applicationId, supplierId: p.supplierId }, ctx))
    revalidatePath(RUTA_PORTAL_SOLICITUD_MERCHANT)
    refrescarSupplyV2('proveedores/solicitudes')
    return { success: r.repetida ? 'La solicitud ya estaba retirada.' : 'Solicitud retirada.' }
  } catch (e) {
    return comoError(e, 'retirarSolicitudMerchant')
  }
}

export async function revisarSolicitudMerchantAction(_prev: EstadoAccion<{ status: string; capacidades: string[] }>, fd: FormData): Promise<EstadoAccion<{ status: string; capacidades: string[] }>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const applicationId = texto(fd, 'applicationId', 60)
    if (!applicationId) return { error: 'Falta la solicitud.' }
    const motivo = texto(fd, 'motivo', 1000)
    const peticion = texto(fd, 'peticion', 1000)
    const v = validarDecision({ decision: texto(fd, 'decision', 30), motivo, peticion })
    if ('error' in v) return { error: v.error }
    const r = await sinEmpresa('Supply: Membego revisa una solicitud de empresa', (tx) =>
      revisarSolicitudMerchantEnTx(tx, { applicationId, decision: v.decision, motivo, peticion, notasInternas: texto(fd, 'notasInternas', 2000) }, ctx)
    )
    revalidatePath(RUTA_SOLICITUDES_MERCHANT)
    revalidatePath(RUTA_PORTAL_SOLICITUD_MERCHANT)
    refrescarSupplyV2('proveedores', `proveedores/${texto(fd, 'supplierId', 60)}`)
    const mensaje = r.repetida
      ? 'La solicitud ya estaba en ese estado.'
      : r.status === 'APPROVED'
        ? `Aprobada: la misma empresa ahora tiene ${r.capacidades.length} capacidad(es) de comercio encendida(s).`
        : r.status === 'REJECTED'
          ? 'Solicitud rechazada; el proveedor verá el motivo.'
          : r.status === 'MORE_INFO_REQUIRED'
            ? 'Le pedimos más información al proveedor.'
            : 'Solicitud en revisión.'
    return { success: mensaje, id: r.id, data: { status: r.status, capacidades: r.capacidades } }
  } catch (e) {
    return comoError(e, 'revisarSolicitudMerchant')
  }
}
