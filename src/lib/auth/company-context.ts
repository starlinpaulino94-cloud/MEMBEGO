import { redirect } from 'next/navigation'
import { sinEmpresa } from '@/lib/tenant'
import type { SessionUser } from '@/types'

/**
 * Empresa de trabajo de una server action del panel /admin.
 *
 * - Staff de empresa: SIEMPRE la de su sesión (el form no puede apuntar a
 *   otra empresa).
 * - Superadmin: el `companyId` del formulario si viene; si no, la empresa
 *   ACTIVA elegida en el selector del panel (app_metadata.companyId). En
 *   ambos casos se verifica que la empresa exista (la sesión puede arrastrar
 *   una empresa borrada).
 *
 * Devuelve null si no se puede resolver → la action responde
 * "Empresa requerida.".
 */
export async function resolveCompanyId(
  user: SessionUser,
  formData?: FormData
): Promise<string | null> {
  if (user.metadata.role !== 'SUPERADMIN') {
    return user.metadata.companyId ?? null
  }
  const delForm = String(formData?.get('companyId') ?? '').trim()
  const candidato = delForm || user.metadata.companyId || ''
  if (!candidato) return null
  const existe = await sinEmpresa('verificar que la empresa del form/sesión existe (superadmin)', (tx) =>
    tx.company.findUnique({ where: { id: candidato }, select: { id: true } })
  ).catch(() => null)
  return existe ? candidato : null
}

/**
 * Destino cuando una página /admin no tiene empresa activa.
 *
 * Nunca /login: el middleware redirige a los logueados fuera de /login hacia
 * su home, y el home del staff es /admin/* — redirigir allí sería un bucle.
 * El superadmin elige empresa en su panel; el staff sin empresa ve una
 * pantalla explícita en vez de datos globales o un bucle.
 */
export function destinoSinEmpresa(role: string): string {
  return role === 'SUPERADMIN' ? '/superadmin/empresas' : '/admin/sin-empresa'
}

/**
 * Empresa de trabajo de una PÁGINA del panel /admin (ámbito EMPRESA).
 *
 * El ROL nunca decide el alcance: tanto el staff como el superadmin operan la
 * empresa ACTIVA de su sesión. Sin empresa activa no hay vista global
 * implícita — hay redirección (superadmin → selector de plataforma, staff →
 * pantalla explícita). La existencia se verifica porque la sesión puede
 * arrastrar una empresa borrada.
 *
 * Reemplaza a `companyFilter` (que devolvía undefined = global para el
 * superadmin). Las Server Actions siguen usando `resolveCompanyId`, que
 * admite el companyId explícito del formulario.
 */
export async function requireCompanyContext(user: SessionUser): Promise<string> {
  const candidato = user.metadata.companyId ?? ''
  if (!candidato) redirect(destinoSinEmpresa(user.metadata.role))
  const existe = await sinEmpresa('verificar empresa activa de la sesión (páginas /admin)', (tx) =>
    tx.company.findUnique({ where: { id: candidato }, select: { id: true } })
  ).catch(() => null)
  if (!existe) redirect(destinoSinEmpresa(user.metadata.role))
  return candidato
}
