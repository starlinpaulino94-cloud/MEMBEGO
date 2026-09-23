import 'server-only'

import { sinEmpresa, type Tx } from '@/lib/tenant'
import type { SupplyDestino } from './catalogo'
import { registrarMovimientos } from './movimientos'

/**
 * MEMBEGO SUPPLY · ALLOCATION ENGINE (Fase 8).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ASIGNAR NO ES CONSUMIR
 *
 * Membego compra 1.000 pizzas sin tener que decidir a qué van. Después aparta
 * 200 para la bienvenida, 500 para una oferta, 100 para referidos. Esas 200 NO
 * están gastadas: están reservadas. Mientras nadie las reclame siguen siendo
 * un activo, y liberarlas cuesta un clic.
 *
 * Los tres números que hay que poder contestar a la vez, y que colapsados en
 * uno hacen ininteligible cualquier campaña:
 *
 *     Asignadas a la campaña     200
 *     Emitidas desde ella        173   ← clientes que ya tienen su voucher
 *     Por emitir                  27   ← cupo que queda
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO PASA POR EL LEDGER
 *
 * Asignar mueve DISPONIBLE → ASIGNADO con un asiento. Liberar lo devuelve.
 * `SupplyAsignacion.cantidad` y `.emitidas` son la vista por campaña; el lote
 * sigue cuadrando por su lado. Las dos cosas salen del mismo ledger, así que
 * no pueden contradecirse.
 */

export interface DatosAsignacion {
  loteId: string
  destinoTipo: SupplyDestino
  destinoId?: string | null
  etiqueta: string
  cantidad: number
  creadoPorId?: string | null
}

export interface ResultadoAsignacion {
  id: string
  loteId: string
  cantidad: number
  disponiblesRestantes: number
}

/**
 * Aparta unidades de un lote para un destino.
 *
 * Concurrencia: `registrarMovimientos` bloquea la fila del lote, así que dos
 * campañas que pidan a la vez las últimas 100 unidades no se llevan 100 cada
 * una — la segunda se encuentra el saldo ya movido y falla con un mensaje que
 * dice cuántas quedaban.
 */
export async function asignar(d: DatosAsignacion): Promise<ResultadoAsignacion> {
  if (!Number.isInteger(d.cantidad) || d.cantidad <= 0) {
    throw new Error('La cantidad a asignar tiene que ser un entero positivo.')
  }
  if (!d.etiqueta.trim()) {
    throw new Error('Una asignación necesita un nombre con el que leerla en los reportes.')
  }

  return sinEmpresa('Membego Supply: la plataforma reparte su supply entre campañas', async (tx) => {
    const asignacion = await tx.supplyAsignacion.create({
      data: {
        loteId: d.loteId,
        destinoTipo: d.destinoTipo,
        destinoId: d.destinoId ?? null,
        etiqueta: d.etiqueta.trim(),
        cantidad: d.cantidad,
        creadoPorId: d.creadoPorId ?? null,
      },
      select: { id: true },
    })

    const res = await registrarMovimientos(
      tx,
      d.loteId,
      [
        {
          tipo: 'ASIGNACION',
          origen: 'DISPONIBLE',
          destino: 'ASIGNADO',
          cantidad: d.cantidad,
          asignacionId: asignacion.id,
          motivo: `Asignación a ${d.etiqueta.trim()}.`,
        },
      ],
      { actorId: d.creadoPorId }
    )

    return {
      id: asignacion.id,
      loteId: d.loteId,
      cantidad: d.cantidad,
      disponiblesRestantes: res.saldo.DISPONIBLE,
    }
  })
}

/**
 * Devuelve al pool unidades apartadas y no emitidas.
 *
 * `cantidad` omitida = liberar TODO lo que queda por emitir, que es lo que se
 * quiere al cerrar una campaña. Lo ya emitido no se toca: esas unidades están
 * en manos de clientes y quitárselas no es "liberar", es revocar, y eso tiene
 * su propio camino con su propio motivo.
 */
export async function liberar(
  asignacionId: string,
  cantidad?: number,
  actorId?: string | null,
  motivo?: string
): Promise<{ liberadas: number; restantes: number }> {
  return sinEmpresa('Membego Supply: liberar unidades apartadas', async (tx) => {
    const asignacion = await tx.supplyAsignacion.findUnique({
      where: { id: asignacionId },
      select: { id: true, loteId: true, cantidad: true, emitidas: true, liberadas: true, etiqueta: true },
    })
    if (!asignacion) throw new Error('Asignación no encontrada.')

    const porEmitir = asignacion.cantidad - asignacion.emitidas - asignacion.liberadas
    const aLiberar = cantidad ?? porEmitir
    if (aLiberar <= 0) return { liberadas: 0, restantes: porEmitir }
    if (aLiberar > porEmitir) {
      throw new Error(
        `Solo quedan ${porEmitir} unidades por emitir en "${asignacion.etiqueta}": no se pueden liberar ${aLiberar}.`
      )
    }

    await registrarMovimientos(
      tx,
      asignacion.loteId,
      [
        {
          tipo: 'LIBERACION_ASIGNACION',
          origen: 'ASIGNADO',
          destino: 'DISPONIBLE',
          cantidad: aLiberar,
          asignacionId: asignacion.id,
          motivo: motivo ?? `Liberación de ${asignacion.etiqueta}.`,
        },
      ],
      { actorId }
    )

    const restantes = porEmitir - aLiberar
    await tx.supplyAsignacion.update({
      where: { id: asignacionId },
      data: {
        liberadas: asignacion.liberadas + aLiberar,
        ...(restantes === 0 ? { activa: false, cerradaAt: new Date() } : {}),
      },
    })

    return { liberadas: aLiberar, restantes }
  })
}

/**
 * Cupo que queda por emitir en una asignación.
 *
 * Se lee DENTRO de la transacción de emisión, después de bloquear el lote: es
 * la comprobación que impide que una campaña de 200 reparta 205 vouchers
 * porque cinco personas pulsaron a la vez.
 */
export async function cupoPorEmitir(tx: Tx, asignacionId: string): Promise<number> {
  const a = await tx.supplyAsignacion.findUnique({
    where: { id: asignacionId },
    select: { cantidad: true, emitidas: true, liberadas: true, activa: true },
  })
  if (!a || !a.activa) return 0
  return Math.max(0, a.cantidad - a.emitidas - a.liberadas)
}

export interface VistaAsignacion {
  id: string
  etiqueta: string
  destinoTipo: string
  destinoId: string | null
  asignadas: number
  emitidas: number
  liberadas: number
  porEmitir: number
  activa: boolean
}

/** Las asignaciones de un lote con los tres números separados. */
export async function asignacionesDeLote(tx: Tx, loteId: string): Promise<VistaAsignacion[]> {
  const filas = await tx.supplyAsignacion.findMany({
    where: { loteId },
    orderBy: { createdAt: 'asc' },
  })
  return filas.map((a) => ({
    id: a.id,
    etiqueta: a.etiqueta,
    destinoTipo: a.destinoTipo,
    destinoId: a.destinoId,
    asignadas: a.cantidad,
    emitidas: a.emitidas,
    liberadas: a.liberadas,
    porEmitir: Math.max(0, a.cantidad - a.emitidas - a.liberadas),
    activa: a.activa,
  }))
}
