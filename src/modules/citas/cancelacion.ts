import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { ESTADOS_ACTIVOS } from '@/modules/citas/queries'
import { quitarCitaDeGoogle } from '@/modules/citas/googleAgenda'

/**
 * CANCELAR UNA CITA · el corazón compartido (B-5).
 *
 * Antes cada camino cancelaba por su cuenta: el panel, el propio cliente y —al
 * abrir la API pública— un integrador. Tres copias de la misma máquina de
 * estados son tres sitios donde diverge. Aquí se centraliza lo que SIEMPRE es
 * igual —avisar al bus con el mismo evento, y la transición de negocio— para que
 * ninguno diga algo distinto del mismo hecho. Es la misma decisión que el ciclo
 * de vida de la membresía (B-4, `emitirCambioMembresiaAlBus`).
 *
 * NO notifica: a quién se avisa depende de quién cancela (el cliente avisa al
 * negocio; el negocio, al cliente), así que esa parte se queda en cada llamador.
 */

interface CitaParaEvento {
  companyId: string
  citaId: string
  clienteId: string
  inicio: Date
  servicio: string | null
  canceladaPor: 'CLIENTE' | 'NEGOCIO'
  motivo: string | null
}

/**
 * AVISA AL BUS de que una cita se canceló. Un solo sitio compone el evento, lo
 * llamen el panel, el cliente o la API. `emitirEventoEstrategia` nunca lanza: un
 * fallo del bus no puede deshacer una cancelación ya guardada.
 */
export async function emitirCitaCanceladaAlBus(c: CitaParaEvento): Promise<void> {
  await emitirEventoEstrategia({
    companyId: c.companyId,
    type: 'cita.cancelada',
    subjectId: c.clienteId,
    payload: {
      appointmentId: c.citaId,
      startsAt: c.inicio.toISOString(),
      service: c.servicio,
      cancelledBy: c.canceladaPor === 'CLIENTE' ? 'customer' : 'business',
      reason: c.motivo,
    },
  })
}

/** Un estado terminal que NO es CANCELADA: la cita ya ocurrió, no se deshace. */
export type MotivoFalloCancelacion = 'no_encontrada' | 'no_cancelable'

export interface CitaCancelada {
  id: string
  clienteId: string
  clienteNombre: string
  clienteSupabaseId: string
  inicio: Date
  servicio: string | null
  zonaHoraria: string
}

export type ResultadoCancelacion =
  | {
      ok: true
      /** `false` si ya estaba cancelada: no se tocó nada (idempotente). */
      cambiada: boolean
      cita: CitaCancelada
    }
  | { ok: false; motivo: MotivoFalloCancelacion }

/**
 * Cancela una cita EN NOMBRE DEL NEGOCIO (panel de admin y API pública). La
 * cita se busca acotada a la empresa: un id de otra empresa devuelve
 * `no_encontrada`, no «no autorizado», por lo mismo que en el resto de la API
 * —distinguirlos confirmaría de quién es cada cita—.
 *
 * IDEMPOTENTE: cancelar una cita YA cancelada no es un error —una integración
 * que reintenta la misma llamada debe poder hacerlo—; devuelve `cambiada:false`
 * sin re-emitir el evento ni re-tocar Google. En cambio una cita COMPLETADA o
 * NO_ASISTIO no se puede cancelar: eso ya ocurrió (`no_cancelable`).
 *
 * Hace la transición, la quita de Google y lo avisa al bus. Devuelve la cita
 * para que el llamador arme SU notificación (aquí, avisar al cliente).
 */
export async function cancelarCitaDeNegocio(
  companyId: string,
  citaId: string,
  motivo: string | null
): Promise<ResultadoCancelacion> {
  const cita = await conEmpresa(companyId, (tx) =>
    tx.cita.findFirst({
      where: { id: citaId, companyId },
      include: {
        cliente: { select: { nombre: true, supabaseId: true } },
        company: { select: { zonaHoraria: true } },
      },
    })
  ).catch(() => null)

  if (!cita) return { ok: false, motivo: 'no_encontrada' }

  const datos: CitaCancelada = {
    id: cita.id,
    clienteId: cita.clienteId,
    clienteNombre: cita.cliente.nombre,
    clienteSupabaseId: cita.cliente.supabaseId,
    inicio: cita.inicio,
    servicio: cita.servicio,
    zonaHoraria: cita.company.zonaHoraria,
  }

  // Ya cancelada: idempotente. No se re-emite ni se re-notifica.
  if (cita.estado === 'CANCELADA') return { ok: true, cambiada: false, cita: datos }
  if (!ESTADOS_ACTIVOS.includes(cita.estado as (typeof ESTADOS_ACTIVOS)[number])) {
    return { ok: false, motivo: 'no_cancelable' }
  }

  await conEmpresa(companyId, (tx) =>
    tx.cita.update({
      where: { id: cita.id },
      data: { estado: 'CANCELADA', canceladaPor: 'NEGOCIO', motivoCancelacion: motivo },
    })
  )

  // El evento no puede quedarse en la agenda de una cita que ya no existe.
  await quitarCitaDeGoogle({
    id: cita.id,
    companyId,
    googleEventId: cita.googleEventId,
  }).catch(anotarFallo('citas:cancelar:google', { id: cita.id }))

  await emitirCitaCanceladaAlBus({
    companyId,
    citaId: cita.id,
    clienteId: cita.clienteId,
    inicio: cita.inicio,
    servicio: cita.servicio,
    canceladaPor: 'NEGOCIO',
    motivo,
  })

  return { ok: true, cambiada: true, cita: datos }
}
