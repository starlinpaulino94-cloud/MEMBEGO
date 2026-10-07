import { conEmpresa } from '@/lib/tenant'

/**
 * Consulta del panel de equipo. Vive FUERA de `invitacionActions.ts` (`'use server'`) a
 * propósito: lo que ese archivo exporta es un endpoint al que cualquier navegador puede
 * llamar, y esta función recibe la empresa como argumento y no comprueba sesión (la
 * página que la usa le pasa la de la sesión). Estando allí, devolvía el correo y el rol de
 * las invitaciones pendientes de CUALQUIER empresa (hallazgo A2 de la auditoría del
 * 2026-10-07). Lo vigila `tests/acciones-sin-guardia.test.ts`.
 */

/**
 * Invitaciones pendientes, con `caducada` ya resuelto.
 *
 * El estado 'PENDIENTE' no se limpia solo: una invitación cuya fecha ya pasó
 * sigue en la lista y no sirve para nada. Sin decirlo, el admin no sabe si
 * tiene que reenviarla y acaba llegando "no me llegó nada" a soporte.
 *
 * El cálculo vive aquí y no en la página a propósito: `Date.now()` dentro de
 * un componente es impuro —el mismo árbol daría resultados distintos según
 * cuándo se evalúe— y el compilador de React lo rechaza. La capa de datos es
 * además donde corresponde: si algo sabe cuándo caduca una invitación, es
 * quien la consulta.
 */
export async function listInvitacionesPendientes(companyId: string) {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.invitacion.findMany({
      where: { companyId, estado: 'PENDIENTE' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, email: true, rol: true, expiraEn: true },
    })
  )
  const ahora = Date.now()
  return filas.map((inv) => ({ ...inv, caducada: inv.expiraEn.getTime() <= ahora }))
}
