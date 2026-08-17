'use server'

/**
 * EXCURSIONES · Catálogo — acciones. Todas detrás de
 * requireSection('excursiones', <funcion>): la capacidad EXCURSIONES y los
 * permisos por empleado gobiernan cada mutación. Multi-tenant con conEmpresa
 * y auditoría en las operaciones que cambian el catálogo.
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  ESTADOS_EXCURSION,
  slugExcursion,
  validarExcursion,
  validarHorario,
  validarVariante,
  type EstadoExcursion,
} from './nucleo'

export interface CatalogoActionState {
  error?: string
  success?: string
  /** id de la excursión creada (para redirigir al detalle). */
  excursionId?: string
}

function deForm(formData: FormData, campos: string[]): Record<string, unknown> {
  return Object.fromEntries(campos.map((c) => [c, String(formData.get(c) ?? '')]))
}

const CAMPOS_EXCURSION = [
  'nombre', 'descripcion', 'duracionMin', 'ubicacion', 'categoria', 'moneda',
  'impuestoPct', 'capacidad', 'puntoSalida', 'horaSalida', 'horaRegreso',
  'incluye', 'noIncluye', 'politicas',
]

async function auditar(
  companyId: string,
  userId: string | null,
  entidadId: string,
  payload: Record<string, unknown>
) {
  const meta = await getRequestMeta()
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId,
        accion: 'NOTA_INTERNA',
        entidadTipo: 'Excursion',
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:auditLog'))
}

/** ADMIN · Crear excursión. Nace con su variante «Estándar» (precio base). */
export async function crearExcursion(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_crear')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const v = validarExcursion(deForm(formData, CAMPOS_EXCURSION))
    if (!v.ok) return { error: v.error }
    // El precio base vive en la variante «Estándar»: así toda excursión tiene
    // desde el primer día la misma forma que una con variantes (§15).
    const variante = validarVariante({
      nombre: 'Estándar',
      precioAdulto: String(formData.get('precioAdulto') ?? ''),
      precioNino: String(formData.get('precioNino') ?? ''),
    })
    if (!variante.ok) return { error: variante.error }

    // Slug único por empresa (sufijo numérico si el nombre se repite).
    const base = slugExcursion(v.datos.nombre)
    const excursion = await conEmpresa(companyId, async (tx) => {
      let slug = base
      let n = 1
      while (await tx.excursion.findFirst({ where: { companyId, slug }, select: { id: true } })) {
        n += 1
        slug = `${base}-${n}`
      }
      return tx.excursion.create({
        data: {
          companyId,
          slug,
          ...v.datos,
          variantes: {
            create: { companyId, ...variante.datos },
          },
        },
        select: { id: true, nombre: true },
      })
    })

    await auditar(companyId, user.metadata.dbUserId ?? null, excursion.id, {
      tipo: 'EXCURSION_CREADA',
      nombre: excursion.nombre,
    })
    revalidatePath('/admin/excursiones/catalogo')
    return { success: 'Excursión creada.', excursionId: excursion.id }
  } catch (e) {
    console.error('[excursiones] crear:', e)
    return {
      error:
        'No se pudo crear. Si acabas de instalar esta versión, corre la migración 20260817_excursiones_fundacion.',
    }
  }
}

/** Carga una excursión VERIFICANDO que es de la empresa del usuario. */
async function excursionDeMiEmpresa(companyId: string, excursionId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.excursion.findFirst({ where: { id: excursionId, companyId }, select: { id: true, nombre: true } })
  )
}

/** ADMIN · Actualizar los campos generales. */
export async function actualizarExcursion(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    if (!(await excursionDeMiEmpresa(companyId, excursionId))) {
      return { error: 'Excursión no encontrada.' }
    }

    const v = validarExcursion(deForm(formData, CAMPOS_EXCURSION))
    if (!v.ok) return { error: v.error }

    await conEmpresa(companyId, (tx) =>
      tx.excursion.update({ where: { id: excursionId }, data: v.datos })
    )
    await auditar(companyId, user.metadata.dbUserId ?? null, excursionId, {
      tipo: 'EXCURSION_ACTUALIZADA',
    })
    revalidatePath('/admin/excursiones/catalogo')
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return { success: 'Cambios guardados.' }
  } catch (e) {
    console.error('[excursiones] actualizar:', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}

/** ADMIN · Cambiar estado. Archivar exige su permiso propio. */
export async function cambiarEstadoExcursion(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const estado = String(formData.get('estado') ?? '') as EstadoExcursion
    if (!(ESTADOS_EXCURSION as readonly string[]).includes(estado)) {
      return { error: 'Estado no reconocido.' }
    }
    const funcion = estado === 'ARCHIVADA' ? 'catalogo_archivar' : 'catalogo_editar'
    const user = await requireSection('excursiones', funcion)
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    const excursion = await excursionDeMiEmpresa(companyId, excursionId)
    if (!excursion) return { error: 'Excursión no encontrada.' }

    await conEmpresa(companyId, (tx) =>
      tx.excursion.update({ where: { id: excursionId }, data: { estado } })
    )
    await auditar(companyId, user.metadata.dbUserId ?? null, excursionId, {
      tipo: 'EXCURSION_ESTADO',
      estado,
      nombre: excursion.nombre,
    })
    revalidatePath('/admin/excursiones/catalogo')
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return { success: `Excursión ${estado.toLowerCase()}.` }
  } catch (e) {
    console.error('[excursiones] estado:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

/** ADMIN · Crear o editar una variante. */
export async function guardarVariante(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    if (!(await excursionDeMiEmpresa(companyId, excursionId))) {
      return { error: 'Excursión no encontrada.' }
    }

    const v = validarVariante(
      deForm(formData, ['nombre', 'precioAdulto', 'precioNino', 'precioResidente', 'precioTurista', 'capacidad'])
    )
    if (!v.ok) return { error: v.error }

    const varianteId = String(formData.get('varianteId') ?? '').trim()
    await conEmpresa(companyId, async (tx) => {
      if (varianteId) {
        await tx.excursionVariante.updateMany({
          where: { id: varianteId, excursionId, companyId },
          data: v.datos,
        })
      } else {
        await tx.excursionVariante.create({
          data: { excursionId, companyId, ...v.datos },
        })
      }
    })
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return { success: varianteId ? 'Variante actualizada.' : 'Variante creada.' }
  } catch (e) {
    console.error('[excursiones] variante:', e)
    return { error: 'No se pudo guardar la variante.' }
  }
}

/**
 * ADMIN · Quitar una variante. HOY las reservas aún no existen (Fase 5); el
 * día que existan, una variante con reservas NO se borra: se desactiva —
 * histórico financiero intacto (§99). La comprobación ya queda escrita.
 */
export async function eliminarVariante(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    const varianteId = String(formData.get('varianteId') ?? '')
    if (!(await excursionDeMiEmpresa(companyId, excursionId))) {
      return { error: 'Excursión no encontrada.' }
    }

    const resultado = await conEmpresa(companyId, async (tx) => {
      const conReservas = await tx.reservaExc.count({ where: { companyId, varianteId } })
      if (conReservas > 0) {
        await tx.excursionVariante.updateMany({
          where: { id: varianteId, excursionId, companyId },
          data: { activa: false },
        })
        return 'desactivada'
      }
      const total = await tx.excursionVariante.count({ where: { excursionId, companyId } })
      if (total <= 1) return 'ultima'
      await tx.excursionVariante.deleteMany({ where: { id: varianteId, excursionId, companyId } })
      return 'eliminada'
    })
    if (resultado === 'ultima') {
      return { error: 'Es la única variante: toda excursión necesita al menos una con su precio.' }
    }
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return {
      success:
        resultado === 'desactivada'
          ? 'La variante tiene reservas: quedó desactivada (el histórico no se borra).'
          : 'Variante eliminada.',
    }
  } catch (e) {
    console.error('[excursiones] eliminarVariante:', e)
    return { error: 'No se pudo quitar la variante.' }
  }
}

/** ADMIN · Crear o editar un horario de salida. */
export async function guardarHorario(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    if (!(await excursionDeMiEmpresa(companyId, excursionId))) {
      return { error: 'Excursión no encontrada.' }
    }

    const v = validarHorario(
      { horaSalida: String(formData.get('horaSalida') ?? ''), cupo: String(formData.get('cupo') ?? '') },
      formData.getAll('dias').map(String)
    )
    if (!v.ok) return { error: v.error }

    const horarioId = String(formData.get('horarioId') ?? '').trim()
    await conEmpresa(companyId, async (tx) => {
      if (horarioId) {
        await tx.excursionHorario.updateMany({
          where: { id: horarioId, excursionId, companyId },
          data: v.datos,
        })
      } else {
        await tx.excursionHorario.create({ data: { excursionId, companyId, ...v.datos } })
      }
    })
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return { success: horarioId ? 'Horario actualizado.' : 'Horario agregado.' }
  } catch (e) {
    console.error('[excursiones] horario:', e)
    return { error: 'No se pudo guardar el horario.' }
  }
}

/** ADMIN · Quitar un horario (no hay histórico que proteger: es agenda). */
export async function eliminarHorario(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    const horarioId = String(formData.get('horarioId') ?? '')
    await conEmpresa(companyId, (tx) =>
      tx.excursionHorario.deleteMany({ where: { id: horarioId, excursionId, companyId } })
    )
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return { success: 'Horario eliminado.' }
  } catch (e) {
    console.error('[excursiones] eliminarHorario:', e)
    return { error: 'No se pudo eliminar el horario.' }
  }
}
