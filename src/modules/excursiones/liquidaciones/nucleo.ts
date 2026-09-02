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
  tipoCalculo?: string | null
}

/** Comprueba si el tipo de remuneración es en especie (no suma a transferencia en efectivo). */
export function esRemuneracionEspecie(tipoCalculo?: string | null): boolean {
  return tipoCalculo === 'PAQUETE_REGALO'
}

/**
 * Total en efectivo de comisiones monetarias (excluye premios en especie).
 */
export function totalMonetarioComisiones(
  comisiones: Array<{ neto: number; tipoCalculo?: string | null }>
): number {
  return centavos(
    comisiones.reduce((suma, c) => {
      if (esRemuneracionEspecie(c.tipoCalculo)) return suma
      return suma + (Number(c.neto) || 0)
    }, 0)
  )
}

export interface LineaLiquidacionParaResumen {
  id: string
  tipoCalculo?: string | null
  monto: number
  neto: number
  ajustes: Array<{ monto: number; motivo?: string }>
  desglose?: string
}

export interface BonoLiquidacionParaResumen {
  id: string
  descripcion: string
  monto: number
  moneda?: string
}

export interface ResumenRemuneracion {
  porcentaje: { total: number; cantidad: number }
  fijoAdulto: { total: number; cantidad: number }
  fijoNino: { total: number; cantidad: number }
  fijoVenta: { total: number; cantidad: number }
  fijoPasajero: { total: number; cantidad: number }
  escalon: { total: number; cantidad: number }
  bonosMetas: { total: number; cantidad: number }
  ajustesPositivos: { total: number; cantidad: number }
  ajustesNegativos: { total: number; cantidad: number }
  premiosEspecie: { valorEstimado: number; cantidad: number; descripciones: string[] }
  totalMonetario: number
}

/**
 * Consolida el desglose por tipo de remuneración de una liquidación.
 * Separa comisiones monetarias, bonos por metas y premios en especie (vouchers).
 */
export function resumenRemuneracionLiquidacion(
  lineas: LineaLiquidacionParaResumen[],
  bonos: BonoLiquidacionParaResumen[] = []
): ResumenRemuneracion {
  let porcentajeTotal = 0
  let porcentajeCant = 0
  let fijoAdultoTotal = 0
  let fijoAdultoCant = 0
  let fijoNinoTotal = 0
  let fijoNinoCant = 0
  let fijoVentaTotal = 0
  let fijoVentaCant = 0
  let fijoPasajeroTotal = 0
  let fijoPasajeroCant = 0
  let escalonTotal = 0
  let escalonCant = 0
  let ajustesPosTotal = 0
  let ajustesPosCant = 0
  let ajustesNegTotal = 0
  let ajustesNegCant = 0
  let especieValor = 0
  let especieCant = 0
  const especieDesc: string[] = []

  for (const l of lineas) {
    const tipo = (l.tipoCalculo || '').toUpperCase()

    // Ajustes
    for (const a of l.ajustes) {
      const mAjuste = Number(a.monto) || 0
      if (mAjuste > 0) {
        ajustesPosTotal += mAjuste
        ajustesPosCant += 1
      } else if (mAjuste < 0) {
        ajustesNegTotal += Math.abs(mAjuste)
        ajustesNegCant += 1
      }
    }

    if (tipo === 'PAQUETE_REGALO') {
      especieValor += Number(l.monto) || 0
      especieCant += 1
      if (l.desglose) especieDesc.push(l.desglose)
      continue
    }

    const neto = Number(l.neto) || 0
    switch (tipo) {
      case 'PORCENTAJE':
        porcentajeTotal += neto
        porcentajeCant += 1
        break
      case 'FIJO_ADULTO':
        fijoAdultoTotal += neto
        fijoAdultoCant += 1
        break
      case 'FIJO_NINO':
        fijoNinoTotal += neto
        fijoNinoCant += 1
        break
      case 'FIJO_VENTA':
        fijoVentaTotal += neto
        fijoVentaCant += 1
        break
      case 'FIJO_PASAJERO':
        fijoPasajeroTotal += neto
        fijoPasajeroCant += 1
        break
      case 'ESCALON':
        escalonTotal += neto
        escalonCant += 1
        break
      default:
        porcentajeTotal += neto
        porcentajeCant += 1
        break
    }
  }

  let bonosTotal = 0
  for (const b of bonos) {
    bonosTotal += Number(b.monto) || 0
  }

  const comisionesMonetarias =
    porcentajeTotal +
    fijoAdultoTotal +
    fijoNinoTotal +
    fijoVentaTotal +
    fijoPasajeroTotal +
    escalonTotal

  const totalMonetario = centavos(comisionesMonetarias + bonosTotal)

  return {
    porcentaje: { total: centavos(porcentajeTotal), cantidad: porcentajeCant },
    fijoAdulto: { total: centavos(fijoAdultoTotal), cantidad: fijoAdultoCant },
    fijoNino: { total: centavos(fijoNinoTotal), cantidad: fijoNinoCant },
    fijoVenta: { total: centavos(fijoVentaTotal), cantidad: fijoVentaCant },
    fijoPasajero: { total: centavos(fijoPasajeroTotal), cantidad: fijoPasajeroCant },
    escalon: { total: centavos(escalonTotal), cantidad: escalonCant },
    bonosMetas: { total: centavos(bonosTotal), cantidad: bonos.length },
    ajustesPositivos: { total: centavos(ajustesPosTotal), cantidad: ajustesPosCant },
    ajustesNegativos: { total: centavos(ajustesNegTotal), cantidad: ajustesNegCant },
    premiosEspecie: {
      valorEstimado: centavos(especieValor),
      cantidad: especieCant,
      descripciones: especieDesc,
    },
    totalMonetario,
  }
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
      (c.neto > 0 || c.tipoCalculo === 'PAQUETE_REGALO') &&
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
