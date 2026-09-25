import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyAsientoTipo, SupplyPagoTipo } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { ASIENTOS_MEMORANDO } from './catalogo'

/**
 * MEMBEGO SUPPLY · dinero con el proveedor (Fases 33, 34, 62).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO EXISTE `supplierBalance`
 *
 * El saldo de un proveedor es la SUMA DE SUS ASIENTOS, calculada cada vez. Un
 * campo guardado con el saldo sería el mismo problema que `remaining = 742` un
 * piso más arriba: un número que alguien puede editar y que nadie puede
 * explicar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SIGNO
 *
 * `monto` positivo = A FAVOR DEL PROVEEDOR (Membego le debe más).
 * `monto` negativo = a favor de Membego (un pago, un reembolso, una reversa).
 *
 * Con una sola columna con signo, el saldo es una suma y no hay forma de que
 * dos lecturas del mismo dato den cifras distintas. Con `debe`/`haber` habría
 * que acordarse de restar en el sitio correcto cada vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COMPROMISO_COMPRA NO ES DEUDA
 *
 * Firmar un contrato por RD$300.000 no significa deber RD$300.000 hoy: en
 * PAGO_POR_REDENCION no se debe nada hasta que alguien consuma. Por eso es un
 * asiento MEMORANDO y queda fuera del saldo por pagar, aunque sí entra en el
 * reporte de "contratado vs pagado".
 */

export interface DatosPago {
  acuerdoId: string
  ordenId?: string | null
  tipo: SupplyPagoTipo
  monto: number
  metodo?: string | null
  referencia?: string | null
  notas?: string | null
  periodoDesde?: Date | null
  periodoHasta?: Date | null
  registradoPorId?: string | null
  claveIdempotencia?: string | null
}

/**
 * Registra un pago al proveedor. Nace PENDIENTE y NO mueve el saldo todavía.
 *
 * La separación pendiente/confirmado es la que permite que alguien prepare una
 * liquidación el viernes y tesorería la confirme el lunes sin que el saldo
 * mienta durante el fin de semana.
 */
export async function registrarPago(d: DatosPago): Promise<{ id: string; reutilizado: boolean }> {
  if (d.monto <= 0) throw new Error('El monto de un pago tiene que ser positivo.')

  return sinEmpresa('Membego Supply: pago de la plataforma a un proveedor', async (tx) => {
    if (d.claveIdempotencia) {
      const previo = await tx.supplyPago.findUnique({
        where: { claveIdempotencia: d.claveIdempotencia },
        select: { id: true },
      })
      if (previo) return { id: previo.id, reutilizado: true }
    }

    const acuerdo = await tx.supplyAcuerdo.findUnique({
      where: { id: d.acuerdoId },
      select: { id: true, proveedorId: true, moneda: true },
    })
    if (!acuerdo) throw new Error('Acuerdo no encontrado.')

    const pago = await tx.supplyPago.create({
      data: {
        acuerdoId: acuerdo.id,
        ordenId: d.ordenId ?? null,
        proveedorId: acuerdo.proveedorId,
        tipo: d.tipo,
        monto: new Prisma.Decimal(d.monto),
        moneda: acuerdo.moneda,
        estado: 'PENDIENTE',
        metodo: d.metodo ?? null,
        referencia: d.referencia ?? null,
        notas: d.notas ?? null,
        periodoDesde: d.periodoDesde ?? null,
        periodoHasta: d.periodoHasta ?? null,
        registradoPorId: d.registradoPorId ?? null,
        claveIdempotencia: d.claveIdempotencia ?? null,
      },
      select: { id: true },
    })
    return { id: pago.id, reutilizado: false }
  })
}

/** Tipo de asiento que le corresponde a cada tipo de pago. */
const ASIENTO_DE_PAGO: Record<SupplyPagoTipo, SupplyAsientoTipo> = {
  ANTICIPO: 'DEPOSITO',
  DEPOSITO: 'DEPOSITO',
  LIQUIDACION_REDENCIONES: 'PAGO',
  LIQUIDACION_FINAL: 'PAGO',
  REEMBOLSO: 'REEMBOLSO',
  AJUSTE: 'AJUSTE',
  CREDITO: 'CREDITO',
}

/**
 * Confirma un pago y lo asienta.
 *
 * Un pago SALE de Membego, así que reduce lo que se le debe al proveedor: el
 * asiento va en negativo. Un REEMBOLSO viene del proveedor hacia Membego y
 * también reduce el saldo. Un CREDITO es a favor del proveedor y suma.
 */
export async function confirmarPago(pagoId: string, actorId?: string | null): Promise<void> {
  await sinEmpresa('Membego Supply: confirmación de un pago a proveedor', async (tx) => {
    const pago = await tx.supplyPago.findUnique({
      where: { id: pagoId },
      select: {
        id: true,
        estado: true,
        tipo: true,
        monto: true,
        moneda: true,
        proveedorId: true,
        acuerdoId: true,
        ordenId: true,
        referencia: true,
      },
    })
    if (!pago) throw new Error('Pago no encontrado.')
    if (pago.estado === 'CONFIRMADO') return
    if (pago.estado === 'ANULADO') throw new Error('Un pago anulado no se puede confirmar.')

    const tipoAsiento = ASIENTO_DE_PAGO[pago.tipo]
    const signo = tipoAsiento === 'CREDITO' ? 1 : -1

    await tx.supplyAsientoFinanciero.create({
      data: {
        proveedorId: pago.proveedorId,
        acuerdoId: pago.acuerdoId,
        ordenId: pago.ordenId,
        pagoId: pago.id,
        tipo: tipoAsiento,
        monto: signo === 1 ? pago.monto : pago.monto.negated(),
        moneda: pago.moneda,
        referencia: pago.referencia,
        motivo: `Pago ${pago.tipo} confirmado.`,
        actorId: actorId ?? null,
      },
    })

    await tx.supplyPago.update({
      where: { id: pagoId },
      data: { estado: 'CONFIRMADO', confirmadoAt: new Date() },
    })
  })

  // Fuera de la transacción: avisar abre la suya, y un fallo de la campanita no
  // puede deshacer un pago confirmado.
  const { avisarLiquidacion } = await import('./notificar')
  await avisarLiquidacion(pagoId)
}

export interface SaldoProveedor {
  proveedorId: string
  moneda: string
  /** Lo contratado (memorando): suma de COMPROMISO_COMPRA. */
  contratado: number
  /** Depósitos y anticipos ya entregados. */
  depositado: number
  /** Redenciones que generaron cuenta por pagar. */
  devengado: number
  /** Pagos confirmados (liquidaciones). */
  pagado: number
  reembolsos: number
  creditos: number
  ajustes: number
  /** Lo que Membego le debe HOY. Positivo = se le debe. */
  saldoPorPagar: number
}

/**
 * Saldo de un proveedor, sumando sus asientos.
 *
 * `saldoPorPagar` excluye los memorando: sumarlos haría que Membego apareciera
 * debiendo el contrato entero el día de la firma, incluso en modalidades donde
 * no debe nada hasta que alguien consuma.
 */
export async function saldoDeProveedor(
  tx: Tx,
  proveedorId: string,
  acuerdoId?: string
): Promise<SaldoProveedor> {
  const grupos = await tx.supplyAsientoFinanciero.groupBy({
    by: ['tipo', 'moneda'],
    where: { proveedorId, ...(acuerdoId ? { acuerdoId } : {}) },
    _sum: { monto: true },
  })

  const por = (tipo: SupplyAsientoTipo) =>
    Number(grupos.find((g) => g.tipo === tipo)?._sum.monto ?? 0)

  const moneda = grupos[0]?.moneda ?? 'DOP'
  const saldo = grupos
    .filter((g) => !ASIENTOS_MEMORANDO.includes(g.tipo))
    .reduce((t, g) => t + Number(g._sum.monto ?? 0), 0)

  return {
    proveedorId,
    moneda,
    contratado: por('COMPROMISO_COMPRA'),
    depositado: Math.abs(por('DEPOSITO')),
    devengado: por('REDENCION_POR_PAGAR'),
    pagado: Math.abs(por('PAGO')),
    reembolsos: Math.abs(por('REEMBOLSO')),
    creditos: por('CREDITO'),
    ajustes: por('AJUSTE') + por('REVERSA'),
    saldoPorPagar: Number(saldo.toFixed(2)),
  }
}

export interface LiquidacionPropuesta {
  acuerdoId: string
  proveedorId: string
  desde: Date
  hasta: Date
  redenciones: number
  montoRedenciones: number
  /** Lo ya depositado que todavía cubre estas redenciones. */
  aplicableDeDeposito: number
  /** Lo que habría que transferir de verdad. */
  aPagar: number
  moneda: string
}

/**
 * Propone la liquidación de un período.
 *
 * NO paga: calcula. Quien decide es una persona, y este número es lo que
 * tiene delante cuando lo hace.
 *
 * Las redenciones REVERSADAS quedan fuera —`reversadaAt: null`— porque una
 * entrega que se deshizo no se paga. Es la diferencia entre conciliar y
 * confiar en el conteo del comercio.
 */
export async function proponerLiquidacion(
  acuerdoId: string,
  desde: Date,
  hasta: Date
): Promise<LiquidacionPropuesta> {
  return sinEmpresa('Membego Supply: propuesta de liquidación a un proveedor', async (tx) => {
    const acuerdo = await tx.supplyAcuerdo.findUnique({
      where: { id: acuerdoId },
      select: { id: true, proveedorId: true, moneda: true, modalidadPago: true },
    })
    if (!acuerdo) throw new Error('Acuerdo no encontrado.')

    const redenciones = await tx.supplyRedencion.findMany({
      where: { acuerdoId, reversadaAt: null, createdAt: { gte: desde, lte: hasta } },
      select: { costoUnitario: true },
    })
    const monto = redenciones.reduce((t, r) => t + Number(r.costoUnitario), 0)

    const saldo = await saldoDeProveedor(tx, acuerdo.proveedorId, acuerdoId)

    // Lo prepagado se consume antes de transferir de nuevo: en PREPAGO_TOTAL o
    // PARCIAL, esas redenciones ya están cubiertas y volver a pagarlas sería
    // pagar dos veces la misma pizza.
    const yaCubierto = Math.max(0, saldo.depositado - saldo.pagado)
    const aplicable = Math.min(yaCubierto, monto)

    return {
      acuerdoId,
      proveedorId: acuerdo.proveedorId,
      desde,
      hasta,
      redenciones: redenciones.length,
      montoRedenciones: Number(monto.toFixed(2)),
      aplicableDeDeposito: Number(aplicable.toFixed(2)),
      aPagar: Number((monto - aplicable).toFixed(2)),
      moneda: acuerdo.moneda,
    }
  })
}

/** Movimientos del ledger financiero de un proveedor, para su pantalla. */
export async function asientosDeProveedor(tx: Tx, proveedorId: string, limite = 100) {
  return tx.supplyAsientoFinanciero.findMany({
    where: { proveedorId },
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: {
      id: true,
      tipo: true,
      monto: true,
      moneda: true,
      motivo: true,
      referencia: true,
      createdAt: true,
      acuerdo: { select: { codigo: true } },
    },
  })
}
