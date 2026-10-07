import { Prisma, type MerchantBillingStatus, type MerchantLedgerEntryType } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { CONFIG_POR_DEFECTO, TIPOS_QUE_SUMAN, TRAMOS_DE_ANTIGUEDAD, cargosVigentes, envejecerDeuda, montoATexto, type TramoDeAntiguedad } from './domain'

/**
 * COMMERCE CORE · Merchant Billing — lecturas (Fase 4).
 *
 * Solo lectura, sin candados. Las de una empresa corren dentro de `conEmpresa` y
 * filtran por `companyId` (el aislamiento no depende de que la RLS esté encendida);
 * las del superadmin recorren empresas y corren en `sinEmpresa`. Los montos salen
 * como texto de dos decimales: el panel no hace aritmética con ellos.
 */

export const POR_PAGINA = 25

export interface ResumenDeCuenta {
  /** false = la empresa aún no tiene cuenta (nunca se le cobró nada): se muestran los valores de la plataforma. */
  existe: boolean
  feeModel: string
  cpaAmount: string
  percentageRate: string
  creditLimit: string
  billingCycle: string
  currency: string
  status: MerchantBillingStatus
  graceUntil: Date | null
  holdManual: boolean
  statusReason: string | null
  /** Lo que debe hoy (negativo = a su favor). */
  saldo: string
  /** Cuánto le queda antes de pasarse del límite (nunca negativo). */
  disponible: string
  /** Porcentaje del límite usado, 0–100 (null si el límite es cero). */
  usoDelLimite: number | null
}

export async function resumenDeCuentaEnTx(tx: Tx, companyId: string): Promise<ResumenDeCuenta> {
  const [c, ultimo] = await Promise.all([
    tx.merchantBillingConfig.findUnique({ where: { companyId } }),
    tx.merchantLedgerEntry.findFirst({ where: { companyId }, orderBy: { seq: 'desc' }, select: { balance: true } }),
  ])
  const limite = c?.creditLimit ?? new Prisma.Decimal(CONFIG_POR_DEFECTO.creditLimit)
  const saldo = ultimo?.balance ?? new Prisma.Decimal(0)
  const libre = limite.minus(saldo)
  const uso = limite.isZero() ? null : Math.max(0, Math.min(100, Math.round(Number(saldo.div(limite).times(100)))))
  return {
    existe: c !== null,
    feeModel: c?.feeModel ?? CONFIG_POR_DEFECTO.feeModel,
    cpaAmount: c ? montoATexto(c.cpaAmount) : CONFIG_POR_DEFECTO.cpaAmount,
    percentageRate: c ? montoATexto(c.percentageRate) : CONFIG_POR_DEFECTO.percentageRate,
    creditLimit: montoATexto(limite),
    billingCycle: c?.billingCycle ?? CONFIG_POR_DEFECTO.billingCycle,
    currency: c?.currency ?? CONFIG_POR_DEFECTO.currency,
    status: c?.status ?? 'ACTIVE',
    graceUntil: c?.graceUntil ?? null,
    holdManual: c?.holdManual ?? false,
    statusReason: c?.statusReason ?? null,
    saldo: montoATexto(saldo),
    disponible: montoATexto(libre.isNegative() ? 0 : libre),
    usoDelLimite: uso,
  }
}

export interface FilaDeAsiento {
  id: string
  seq: number
  type: MerchantLedgerEntryType
  amount: string
  balance: string
  currency: string
  reason: string | null
  referenceType: string
  referenceId: string
  createdAt: Date
  /** Pedido que originó la comisión (solo en asientos de comisión y de reverso). */
  pedidoId: string | null
  pedidoCodigo: string | null
}

export interface ListaDeAsientos {
  filas: FilaDeAsiento[]
  total: number
  pagina: number
  paginas: number
}

/** El libro de la empresa, del más reciente al más viejo, con el pedido de cada comisión. */
export async function listarAsientosEnTx(tx: Tx, companyId: string, o: { pagina?: number; tipo?: MerchantLedgerEntryType } = {}): Promise<ListaDeAsientos> {
  const pagina = Math.max(1, Math.trunc(o.pagina ?? 1) || 1)
  const where: Prisma.MerchantLedgerEntryWhereInput = { companyId, ...(o.tipo ? { type: o.tipo } : {}) }
  const [total, asientos] = await Promise.all([
    tx.merchantLedgerEntry.count({ where }),
    tx.merchantLedgerEntry.findMany({ where, orderBy: { seq: 'desc' }, skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
  ])
  const comisiones = await tx.commission.findMany({
    where: { companyId, id: { in: asientos.filter((a) => a.referenceType === 'COMMISSION').map((a) => a.referenceId) } },
    select: { id: true, orderId: true, order: { select: { code: true } } },
  })
  const porComision = new Map(comisiones.map((c) => [c.id, c]))
  return {
    filas: asientos.map((a) => {
      const c = a.referenceType === 'COMMISSION' ? porComision.get(a.referenceId) : undefined
      return {
        id: a.id,
        seq: a.seq,
        type: a.type,
        amount: montoATexto(a.amount),
        balance: montoATexto(a.balance),
        currency: a.currency,
        reason: a.reason,
        referenceType: a.referenceType,
        referenceId: a.referenceId,
        createdAt: a.createdAt,
        pedidoId: c?.orderId ?? null,
        pedidoCodigo: c?.order.code ?? null,
      }
    }),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
  }
}

export interface FilaDeCorte {
  id: string
  period: string
  periodStart: Date
  periodEnd: Date
  billingCycle: string
  currency: string
  openingBalance: string
  totalOrders: number
  totalGmv: string
  totalCommissions: string
  reversals: string
  adjustments: string
  credits: string
  payments: string
  closingBalance: string
  amountDue: string
  generatedAt: Date
}

export async function listarCortesEnTx(tx: Tx, companyId: string, limite = 24): Promise<FilaDeCorte[]> {
  const cortes = await tx.merchantStatement.findMany({ where: { companyId }, orderBy: { periodStart: 'desc' }, take: limite })
  return cortes.map((c) => ({
    id: c.id,
    period: c.period,
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    billingCycle: c.billingCycle,
    currency: c.currency,
    openingBalance: montoATexto(c.openingBalance),
    totalOrders: c.totalOrders,
    totalGmv: montoATexto(c.totalGmv),
    totalCommissions: montoATexto(c.totalCommissions),
    reversals: montoATexto(c.reversals),
    adjustments: montoATexto(c.adjustments),
    credits: montoATexto(c.credits),
    payments: montoATexto(c.payments),
    closingBalance: montoATexto(c.closingBalance),
    amountDue: montoATexto(c.amountDue),
    generatedAt: c.generatedAt,
  }))
}

// ── Superadmin: todas las cuentas ────────────────────────────────────────────

export interface FiltrosDeCuentas {
  q?: string
  estado?: MerchantBillingStatus
  /** Solo las que deben algo. */
  soloConDeuda?: boolean
  pagina?: number
}

export interface FilaDeCuenta {
  companyId: string
  empresa: string
  slug: string
  status: MerchantBillingStatus
  holdManual: boolean
  graceUntil: Date | null
  feeModel: string
  creditLimit: string
  currency: string
  saldo: string
  /** Fecha del último asiento. */
  ultimoMovimiento: Date | null
}

export interface ListaDeCuentas {
  filas: FilaDeCuenta[]
  total: number
  pagina: number
  paginas: number
  conteos: Record<MerchantBillingStatus, number>
  /** Lo que se debe en total (solo saldos positivos) y cómo envejece. */
  deudaTotal: string
  antiguedad: Record<TramoDeAntiguedad, string>
}

interface FilaSql {
  companyId: string
  balance: Prisma.Decimal
  createdAt: Date
}

/** El último asiento de cada empresa (su saldo actual), para las empresas dadas. */
async function ultimosSaldos(tx: Tx, ids: readonly string[] | null): Promise<Map<string, FilaSql>> {
  const filas = ids === null
    ? await tx.$queryRaw<FilaSql[]>`SELECT DISTINCT ON ("companyId") "companyId", "balance", "createdAt" FROM "merchant_ledger_entries" ORDER BY "companyId", "seq" DESC`
    : ids.length === 0
      ? []
      : await tx.$queryRaw<FilaSql[]>`SELECT DISTINCT ON ("companyId") "companyId", "balance", "createdAt" FROM "merchant_ledger_entries" WHERE "companyId" = ANY(${ids as string[]}) ORDER BY "companyId", "seq" DESC`
  return new Map(filas.map((f) => [f.companyId, f]))
}

/** Todas las cuentas con su saldo, y la antigüedad de lo que se debe. Solo el superadmin (`sinEmpresa`). */
export async function listarCuentasEnTx(tx: Tx, f: FiltrosDeCuentas = {}, ahora = new Date()): Promise<ListaDeCuentas> {
  const pagina = Math.max(1, Math.trunc(f.pagina ?? 1) || 1)
  const q = f.q?.trim().slice(0, 80)
  const donde: Prisma.MerchantBillingConfigWhereInput = {
    ...(f.estado ? { status: f.estado } : {}),
    ...(q ? { company: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } } : {}),
  }
  const saldos = await ultimosSaldos(tx, null)
  const conDeuda = [...saldos.entries()].filter(([, s]) => s.balance.greaterThan(0)).map(([id]) => id)

  const dondeLista: Prisma.MerchantBillingConfigWhereInput = f.soloConDeuda ? { ...donde, companyId: { in: conDeuda } } : donde
  const [total, configs, porEstado] = await Promise.all([
    tx.merchantBillingConfig.count({ where: dondeLista }),
    tx.merchantBillingConfig.findMany({
      where: dondeLista,
      include: { company: { select: { name: true, slug: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    tx.merchantBillingConfig.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  const conteos: Record<MerchantBillingStatus, number> = { ACTIVE: 0, GRACE_PERIOD: 0, SUSPENDED: 0 }
  for (const g of porEstado) conteos[g.status] = g._count._all

  // Antigüedad de la deuda de las empresas que deben algo.
  // Se leen también los reversos de comisión: una comisión revertida y su reverso se anulan y no son un cargo vivo.
  const asientosDeCargo = conDeuda.length
    ? await tx.merchantLedgerEntry.findMany({
        where: {
          companyId: { in: conDeuda },
          OR: [{ type: { in: [...TIPOS_QUE_SUMAN] } }, { type: 'ADJUSTMENT', amount: { gt: 0 } }, { type: 'REFUND', referenceType: 'COMMISSION' }],
        },
        select: { companyId: true, type: true, amount: true, createdAt: true, referenceType: true, referenceId: true },
      })
    : []
  const asientosPorEmpresa = new Map<string, typeof asientosDeCargo>()
  for (const a of asientosDeCargo) asientosPorEmpresa.set(a.companyId, [...(asientosPorEmpresa.get(a.companyId) ?? []), a])
  const porEmpresa = new Map<string, { amount: Prisma.Decimal; createdAt: Date }[]>()
  for (const [id, filas] of asientosPorEmpresa) porEmpresa.set(id, cargosVigentes(filas) as { amount: Prisma.Decimal; createdAt: Date }[])
  const total0 = TRAMOS_DE_ANTIGUEDAD.reduce((acc, t) => ({ ...acc, [t]: '0.00' }), {} as Record<TramoDeAntiguedad, string>)
  const acumulado = { ...total0 }
  let deuda = 0
  for (const id of conDeuda) {
    const saldo = saldos.get(id)!.balance
    deuda += Number(saldo.toFixed(2))
    const a = envejecerDeuda(saldo, porEmpresa.get(id) ?? [], ahora)
    for (const t of TRAMOS_DE_ANTIGUEDAD) acumulado[t] = (Number(acumulado[t]) + Number(a[t].toFixed(2))).toFixed(2)
  }

  return {
    filas: configs.map((c) => ({
      companyId: c.companyId,
      empresa: c.company.name,
      slug: c.company.slug,
      status: c.status,
      holdManual: c.holdManual,
      graceUntil: c.graceUntil,
      feeModel: c.feeModel,
      creditLimit: montoATexto(c.creditLimit),
      currency: c.currency,
      saldo: montoATexto(saldos.get(c.companyId)?.balance ?? 0),
      ultimoMovimiento: saldos.get(c.companyId)?.createdAt ?? null,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    conteos,
    deudaTotal: deuda.toFixed(2),
    antiguedad: acumulado,
  }
}

/** Una empresa para el detalle del superadmin (nombre y slug), o null si no existe. */
export async function empresaParaCuentaEnTx(tx: Tx, companyId: string): Promise<{ id: string; name: string; slug: string } | null> {
  return tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, slug: true } })
}
