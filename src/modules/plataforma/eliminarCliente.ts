import 'server-only'
import type { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { purgarClienteRow } from '@/modules/superadmin/purgar'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'

/**
 * BORRAR UN CLIENTE desde la API pública (B-5, derecho al olvido).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ BORRA, Y QUÉ NO
 *
 * Purga la FICHA de esta empresa y todo lo que cuelga de ella —el trabajo de
 * cascada + cumplimiento ya resuelto en `purgarClienteRow`: visitas, membresías,
 * vehículos, tickets y referidos se borran, y las transacciones aplicadas se
 * ANULAN (no se borran) para no alterar cierres históricos, dejando rastro—.
 *
 * NO toca la cuenta de acceso de la persona. Un `Cliente` es la relación de UNA
 * empresa con una persona; esa persona puede ser cliente de otras y su cuenta es
 * suya, no de la empresa. Borrar la identidad global —y la cuenta de Supabase—
 * cuando alguien deja de ser cliente de todas es una decisión de plataforma, del
 * superadmin (`eliminarClienteGlobal`), no de una clave de empresa. Aquí se
 * respeta esa frontera: la empresa borra su relación y sus datos, y nada más.
 */

export type ResultadoEliminarCliente =
  | { ok: true; conteos: Record<string, number> }
  | { ok: false; motivo: 'no_existe' }

export async function eliminarClienteDeEmpresa(
  companyId: string,
  clienteId: string
): Promise<ResultadoEliminarCliente> {
  // Acotado a la empresa: un id de otra empresa es `no_existe`, no «no
  // autorizado» —igual que el resto de la API, para no confirmar de quién es
  // cada cliente—. Esta comprobación es la que hace segura la llamada a
  // `purgarClienteRow`, que borra por id sin mirar la empresa.
  const cliente = await conEmpresa(companyId, (tx) =>
    tx.cliente.findFirst({
      where: { id: clienteId, companyId },
      select: { id: true, nombre: true, email: true },
    })
  ).catch(() => null)

  if (!cliente) return { ok: false, motivo: 'no_existe' }

  const conteos = await purgarClienteRow(cliente.id)

  // Rastro de auditoría de una operación destructiva. Best-effort: la ficha ya
  // se borró y no se va a resucitar porque el log falle.
  await sinEmpresa('plataforma: auditar borrado de cliente por API', (tx) =>
    tx.auditLog
      .create({
        data: {
          companyId,
          userId: null, // la borró una clave de empresa, no un usuario
          accion: 'CUENTA_ELIMINADA',
          entidadTipo: 'Cliente',
          entidadId: cliente.id,
          payload: { via: 'api', nombre: cliente.nombre, email: cliente.email, ...conteos } as Prisma.InputJsonValue,
        },
      })
  ).catch(anotarFallo('plataforma:eliminar-cliente:audit', { id: cliente.id }))

  // Al bus: un satélite que proyecta este cliente tiene que soltar su copia, o
  // se queda con un fantasma. `subjectId` viaja como `customerId` en el sobre.
  // Va DESPUÉS del borrado —`subjectId` es un string sin FK— y nunca lanza.
  await emitirEventoEstrategia({
    companyId,
    type: 'cliente.eliminado',
    subjectId: cliente.id,
    payload: {},
  })

  return { ok: true, conteos }
}
