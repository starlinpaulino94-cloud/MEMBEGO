import 'server-only'

import { Prisma } from '@prisma/client'
import type {
  SupplyCuentaEstado,
  SupplyCuentaPorCobrarOrigen,
  SupplyCuentaPorPagarOrigen,
} from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { CUENTA_VIVA } from './catalogo'
import { codigoCuentaPorCobrar, codigoCuentaPorPagar } from './codigos'
import { netoCuentaPorPagar, pendienteDeCuenta, redondear2, saldarCuenta } from './dinero'
import { TRANSICIONES_CUENTA, exigirTransicion } from './estados'

/**
 * MEMBEGO SUPPLY · CUENTAS POR PAGAR Y POR COBRAR (§15, §16).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA OBLIGACIÓN, UNA FILA, UN ASIENTO
 *
 * El ledger financiero sigue siendo la verdad del SALDO (ADR-0008). Estas
 * tablas responden la pregunta que el ledger no responde: «¿qué obligación
 * concreta queda abierta y cuánto de ella se saldó?». Cada cuenta nace con un
 * asiento CUENTA_POR_PAGAR (+) o CUENTA_POR_COBRAR (−) y se salda por tres
 * caminos —pago directo, aplicación de depósito o liquidación— que dejan su
 * rastro aquí y su asiento allá. Si un día discrepan, manda el ledger.
 *
 * NO TODO ES CUENTA POR PAGAR (§16). Un reembolso pendiente, una
 * penalización, una diferencia conciliada a favor de Membego son cuentas por
 * COBRAR, con su propio signo y su propia lista.
 *
 * Las funciones `EnTx` exigen la transacción del llamador: nacer una cuenta
 * es casi siempre la última línea de otra operación (registrar una factura,
 * entregar una venta, resolver una discrepancia) y partirla en dos es como se
 * pierde la atomicidad.
 */

export interface DatosCuentaPorPagar {
  proveedorId: string
  acuerdoId?: string | null
  origen: SupplyCuentaPorPagarOrigen
  descripcion: string
  montoBruto: number
  comision?: number
  descuentos?: number
  impuestos?: number
  moneda?: string
  vencimientoAt?: Date | null
  facturaId?: string | null
  ventaId?: string | null
  discrepanciaId?: string | null
  notas?: string | null
  creadoPorId?: string | null
  claveIdempotencia?: string | null
}

export interface CuentaCreada {
  id: string
  codigo: string
  montoNeto: number
  reutilizada: boolean
}

export async function crearCuentaPorPagarEnTx(tx: Tx, d: DatosCuentaPorPagar): Promise<CuentaCreada> {
  if (!d.descripcion.trim()) throw new Error('Una cuenta por pagar necesita una descripción.')
  if (!Number.isFinite(d.montoBruto) || d.montoBruto < 0) throw new Error('El monto bruto no puede ser negativo.')

  if (d.claveIdempotencia) {
    const previa = await tx.supplyCuentaPorPagar.findUnique({
      where: { claveIdempotencia: d.claveIdempotencia },
      select: { id: true, codigo: true, montoNeto: true },
    })
    if (previa) return { id: previa.id, codigo: previa.codigo, montoNeto: Number(previa.montoNeto), reutilizada: true }
  }

  const montoNeto = netoCuentaPorPagar(d)
  if (montoNeto < 0) throw new Error('El neto de una cuenta por pagar no puede ser negativo.')

  const secuencia = (await tx.supplyCuentaPorPagar.count()) + 1
  const cuenta = await tx.supplyCuentaPorPagar.create({
    data: {
      codigo: codigoCuentaPorPagar(secuencia),
      proveedorId: d.proveedorId,
      acuerdoId: d.acuerdoId ?? null,
      origen: d.origen,
      descripcion: d.descripcion.trim(),
      facturaId: d.facturaId ?? null,
      ventaId: d.ventaId ?? null,
      discrepanciaId: d.discrepanciaId ?? null,
      montoBruto: new Prisma.Decimal(redondear2(d.montoBruto)),
      comision: new Prisma.Decimal(redondear2(d.comision ?? 0)),
      descuentos: new Prisma.Decimal(redondear2(d.descuentos ?? 0)),
      impuestos: new Prisma.Decimal(redondear2(d.impuestos ?? 0)),
      montoNeto: new Prisma.Decimal(montoNeto),
      moneda: d.moneda ?? 'DOP',
      // Una cuenta de cero nace saldada: no hay nada que deber ni que liquidar.
      estado: montoNeto === 0 ? 'SALDADA' : 'ABIERTA',
      vencimientoAt: d.vencimientoAt ?? null,
      notas: d.notas ?? null,
      creadoPorId: d.creadoPorId ?? null,
      claveIdempotencia: d.claveIdempotencia ?? null,
    },
    select: { id: true, codigo: true },
  })

  if (montoNeto > 0) {
    await tx.supplyAsientoFinanciero.create({
      data: {
        proveedorId: d.proveedorId,
        acuerdoId: d.acuerdoId ?? null,
        tipo: 'CUENTA_POR_PAGAR',
        monto: new Prisma.Decimal(montoNeto),
        moneda: d.moneda ?? 'DOP',
        referencia: cuenta.codigo,
        motivo: `${d.descripcion.trim()} (${d.origen}).`,
        actorId: d.creadoPorId ?? null,
      },
    })
  }

  return { id: cuenta.id, codigo: cuenta.codigo, montoNeto, reutilizada: false }
}

export interface DatosCuentaPorCobrar {
  proveedorId: string
  acuerdoId?: string | null
  origen: SupplyCuentaPorCobrarOrigen
  descripcion: string
  monto: number
  moneda?: string
  vencimientoAt?: Date | null
  facturaId?: string | null
  discrepanciaId?: string | null
  notas?: string | null
  creadoPorId?: string | null
  claveIdempotencia?: string | null
}

export async function crearCuentaPorCobrarEnTx(tx: Tx, d: DatosCuentaPorCobrar): Promise<CuentaCreada> {
  if (!d.descripcion.trim()) throw new Error('Una cuenta por cobrar necesita una descripción.')
  if (!Number.isFinite(d.monto) || d.monto <= 0) throw new Error('El monto de una cuenta por cobrar tiene que ser positivo.')

  if (d.claveIdempotencia) {
    const previa = await tx.supplyCuentaPorCobrar.findUnique({
      where: { claveIdempotencia: d.claveIdempotencia },
      select: { id: true, codigo: true, montoNeto: true },
    })
    if (previa) return { id: previa.id, codigo: previa.codigo, montoNeto: Number(previa.montoNeto), reutilizada: true }
  }

  const monto = redondear2(d.monto)
  const secuencia = (await tx.supplyCuentaPorCobrar.count()) + 1
  const cuenta = await tx.supplyCuentaPorCobrar.create({
    data: {
      codigo: codigoCuentaPorCobrar(secuencia),
      proveedorId: d.proveedorId,
      acuerdoId: d.acuerdoId ?? null,
      origen: d.origen,
      descripcion: d.descripcion.trim(),
      facturaId: d.facturaId ?? null,
      discrepanciaId: d.discrepanciaId ?? null,
      montoNeto: new Prisma.Decimal(monto),
      moneda: d.moneda ?? 'DOP',
      vencimientoAt: d.vencimientoAt ?? null,
      notas: d.notas ?? null,
      creadoPorId: d.creadoPorId ?? null,
      claveIdempotencia: d.claveIdempotencia ?? null,
    },
    select: { id: true, codigo: true },
  })

  await tx.supplyAsientoFinanciero.create({
    data: {
      proveedorId: d.proveedorId,
      acuerdoId: d.acuerdoId ?? null,
      tipo: 'CUENTA_POR_COBRAR',
      monto: new Prisma.Decimal(-monto),
      moneda: d.moneda ?? 'DOP',
      referencia: cuenta.codigo,
      motivo: `${d.descripcion.trim()} (${d.origen}).`,
      actorId: d.creadoPorId ?? null,
    },
  })

  return { id: cuenta.id, codigo: cuenta.codigo, montoNeto: monto, reutilizada: false }
}

// ── Saldar ──────────────────────────────────────────────────────────────────

export interface ContextoSaldo {
  via: 'PAGO' | 'DEPOSITO' | 'LIQUIDACION'
  referencia?: string | null
  actorId?: string | null
}

/**
 * Salda parte o todo de una cuenta por pagar. NO escribe asiento: quien salda
 * (el pago, el depósito, la liquidación) ya dejó el suyo, y duplicarlo aquí
 * contaría el dinero dos veces. Solo actualiza el sub-libro y la factura si la
 * hay. Bloquea la fila: dos caminos saldando a la vez no pueden pasar del neto.
 */
export async function saldarCuentaPorPagarEnTx(
  tx: Tx,
  cuentaId: string,
  monto: number,
  ctx: ContextoSaldo
): Promise<{ estado: SupplyCuentaEstado; montoSaldado: number }> {
  const filas = await tx.$queryRaw<{ id: string; estado: SupplyCuentaEstado; montoNeto: string; montoSaldado: string; facturaId: string | null }[]>`
    SELECT "id", "estado", "montoNeto"::text, "montoSaldado"::text, "facturaId"
      FROM "supply_cuentas_por_pagar" WHERE "id" = ${cuentaId} FOR UPDATE
  `
  const cuenta = filas[0]
  if (!cuenta) throw new Error('Cuenta por pagar no encontrada.')
  if (!CUENTA_VIVA.includes(cuenta.estado)) {
    throw new Error(`La cuenta por pagar está ${cuenta.estado.toLowerCase()}: no se puede saldar.`)
  }

  const r = saldarCuenta({ montoNeto: Number(cuenta.montoNeto), montoSaldado: Number(cuenta.montoSaldado) }, monto)
  if (!r.ok) throw new Error(r.error)
  exigirTransicion(TRANSICIONES_CUENTA, cuenta.estado, r.estado, 'Cuenta por pagar')

  await tx.supplyCuentaPorPagar.update({
    where: { id: cuentaId },
    data: { montoSaldado: new Prisma.Decimal(r.montoSaldado), estado: r.estado },
  })
  if (cuenta.facturaId) {
    await tx.supplyFacturaProveedor.update({
      where: { id: cuenta.facturaId },
      data: {
        montoSaldado: new Prisma.Decimal(r.montoSaldado),
        estado: r.estado === 'SALDADA' ? 'PAGADA' : 'PARCIALMENTE_PAGADA',
      },
    })
  }
  void ctx
  return { estado: r.estado, montoSaldado: r.montoSaldado }
}

export async function saldarCuentaPorCobrarEnTx(
  tx: Tx,
  cuentaId: string,
  monto: number,
  ctx: ContextoSaldo
): Promise<{ estado: SupplyCuentaEstado; montoSaldado: number }> {
  const filas = await tx.$queryRaw<{ id: string; estado: SupplyCuentaEstado; montoNeto: string; montoSaldado: string }[]>`
    SELECT "id", "estado", "montoNeto"::text, "montoSaldado"::text
      FROM "supply_cuentas_por_cobrar" WHERE "id" = ${cuentaId} FOR UPDATE
  `
  const cuenta = filas[0]
  if (!cuenta) throw new Error('Cuenta por cobrar no encontrada.')
  if (!CUENTA_VIVA.includes(cuenta.estado)) {
    throw new Error(`La cuenta por cobrar está ${cuenta.estado.toLowerCase()}: no se puede saldar.`)
  }
  const r = saldarCuenta({ montoNeto: Number(cuenta.montoNeto), montoSaldado: Number(cuenta.montoSaldado) }, monto)
  if (!r.ok) throw new Error(r.error)
  exigirTransicion(TRANSICIONES_CUENTA, cuenta.estado, r.estado, 'Cuenta por cobrar')
  await tx.supplyCuentaPorCobrar.update({
    where: { id: cuentaId },
    data: { montoSaldado: new Prisma.Decimal(r.montoSaldado), estado: r.estado },
  })
  void ctx
  return { estado: r.estado, montoSaldado: r.montoSaldado }
}

// ── Disputar y cancelar ─────────────────────────────────────────────────────

type Lado = 'CXP' | 'CXC'

/**
 * Disputar congela: la cuenta no entra en liquidación ni se salda hasta
 * resolverla. Cancelar es terminal y CONTRARRESTA el asiento con signo opuesto
 * (el original se queda: el ledger financiero tampoco borra).
 */
export async function moverCuenta(
  lado: Lado,
  cuentaId: string,
  hasta: SupplyCuentaEstado,
  motivo: string,
  actorId?: string | null
): Promise<void> {
  if ((hasta === 'DISPUTADA' || hasta === 'CANCELADA') && !motivo.trim()) {
    throw new Error('Disputar o cancelar una cuenta exige un motivo.')
  }
  if (hasta === 'SALDADA' || hasta === 'PARCIALMENTE_SALDADA') {
    throw new Error('Una cuenta se salda con un pago, un depósito o una liquidación, no a mano.')
  }
  await sinEmpresa('Membego Supply: estado de una cuenta por pagar/cobrar', async (tx) => {
    const cuenta =
      lado === 'CXP'
        ? await tx.supplyCuentaPorPagar.findUnique({
            where: { id: cuentaId },
            select: { estado: true, proveedorId: true, acuerdoId: true, montoNeto: true, montoSaldado: true, moneda: true, codigo: true, liquidacionId: true, facturaId: true },
          })
        : await tx.supplyCuentaPorCobrar.findUnique({
            where: { id: cuentaId },
            select: { estado: true, proveedorId: true, acuerdoId: true, montoNeto: true, montoSaldado: true, moneda: true, codigo: true, liquidacionId: true, facturaId: true },
          })
    if (!cuenta) throw new Error('Cuenta no encontrada.')
    exigirTransicion(TRANSICIONES_CUENTA, cuenta.estado, hasta, lado === 'CXP' ? 'Cuenta por pagar' : 'Cuenta por cobrar')
    if (cuenta.liquidacionId && hasta === 'CANCELADA') {
      throw new Error('Esta cuenta ya entró en una liquidación: cancela o disputa la liquidación.')
    }

    // Lo pendiente (neto − saldado) es lo que se contrarresta al cancelar.
    const pendiente = pendienteDeCuenta({ montoNeto: Number(cuenta.montoNeto), montoSaldado: Number(cuenta.montoSaldado) })
    const datos = {
      estado: hasta,
      ...(hasta === 'DISPUTADA' ? { disputaMotivo: motivo.trim() } : {}),
      ...(hasta === 'CANCELADA' ? { notas: `Cancelada: ${motivo.trim()}` } : {}),
    }
    if (lado === 'CXP') {
      await tx.supplyCuentaPorPagar.update({ where: { id: cuentaId }, data: datos })
      if (cuenta.facturaId) {
        await tx.supplyFacturaProveedor.update({
          where: { id: cuenta.facturaId },
          data: { estado: hasta === 'CANCELADA' ? 'ANULADA' : hasta === 'DISPUTADA' ? 'DISPUTADA' : 'REGISTRADA' },
        })
      }
    } else {
      await tx.supplyCuentaPorCobrar.update({ where: { id: cuentaId }, data: datos })
    }

    if (hasta === 'CANCELADA' && pendiente > 0) {
      await tx.supplyAsientoFinanciero.create({
        data: {
          proveedorId: cuenta.proveedorId,
          acuerdoId: cuenta.acuerdoId,
          tipo: 'REVERSA',
          // CxP nació en positivo → se contrarresta en negativo; CxC al revés.
          monto: new Prisma.Decimal(lado === 'CXP' ? -pendiente : pendiente),
          moneda: cuenta.moneda,
          referencia: cuenta.codigo,
          motivo: `Cuenta cancelada: ${motivo.trim()}`,
          actorId: actorId ?? null,
        },
      })
    }
  })
}

// ── Lecturas ────────────────────────────────────────────────────────────────

export interface FiltroCuentas {
  proveedorId?: string
  acuerdoId?: string
  estado?: SupplyCuentaEstado
  desde?: Date
  hasta?: Date
  limite?: number
}

export async function listarCuentasPorPagar(f: FiltroCuentas = {}) {
  return sinEmpresa('Membego Supply: cuentas por pagar de la plataforma', (tx) =>
    tx.supplyCuentaPorPagar.findMany({
      where: {
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}),
        ...(f.estado ? { estado: f.estado } : {}),
        ...(f.desde || f.hasta ? { createdAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } } : {}),
      },
      orderBy: [{ estado: 'asc' }, { vencimientoAt: 'asc' }, { createdAt: 'desc' }],
      take: f.limite ?? 300,
      select: {
        id: true, codigo: true, origen: true, descripcion: true, estado: true,
        montoBruto: true, comision: true, montoNeto: true, montoSaldado: true, moneda: true,
        vencimientoAt: true, createdAt: true, liquidacionId: true, facturaId: true, ventaId: true,
        disputaMotivo: true,
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true } },
        liquidacion: { select: { codigo: true } },
      },
    })
  )
}

export async function listarCuentasPorCobrar(f: FiltroCuentas = {}) {
  return sinEmpresa('Membego Supply: cuentas por cobrar de la plataforma', (tx) =>
    tx.supplyCuentaPorCobrar.findMany({
      where: {
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}),
        ...(f.estado ? { estado: f.estado } : {}),
        ...(f.desde || f.hasta ? { createdAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } } : {}),
      },
      orderBy: [{ estado: 'asc' }, { vencimientoAt: 'asc' }, { createdAt: 'desc' }],
      take: f.limite ?? 300,
      select: {
        id: true, codigo: true, origen: true, descripcion: true, estado: true,
        montoNeto: true, montoSaldado: true, moneda: true,
        vencimientoAt: true, createdAt: true, liquidacionId: true, disputaMotivo: true,
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true } },
        liquidacion: { select: { codigo: true } },
      },
    })
  )
}

export interface ResumenCuentas {
  abiertas: number
  montoPendiente: number
  vencidas: number
  montoVencido: number
  disputadas: number
}

/** Cifras para el tablero: cuánto se debe (o se le debe a Membego) hoy. */
export async function resumenCuentas(tx: Tx, lado: Lado, ahora = new Date(), proveedorId?: string): Promise<ResumenCuentas> {
  const where = { estado: { in: [...CUENTA_VIVA] }, ...(proveedorId ? { proveedorId } : {}) }
  const filas =
    lado === 'CXP'
      ? await tx.supplyCuentaPorPagar.findMany({ where, select: { montoNeto: true, montoSaldado: true, vencimientoAt: true } })
      : await tx.supplyCuentaPorCobrar.findMany({ where, select: { montoNeto: true, montoSaldado: true, vencimientoAt: true } })
  const disputadas =
    lado === 'CXP'
      ? await tx.supplyCuentaPorPagar.count({ where: { estado: 'DISPUTADA', ...(proveedorId ? { proveedorId } : {}) } })
      : await tx.supplyCuentaPorCobrar.count({ where: { estado: 'DISPUTADA', ...(proveedorId ? { proveedorId } : {}) } })
  const r: ResumenCuentas = { abiertas: filas.length, montoPendiente: 0, vencidas: 0, montoVencido: 0, disputadas }
  for (const c of filas) {
    const pendiente = pendienteDeCuenta({ montoNeto: Number(c.montoNeto), montoSaldado: Number(c.montoSaldado) })
    r.montoPendiente += pendiente
    if (c.vencimientoAt && c.vencimientoAt < ahora) {
      r.vencidas += 1
      r.montoVencido += pendiente
    }
  }
  r.montoPendiente = redondear2(r.montoPendiente)
  r.montoVencido = redondear2(r.montoVencido)
  return r
}
