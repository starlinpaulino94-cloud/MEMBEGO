'use server'

import { sinEmpresa } from '@/lib/tenant'
import { exigirPermisoSupplyV2 } from './permisos'
import { comoError, contextoDeAuditoria, entero, refrescarSupplyV2, texto, type EstadoAccion } from './actions-util'
import { crearCategoriaVehiculoEnTx, editarCategoriaVehiculoEnTx } from './categories/service'

/**
 * MEMBEGO SUPPLY · categorías de vehículo de PLATAFORMA.
 *
 * EL PERMISO SE COMPRUEBA AQUÍ, no en el botón: una server action se despacha
 * por su identificador desde cualquier sitio, así que esconder el botón no
 * protege nada.
 *
 * `sinEmpresa` porque este catálogo es de Membego y no tiene `companyId`: es
 * una escritura deliberadamente fuera de inquilino, y además es lo que activa
 * el modo omnisciente que la política de RLS exige para escribirlo.
 */

function refrescar(): void {
  refrescarSupplyV2('categorias', 'ofertas')
}

export async function crearCategoriaVehiculoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_VEHICLE_CATEGORY_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: crear categoría de vehículo', (tx) =>
      crearCategoriaVehiculoEnTx(
        tx,
        {
          code: texto(fd, 'code', 32),
          nombre: texto(fd, 'nombre', 60),
          nivelTarifario: entero(fd, 'nivelTarifario') ?? 0,
          orden: entero(fd, 'orden') ?? 0,
          descripcion: texto(fd, 'descripcion', 300) || null,
        },
        ctx
      )
    )
    refrescar()
    return { success: `Categoría ${r.code} creada.`, id: r.id }
  } catch (e) {
    return comoError(e, 'crearCategoriaVehiculo')
  }
}

export async function editarCategoriaVehiculoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'id', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_VEHICLE_CATEGORY_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const nivel = entero(fd, 'nivelTarifario')
    const orden = entero(fd, 'orden')
    const r = await sinEmpresa('Supply: editar categoría de vehículo', (tx) =>
      editarCategoriaVehiculoEnTx(
        tx,
        id,
        {
          nombre: texto(fd, 'nombre', 60),
          // Ausente = no se toca. Un `?? 0` aquí mandaría un nivel inválido y
          // el dominio lo rechazaría con un mensaje que no explica nada.
          ...(nivel != null ? { nivelTarifario: nivel } : {}),
          ...(orden != null ? { orden } : {}),
          descripcion: texto(fd, 'descripcion', 300) || null,
        },
        ctx
      )
    )
    refrescar()
    return {
      success: r.cambios.length ? `Categoría actualizada: ${r.cambios.join(', ')}.` : 'No había nada que cambiar.',
      id,
    }
  } catch (e) {
    return comoError(e, 'editarCategoriaVehiculo')
  }
}

/**
 * Baja y alta LÓGICA, nunca borrado: una oferta ya publicada puede tener un
 * precio colgado de esta categoría, y borrarla reescribiría el pasado.
 */
export async function cambiarEstadoCategoriaVehiculoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'id', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_VEHICLE_CATEGORY_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const activo = texto(fd, 'activo', 10) === 'true'
    await sinEmpresa('Supply: activar o desactivar categoría de vehículo', (tx) =>
      editarCategoriaVehiculoEnTx(tx, id, { activo }, ctx)
    )
    refrescar()
    return { success: activo ? 'Categoría reactivada.' : 'Categoría desactivada: deja de resolver precios.', id }
  } catch (e) {
    return comoError(e, 'cambiarEstadoCategoriaVehiculo')
  }
}
