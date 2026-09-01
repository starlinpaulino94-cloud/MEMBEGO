import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo, exigeSistema } from '@/modules/plataforma/api'
import { errorApi, respuestaApi, type CodigoError } from '@/modules/plataforma/errores'
import { conIdempotencia } from '@/modules/plataforma/idempotencia'
import { revertirVisita, type MotivoRechazoReversa } from '@/modules/visitas/reversa'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/redemptions/{visitId}/reverse — deshacer un canje.
 *
 * La otra mitad de `POST /redemptions`, y sin ella el contrato estaba cojo: un
 * satélite que consume el beneficio, cobra el lavado y después anula la factura
 * dejaba al cliente sin ese lavado para siempre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL IDENTIFICADOR ES EL `visitId`, NO EL `redemptionId`
 *
 * `POST /redemptions` devuelve los dos: `redemptionId` es la transacción
 * comercial y `visitId` la visita. Lo que se revierte es la VISITA — es la que
 * consumió el lavado. La transacción se arrastra a `REVERTED` detrás, no al
 * revés. Que el endpoint cuelgue de `/redemptions/` es por dónde nació el
 * recurso, y por eso este párrafo existe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `Idempotency-Key` OBLIGATORIA, POR LA MISMA RAZÓN QUE AL CANJEAR
 *
 * Un reintento sobre una reversa devolvería DOS lavados si nada lo impide. Hay
 * dos cierres independientes sobre el mismo hecho, y los dos hacen falta: la
 * clave de idempotencia responde lo mismo a la misma petición, y el guard del
 * servicio (`revertidaAt: null` en el WHERE) impide el doble abono aunque dos
 * peticiones lleguen a la vez con claves distintas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REVERTIR LO YA REVERTIDO DEVUELVE 200, NO 409
 *
 * Es la respuesta correcta a «asegúrate de que esto está revertido», que es lo
 * que hace un satélite reintentando tras un timeout. El campo `applied` dice
 * cuál de las dos cosas pasó, para quien necesite distinguirlo.
 */

interface Cuerpo {
  companyId?: string
  /** Por qué se revierte. Obligatorio: una reversa sin motivo no se explica. */
  reason?: string
}

const HTTP_POR_MOTIVO: Record<MotivoRechazoReversa, CodigoError> = {
  VISITA_NO_ENCONTRADA: 'NOT_FOUND',
  EMPRESA_AJENA: 'COMPANY_NOT_ENTITLED',
  YA_REVERTIDA: 'REDEMPTION_CONFLICT',
  SIN_MOTIVO: 'INVALID_REQUEST',
  ERROR_INTERNO: 'INTERNAL_ERROR',
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const crudo = await req.text()
  const cuerpo = (() => {
    try {
      return JSON.parse(crudo || '{}') as Cuerpo
    } catch {
      return {} as Cuerpo
    }
  })()

  // Mismo permiso que canjear: quien puede consumir el beneficio es quien puede
  // devolverlo. Un scope aparte obligaría a re-habilitar a todos los satélites
  // que ya canjean, y dejaría a los que no lo pidan sin poder deshacer.
  const auth = await autenticarSobreEmpresa(req, 'benefits:redeem', cuerpo.companyId)
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  // Este recurso es de SATÉLITE: necesita saber qué sistema respalda la
  // operación. `exigeSistema` lo afirma con el tipo — una clave de API de
  // empresa no llega aquí (la guardia la rechaza antes con
  // API_KEY_NOT_SUPPORTED), y si algún día llegara, esto lo detendría.
  const sistema = exigeSistema(ctx)

  const clave = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!clave) return errorApi('IDEMPOTENCY_KEY_REQUIRED', ctx.requestId)

  if (!id?.trim()) {
    return errorApi('INVALID_REQUEST', ctx.requestId, { message: 'visitId is required.' })
  }
  if (!cuerpo.reason?.trim()) {
    return errorApi('INVALID_REQUEST', ctx.requestId, { message: 'reason is required.' })
  }

  // La reserva va ANTES de revertir, igual que al canjear: al revés, dos
  // reintentos simultáneos devolverían los dos lavados antes de que ninguno
  // guardara su respuesta.
  const idem = await conIdempotencia({
    sistemaId: sistema.sistemaId,
    companyId,
    clave,
    endpoint: '/api/platform/v1/redemptions/{id}/reverse',
    cuerpo: crudo,
    requestId: ctx.requestId,
  })
  if (idem.modo === 'RECHAZAR') return idem.respuesta
  if (idem.modo === 'REPETIDA') return idem.respuesta

  const resultado = await revertirVisita(
    {
      origen: 'SISTEMA',
      // Un satélite no es un usuario de MembeGo: la reversa queda sin empleado
      // y el rastro del sistema va en `revertidaPorSistema` y en la auditoría.
      dbUserId: null,
      companyId,
      sistemaSlug: sistema.sistemaSlug,
    },
    id.trim(),
    cuerpo.reason
  )

  if (!resultado.ok) {
    const code = HTTP_POR_MOTIVO[resultado.motivo]
    console.warn('[reverse] rechazado:', resultado.motivo, sistema.sistemaSlug, ctx.requestId)
    const fallo = errorApi(code, ctx.requestId, { message: resultado.mensaje })
    // Un rechazo también se guarda: el reintento de un satélite que ya recibió
    // «no existe» no debe encontrarse otra respuesta distinta.
    await idem.guardar(fallo.status, await fallo.clone().json())
    return fallo
  }

  const salida = {
    visitId: resultado.visitId,
    membershipId: resultado.membershipId,
    customerId: resultado.clienteId,
    companyId: resultado.companyId,
    /** Saldo tras devolver el lavado. `null` en planes ilimitados. */
    usesLeft: resultado.restantes,
    /** `false` = ya estaba revertida y esta llamada no cambió nada. */
    applied: resultado.aplicada,
    reversedAt: resultado.revertidaAt,
  }
  await idem.guardar(200, salida)
  return respuestaApi(salida, ctx.requestId)
}
