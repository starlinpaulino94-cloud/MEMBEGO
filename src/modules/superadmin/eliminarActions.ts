'use server'

/**
 * Eliminación de cuentas por el SUPERADMIN (clientes y usuarios de staff).
 *
 * Principios:
 *  - Solo SUPERADMIN, con confirmación explícita ("ELIMINAR") verificada
 *    también en el servidor.
 *  - La purga de un cliente borra sus datos personales y operativos en el
 *    orden correcto de dependencias, pero CONSERVA las transacciones
 *    (facturas/tickets quedan con el cliente en NULL): el historial contable
 *    de la empresa no se pierde.
 *  - Un staff con historial de caja (arqueos) NO se puede eliminar: borrar
 *    sus sesiones destruiría registros contables. Se informa con claridad.
 *  - La cuenta de acceso (Supabase Auth) se elimina solo cuando la persona
 *    ya no existe en ninguna empresa.
 *  - Todo queda auditado (CUENTA_ELIMINADA) con quién, qué y cuánto se borró.
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestMeta } from '@/lib/server-utils'
import { sinEmpresa } from '@/lib/tenant'
import { purgarClienteRow } from '@/modules/superadmin/purgar'

export interface EliminarState {
  error?: string
  success?: boolean
  mensaje?: string
}

/** Guard NO-redirect para server actions: solo SUPERADMIN. */
async function requireSuperadmin() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

/** Borra la fila User (con sus notificaciones) y la cuenta de Supabase Auth. */
async function eliminarCuentaAcceso(supabaseId: string) {
  const userRow = await sinEmpresa('superadmin: buscar usuario por supabaseId', (tx) =>
    tx.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    })
  )
  if (userRow) {
    await sinEmpresa('superadmin: borrar notificaciones y usuario', async (tx) => {
      await tx.notificacion.deleteMany({ where: { userId: userRow.id } })
      await tx.user.delete({ where: { id: userRow.id } })
    })
  }
  const supabase = createAdminClient()
  const { error } = await supabase.auth.admin.deleteUser(supabaseId)
  if (error) console.error('[eliminar] supabase auth:', error.message)
}

/** Rastro de auditoría de la eliminación; nunca rompe el flujo. */
async function auditarEliminacion(params: {
  companyId: string | null
  userId: string | null
  entidadTipo: 'Cliente' | 'User'
  entidadId: string
  payload: Record<string, unknown>
}) {
  const meta = await getRequestMeta().catch(() => ({ ipAddress: null, userAgent: null }))
  await sinEmpresa('superadmin: auditar eliminación', (tx) =>
    tx.auditLog
      .create({
        data: {
          companyId: params.companyId,
          userId: params.userId,
          accion: 'CUENTA_ELIMINADA',
          entidadTipo: params.entidadTipo,
          entidadId: params.entidadId,
          payload: params.payload as Prisma.InputJsonValue,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      })
      .catch((e) => console.error('[eliminar] audit:', e))
  )
}

/**
 * Elimina un CLIENTE (su ficha en la empresa) y, si no pertenece a ninguna
 * otra empresa, también su cuenta de acceso.
 */
export async function eliminarClienteGlobal(
  _prev: EliminarState,
  formData: FormData
): Promise<EliminarState> {
  try {
    const user = await requireSuperadmin()
    if (!user) return { error: 'No autorizado.' }

    if (String(formData.get('confirmacion') ?? '').trim().toUpperCase() !== 'ELIMINAR') {
      return { error: 'Escribe ELIMINAR para confirmar.' }
    }
    const clienteId = String(formData.get('clienteId') ?? '').trim()
    if (!clienteId) return { error: 'Cliente no especificado.' }

    const cliente = await sinEmpresa('superadmin: buscar cliente por id', (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: { id: true, nombre: true, email: true, supabaseId: true, companyId: true },
      })
    )
    if (!cliente) return { error: 'Cliente no encontrado.' }

    const conteos = await purgarClienteRow(cliente.id)

    // Si la persona ya no es cliente de NINGUNA empresa, se elimina también
    // su cuenta de acceso (User + Supabase Auth).
    const restantes = await sinEmpresa('superadmin: contar fichas restantes del cliente', (tx) =>
      tx.cliente.count({
        where: { supabaseId: cliente.supabaseId },
      })
    )
    if (restantes === 0) await eliminarCuentaAcceso(cliente.supabaseId)

    await auditarEliminacion({
      companyId: cliente.companyId,
      userId: user.metadata.dbUserId ?? null,
      entidadTipo: 'Cliente',
      entidadId: cliente.id,
      payload: {
        nombre: cliente.nombre,
        email: cliente.email,
        cuentaAccesoEliminada: restantes === 0,
        ...conteos,
      },
    })

    revalidatePath('/admin/clientes')
    revalidatePath('/superadmin/usuarios')
    revalidatePath('/superadmin/membresias')
    return {
      success: true,
      mensaje:
        restantes === 0
          ? `Cliente ${cliente.nombre} eliminado, junto con su cuenta de acceso.`
          : `Cliente ${cliente.nombre} eliminado de esta empresa (conserva cuenta en otras).`,
    }
  } catch (e) {
    console.error('[eliminarClienteGlobal]', e)
    return { error: 'No se pudo eliminar el cliente. Revisa el registro del servidor.' }
  }
}

/**
 * Elimina un USUARIO (staff o cliente) y su cuenta de acceso. Para cuentas
 * CLIENTE purga primero todas sus fichas de cliente en cada empresa.
 */
export async function eliminarUsuarioGlobal(
  _prev: EliminarState,
  formData: FormData
): Promise<EliminarState> {
  try {
    const user = await requireSuperadmin()
    if (!user) return { error: 'No autorizado.' }

    if (String(formData.get('confirmacion') ?? '').trim().toUpperCase() !== 'ELIMINAR') {
      return { error: 'Escribe ELIMINAR para confirmar.' }
    }
    const userId = String(formData.get('userId') ?? '').trim()
    if (!userId) return { error: 'Usuario no especificado.' }
    if (userId === user.metadata.dbUserId) {
      return { error: 'No puedes eliminar tu propia cuenta.' }
    }

    const objetivo = await sinEmpresa('superadmin: buscar usuario por id', (tx) =>
      tx.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, companyId: true, supabaseId: true },
      })
    )
    if (!objetivo) return { error: 'Usuario no encontrado.' }
    if (objetivo.role === 'SUPERADMIN') {
      return { error: 'Las cuentas SUPERADMIN no se eliminan desde aquí.' }
    }

    if (objetivo.role === 'CLIENTE') {
      const fichas = await sinEmpresa('superadmin: fichas de cliente del usuario', (tx) =>
        tx.cliente.findMany({
          where: { supabaseId: objetivo.supabaseId },
          select: { id: true },
        })
      )
      for (const f of fichas) await purgarClienteRow(f.id)
    } else {
      // Staff: sus sesiones de caja son registros contables permanentes.
      const cajas = await sinEmpresa('superadmin: contar cajas abiertas del staff', (tx) =>
        tx.cajaSesion.count({
          where: { abiertaPorId: objetivo.id },
        })
      )
      if (cajas > 0) {
        return {
          error:
            'Este usuario abrió sesiones de caja (arqueos) y eliminarlo borraría registros contables. Quítale el acceso cambiando su rol o su empresa.',
        }
      }
    }

    await eliminarCuentaAcceso(objetivo.supabaseId)

    await auditarEliminacion({
      companyId: objetivo.companyId,
      userId: user.metadata.dbUserId ?? null,
      entidadTipo: 'User',
      entidadId: objetivo.id,
      payload: { nombre: objetivo.name, email: objetivo.email, rol: objetivo.role },
    })

    revalidatePath('/superadmin/usuarios')
    revalidatePath('/admin/empleados')
    revalidatePath('/admin/clientes')
    return { success: true, mensaje: `Usuario ${objetivo.name} eliminado.` }
  } catch (e) {
    console.error('[eliminarUsuarioGlobal]', e)
    return { error: 'No se pudo eliminar el usuario. Revisa el registro del servidor.' }
  }
}
