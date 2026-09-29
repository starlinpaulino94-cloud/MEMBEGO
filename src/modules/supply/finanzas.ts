import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyAsientoTipo, SupplyPagoTipo } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { ASIENTOS_MEMORANDO } from './catalogo'
import { ASIENTO_DE_PAGO, redondear2, signoDeAsiento } from './dinero'
import { activarDepositoEnTx } from './depositos'
import { saldarCuentaPorPagarEnTx } from './cuentas'
import { fondearOrdenEnTx } from './procurement'

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
 * `monto` negativo = a favor de Membego (un pago, un depósito, una cuenta por
 * cobrar). La regla vive en `dinero.ts:signoDeAsiento`, que es puro y se
 * prueba: la auditoría del 29-09-2026 encontró el reembolso al revés.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COMPROMISO_COMPRA NO ES DEUDA
 *
 * Firmar un contrato por RD$300.000 no significa deber RD$300.000 hoy: en
 * PAGO_POR_REDENCION no se debe nada hasta que alguien consuma. Por eso es un
 * asiento MEMORANDO y queda fuera del saldo por pagar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASA AL CONFIRMAR UN PAGO (auditoría H4)
 *
 * Además del asiento: si el pago fondea un DEPÓSITO, el depósito se abre; si
 * lleva `ordenId`, la orden pasa sola a PARCIALMENTE_FONDEADA o FONDEADA; si
 * lleva `cuentaPorPagarId`, esa cuenta se salda en lo que cubra el pago. Todo
 * en la MISMA transacción: un pago confirmado a medias es la clase de estado
 * que luego nadie sabe explicar.
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
  /** Cuenta por pagar que este pago salda (una factura pagada aparte). */
  cuentaPorPagarId?: string | null
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
  return sinEmpresa('Membego Supply: pago de la plataforma a un proveedor', (tx) => registrarPagoEnTx(tx, d))
}

export async function registrarPagoEnTx(tx: Tx, d: DatosPago): Promise<{ id: string; reutilizado: boolean }> {
  if (!Number.isFinite(d.monto) || d.monto <= 0) throw new Error('El monto de un pago tiene que ser positivo.')

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

  if (d.cuentaPorPagarId) {
    const cxp = await tx.supplyCuentaPorPagar.findUnique({
      where: { id: d.cuentaPorPagarId },
      select: { proveedorId: true, estado: true },
    })
    if (!cxp || cxp.proveedorId !== acuerdo.proveedorId) {
      throw new Error('La cuenta por pagar no es de este proveedor.')
    }
    if (cxp.estado === 'SALDADA' || cxp.estado === 'CANCELADA') {
      throw new Error(`La cuenta por pagar ya está ${cxp.estado.toLowerCase()}.`)
    }
  }

  const pago = await tx.supplyPago.create({
    data: {
      acuerdoId: acuerdo.id,
      ordenId: d.ordenId ?? null,
      proveedorId: acuerdo.proveedorId,
      tipo: d.tipo,
      monto: new Prisma.Decimal(redondear2(d.monto)),
      moneda: acuerdo.moneda,
      estado: 'PENDIENTE',
      metodo: d.metodo ?? null,
      referencia: d.referencia ?? null,
      notas: d.notas ?? null,
      periodoDesde: d.periodoDesde ?? null,
      periodoHasta: d.periodoHasta ?? null,
      cuentaPorPagarId: d.cuentaPorPagarId ?? null,
      registradoPorId: d.registradoPorId ?? null,
      claveIdempotencia: d.claveIdempotencia ?? null,
    },
    select: { id: true },
  })
  return { id: pago.id, reutilizado: false }
}

/**
 * Confirma un pago y lo asienta, con todos sus efectos en una transacción.
 */
export async function confirmarPago(pagoId: string, actorId?: string | null): Promise<void> {
  await sinEmpresa('Membego Supply: confirmación de un pago a proveedor', async (tx) => {
    await confirmarPagoEnTx(tx, pagoId, actorId)
  })

  // Fuera de la transacción: avisar abre la suya, y un fallo de la campanita no
  // puede deshacer un pago confirmado.
  const { avisarLiquidacion } = await import('./notificar')
  await avisarLiquidacion(pagoId)
}

export async function confirmarPagoEnTx(tx: Tx, pagoId: string, actorId?: string | null): Promise<void> {
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
      cuentaPorPagarId: true,
      deposito: { select: { id: true } },
    },
  })
  if (!pago) throw new Error('Pago no encontrado.')
  if (pago.estado === 'CONFIRMADO') return
  if (pago.estado === 'ANULADO') throw new Error('Un pago anulado no se puede confirmar.')

  const tipoAsiento = ASIENTO_DE_PAGO[pago.tipo]
  const signo = signoDeAsiento(tipoAsiento)

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

  if (pago.deposito) await activarDepositoEnTx(tx, pago.deposito.id, actorId)
  if (pago.ordenId) await fondearOrdenEnTx(tx, pago.ordenId)
  if (pago.cuentaPorPagarId && signo === -1) {
    await saldarCuentaPorPagarEnTx(tx, pago.cuentaPorPagarId, Number(pago.monto), {
      via: 'PAGO',
      referencia: pago.id,
      actorId,
    })
  }
}

/**
 * Anula un pago PENDIENTE. Un pago confirmado no se anula: se registra un
 * reembolso o un ajuste, que es un hecho nuevo con su propio asiento.
 */
export async function anularPago(pagoId: string, motivo: string, actorId?: string | null): Promise<void> {
  if (!motivo.trim()) throw new Error('Anular un pago exige un motivo.')
  await sinEmpresa('Membego Supply: anular un pago pendiente', async (tx) => {
    const pago = await tx.supplyPago.findUnique({
      where: { id: pagoId },
      select: { estado: true, deposito: { select: { id: true, estado: true } } },
    })
    if (!pago) throw new Error('Pago no encontrado.')
    if (pago.estado !== 'PENDIENTE') throw new Error(`Solo se anula un pago pendiente; este está ${pago.estado}.`)
    await tx.supplyPago.update({
      where: { id: pagoId },
      data: { estado: 'ANULADO', anuladoAt: new Date(), anuladoMotivo: motivo.trim() },
    })
    if (pago.deposito && pago.deposito.estado === 'PENDIENTE') {
      await tx.supplyDeposito.update({
        where: { id: pago.deposito.id },
        data: { estado: 'CANCELADO', cerradoAt: new Date(), cerradoMotivo: `Pago anulado: ${motivo.trim()}` },
      })
    }
    void actorId
  })
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
  /** Cuentas por pagar nacidas (facturas, ventas, ajustes). */
  cuentasPorPagar: number
  /** Cuentas por cobrar nacidas (a favor de Membego). */
  cuentasPorCobrar: number
  /** Pagos confirmados (liquidaciones). */
  pagado: number
  reembolsos: number
  creditos: number
  ajustes: number
  /** Lo que Membego le debe HOY. Positivo = se le debe; negativo = le deben. */
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
    grupos.filter((g) => g.tipo === tipo).reduce((t, g) => t + Number(g._sum.monto ?? 0), 0)

  const moneda = grupos[0]?.moneda ?? 'DOP'
  const saldo = grupos
    .filter((g) => !ASIENTOS_MEMORANDO.includes(g.tipo))
    .reduce((t, g) => t + Number(g._sum.monto ?? 0), 0)

  return {
    proveedorId,
    moneda,
    contratado: redondear2(por('COMPROMISO_COMPRA')),
    depositado: redondear2(Math.abs(por('DEPOSITO'))),
    devengado: redondear2(por('REDENCION_POR_PAGAR')),
    cuentasPorPagar: redondear2(por('CUENTA_POR_PAGAR')),
    cuentasPorCobrar: redondear2(Math.abs(por('CUENTA_POR_COBRAR'))),
    pagado: redondear2(Math.abs(por('PAGO'))),
    reembolsos: redondear2(por('REEMBOLSO')),
    creditos: redondear2(por('CREDITO')),
    ajustes: redondear2(por('AJUSTE') + por('REVERSA')),
    saldoPorPagar: redondear2(saldo),
  }
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
