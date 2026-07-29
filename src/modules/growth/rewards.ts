/**
 * Growth Engine 3.0 · Motor de recompensas configurable.
 *
 * Server-internal (SIN 'use server'). Evalúa las reglas (GrowthRule) que la
 * empresa definió para un EVENTO real del embudo y ENTREGA la recompensa:
 * puntos/créditos (wallet), lavados (membresía) o un Beneficio Digital de E8
 * (ProductoCompra activo con QR). Nunca hay recompensas fijas en código.
 *
 * Idempotente: cada recompensa lleva un `dedupeKey` único; reejecutar el mismo
 * disparador no duplica entregas. Nunca lanza: el crecimiento jamás debe romper
 * el flujo principal (registro, activación, compra).
 */

import { prisma } from '@/lib/prisma'
import type { Prisma, GrowthTrigger, GrowthRule, GrowthBeneficiario } from '@prisma/client'
import {
  calcularVencimientoBeneficio,
  registrarTransicionCompra,
} from '@/modules/promociones/compra'
import { logReferralEvent } from '@/lib/referidos'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'

type Tx = Prisma.TransactionClient

export interface EvaluarGrowthInput {
  companyId: string
  trigger: GrowthTrigger
  /** Cliente que invita (dueño del enlace). */
  referenteClienteId?: string | null
  /** Cliente invitado (cuando ya tiene cuenta). */
  referidoClienteId?: string | null
  /** Enlace de invitación concreto (atribución). */
  growthLinkId?: string | null
  /** Vínculo Referido que originó el disparo (auditoría / dedupe). */
  referidoId?: string | null
  /** Contexto de condición: plan comprado, cantidad de referidos, etc. */
  planId?: string | null
  referidosCompletados?: number | null
}

/** ¿Quién recibe la recompensa de esta regla? Devuelve pares (clienteId, rol). */
function beneficiarios(
  benef: GrowthBeneficiario,
  referenteClienteId?: string | null,
  referidoClienteId?: string | null
): { clienteId: string; rol: 'REFERENTE' | 'REFERIDO' }[] {
  const out: { clienteId: string; rol: 'REFERENTE' | 'REFERIDO' }[] = []
  if ((benef === 'REFERENTE' || benef === 'AMBOS') && referenteClienteId) {
    out.push({ clienteId: referenteClienteId, rol: 'REFERENTE' })
  }
  if ((benef === 'REFERIDO' || benef === 'AMBOS') && referidoClienteId) {
    out.push({ clienteId: referidoClienteId, rol: 'REFERIDO' })
  }
  return out
}

/** ¿La condición de la regla se cumple para este disparo? */
function condicionCumple(rule: GrowthRule, input: EvaluarGrowthInput): boolean {
  if (rule.trigger === 'N_REFERIDOS') {
    return (input.referidosCompletados ?? 0) >= rule.valorCondicion
  }
  if (rule.trigger === 'COMPRA' && rule.planId) {
    // Condición de plan específico (ej. solo Plan Gold).
    return input.planId === rule.planId
  }
  return true
}

/**
 * Evalúa y entrega TODAS las recompensas aplicables a un disparo. Devuelve el
 * número de recompensas nuevas creadas (0 si ninguna aplica o ya existían).
 */
export async function evaluarRecompensasGrowth(input: EvaluarGrowthInput): Promise<number> {
  try {
    const reglas = await prisma.growthRule.findMany({
      where: { companyId: input.companyId, trigger: input.trigger, activo: true },
    })
    if (reglas.length === 0) return 0

    let creadas = 0
    for (const rule of reglas) {
      if (!condicionCumple(rule, input)) continue
      for (const b of beneficiarios(rule.beneficiario, input.referenteClienteId, input.referidoClienteId)) {
        const ok = await entregarUna(rule, b.clienteId, input)
        if (ok) creadas++
      }
    }
    return creadas
  } catch (e) {
    console.error('[growth] evaluarRecompensasGrowth', e)
    return 0
  }
}

/** Discriminador de idempotencia según el tipo de disparo. */
function dedupe(rule: GrowthRule, clienteId: string, input: EvaluarGrowthInput): string {
  if (rule.trigger === 'N_REFERIDOS') {
    return `${rule.id}:${clienteId}:umbral:${rule.valorCondicion}`
  }
  const ref = input.referidoId ?? input.referidoClienteId ?? input.growthLinkId ?? 'x'
  return `${rule.id}:${clienteId}:${input.trigger}:${ref}`
}

/** Crea (idempotente) y entrega una recompensa. Devuelve true si es nueva. */
async function entregarUna(
  rule: GrowthRule,
  clienteId: string,
  input: EvaluarGrowthInput
): Promise<boolean> {
  const dedupeKey = dedupe(rule, clienteId, input)

  // Corta temprano si ya existe (evita trabajo y respeta el unique).
  const existe = await prisma.growthReward.findUnique({
    where: { dedupeKey },
    select: { id: true },
  })
  if (existe) return false

  const valor = Number(rule.recompensaValor)
  const descripcion = describir(rule, valor)

  try {
    await prisma.$transaction(async (tx) => {
      const { estado, productoCompraId } = await aplicarEfecto(tx, rule, clienteId, input, valor)
      await tx.growthReward.create({
        data: {
          companyId: input.companyId,
          ruleId: rule.id,
          clienteId,
          growthLinkId: input.growthLinkId ?? null,
          referidoId: input.referidoId ?? null,
          trigger: input.trigger,
          tipo: rule.recompensaTipo,
          valor: rule.recompensaValor,
          descripcion,
          estado,
          productoCompraId,
          entregadaAt: estado === 'ENTREGADA' ? new Date() : null,
          dedupeKey,
        },
      })
    })
  } catch (e) {
    // Carrera con otra ejecución concurrente del mismo disparo: el unique la
    // rechaza y no se duplica. Cualquier otro error se registra sin romper.
    if (
      e instanceof Error &&
      'code' in e &&
      (e as { code?: string }).code === 'P2002'
    ) {
      return false
    }
    console.error('[growth] entregarUna', e)
    return false
  }

  // Evento del embudo (fuera de la transacción; nunca rompe la entrega).
  await logReferralEvent({
    clienteId,
    companyId: input.companyId,
    tipo: 'RECOMPENSA',
    referidoClienteId: input.referidoClienteId ?? null,
    growthLinkId: input.growthLinkId ?? null,
    meta: { ruleId: rule.id, tipo: rule.recompensaTipo, valor },
  })
  return true
}

/** Aplica el efecto de la recompensa y devuelve su estado resultante. */
async function aplicarEfecto(
  tx: Tx,
  rule: GrowthRule,
  clienteId: string,
  input: EvaluarGrowthInput,
  valor: number
): Promise<{ estado: 'ENTREGADA' | 'PENDIENTE'; productoCompraId: string | null }> {
  switch (rule.recompensaTipo) {
    case 'PUNTOS':
      await sumarWallet(tx, input.companyId, clienteId, { puntos: Math.round(valor) })
      return { estado: 'ENTREGADA', productoCompraId: null }

    case 'CREDITOS':
      await sumarWallet(tx, input.companyId, clienteId, { creditos: valor })
      return { estado: 'ENTREGADA', productoCompraId: null }

    case 'LAVADOS_GRATIS': {
      // Compat E6: suma usos a la membresía ACTIVA; si no hay, queda PENDIENTE.
      const upd = await tx.membership.updateMany({
        where: { clienteId, companyId: input.companyId, estado: 'ACTIVA' },
        data: { lavadosRestantes: { increment: Math.round(valor) } },
      })
      return { estado: upd.count > 0 ? 'ENTREGADA' : 'PENDIENTE', productoCompraId: null }
    }

    case 'BENEFICIO': {
      const compraId = await otorgarBeneficio(tx, rule, clienteId, input.companyId)
      return compraId
        ? { estado: 'ENTREGADA', productoCompraId: compraId }
        : { estado: 'PENDIENTE', productoCompraId: null }
    }

    // Descuentos: entrega de negocio (manual). Se registran PENDIENTE.
    case 'DESCUENTO_PORCENTAJE':
    case 'DESCUENTO_MONTO':
    default:
      return { estado: 'PENDIENTE', productoCompraId: null }
  }
}

/** Otorga un Beneficio Digital (E8) como ProductoCompra activo con QR. */
async function otorgarBeneficio(
  tx: Tx,
  rule: GrowthRule,
  clienteId: string,
  companyId: string
): Promise<string | null> {
  if (!rule.recompensaPromocionId) return null
  return crearBeneficioCompra(tx, companyId, clienteId, rule.recompensaPromocionId, 'Recompensa del Growth Engine')
}

/**
 * Crea un ProductoCompra ACTIVO (Beneficio Digital E8) con su QR para el
 * cliente, sin pago ni consumo de cupo. Devuelve el id o null si la promoción
 * no existe o no pertenece a la empresa.
 */
async function crearBeneficioCompra(
  tx: Tx,
  companyId: string,
  clienteId: string,
  promocionId: string,
  motivo: string
): Promise<string | null> {
  const promo = await tx.promocion.findUnique({
    where: { id: promocionId },
    select: {
      id: true, companyId: true, usosPorCompra: true,
      beneficioVigenciaDias: true, beneficioVigenciaHasta: true,
    },
  })
  if (!promo || promo.companyId !== companyId) return null

  const now = new Date()
  const usos = promo.usosPorCompra > 0 ? promo.usosPorCompra : 1
  const compra = await tx.productoCompra.create({
    data: {
      tipo: 'PROMOCION',
      promocionId: promo.id,
      clienteId,
      companyId,
      estado: 'ACTIVA',
      fechaActivacion: now,
      fechaVencimiento: calcularVencimientoBeneficio(promo, now),
      usosIncluidos: usos,
      usosRestantes: usos,
      precioCongelado: 0,
      montoPagado: 0,
      pagoConfirmado: true,
    },
    select: { id: true },
  })
  await registrarTransicionCompra(tx, {
    compraId: compra.id,
    desde: null,
    hacia: 'ACTIVA',
    motivo,
  })
  await tx.qrToken.create({
    data: { clienteId, compraId: compra.id, token: nuevoTokenQr(), expiraAt: vencimientoQr() },
  })
  return compra.id
}

/**
 * Entrega DIRECTA del beneficio ofrecido por un enlace al invitado que se
 * registra (req #4/#5): "solo por aceptar recibirás X". Es el ofrecimiento
 * explícito del enlace (no una regla). Idempotente: no re-otorga si el cliente
 * ya tiene una compra de esa promoción. Devuelve el compraId o null.
 */
export async function otorgarBeneficioReferido(input: {
  companyId: string
  clienteId: string
  promocionId: string
}): Promise<string | null> {
  try {
    const yaTiene = await prisma.productoCompra.count({
      where: { clienteId: input.clienteId, promocionId: input.promocionId },
    })
    if (yaTiene > 0) return null
    return await prisma.$transaction((tx) =>
      crearBeneficioCompra(
        tx,
        input.companyId,
        input.clienteId,
        input.promocionId,
        'Beneficio de bienvenida por invitación'
      )
    )
  } catch (e) {
    console.error('[growth] otorgarBeneficioReferido', e)
    return null
  }
}

/**
 * Entrega DIRECTA de una promoción como beneficio (ProductoCompra ACTIVA + QR),
 * SIN el candado de idempotencia por cliente+promoción. Pensada para premios
 * que se pueden ganar más de una vez (p. ej. la ruleta de la Fase 6B). Devuelve
 * el compraId o null. Solo debe llamarse desde código de servidor autorizado.
 */
export async function otorgarBeneficioDirecto(input: {
  companyId: string
  clienteId: string
  promocionId: string
  motivo?: string
}): Promise<string | null> {
  try {
    return await prisma.$transaction((tx) =>
      crearBeneficioCompra(
        tx,
        input.companyId,
        input.clienteId,
        input.promocionId,
        input.motivo ?? 'Premio de gamificación'
      )
    )
  } catch (e) {
    console.error('[growth] otorgarBeneficioDirecto', e)
    return null
  }
}

/** Suma puntos/créditos al wallet del cliente (crea la fila si no existe). */
async function sumarWallet(
  tx: Tx,
  companyId: string,
  clienteId: string,
  delta: { puntos?: number; creditos?: number }
): Promise<void> {
  await tx.growthWallet.upsert({
    where: { companyId_clienteId: { companyId, clienteId } },
    create: {
      companyId,
      clienteId,
      puntos: delta.puntos ?? 0,
      creditos: delta.creditos ?? 0,
    },
    update: {
      ...(delta.puntos ? { puntos: { increment: delta.puntos } } : {}),
      ...(delta.creditos ? { creditos: { increment: delta.creditos } } : {}),
    },
  })
}

function describir(rule: GrowthRule, valor: number): string {
  switch (rule.recompensaTipo) {
    case 'PUNTOS':
      return `${Math.round(valor)} puntos`
    case 'CREDITOS':
      return `RD$${valor.toFixed(2)} en créditos`
    case 'LAVADOS_GRATIS':
      return `${Math.round(valor)} lavado(s) gratis`
    case 'BENEFICIO':
      return rule.nombre
    case 'DESCUENTO_PORCENTAJE':
      return `${valor}% de descuento`
    case 'DESCUENTO_MONTO':
      return `RD$${valor.toFixed(2)} de descuento`
    default:
      return rule.nombre
  }
}
