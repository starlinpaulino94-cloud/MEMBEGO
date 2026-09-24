import type { SupplyModeloComercial } from '@prisma/client'
import type { SaldoCubetas } from './ledger'

/**
 * MEMBEGO SUPPLY · UNIT ECONOMICS (Fases 35, 36, 62).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE HACE QUE ESTOS NÚMEROS SIGNIFIQUEN ALGO
 *
 * EMITIDO ≠ REDIMIDO. Una unidad emitida es una promesa; solo la redimida
 * costó dinero de verdad, porque solo ahí el proveedor entregó algo. Contar los
 * vouchers emitidos como gasto infla el costo de toda campaña —y hace que
 * regalar parezca más caro de lo que es, que es justo la decisión que estos
 * números tienen que informar.
 *
 * Por eso hay SIETE costos y no uno, y ninguno sustituye a otro:
 *
 *   contratado   lo que dice el contrato
 *   consumido    lo REDIMIDO · el gasto real
 *   asignado     apartado para campañas, todavía recuperable
 *   expuesto     emitido sin canjear · obligación viva
 *   cerrado      vencido o cancelado · pérdida, salvo recuperación
 *   recuperado   devuelto por política de sobrantes
 *   disponible   todavía sin destino
 *
 * PURO: aritmética sobre cifras ya leídas. Sin base, sin proyecciones
 * inventadas — todo sale de movimientos registrados (Fase 38).
 */

export interface CostosDelLote {
  contratado: number
  disponible: number
  asignado: number
  retenido: number
  expuesto: number
  consumido: number
  cerrado: number
}

/** Reparte el costo del lote entre las cubetas. Todo a costo unitario. */
export function costosDeLote(saldo: SaldoCubetas, costoUnitario: number): CostosDelLote {
  const c = (n: number) => Number((n * costoUnitario).toFixed(2))
  const comprado =
    saldo.DISPONIBLE + saldo.ASIGNADO + saldo.RETENIDO + saldo.EMITIDO + saldo.REDIMIDO + saldo.CERRADO
  return {
    contratado: c(comprado),
    disponible: c(saldo.DISPONIBLE),
    asignado: c(saldo.ASIGNADO),
    retenido: c(saldo.RETENIDO),
    expuesto: c(saldo.EMITIDO),
    consumido: c(saldo.REDIMIDO),
    cerrado: c(saldo.CERRADO),
  }
}

// ── Economía por unidad ─────────────────────────────────────────────────────

export interface UnidadEconomia {
  /** Lo que le costó a Membego adquirirla. */
  costoAdquisicion: number
  /** Lo que el cliente le pagó A MEMBEGO (0 en un regalo). */
  ingresoCliente: number
  /** Ingreso − costo. Negativo en un regalo: es marketing, no pérdida. */
  margenBruto: number
  /** Costo de adquisición de cliente imputable a esta unidad. */
  cac: number
  /** Precio público de referencia, para medir el descuento conseguido. */
  precioReferencia: number | null
  /** % de descuento sobre el precio público, si se conoce. */
  descuentoPorcentaje: number | null
}

/**
 * Economía de UNA unidad entregada.
 *
 * `cac` solo se llena cuando el cliente no pagó nada: una unidad vendida a
 * RD$399 no es costo de adquisición, es una venta con margen. Mezclarlas hace
 * que el CAC de una campaña dependa de cuántas unidades se vendieron aparte.
 *
 * Antes de comisiones de pasarela, impuestos, soporte y reembolsos — que no se
 * inventan aquí: se restan cuando existan datos reales.
 */
export function economiaUnidad(
  costoAdquisicion: number,
  ingresoCliente: number,
  precioReferencia?: number | null
): UnidadEconomia {
  const margen = Number((ingresoCliente - costoAdquisicion).toFixed(2))
  return {
    costoAdquisicion,
    ingresoCliente,
    margenBruto: margen,
    cac: ingresoCliente === 0 ? costoAdquisicion : 0,
    precioReferencia: precioReferencia ?? null,
    descuentoPorcentaje:
      precioReferencia && precioReferencia > 0
        ? Number((((precioReferencia - costoAdquisicion) / precioReferencia) * 100).toFixed(1))
        : null,
  }
}

// ── Economía de una campaña (Fase 36) ───────────────────────────────────────

export interface EconomiaCampana {
  asignadas: number
  emitidas: number
  redimidas: number
  porEmitir: number
  activasSinCanjear: number
  costoUnitario: number
  /** Lo apartado, a costo. Todavía recuperable liberándolo. */
  costoComprometido: number
  /** Lo REDIMIDO, a costo. El gasto real de la campaña. */
  costoConsumido: number
  /** Lo emitido sin canjear, a costo. Obligación viva. */
  costoExpuesto: number
  ingresos: number
  /** Cuántas de las emitidas llegaron a usarse. */
  tasaRedencion: number
  /** Costo real por cliente que efectivamente consumió. */
  costoPorRedencion: number
}

export function economiaCampana(d: {
  asignadas: number
  emitidas: number
  liberadas: number
  redimidas: number
  costoUnitario: number
  ingresos?: number
}): EconomiaCampana {
  const activasSinCanjear = Math.max(0, d.emitidas - d.redimidas)
  const porEmitir = Math.max(0, d.asignadas - d.emitidas - d.liberadas)
  const r2 = (n: number) => Number(n.toFixed(2))
  return {
    asignadas: d.asignadas,
    emitidas: d.emitidas,
    redimidas: d.redimidas,
    porEmitir,
    activasSinCanjear,
    costoUnitario: d.costoUnitario,
    costoComprometido: r2(porEmitir * d.costoUnitario),
    costoConsumido: r2(d.redimidas * d.costoUnitario),
    costoExpuesto: r2(activasSinCanjear * d.costoUnitario),
    ingresos: r2(d.ingresos ?? 0),
    tasaRedencion: d.emitidas === 0 ? 0 : Number(((d.redimidas / d.emitidas) * 100).toFixed(1)),
    costoPorRedencion: d.redimidas === 0 ? 0 : r2((d.redimidas * d.costoUnitario) / d.redimidas),
  }
}

// ── Compra completa vs subsidio (Fase 24) ───────────────────────────────────

export interface DesgloseSubsidio {
  /** Precio público de la unidad. */
  precioPublico: number
  /** Lo que aporta Membego. */
  aporteMembego: number
  /** Lo que el cliente le paga al COMERCIO. */
  aporteCliente: number
  /** Lo que el comercio tiene derecho a cobrar en total. */
  porCobrarComercio: number
}

/**
 * Desglosa una operación subsidiada.
 *
 * Lo que impide el error caro: en un subsidio, el comercio cobra el total
 * (parte del cliente + parte de Membego). En una compra completa, el comercio
 * ya cobró por contrato y el cliente NO paga la unidad base. Devolver el mismo
 * objeto para los dos casos con números distintos sería una invitación a
 * sumarlos mal, así que esta función solo acepta subsidios.
 */
export function desglosarSubsidio(
  modelo: SupplyModeloComercial,
  precioPublico: number,
  aporteMembego: number
): DesgloseSubsidio {
  if (modelo !== 'SUBSIDIO') {
    throw new Error(
      'desglosarSubsidio solo aplica a SUBSIDIO. En una compra de unidad completa el cliente no paga la unidad base.'
    )
  }
  const aporteCliente = Number(Math.max(0, precioPublico - aporteMembego).toFixed(2))
  return {
    precioPublico,
    aporteMembego,
    aporteCliente,
    porCobrarComercio: Number((aporteCliente + aporteMembego).toFixed(2)),
  }
}

// ── Adquisición (Fases 37-38) ───────────────────────────────────────────────

export interface MetricasAdquisicion {
  clientesAlcanzados: number
  clientesQueRedimieron: number
  costoTotal: number
  /** Costo por cliente que RECIBIÓ el beneficio. */
  costoPorCliente: number
  /** Costo por cliente que efectivamente lo CONSUMIÓ. El que importa. */
  costoPorClienteActivado: number
  /** % de los que recibieron y llegaron a usarlo. */
  tasaActivacion: number
}

/**
 * CAC real de una campaña.
 *
 * Los dos costos por cliente se dan juntos a propósito: el primero es el que
 * sale de dividir presupuesto entre vouchers y siempre parece mejor; el
 * segundo es el que se paga de verdad. Enseñar solo uno de los dos es como se
 * justifican campañas que no funcionaron.
 */
export function metricasAdquisicion(d: {
  clientesAlcanzados: number
  clientesQueRedimieron: number
  costoConsumido: number
}): MetricasAdquisicion {
  const r2 = (n: number) => Number(n.toFixed(2))
  return {
    clientesAlcanzados: d.clientesAlcanzados,
    clientesQueRedimieron: d.clientesQueRedimieron,
    costoTotal: r2(d.costoConsumido),
    costoPorCliente: d.clientesAlcanzados === 0 ? 0 : r2(d.costoConsumido / d.clientesAlcanzados),
    costoPorClienteActivado:
      d.clientesQueRedimieron === 0 ? 0 : r2(d.costoConsumido / d.clientesQueRedimieron),
    tasaActivacion:
      d.clientesAlcanzados === 0
        ? 0
        : Number(((d.clientesQueRedimieron / d.clientesAlcanzados) * 100).toFixed(1)),
  }
}

export interface LtvVsCac {
  cac: number
  /** GMV que esos clientes generaron DESPUÉS de adquirirlos. Dato real. */
  gmvPosterior: number
  ltvPorCliente: number
  /** Cuántas veces se recupera el CAC. Null si todavía no hay CAC. */
  multiplo: number | null
}

/**
 * LTV frente a CAC con datos REGISTRADOS.
 *
 * Sin proyecciones: si un cliente lleva dos semanas en la plataforma, su LTV
 * es lo que ha gastado en dos semanas. Extrapolar a doce meses produce el
 * número que todo el mundo quiere ver y nadie puede defender (Fase 38).
 */
export function ltvVsCac(d: {
  costoAdquisicionTotal: number
  clientes: number
  gmvPosterior: number
}): LtvVsCac {
  const r2 = (n: number) => Number(n.toFixed(2))
  const cac = d.clientes === 0 ? 0 : r2(d.costoAdquisicionTotal / d.clientes)
  const ltv = d.clientes === 0 ? 0 : r2(d.gmvPosterior / d.clientes)
  return {
    cac,
    gmvPosterior: r2(d.gmvPosterior),
    ltvPorCliente: ltv,
    multiplo: cac === 0 ? null : Number((ltv / cac).toFixed(2)),
  }
}

// ── Scorecard de proveedor (Fase 31) ────────────────────────────────────────

export interface ScorecardProveedor {
  contratadas: number
  emitidas: number
  redimidas: number
  reversadas: number
  incidencias: number
  incumplimientos: number
  /** % de vouchers emitidos que el comercio llegó a cumplir. */
  tasaCumplimiento: number
  /** % de redenciones que hubo que reversar. */
  tasaReversa: number
  /** % de redenciones con incidencia de incumplimiento. */
  tasaIncumplimiento: number
  /** 0-100. Determinista, sin IA (Fase 54). */
  puntaje: number
}

/**
 * Puntaje de un proveedor.
 *
 * Fórmula deliberadamente simple y explicable: se parte de la tasa de
 * cumplimiento y se penalizan reversas e incumplimientos. Un proveedor tiene
 * derecho a entender por qué Membego decidió no volver a comprarle, y una
 * puntuación que nadie sabe reproducir no sirve para esa conversación.
 */
export function scorecard(d: {
  contratadas: number
  emitidas: number
  redimidas: number
  reversadas: number
  incidencias: number
  incumplimientos: number
}): ScorecardProveedor {
  const pct = (n: number, sobre: number) => (sobre === 0 ? 0 : Number(((n / sobre) * 100).toFixed(1)))
  const tasaCumplimiento = pct(d.redimidas, d.emitidas)
  const tasaReversa = pct(d.reversadas, d.redimidas)
  const tasaIncumplimiento = pct(d.incumplimientos, d.redimidas)

  // Sin entregas todavía no hay nada que puntuar: un proveedor nuevo no es ni
  // bueno ni malo, y darle 0 lo dejaría fuera de la siguiente compra por no
  // haber tenido una primera.
  const puntaje =
    d.emitidas === 0
      ? 100
      : Math.max(0, Math.min(100, Math.round(tasaCumplimiento - tasaReversa * 2 - tasaIncumplimiento * 3)))

  return {
    contratadas: d.contratadas,
    emitidas: d.emitidas,
    redimidas: d.redimidas,
    reversadas: d.reversadas,
    incidencias: d.incidencias,
    incumplimientos: d.incumplimientos,
    tasaCumplimiento,
    tasaReversa,
    tasaIncumplimiento,
    puntaje,
  }
}
