import 'server-only'
import type { Tx } from '@/lib/tenant'
import {
  ipParaRegistro,
  userAgentParaRegistro,
  type ContextoConsentimiento,
  type OrigenConsentimiento,
  type TipoConsentimiento,
} from '@/modules/pagos/consentimientosCore'

/**
 * REGISTRO DE CONSENTIMIENTOS sobre la tarjeta guardada.
 *
 * Todo recibe una transacción abierta: el consentimiento tiene que quedar en el
 * mismo instante atómico que lo que autoriza. Una tarjeta guardada sin su
 * consentimiento —o una renovación encendida sin el suyo— es el estado que esta
 * tabla existe para impedir.
 *
 * Solo se inserta. Lo único que se modifica de una fila es `revocadoAt`.
 *
 * «Consultar y luego crear» se serializa con un candado de transacción por
 * cliente que toma `otorgarConsentimiento` por su cuenta (no depende de quien
 * lo llama): dos peticiones a la vez del mismo cliente no se pisan. Los índices
 * únicos parciales de la migración son la segunda barrera.
 */

export interface OtorgarConsentimientoInput {
  companyId: string
  clienteId: string
  tipo: TipoConsentimiento
  tarjetaId: string
  /** Solo para RENOVACION_AUTOMATICA: la membresía que se renovará sola. */
  membershipId?: string | null
  contexto: ContextoConsentimiento
  origen?: OrigenConsentimiento
}

/**
 * Registra un consentimiento, o devuelve el vigente si ya había uno igual.
 *
 * IDEMPOTENTE: aceptar dos veces lo mismo (doble clic, un reintento) no deja
 * dos filas vigentes ni reescribe la fecha del primero.
 *
 * Renovar con OTRA tarjeta no es lo mismo que renovar con la misma: el cliente
 * consintió que se cobre ESA tarjeta. Se revoca el consentimiento anterior y se
 * registra uno nuevo, de modo que el historial dice qué tarjeta estuvo
 * autorizada en cada momento.
 */
export async function otorgarConsentimiento(
  tx: Tx,
  input: OtorgarConsentimientoInput
): Promise<{ id: string; creado: boolean }> {
  const membershipId = input.tipo === 'RENOVACION_AUTOMATICA' ? (input.membershipId ?? null) : null
  if (input.tipo === 'RENOVACION_AUTOMATICA' && !membershipId) {
    throw new Error('otorgarConsentimiento: la renovación automática exige una membresía.')
  }

  // Un candado de la base que vive lo que dura la transacción: la segunda
  // petición espera a que la primera termine, ve su consentimiento y no crea otro.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consentimiento:${input.clienteId}`}, 0))`

  const vigente = await tx.consentimientoPago.findFirst({
    where: {
      clienteId: input.clienteId,
      tipo: input.tipo,
      revocadoAt: null,
      // Guardar es por tarjeta; renovar es por membresía.
      ...(membershipId ? { membershipId } : { tarjetaId: input.tarjetaId, membershipId: null }),
    },
    select: { id: true, tarjetaId: true },
  })

  if (vigente) {
    if (!membershipId || vigente.tarjetaId === input.tarjetaId) {
      return { id: vigente.id, creado: false }
    }
    await tx.consentimientoPago.update({
      where: { id: vigente.id },
      data: { revocadoAt: new Date() },
    })
  }

  const fila = await tx.consentimientoPago.create({
    data: {
      companyId: input.companyId,
      clienteId: input.clienteId,
      tipo: input.tipo,
      tarjetaId: input.tarjetaId,
      membershipId,
      origen: input.origen ?? 'CLIENTE',
      textoVersion: input.contexto.textoVersion,
      ipAddress: ipParaRegistro(input.contexto.ip),
      userAgent: userAgentParaRegistro(input.contexto.userAgent),
    },
    select: { id: true },
  })
  return { id: fila.id, creado: true }
}

export interface FiltroConsentimientos {
  tipo?: TipoConsentimiento
  tarjetaId?: string
  membershipId?: string
}

/**
 * Retira los consentimientos VIGENTES que cumplan el filtro. Devuelve cuántos.
 *
 * Exige al menos un filtro de alcance (`tarjetaId` o `membershipId`): una
 * revocación sin límites borraría el consentimiento de todo el mundo, y el
 * descuido que lo provocara no dejaría ningún error que lo delatara.
 */
export async function revocarConsentimientos(
  tx: Tx,
  filtro: FiltroConsentimientos
): Promise<number> {
  if (!filtro.tarjetaId && !filtro.membershipId) {
    throw new Error('revocarConsentimientos: hace falta tarjetaId o membershipId.')
  }
  const r = await tx.consentimientoPago.updateMany({
    where: {
      revocadoAt: null,
      ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
      ...(filtro.tarjetaId ? { tarjetaId: filtro.tarjetaId } : {}),
      ...(filtro.membershipId ? { membershipId: filtro.membershipId } : {}),
    },
    data: { revocadoAt: new Date() },
  })
  return r.count
}

/**
 * El consentimiento vigente de este tipo para esa membresía / tarjeta, o `null`.
 *
 * Devuelve QUÉ texto aceptó el cliente y por qué camino, no solo que existe: el
 * cobro necesita saber si lo que se le prometió incluye un aviso previo
 * (`exigeAvisoPrevio`), y el aviso de una renovación heredada invita a revisarla.
 * Si hubiera más de uno vigente —no debería: los índices únicos parciales lo
 * impiden—, se toma el más reciente.
 */
export async function consentimientoVigente(
  tx: Tx,
  filtro: { tipo: TipoConsentimiento; membershipId?: string; tarjetaId?: string }
): Promise<{ textoVersion: string; origen: string } | null> {
  if (!filtro.tarjetaId && !filtro.membershipId) return null
  return tx.consentimientoPago.findFirst({
    where: {
      tipo: filtro.tipo,
      revocadoAt: null,
      ...(filtro.membershipId ? { membershipId: filtro.membershipId } : {}),
      ...(filtro.tarjetaId ? { tarjetaId: filtro.tarjetaId } : {}),
    },
    orderBy: { otorgadoAt: 'desc' },
    select: { textoVersion: true, origen: true },
  })
}

/** ¿Hay un consentimiento vigente de este tipo para esa membresía / tarjeta? */
export async function tieneConsentimientoVigente(
  tx: Tx,
  filtro: { tipo: TipoConsentimiento; membershipId?: string; tarjetaId?: string }
): Promise<boolean> {
  return (await consentimientoVigente(tx, filtro)) !== null
}
