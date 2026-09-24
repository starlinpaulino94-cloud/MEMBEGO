import 'server-only'

import type { Prisma, SupplyCubeta, SupplyLoteEstado, SupplyMovimientoTipo } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import {
  agotado,
  aplicarMovimiento,
  saldoVacio,
  validarMovimiento,
  type MovimientoPropuesto,
  type SaldoCubetas,
} from './ledger'
import { puedeTransicionar, TRANSICIONES_LOTE } from './estados'

/**
 * MEMBEGO SUPPLY · el ÚNICO camino hacia el ledger.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA
 *
 * Ninguna cubeta de `supply_lotes` se actualiza fuera de este archivo. Si un
 * módulo necesita mover unidades, llama a `registrarMovimientos`. Escribir un
 * `update` directo sobre `disponibles` es lo que convierte un ledger en un
 * número editable con pasos extra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE GANA LA ÚLTIMA UNIDAD (Fase 9)
 *
 * Tres barreras, y ninguna vive en el navegador:
 *
 *  1. `SELECT … FOR UPDATE` sobre la fila del lote. La segunda transacción
 *     espera a que la primera termine; cuando entra, lee las cubetas YA
 *     actualizadas y su validación falla. Un `findUnique` normal no vale: dos
 *     transacciones leerían «queda 1» a la vez.
 *  2. `validarMovimiento` contra el saldo recién bloqueado.
 *  3. Los CHECK de la migración (cuadre y no-negatividad). Si un día alguien
 *     abre un camino nuevo y se salta los dos primeros, Postgres lo para.
 *
 * `version` sube en cada escritura. No es la defensa —la defensa es el
 * bloqueo— pero deja ver en la conciliación cuántas manos tocaron un lote.
 */

export interface ContextoMovimiento {
  actorId?: string | null
  correlationId?: string | null
}

export interface EntradaMovimiento extends MovimientoPropuesto {
  tipo: SupplyMovimientoTipo
  asignacionId?: string | null
  derechoId?: string | null
  redencionId?: string | null
  referencia?: string | null
}

export interface ResultadoMovimientos {
  loteId: string
  saldo: SaldoCubetas
  estado: SupplyLoteEstado
  movimientoIds: string[]
}

/** Fila del lote tal como la devuelve el bloqueo. */
interface LoteBloqueado {
  id: string
  estado: SupplyLoteEstado
  compradas: number
  disponibles: number
  asignadas: number
  retenidas: number
  emitidas: number
  redimidas: number
  cerradas: number
  version: number
}

/**
 * Bloquea la fila del lote y devuelve sus cubetas.
 *
 * `FOR UPDATE` sin `NOWAIT`: quien llega segundo ESPERA. Fallar de inmediato
 * convertiría dos clientes pulsando «Obtener» a la vez en un error para el
 * segundo aunque quedaran cien unidades — el bloqueo dura microsegundos.
 */
export async function bloquearLote(tx: Tx, loteId: string): Promise<LoteBloqueado> {
  const filas = await tx.$queryRaw<LoteBloqueado[]>`
    SELECT "id", "estado", "compradas", "disponibles", "asignadas",
           "retenidas", "emitidas", "redimidas", "cerradas", "version"
      FROM "supply_lotes"
     WHERE "id" = ${loteId}
     FOR UPDATE
  `
  const lote = filas[0]
  if (!lote) throw new Error(`Lote de supply no encontrado: ${loteId}`)
  return lote
}

function saldoDeFila(lote: LoteBloqueado): SaldoCubetas {
  return {
    DISPONIBLE: lote.disponibles,
    ASIGNADO: lote.asignadas,
    RETENIDO: lote.retenidas,
    EMITIDO: lote.emitidas,
    REDIMIDO: lote.redimidas,
    CERRADO: lote.cerradas,
  }
}

/**
 * Estado que le toca al lote después de mover unidades.
 *
 * AGOTADO y ACTIVO se van y vuelven solos: una reversa de redención devuelve
 * una unidad a EMITIDO y el lote vuelve a tener algo que entregar. Los estados
 * decididos por una persona —CANCELADO, CERRADO— y los que dependen del
 * calendario —VENCIDO— no se tocan aquí: ninguna cantidad los provoca.
 */
function estadoTrasMover(actual: SupplyLoteEstado, saldo: SaldoCubetas): SupplyLoteEstado {
  if (actual !== 'ACTIVO' && actual !== 'AGOTADO') return actual
  const destino: SupplyLoteEstado = agotado(saldo) ? 'AGOTADO' : 'ACTIVO'
  if (destino === actual) return actual
  return puedeTransicionar(TRANSICIONES_LOTE, actual, destino) ? destino : actual
}

/**
 * Registra uno o varios asientos sobre un lote, en orden, de forma atómica.
 *
 * VARIOS Y NO UNO: emitir un derecho desde una campaña es «sacar de ASIGNADO,
 * meter en EMITIDO» — un solo asiento— pero redimir con reserva o convertir un
 * hold en emisión encadenan dos. Pasarlos juntos garantiza que se validen
 * contra el saldo que va quedando y que o entran todos o no entra ninguno.
 *
 * @param tx transacción EN CURSO. No abre la suya: el llamador ya tiene una
 *   (conEmpresa/sinEmpresa) y partir el trabajo en dos transacciones es
 *   exactamente cómo se pierde la atomicidad entre el ledger y el derecho.
 */
export async function registrarMovimientos(
  tx: Tx,
  loteId: string,
  entradas: readonly EntradaMovimiento[],
  ctx: ContextoMovimiento = {}
): Promise<ResultadoMovimientos> {
  if (entradas.length === 0) {
    const lote = await bloquearLote(tx, loteId)
    return { loteId, saldo: saldoDeFila(lote), estado: lote.estado, movimientoIds: [] }
  }

  const lote = await bloquearLote(tx, loteId)
  let saldo = saldoDeFila(lote)

  // Validación completa ANTES de escribir nada: si el tercer asiento de una
  // cadena es imposible, no queda medio movimiento registrado.
  for (const entrada of entradas) {
    const veredicto = validarMovimiento(saldo, entrada)
    if (!veredicto.ok) throw new Error(veredicto.error)
    saldo = aplicarMovimiento(saldo, entrada)
  }

  const movimientoIds: string[] = []
  for (const entrada of entradas) {
    const creado = await tx.supplyMovimiento.create({
      data: {
        loteId,
        tipo: entrada.tipo,
        origen: entrada.origen,
        destino: entrada.destino,
        cantidad: entrada.cantidad,
        asignacionId: entrada.asignacionId ?? null,
        derechoId: entrada.derechoId ?? null,
        redencionId: entrada.redencionId ?? null,
        referencia: entrada.referencia ?? null,
        motivo: entrada.motivo ?? null,
        actorId: ctx.actorId ?? null,
        correlationId: ctx.correlationId ?? null,
      },
      select: { id: true },
    })
    movimientoIds.push(creado.id)
  }

  const comprado =
    saldo.DISPONIBLE + saldo.ASIGNADO + saldo.RETENIDO + saldo.EMITIDO + saldo.REDIMIDO + saldo.CERRADO

  await tx.supplyLote.update({
    where: { id: loteId },
    data: {
      compradas: comprado,
      disponibles: saldo.DISPONIBLE,
      asignadas: saldo.ASIGNADO,
      retenidas: saldo.RETENIDO,
      emitidas: saldo.EMITIDO,
      redimidas: saldo.REDIMIDO,
      cerradas: saldo.CERRADO,
      estado: estadoTrasMover(lote.estado, saldo),
      version: { increment: 1 },
    },
  })

  return {
    loteId,
    saldo,
    estado: estadoTrasMover(lote.estado, saldo),
    movimientoIds,
  }
}

// ── Recálculo desde el ledger ───────────────────────────────────────────────

/**
 * Recalcula las cubetas de un lote SUMANDO SUS ASIENTOS y las guarda.
 *
 * La dirección importa: siempre del ledger al contador, nunca al revés. El
 * contador es caché; si discrepan, el equivocado es el contador.
 *
 * Se usa desde la conciliación (Fase 32) cuando se detecta deriva, y después
 * de una migración de datos. No es una operación rutinaria: si hace falta a
 * menudo, hay un camino escribiendo cubetas fuera de este archivo.
 */
export async function recalcularCubetas(tx: Tx, loteId: string): Promise<SaldoCubetas> {
  await bloquearLote(tx, loteId)

  const grupos = await tx.supplyMovimiento.groupBy({
    by: ['origen', 'destino'],
    where: { loteId },
    _sum: { cantidad: true },
  })

  const saldo = saldoVacio()
  let comprado = 0
  for (const g of grupos) {
    const cantidad = g._sum.cantidad ?? 0
    if (g.origen) saldo[g.origen as SupplyCubeta] -= cantidad
    else comprado += cantidad
    if (g.destino) saldo[g.destino as SupplyCubeta] += cantidad
    else comprado -= cantidad
  }

  await tx.supplyLote.update({
    where: { id: loteId },
    data: {
      compradas: comprado,
      disponibles: saldo.DISPONIBLE,
      asignadas: saldo.ASIGNADO,
      retenidas: saldo.RETENIDO,
      emitidas: saldo.EMITIDO,
      redimidas: saldo.REDIMIDO,
      cerradas: saldo.CERRADO,
      version: { increment: 1 },
    },
  })

  return saldo
}

/** Saldo de un lote leyendo SOLO el ledger (sin tocar los contadores). */
export async function saldoDesdeLedger(tx: Tx, loteId: string): Promise<SaldoCubetas> {
  const grupos = await tx.supplyMovimiento.groupBy({
    by: ['origen', 'destino'],
    where: { loteId },
    _sum: { cantidad: true },
  })
  const saldo = saldoVacio()
  for (const g of grupos) {
    const cantidad = g._sum.cantidad ?? 0
    if (g.origen) saldo[g.origen as SupplyCubeta] -= cantidad
    if (g.destino) saldo[g.destino as SupplyCubeta] += cantidad
  }
  return saldo
}

/**
 * Helper de lectura: `Decimal` de Prisma → número. Los importes del módulo son
 * `Decimal(12,2)` y se formatean/suman en pantalla; convertir en un solo sitio
 * evita que cada consumidor invente su propio `Number(...)`.
 */
export function aNumero(valor: Prisma.Decimal | number | null | undefined): number {
  if (valor == null) return 0
  return typeof valor === 'number' ? valor : Number(valor)
}
