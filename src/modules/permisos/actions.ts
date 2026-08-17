'use server'

/**
 * Módulo de PERMISOS · guardar los ajustes de un empleado.
 *
 * Solo el ADMINISTRADOR de la empresa (o el superadmin) edita permisos, y
 * nunca sobre sí mismo ni sobre otro administrador: los roles exentos no
 * pueden quedar bloqueados por diseño (nadie deja al dueño fuera).
 *
 * El JSON guarda DIFERENCIAS contra el rol. Además de la base (fuente de
 * verdad, efecto inmediato en las server actions y el menú), se espeja en el
 * app_metadata del token para que el gate de VISTA del proxy lo aplique al
 * refrescarse la sesión.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { conEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { Prisma } from '@prisma/client'
import {
  ADMIN_SECTIONS,
  ROLES_EXENTOS_PERMISOS,
  permisosDesdeSeleccion,
  puedeEditarPermisos,
  type AdminSection,
} from '@/lib/auth/permissions'
import { FUNCIONES_POR_SECCION } from '@/lib/auth/funciones'

export interface PermisosActionState {
  error?: string
  success?: string
}

const ROLES_EDITORES = ROLES_EXENTOS_PERMISOS

export async function guardarPermisosEmpleado(
  _prev: PermisosActionState,
  formData: FormData
): Promise<PermisosActionState> {
  try {
    const user = await getUser()
    if (!user || !ROLES_EDITORES.includes(user.metadata.role)) {
      return { error: 'Solo el administrador puede editar permisos.' }
    }

    const userId = String(formData.get('userId') ?? '')
    if (!userId) return { error: 'Empleado no especificado.' }
    if (userId === user.metadata.dbUserId) {
      return { error: 'No puedes editar tus propios permisos.' }
    }

    const objetivo = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, supabaseId: true, role: true, companyId: true, name: true },
    })
    if (!objetivo) return { error: 'Empleado no encontrado.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      (!objetivo.companyId || objetivo.companyId !== user.metadata.companyId)
    ) {
      return { error: 'Ese empleado no pertenece a tu empresa.' }
    }
    // El superadmin ajusta a cualquiera (incluidos administradores — control
    // de plataforma); un admin de empresa solo a su equipo, nunca a otro admin.
    if (!puedeEditarPermisos(user.metadata.role, objetivo.role)) {
      return {
        error:
          user.metadata.role === 'SUPERADMIN'
            ? 'Los permisos de un superadmin no se editan.'
            : 'A los administradores solo los ajusta la plataforma (superadmin).',
      }
    }

    // La selección llega como JSON del formulario y se valida ENTERA contra
    // el catálogo: secciones reales y funciones que existen de verdad.
    let cruda: unknown
    try {
      cruda = JSON.parse(String(formData.get('seleccion') ?? ''))
    } catch {
      return { error: 'La selección llegó dañada. Recarga e intenta de nuevo.' }
    }
    const r = (cruda ?? {}) as {
      secciones?: Record<string, unknown>
      funcionesNegadas?: Record<string, unknown>
    }
    const secciones: Partial<Record<AdminSection, boolean>> = {}
    for (const [sec, v] of Object.entries(r.secciones ?? {})) {
      if ((ADMIN_SECTIONS as readonly string[]).includes(sec) && typeof v === 'boolean') {
        secciones[sec as AdminSection] = v
      }
    }
    const funcionesNegadas: Partial<Record<AdminSection, string[]>> = {}
    for (const [sec, lista] of Object.entries(r.funcionesNegadas ?? {})) {
      if (!(ADMIN_SECTIONS as readonly string[]).includes(sec) || !Array.isArray(lista)) continue
      const validas = new Set(
        (FUNCIONES_POR_SECCION[sec as AdminSection] ?? []).map((f) => f.codigo)
      )
      const limpias = lista.filter((f): f is string => typeof f === 'string' && validas.has(f))
      if (limpias.length) funcionesNegadas[sec as AdminSection] = limpias
    }

    const permisos = permisosDesdeSeleccion(objetivo.role, { secciones, funcionesNegadas })

    await prisma.user.update({
      where: { id: objetivo.id },
      data: { permisos: permisos ? (permisos as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    })

    // Espejo al token (gate de vista del proxy). Best-effort: si falla, la
    // barrera real (server actions + menú, que leen la base) ya aplica.
    const supabase = createAdminClient()
    await supabase.auth.admin
      .updateUserById(objetivo.supabaseId, { app_metadata: { permisos } })
      .then(({ error }) => {
        if (error) console.error('[permisos] espejo app_metadata:', error.message)
      })
      .catch((e) => console.error('[permisos] espejo app_metadata:', e))

    // Auditoría: quién ajustó qué y a quién.
    if (objetivo.companyId) {
      const companyId = objetivo.companyId
      const meta = await getRequestMeta()
      await conEmpresa(companyId, (tx) =>
        tx.auditLog.create({
          data: {
            companyId,
            userId: user.metadata.dbUserId ?? null,
            accion: 'NOTA_INTERNA',
            entidadTipo: 'User',
            entidadId: objetivo.id,
            payload: {
              tipo: 'PERMISOS_ACTUALIZADOS',
              empleado: objetivo.name,
              permisos: (permisos ?? null) as object | null,
            },
            ...meta,
          },
        })
      ).catch(anotarFallo('permisos:auditLog'))
    }

    revalidatePath(`/admin/empleados/${objetivo.id}`)
    revalidatePath(`/admin/empleados/${objetivo.id}/permisos`)
    return {
      success: permisos
        ? `Permisos de ${objetivo.name} guardados.`
        : `${objetivo.name} vuelve a heredar los permisos de su rol.`,
    }
  } catch (e) {
    console.error('[permisos] guardar:', e)
    return {
      error:
        'No se pudo guardar. Si acabas de instalar esta versión, corre la migración 20260814_permisos_empleado.',
    }
  }
}
