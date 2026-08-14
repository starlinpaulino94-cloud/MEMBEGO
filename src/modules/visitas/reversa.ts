import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { transicionar } from '@/lib/transactions'
import { capturarErrorInesperado } from '@/lib/sentry'

/**
 * REVERTIR UNA VISITA · deshacer un canje y devolverle el lavado al cliente.
 *
 * Faltaba, y se notaba desde fuera: un satélite que consume el beneficio con
 * `POST /redemptions`, cobra el lavado y después anula la factura dejaba al
 * cliente sin ese lavado para siempre. La única salida era tocar la base a
 * mano — justo lo que una API existe para evitar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SE BORRA: SE MARCA
 *
 * Borrar la visita dejaría el saldo cuadrado y el historial mintiendo. El
 * lavado se registró; que después se anulara la factura que lo cobraba es un
 * hecho posterior, no una razón para fingir que nunca ocurrió. Y es lo único
 * que permite responder, tres meses más tarde, «¿por qué a este cliente le
 * sobra un lavado?».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEVOLVER EL SALDO SOLO SI SE DESCONTÓ
 *
 * `Visit.descontado` distingue el plan con saldo del ilimitado. Sumar un lavado
 * a una membresía ilimitada le inventaría un saldo que su plan no tiene, y a
 * partir de ahí el cliente vería «1 lavado restante» en un plan sin límite.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REVERTIR DOS VECES DEVUELVE UN LAVADO, NO DOS
 *
 * El guard va en el WHERE del update (`revertidaAt: null`), no en un `if`
 * previo: dos peticiones simultáneas no pueden ganar las dos. La segunda
 * encuentra `count = 0` y sale por `YA_REVERTIDA`, que NO es un error del
 * llamante — es la respuesta correcta a «asegúrate de que esto está revertido».
 */

export type MotivoRechazoReversa =
  | 'VISITA_NO_ENCONTRADA'
  | 'EMPRESA_AJENA'
  | 'YA_REVERTIDA'
  | 'SIN_MOTIVO'
  | 'ERROR_INTERNO'

export interface ActorReversa {
  origen: 'PANEL' | 'SISTEMA'
  /** Usuario de MembeGo. `null` cuando revierte un satélite. */
  dbUserId: string | null
  /** Empresa a la que el actor está acotado. `null` solo para superadmin. */
  companyId: string | null
  /** Slug del satélite, cuando `origen` es SISTEMA. */
  sistemaSlug?: string
}

export interface ReversaAplicada {
  ok: true
  visitId: string
  membershipId: string
  clienteId: string
  companyId: string
  /** Saldo DESPUÉS de devolver el lavado. `null` en planes ilimitados. */
  restantes: number | null
  /** `true` si esta llamada fue la que revirtió; `false` si ya lo estaba. */
  aplicada: boolean
  revertidaAt: string
}

export interface ReversaRechazada {
  ok: false
  motivo: MotivoRechazoReversa
  mensaje: string
}

export type ResultadoReversa = ReversaAplicada | ReversaRechazada

const no = (motivo: MotivoRechazoReversa, mensaje: string): ReversaRechazada => ({
  ok: false,
  motivo,
  mensaje,
})

export async function revertirVisita(
  actor: ActorReversa,
  visitId: string,
  motivo: string
): Promise<ResultadoReversa> {
  const razon = motivo.trim()
  if (razon.length === 0) {
    // Una reversa sin motivo es un descuadre que nadie puede explicar después.
    return no('SIN_MOTIVO', 'Indique por qué se revierte la visita.')
  }

  try {
    const visita = await sinEmpresa('reversa: buscar la visita a revertir', (tx) =>
      tx.visit.findUnique({
        where: { id: visitId },
        select: {
          id: true,
          descontado: true,
          revertidaAt: true,
          clienteId: true,
          membershipId: true,
          membership: { select: { id: true, companyId: true, lavadosRestantes: true } },
          transaccion: { select: { id: true } },
        },
      })
    )

    if (!visita) return no('VISITA_NO_ENCONTRADA', 'La visita no existe.')

    const companyId = visita.membership.companyId
    // La empresa no se cree, se comprueba: un satélite acotado a una empresa no
    // puede revertir la visita de otra ni conociendo su identificador.
    if (actor.companyId !== null && actor.companyId !== companyId) {
      return no('EMPRESA_AJENA', 'La visita no pertenece a su empresa.')
    }

    const ahora = new Date()

    const resultado = await conEmpresa(companyId, async (tx) => {
      // El guard atómico. Si otra petición revirtió entre la lectura y esto,
      // `count` es 0 y esta no vuelve a sumar el lavado.
      const marcada = await tx.visit.updateMany({
        where: { id: visita.id, revertidaAt: null },
        data: {
          revertidaAt: ahora,
          revertidaMotivo: razon,
          revertidaPorId: actor.dbUserId,
          revertidaPorSistema: actor.origen === 'SISTEMA' ? (actor.sistemaSlug ?? null) : null,
        },
      })

      if (marcada.count === 0) return { yaEstaba: true as const }

      // Solo se devuelve el lavado si en su día se descontó.
      if (visita.descontado) {
        await tx.membership.update({
          where: { id: visita.membershipId },
          data: { lavadosRestantes: { increment: 1 } },
        })
      }

      // La transacción oficial pasa a REVERTED. La máquina de estados ya
      // permitía APPLIED → REVERTED; lo que faltaba era quien la usara.
      if (visita.transaccion) {
        await transicionar(tx, visita.transaccion.id, 'REVERTED', {
          userId: actor.dbUserId,
          motivo: razon,
        })
      }

      await tx.auditLog.create({
        data: {
          companyId,
          userId: actor.dbUserId,
          accion: 'VISITA_REVERTIDA',
          entidadTipo: 'Visit',
          entidadId: visita.id,
          payload: {
            clienteId: visita.clienteId,
            membresiaId: visita.membershipId,
            motivo: razon,
            devolvioLavado: visita.descontado,
            origen: actor.origen,
            ...(actor.sistemaSlug ? { sistema: actor.sistemaSlug } : {}),
          },
        },
      })

      const fresco = await tx.membership.findUnique({
        where: { id: visita.membershipId },
        select: { lavadosRestantes: true },
      })

      return { yaEstaba: false as const, restantes: fresco?.lavadosRestantes ?? null }
    })

    if (resultado.yaEstaba) {
      // Ya estaba revertida. NO es un error: es la respuesta correcta a
      // «asegúrate de que esto está revertido», que es lo que hace un satélite
      // reintentando tras un timeout.
      const actualizada = await sinEmpresa('reversa: saldo tras una reversa ya aplicada', (tx) =>
        tx.visit.findUnique({
          where: { id: visita.id },
          select: { revertidaAt: true, membership: { select: { lavadosRestantes: true } } },
        })
      )
      return {
        ok: true,
        visitId: visita.id,
        membershipId: visita.membershipId,
        clienteId: visita.clienteId,
        companyId,
        restantes: visita.descontado
          ? (actualizada?.membership.lavadosRestantes ?? null)
          : null,
        aplicada: false,
        revertidaAt: (actualizada?.revertidaAt ?? ahora).toISOString(),
      }
    }

    return {
      ok: true,
      visitId: visita.id,
      membershipId: visita.membershipId,
      clienteId: visita.clienteId,
      companyId,
      restantes: visita.descontado ? resultado.restantes : null,
      aplicada: true,
      revertidaAt: ahora.toISOString(),
    }
  } catch (error) {
    capturarErrorInesperado('visitas/reversa', error, { visitId })
    return no('ERROR_INTERNO', 'No se pudo revertir la visita.')
  }
}
