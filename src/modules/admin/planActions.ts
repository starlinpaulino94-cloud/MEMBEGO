'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { requireAdminUser } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import type { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { plural } from '@/lib/plural'

async function requireSuperAdmin() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

export interface PlanActionState {
  error?: string
  success?: boolean
}

/**
 * F4.3: parsea los campos del plan (compartido entre crear y actualizar).
 * Incluye vigencia, condiciones, color y orden de presentación.
 */
function parsePlan(formData: FormData): { error: string } | {
  nombre: string
  precio: number
  lavados: number
  esIlimitado: boolean
  descripcion: string | null
  beneficios: string[]
  vigenciaDias: number
  condiciones: string | null
  color: string | null
  orden: number
} {
  const nombre = String(formData.get('nombre') ?? '').trim()
  const precioRaw = String(formData.get('precio') ?? '').trim()
  const lavadosRaw = String(formData.get('lavados') ?? '').trim()
  const esIlimitado = formData.get('esIlimitado') === 'on'
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const beneficiosRaw = String(formData.get('beneficios') ?? '').trim()
  const vigenciaRaw = String(formData.get('vigenciaDias') ?? '').trim()
  const condiciones = String(formData.get('condiciones') ?? '').trim()
  const color = String(formData.get('color') ?? '').trim()
  const ordenRaw = String(formData.get('orden') ?? '').trim()

  if (!nombre || !precioRaw) return { error: 'Nombre y precio son obligatorios.' }

  const precio = Number(precioRaw)
  if (isNaN(precio) || precio < 0) return { error: 'Precio inválido.' }

  const vigenciaDias = vigenciaRaw ? Number(vigenciaRaw) : 30
  if (isNaN(vigenciaDias) || vigenciaDias < 1) {
    return { error: 'La vigencia debe ser al menos 1 día.' }
  }

  const orden = ordenRaw ? Number(ordenRaw) : 0
  if (isNaN(orden)) return { error: 'El orden no es válido.' }

  return {
    nombre,
    precio,
    lavados: Number(lavadosRaw) || 0,
    esIlimitado,
    descripcion: descripcion || null,
    beneficios: beneficiosRaw
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean),
    vigenciaDias,
    condiciones: condiciones || null,
    color: color || null,
    orden,
  }
}

/**
 * BITÁCORA DE CAMBIOS DEL CATÁLOGO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EN UNA TRANSACCIÓN APARTE, Y NO JUNTO AL CAMBIO.
 *
 * Lo natural sería escribir la línea dentro de la misma transacción que la
 * modificación: o las dos, o ninguna. Se hace al revés a propósito.
 *
 * Los valores nuevos del enum `AuditAccion` viven en una migración, y en este
 * proyecto las migraciones se aplican a mano (el flujo automático se omite solo
 * si falta el secreto). Si la línea fuera parte de la misma transacción, en
 * cuanto este código llegara a producción ANTES que su migración, PostgreSQL
 * rechazaría el valor desconocido y arrastraría consigo el cambio del plan: el
 * catálogo entero quedaría de solo lectura, sin más explicación que «Ocurrió un
 * error».
 *
 * Así que se acepta el fail-open: si no se puede auditar, se anota en el log
 * del servidor y el cambio del plan sigue en pie. Tiene un coste real —justo
 * mientras falte la migración, no hay rastro— y se prefiere a que una tabla de
 * auditoría pueda impedir vender.
 */
async function auditarPlan(
  companyId: string,
  userId: string | null,
  accion: 'PLAN_CREADO' | 'PLAN_ACTUALIZADO' | 'PLAN_PAUSADO' | 'PLAN_REANUDADO' | 'PLAN_ELIMINADO',
  planId: string,
  // `Prisma.InputJsonObject` y no `Record<string, unknown>`: la columna es JSON
  // y el tipo laxo dejaría colar un `Date` o un `undefined` que revientan al
  // serializar, justo en el camino que no puede fallar.
  payload: Prisma.InputJsonObject
) {
  try {
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId,
          accion,
          entidadTipo: 'Plan',
          entidadId: planId,
          payload,
        },
      })
    )
  } catch (e) {
    console.error('[plan] no se pudo auditar', accion, e)
  }
}

function revalidatePlanes() {
  revalidatePath('/superadmin/planes')
  revalidatePath('/admin/planes')
  revalidatePath('/cliente/planes')
  revalidatePath('/empresas', 'layout')
}

/**
 * F4.3: la empresa crea sus propios planes; el superadmin puede crear para
 * cualquier empresa (pasa companyId en el form).
 */
export async function crearPlan(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const companyId =
    // Superadmin: companyId del form o, si no viene, la empresa ACTIVA del
    // selector del panel. Staff: siempre la de su sesión.
    (await resolveCompanyId(user, formData)) ?? ''
  if (!companyId) return { error: 'Empresa requerida.' }

  const parsed = parsePlan(formData)
  if ('error' in parsed) return { error: parsed.error }

  try {
    const creado = await conEmpresa(companyId, (tx) =>
      tx.plan.create({
        data: {
          companyId,
          nombre: parsed.nombre,
          precio: parsed.precio,
          lavadosIncluidos: parsed.esIlimitado ? 0 : parsed.lavados,
          esIlimitado: parsed.esIlimitado,
          descripcion: parsed.descripcion,
          beneficios: parsed.beneficios,
          vigenciaDias: parsed.vigenciaDias,
          condiciones: parsed.condiciones,
          color: parsed.color,
          orden: parsed.orden,
        },
        select: { id: true },
      })
    )

    await auditarPlan(companyId, user.metadata.dbUserId ?? null, 'PLAN_CREADO', creado.id, {
      plan: parsed.nombre,
      precio: parsed.precio,
      vigenciaDias: parsed.vigenciaDias,
    })

    revalidatePlanes()
    return { success: true }
  } catch (e) {
    console.error('[plan]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

/**
 * Devuelve el plan solo si pertenece a la empresa del usuario (o superadmin).
 *
 * Trae también `nombre` y `precio` PORQUE SON EL ESTADO ANTERIOR: sin leerlos
 * antes del `update`, la bitácora podría decir a qué precio quedó el plan pero
 * no de cuál venía — y «de cuál venía» es exactamente la pregunta que se hace
 * cuando un cliente reclama lo que pagó.
 */
async function planDeMiEmpresa(
  planId: string,
  user: NonNullable<Awaited<ReturnType<typeof requireAdminUser>>>
) {
  const plan = await sinEmpresa('plan por id sin conocer la empresa', (tx) =>
    tx.plan.findUnique({
      where: { id: planId },
      select: { id: true, companyId: true, activo: true, nombre: true, precio: true },
    })
  )
  if (!plan) return null
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    plan.companyId !== user.metadata.companyId
  ) {
    return null
  }
  return plan
}

export async function actualizarPlan(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const planId = String(formData.get('planId') ?? '').trim()
  if (!planId) return { error: 'Plan no especificado.' }

  const parsed = parsePlan(formData)
  if ('error' in parsed) return { error: parsed.error }

  const activo = formData.get('activo') === 'on'

  try {
    const plan = await planDeMiEmpresa(planId, user)
    if (!plan) return { error: 'Plan no encontrado.' }

    await conEmpresa(plan.companyId, (tx) =>
      tx.plan.update({
        where: { id: planId },
        data: {
          nombre: parsed.nombre,
          precio: parsed.precio,
          lavadosIncluidos: parsed.esIlimitado ? 0 : parsed.lavados,
          esIlimitado: parsed.esIlimitado,
          descripcion: parsed.descripcion,
          beneficios: parsed.beneficios,
          vigenciaDias: parsed.vigenciaDias,
          condiciones: parsed.condiciones,
          color: parsed.color,
          orden: parsed.orden,
          activo,
        },
      })
    )

    // El precio anterior y el nuevo, cuando cambió. `describir()` de la
    // bitácora pinta `antes → despues` sin que haya que abrir el payload, así
    // que la línea se lee entera desde la lista: «Plan actualizado · 1200 →
    // 1500». Si no cambió el precio, no se ensucia con «1200 → 1200».
    const precioAntes = Number(plan.precio)
    const cambioPrecio = precioAntes !== parsed.precio
    await auditarPlan(plan.companyId, user.metadata.dbUserId ?? null, 'PLAN_ACTUALIZADO', planId, {
      plan: parsed.nombre,
      ...(cambioPrecio ? { antes: precioAntes, despues: parsed.precio } : { precio: parsed.precio }),
      ...(plan.nombre !== parsed.nombre ? { de: plan.nombre, a: parsed.nombre } : {}),
    })

    revalidatePlanes()
    return { success: true }
  } catch (e) {
    console.error('[plan]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

/**
 * Pausa/reanuda un plan con un clic (sin pasar por el formulario de edición).
 * Un plan pausado desaparece del catálogo del cliente y del perfil público al
 * instante; las membresías YA vendidas de ese plan no se tocan — siguen
 * vigentes hasta su vencimiento.
 */
export async function alternarPlanActivo(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const planId = String(formData.get('planId') ?? '').trim()
  if (!planId) return { error: 'Plan no especificado.' }

  try {
    const plan = await planDeMiEmpresa(planId, user)
    if (!plan) return { error: 'Plan no encontrado.' }

    await conEmpresa(plan.companyId, (tx) =>
      tx.plan.update({
        where: { id: planId },
        data: { activo: !plan.activo },
      })
    )

    await auditarPlan(
      plan.companyId,
      user.metadata.dbUserId ?? null,
      plan.activo ? 'PLAN_PAUSADO' : 'PLAN_REANUDADO',
      planId,
      { plan: plan.nombre }
    )

    revalidatePlanes()
    return { success: true }
  } catch (e) {
    console.error('[plan] alternar activo', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarPlan(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireAdminUser()
  if (!user) return { error: 'No autorizado.' }

  const planId = String(formData.get('planId') ?? '').trim()
  if (!planId) return { error: 'Plan no especificado.' }

  try {
    const plan = await planDeMiEmpresa(planId, user)
    if (!plan) return { error: 'Plan no encontrado.' }

    /**
     * LAS DOS FORMAS EN QUE UN PLAN ESTÁ EN USO.
     *
     * Se contaban solo las membresías VENDIDAS de ese plan. Pero un plan también
     * puede estar SOLICITADO: cuando alguien pide cambiarse a él, la membresía
     * guarda `planIdSolicitado` apuntando aquí. Esa clave foránea también
     * impide borrar.
     *
     * El efecto era una mentira con dos caras: el botón se veía habilitado
     * («0 membresías») y, al pulsarlo, PostgreSQL rechazaba el borrado y el
     * usuario leía «Ocurrió un error. Intenta de nuevo.» — que es justo lo
     * peor que se le puede decir, porque reintentar no iba a funcionar nunca.
     */
    const { vendidas, solicitadas } = await conEmpresa(plan.companyId, async (tx) => {
      const [vendidas, solicitadas] = await Promise.all([
        tx.membership.count({ where: { planId } }),
        tx.membership.count({ where: { planIdSolicitado: planId } }),
      ])
      return { vendidas, solicitadas }
    })

    if (vendidas > 0 || solicitadas > 0) {
      const motivos = [
        vendidas > 0 ? plural(vendidas, 'membresía vendida', 'membresías vendidas') : null,
        solicitadas > 0
          ? plural(solicitadas, 'cambio de plan pendiente', 'cambios de plan pendientes')
          : null,
      ].filter(Boolean)
      return {
        error: `No se puede eliminar: hay ${motivos.join(' y ')}. Páusalo para dejar de ofrecerlo.`,
      }
    }

    await conEmpresa(plan.companyId, (tx) => tx.plan.delete({ where: { id: planId } }))

    await auditarPlan(plan.companyId, user.metadata.dbUserId ?? null, 'PLAN_ELIMINADO', planId, {
      plan: plan.nombre,
      precio: Number(plan.precio),
    })

    revalidatePlanes()
    return { success: true }
  } catch (e) {
    console.error('[plan]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function cancelarMembresia(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireSuperAdmin()
  if (!user) return { error: 'No autorizado.' }

  const membershipId = String(formData.get('membershipId') ?? '').trim()
  if (!membershipId) return { error: 'Membresía no especificada.' }

  try {
    const m = await sinEmpresa('membresía por id para superadmin', (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: { cliente: true },
      })
    )
    if (!m) return { error: 'Membresía no encontrada.' }

    await conEmpresa(m.cliente.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membershipId },
        data: { estado: 'CANCELADA' },
      })
      await tx.auditLog.create({
        data: {
          companyId: m.cliente.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'MEMBRESIA_CANCELADA',
          entidadTipo: 'Membership',
          entidadId: m.id,
          payload: { prevEstado: m.estado },
        },
      })
    })

    revalidatePath('/superadmin/membresias')
    revalidatePath('/admin/clientes')
    return { success: true }
  } catch (e) {
    console.error('[plan]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function desactivarMembresia(
  _prev: PlanActionState,
  formData: FormData
): Promise<PlanActionState> {
  const user = await requireSuperAdmin()
  if (!user) return { error: 'No autorizado.' }

  const membershipId = String(formData.get('membershipId') ?? '').trim()
  if (!membershipId) return { error: 'Membresía no especificada.' }

  try {
    const m = await sinEmpresa('membresía por id para superadmin', (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: { cliente: true },
      })
    )
    if (!m) return { error: 'Membresía no encontrada.' }
    if (m.estado !== 'ACTIVA') return { error: 'Solo se puede desactivar una membresía activa.' }

    await conEmpresa(m.cliente.companyId, async (tx) => {
      await tx.membership.update({
        where: { id: membershipId },
        data: { estado: 'VENCIDA' },
      })
      await tx.auditLog.create({
        data: {
          companyId: m.cliente.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'MEMBRESIA_CANCELADA',
          entidadTipo: 'Membership',
          entidadId: m.id,
          payload: { prevEstado: 'ACTIVA', nuevaAccion: 'VENCIDA' },
        },
      })
    })

    revalidatePath('/superadmin/membresias')
    revalidatePath('/admin/clientes')
    return { success: true }
  } catch (e) {
    console.error('[plan]', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
