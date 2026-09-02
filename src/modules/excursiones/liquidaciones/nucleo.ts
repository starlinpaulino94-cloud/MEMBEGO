/**
 * EXCURSIONES · Liquidaciones — NÚCLEO PURO.
 *
 * Una liquidación es el PAGO de un conjunto de comisiones aprobadas en un
 * período. Es el punto donde el dinero sale de la empresa, así que las reglas
 * son de contabilidad, no de interfaz:
 *
 * 1. UNA COMISIÓN SE LIQUIDA UNA SOLA VEZ. La que ya está en otra liquidación
 *    no se vuelve a incluir, aunque la fecha del período la abarque.
 * 2. EL TOTAL SE CALCULA, NO SE ESCRIBE. Sale de sumar las comisiones netas
 *    incluidas — nadie teclea el monto de un pago.
 * 3. UNA LIQUIDACIÓN PAGADA NO SE EDITA. Ni se le quitan comisiones ni se le
 *    cambia el total: se anula entera (devolviendo sus comisiones al pozo) o
 *    se corrige con un ajuste sobre la comisión concreta.
 */

// ── Estados ──────────────────────────────────────────────────────────────────

export const ESTADOS_LIQUIDACION = ['BORRADOR', 'APROBADA', 'PAGADA', 'ANULADA'] as const
export type EstadoLiquidacion = (typeof ESTADOS_LIQUIDACION)[number]

export const ESTADO_LIQUIDACION_LABEL: Record<EstadoLiquidacion, string> = {
  BORRADOR: 'Borrador',
  APROBADA: 'Aprobada',
  PAGADA: 'Pagada',
  ANULADA: 'Anulada',
}

export const TONO_LIQUIDACION: Record<EstadoLiquidacion, 'success' | 'warning' | 'neutral' | 'info'> = {
  BORRADOR: 'warning',
  APROBADA: 'info',
  PAGADA: 'success',
  ANULADA: 'neutral',
}

const TRANSICIONES: Record<EstadoLiquidacion, EstadoLiquidacion[]> = {
  BORRADOR: ['APROBADA', 'ANULADA'],
  APROBADA: ['PAGADA', 'ANULADA'],
  PAGADA: ['ANULADA'], // solo para revertir un pago que no ocurrió (con motivo)
  ANULADA: [],
}

export function puedeTransicionarLiquidacion(
  desde: EstadoLiquidacion,
  hacia: EstadoLiquidacion
): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia)
}

export function motivoTransicionLiquidacion(
  desde: EstadoLiquidacion,
  hacia: EstadoLiquidacion
): string | null {
  if (puedeTransicionarLiquidacion(desde, hacia)) return null
  if (desde === 'ANULADA') return 'Esta liquidación está anulada: su histórico no se reescribe.'
  if (desde === 'PAGADA' && hacia !== 'ANULADA') {
    return 'Esta liquidación ya se pagó. Solo puede anularse, y eso devuelve sus comisiones al pozo.'
  }
  return `No se puede pasar de ${ESTADO_LIQUIDACION_LABEL[desde]} a ${ESTADO_LIQUIDACION_LABEL[hacia]}.`
}

// ── Numeración y dinero ──────────────────────────────────────────────────────

/** PAY-2026-0014: prefijo + año + correlativo de 4 dígitos. */
export function numeroLiquidacion(prefijo: string, anio: number, n: number): string {
  const p = (prefijo || 'PAY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PAY'
  return `${p}-${anio}-${String(Math.max(1, Math.trunc(n))).padStart(4, '0')}`
}

export function centavos(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/** El total de una liquidación: la suma de los netos que incluye. */
export function totalLiquidacion(netos: number[]): number {
  return centavos(netos.reduce((suma, n) => suma + (Number(n) || 0), 0))
}

export interface ComisionLiquidable {
  id: string
  vendedorId: string
  estado: string
  neto: number
  createdAt: Date
  liquidacionId: string | null
}

/**
 * Qué comisiones entran en una liquidación. Los cuatro filtros son de
 * contabilidad, no de pantalla:
 *
 * - Del vendedor que se va a pagar.
 * - Dentro del período (por la fecha en que se generó la comisión).
 * - APROBADA: para liquidar una comisión debe estar previamente aprobada;
 *   una GENERADA todavía no la aprobó nadie, y una PAGADA o ANULADA ya no debe nada.
 * - Sin liquidación previa: nadie cobra dos veces lo mismo (regla 1).
 *
 * Las de neto cero se dejan fuera: no son un pago, son ruido en el recibo.
 */
export function comisionesDelPeriodo(
  comisiones: ComisionLiquidable[],
  criterio: { vendedorId: string; desde: Date; hasta: Date }
): ComisionLiquidable[] {
  return comisiones.filter(
    (c) =>
      c.vendedorId === criterio.vendedorId &&
      c.liquidacionId === null &&
      c.estado === 'APROBADA' &&
      c.neto > 0 &&
      c.createdAt >= criterio.desde &&
      c.createdAt <= criterio.hasta
  )
}

// ── Validación ───────────────────────────────────────────────────────────────

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export interface PeriodoLiquidacion {
  vendedorId: string
  desde: Date
  hasta: Date
}

/**
 * El período de una liquidación. `hasta` se lleva al final del día: un pago
 * «hasta el 31» que dejara fuera las comisiones de esa tarde sería un error
 * silencioso de los que aparecen un mes después.
 */
export function validarPeriodo(
  form: Record<string, unknown>
): { ok: true; datos: PeriodoLiquidacion } | { ok: false; error: string } {
  const vendedorId = texto(form.vendedorId, 40)
  if (!vendedorId) return { ok: false, error: 'Elige a qué vendedor se le va a liquidar.' }

  const desdeS = texto(form.desde, 10)
  const hastaS = texto(form.hasta, 10)
  if (!FECHA_RE.test(desdeS) || !FECHA_RE.test(hastaS)) {
    return { ok: false, error: 'Elige el período: desde y hasta.' }
  }
  const desde = new Date(`${desdeS}T00:00:00.000Z`)
  const hasta = new Date(`${hastaS}T23:59:59.999Z`)
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    return { ok: false, error: 'Las fechas del período no son válidas.' }
  }
  if (hasta < desde) return { ok: false, error: 'El período termina antes de empezar.' }

  return { ok: true, datos: { vendedorId, desde, hasta } }
}

export interface PagoLiquidacion {
  metodo: string
  referencia: string | null
  notas: string | null
}

/**
 * Los datos del pago. La referencia es obligatoria salvo en efectivo: un pago
 * por transferencia sin número de transacción no se puede reconciliar después,
 * y el vendedor que reclame no tendrá con qué defenderse.
 */
export function validarPagoLiquidacion(
  form: Record<string, unknown>
): { ok: true; datos: PagoLiquidacion } | { ok: false; error: string } {
  const metodo = texto(form.metodo, 40).toUpperCase() || 'EFECTIVO'
  const referencia = texto(form.referencia, 120)
  if (metodo !== 'EFECTIVO' && !referencia) {
    return {
      ok: false,
      error: 'Escribe la referencia del pago (número de transferencia, cheque o depósito).',
    }
  }
  return {
    ok: true,
    datos: { metodo, referencia: referencia || null, notas: texto(form.notas, 500) || null },
  }
}
