'use server'

import { revalidatePath } from 'next/cache'
import { requireRole, requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { eliminarSinonimo, guardarSinonimo } from './sinonimos'

/**
 * Acciones de administración de sinónimos de búsqueda.
 *
 * Dos ámbitos con dueños distintos (decisión del usuario): los GLOBALES los
 * administra la plataforma en /superadmin/busqueda; los DE LA EMPRESA, cada
 * negocio en /admin/sinonimos. La guardia y el companyId se resuelven AQUÍ —
 * el módulo puro no conoce la sesión.
 *
 * Las dos de empresa piden `requireSection('sinonimos')` y no un rol. Las
 * server actions se despachan por ID desde cualquier path permitido, así que
 * el gate del proxy no las cubre: con `ADMIN_ROLES` —que incluye MARKETING y
 * SUPERVISOR— se podían llamar sin poder siquiera abrir la pantalla. Las
 * globales siguen siendo del superadmin y nada más.
 */

export interface SinonimoState {
  error?: string
  success?: boolean
}

function textos(fd: FormData) {
  return {
    termino: String(fd.get('termino') ?? ''),
    equivalencia: String(fd.get('equivalencia') ?? ''),
  }
}

export async function guardarSinonimoGlobal(
  _prev: SinonimoState,
  fd: FormData
): Promise<SinonimoState> {
  await requireRole('SUPERADMIN')
  try {
    await guardarSinonimo({ ...textos(fd), companyId: null })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo guardar el sinónimo.' }
  }
  revalidatePath('/superadmin/busqueda')
  return { success: true }
}

export async function eliminarSinonimoGlobal(fd: FormData): Promise<void> {
  await requireRole('SUPERADMIN')
  const id = String(fd.get('id') ?? '')
  if (!id) return
  await eliminarSinonimo(id, null).catch(() => undefined)
  revalidatePath('/superadmin/busqueda')
}

export async function guardarSinonimoEmpresa(
  _prev: SinonimoState,
  fd: FormData
): Promise<SinonimoState> {
  const user = await requireSection('sinonimos')
  if (!user) return { error: 'No autorizado.' }
  const companyId = await resolveCompanyId(user, fd)
  if (!companyId) return { error: 'Empresa requerida.' }
  try {
    await guardarSinonimo({ ...textos(fd), companyId })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo guardar el sinónimo.' }
  }
  revalidatePath('/admin/sinonimos')
  return { success: true }
}

export async function eliminarSinonimoEmpresa(fd: FormData): Promise<void> {
  const user = await requireSection('sinonimos')
  if (!user) return
  const companyId = await resolveCompanyId(user, fd)
  if (!companyId) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  await eliminarSinonimo(id, companyId).catch(() => undefined)
  revalidatePath('/admin/sinonimos')
}
