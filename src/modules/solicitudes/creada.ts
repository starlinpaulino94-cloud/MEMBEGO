import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * LA SOLICITUD QUE SE CONVIERTE EN EMPRESA (fase 7 · 7.3).
 *
 * Una solicitud puede dar su empresa por dos caminos: el botón «Crear empresa y cuenta del administrador» de la propia solicitud (con
 * contraseña temporal) y «Empresas → Nueva» con los datos precargados (cuando la cuenta del dueño ya existe, o el superadmin quiere
 * cambiar algo). Los dos terminan igual —la solicitud queda «Creada» y enlazada a su empresa, con su rastro en la bitácora— y por eso
 * ese final vive aquí, una vez.
 */

/**
 * `null` si la solicitud se puede convertir en empresa; si no, el motivo en lenguaje del negocio. Se comprueba ANTES de crear nada:
 * así una solicitud que ya tiene su empresa no deja una segunda.
 */
export async function motivoParaNoCrearDesde(solicitudId: string): Promise<string | null> {
  const s = await prisma.solicitudEmpresa.findUnique({ where: { id: solicitudId }, select: { estado: true, companyId: true } })
  if (!s) return 'Solicitud no encontrada.'
  if (s.estado === 'CREADA' && s.companyId) return 'Esta solicitud ya tiene su empresa creada.'
  return null
}

/**
 * Marca la solicitud como creada y deja la línea en la bitácora de la empresa. El cambio de estado es parte del alta (si falla, el alta
 * se deshace); la bitácora no: no vale deshacer una empresa por un rastro que no se pudo escribir.
 */
export async function marcarSolicitudCreada(solicitudId: string, companyId: string, actorDbUserId: string | null | undefined): Promise<void> {
  await prisma.solicitudEmpresa.update({ where: { id: solicitudId }, data: { estado: 'CREADA', companyId } })
  const meta = await getRequestMeta()
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId: actorDbUserId ?? null,
        accion: 'NOTA_INTERNA',
        entidadTipo: 'Company',
        entidadId: companyId,
        payload: { tipo: 'EMPRESA_CREADA_DESDE_SOLICITUD', solicitudId },
        ...meta,
      },
    })
  ).catch(anotarFallo('solicitudes:auditLog'))
}
