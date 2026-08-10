import type { NextRequest } from 'next/server'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi, type CodigoError } from '@/modules/plataforma/errores'
import { conIdempotencia } from '@/modules/plataforma/idempotencia'
import { ejecutarCanje, type MotivoRechazo } from '@/modules/visitas/canje'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/redemptions — consumir un beneficio.
 *
 * El endpoint que sostiene el flujo entero: el vertical identifica al cliente,
 * pregunta a `/benefits/evaluate`, presta el servicio y lo consume aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES EL MISMO CÓDIGO QUE EL MOSTRADOR
 *
 * No hay una implementación «para la API». Llama a `ejecutarCanje`, exactamente
 * el mismo servicio que usa el escáner del panel: mismo núcleo atómico, mismo
 * QR de un solo uso, misma auditoría, misma transacción oficial, mismos eventos.
 *
 * Eso es deliberado y es la razón de que la Fase 3b empezara por extraer ese
 * servicio en vez de escribir el endpoint directamente. Dos implementaciones de
 * la ruta del dinero terminan divergiendo —siempre— en el caso raro que nadie
 * probó, y aquí el caso raro es alguien pagando de más o consumiendo dos veces.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `Idempotency-Key` ES OBLIGATORIA, Y NO ES UNA FORMALIDAD
 *
 * Un reintento de red sobre un canje consume el beneficio dos veces. El satélite
 * no puede distinguir «no llegó» de «llegó y se perdió la respuesta»: desde su
 * lado las dos son un timeout. Sin la clave, la única opción segura sería no
 * reintentar nunca — y entonces cada corte de red pierde un canje que el cliente
 * ya recibió.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA EMPRESA NO SE CREE, SE COMPRUEBA
 *
 * `companyId` llega en el cuerpo porque hay que decir de qué empresa se habla.
 * `autenticarSobreEmpresa` lo contrasta con las habilitaciones antes de nada, y
 * `ejecutarCanje` vuelve a comprobar que la membresía sea de esa empresa. Dos
 * cierres independientes sobre el mismo hecho.
 */

interface Cuerpo {
  companyId?: string
  membershipId?: string
  servicio?: string
  vehiculoId?: string | null
  sucursalId?: string | null
  qrTokenId?: string | null
  notas?: string | null
}

/**
 * Cada rechazo del canje a su código HTTP. `409` para los conflictos de carrera
 * —el QR que otro acaba de usar, la membresía que se agotó entre la evaluación
 * y el canje— porque son reintentables con datos frescos; `422` no existe aquí
 * a propósito: el satélite solo necesita saber si insistir o rendirse.
 */
const HTTP_POR_MOTIVO: Record<MotivoRechazo, CodigoError> = {
  MEMBRESIA_NO_ENCONTRADA: 'NOT_FOUND',
  SUCURSAL_NO_ENCONTRADA: 'NOT_FOUND',
  // La membresía existe pero es de otra empresa: mismo 404 que si no existiera.
  // Distinguirlo confirmaría, membresía a membresía, de quién es cada una.
  EMPRESA_AJENA: 'NOT_FOUND',
  VEHICULO_NO_AUTORIZADO: 'BENEFIT_NOT_ELIGIBLE',
  MEMBRESIA_NO_ACTIVA: 'BENEFIT_NOT_ELIGIBLE',
  MEMBRESIA_VENCIDA: 'BENEFIT_NOT_ELIGIBLE',
  SIN_USOS: 'BENEFIT_NOT_ELIGIBLE',
  QR_INVALIDO: 'BENEFIT_NOT_ELIGIBLE',
  CONFLICTO: 'REDEMPTION_CONFLICT',
  ERROR_INTERNO: 'INTERNAL_ERROR',
}

export async function POST(req: NextRequest) {
  const crudo = await req.text()
  const cuerpo = (() => {
    try {
      return JSON.parse(crudo || '{}') as Cuerpo
    } catch {
      return {} as Cuerpo
    }
  })()

  const auth = await autenticarSobreEmpresa(req, 'benefits:redeem', cuerpo.companyId)
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth

  const clave = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!clave) return errorApi('IDEMPOTENCY_KEY_REQUIRED', ctx.requestId)

  if (!cuerpo.membershipId || !cuerpo.servicio?.trim()) {
    return errorApi('INVALID_REQUEST', ctx.requestId, {
      message: 'membershipId and servicio are required.',
    })
  }

  // La reserva va ANTES de canjear. Al revés —canjear y luego registrar— dos
  // reintentos simultáneos consumirían los dos antes de que ninguno guardara.
  const idem = await conIdempotencia({
    sistemaId: ctx.sistemaId,
    companyId,
    clave,
    endpoint: '/api/platform/v1/redemptions',
    cuerpo: crudo,
    requestId: ctx.requestId,
  })
  if (idem.modo === 'RECHAZAR') return idem.respuesta
  if (idem.modo === 'REPETIDA') return idem.respuesta

  const resultado = await ejecutarCanje(
    {
      origen: 'SISTEMA',
      // Un satélite no es un usuario de MembeGo. La visita queda sin empleado y
      // el rastro del sistema va en la auditoría y en el ticket: inventar un
      // usuario para que el campo no esté vacío sería falsificar quién atendió.
      dbUserId: null,
      nombre: ctx.sistemaSlug,
      companyId,
      sistemaSlug: ctx.sistemaSlug,
    },
    {
      membershipId: cuerpo.membershipId,
      servicio: cuerpo.servicio.trim(),
      vehiculoId: cuerpo.vehiculoId?.trim() || null,
      notas: cuerpo.notas?.trim() || null,
      sucursalId: cuerpo.sucursalId?.trim() || null,
      qrTokenId: cuerpo.qrTokenId?.trim() || null,
    },
    {
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      iniciadoEn: Date.now(),
    }
  )

  if (!resultado.ok) {
    const code = HTTP_POR_MOTIVO[resultado.motivo]
    console.warn('[redemptions] rechazado:', resultado.motivo, ctx.sistemaSlug, ctx.requestId)
    const fallo = errorApi(code, ctx.requestId, {
      message: resultado.mensaje,
      ...(code === 'BENEFIT_NOT_ELIGIBLE' ? { reason: resultado.motivo } : {}),
    })
    // Un rechazo TAMBIÉN se guarda: si no, el reintento de un satélite que ya
    // recibió «sin usos» volvería a ejecutar el canje y podría encontrarlo
    // recargado — dos respuestas distintas para la misma petición.
    await idem.guardar(fallo.status, await fallo.clone().json())
    return fallo
  }

  const salida = {
    redemptionId: resultado.transaccionId,
    visitId: resultado.visitId,
    codigo: resultado.codigo,
    ticketNumero: resultado.ticketNumero,
    customerId: resultado.clienteId,
    companyId: resultado.companyId,
    servicio: resultado.servicio,
    usesLeft: resultado.ilimitado ? null : resultado.restantes,
    unlimited: resultado.ilimitado,
    redeemedAt: new Date().toISOString(),
  }
  await idem.guardar(200, salida)
  return respuestaApi(salida, ctx.requestId)
}
