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
