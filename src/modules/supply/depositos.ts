import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyDepositoEstado } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { DEPOSITO_VIVO } from './catalogo'
import { codigoDeposito } from './codigos'
import { aplicarDeposito as calcularAplicacion, estadoDeDeposito, redondear2, saldoDisponibleDeposito } from './dinero'
import { TRANSICIONES_DEPOSITO, exigirTransicion, puedeTransicionar } from './estados'
import { pendienteDeCuenta } from './dinero'
import { saldarCuentaPorPagarEnTx } from './cuentas'
import { registrarPagoEnTx } from './finanzas'

/**
 * MEMBEGO SUPPLY · DEPÓSITOS ABIERTOS (§3 B del encargo).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DINERO SIN COMPRA CONCRETA
 *
 * Membego le entrega RD$100.000 a un proveedor «a cuenta». Después llegan
 * facturas de 20k, 15k y 10k, y en cada una Membego decide: aplicar el
 * depósito, pagarla aparte, aplicar una parte, o dejar el depósito quieto.
 * El saldo disponible es original − aplicado − devuelto, y cada cambio deja
 * un movimiento con el saldo ANTES y DESPUÉS: nunca se pierde trazabilidad.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE RELACIONA CON EL LEDGER FINANCIERO
 *
 * El depósito es un pago de tipo DEPOSITO. Al confirmarse, el ledger recibe
 * −100k (Membego pagó) y el depósito se ABRE. Registrar una factura de 20k
 * escribe +20k (CUENTA_POR_PAGAR). El saldo del proveedor queda en −80k: el
 * proveedor retiene 80k de Membego, que es exactamente el saldo del depósito.
 * APLICAR el depósito a la factura NO escribe asiento —el neteo ya está en el
 * ledger—: solo dice qué obligación quedó cubierta y por qué depósito. PAGAR la
 * factura aparte sí escribe −20k, y el depósito no se toca (caso 10 de las
 * pruebas). Los dos caminos dejan el ledger diciendo la verdad.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONCURRENCIA
 *
 * Toda aplicación bloquea la fila del depósito (`FOR UPDATE`) y la de la
 * cuenta, y el CHECK de la base impide que aplicado + devuelto supere lo
 * original aunque alguien abra otro camino.
 */

export interface DatosDeposito {
  proveedorId: string
  acuerdoId?: string | null
  monto: number
  moneda?: string
  referencia?: string | null
  metodo?: string | null
  notas?: string | null
  cierraAt?: Date | null
  documentos?: string[]
  registradoPorId?: string | null
  claveIdempotencia?: string | null
}

/**
 * Registra un depósito y el pago que lo fondea. Nace PENDIENTE: el dinero no
 * cuenta hasta que tesorería confirme el pago (`confirmarPago`), que es lo que
 * abre el depósito y asienta la salida.
 */
export async function registrarDeposito(d: DatosDeposito): Promise<{ id: string; codigo: string; pagoId: string; reutilizado: boolean }> {
  if (!Number.isFinite(d.monto) || d.monto <= 0) throw new Error('El monto del depósito tiene que ser positivo.')
  const acuerdoId = d.acuerdoId
  if (!acuerdoId) throw new Error('Un depósito se registra contra un acuerdo: es lo que dice a cuenta de qué se entrega.')

  return sinEmpresa('Membego Supply: registrar un depósito a un proveedor', async (tx) => {
    if (d.claveIdempotencia) {
      const previo = await tx.supplyDeposito.findUnique({
        where: { claveIdempotencia: d.claveIdempotencia },
        select: { id: true, codigo: true, pagoId: true },
      })
      if (previo) return { id: previo.id, codigo: previo.codigo, pagoId: previo.pagoId ?? '', reutilizado: true }
    }

    const acuerdo = await tx.supplyAcuerdo.findUnique({
      where: { id: acuerdoId },
      select: { proveedorId: true, moneda: true },
    })
    if (!acuerdo || acuerdo.proveedorId !== d.proveedorId) throw new Error('El acuerdo no es de este proveedor.')

    const pago = await registrarPagoEnTx(tx, {
      acuerdoId,
      tipo: 'DEPOSITO',
      monto: d.monto,
      metodo: d.metodo ?? null,
      referencia: d.referencia ?? null,
      notas: d.notas ?? null,
      registradoPorId: d.registradoPorId ?? null,
      claveIdempotencia: d.claveIdempotencia ? `${d.claveIdempotencia}:pago` : null,
    })

    const secuencia = (await tx.supplyDeposito.count()) + 1
    const deposito = await tx.supplyDeposito.create({
      data: {
        codigo: codigoDeposito(secuencia),
        proveedorId: d.proveedorId,
        acuerdoId,
        pagoId: pago.id,
        estado: 'PENDIENTE',
        montoOriginal: new Prisma.Decimal(redondear2(d.monto)),
        moneda: d.moneda ?? acuerdo.moneda,
        referencia: d.referencia ?? null,
        notas: d.notas ?? null,
        documentos: d.documentos ?? [],
        cierraAt: d.cierraAt ?? null,
        registradoPorId: d.registradoPorId ?? null,
        claveIdempotencia: d.claveIdempotencia ?? null,
      },
      select: { id: true, codigo: true },
    })
    return { id: deposito.id, codigo: deposito.codigo, pagoId: pago.id, reutilizado: false }
  })
}

/** El pago que fondea el depósito se confirmó: el depósito se abre. */
export async function activarDepositoEnTx(tx: Tx, depositoId: string, actorId?: string | null): Promise<void> {
  const dep = await bloquearDeposito(tx, depositoId)
  if (dep.estado !== 'PENDIENTE') return
  await tx.supplyDeposito.update({
    where: { id: depositoId },
    data: { estado: 'ABIERTO', abiertoAt: new Date(), aprobadoPorId: actorId ?? null, version: { increment: 1 } },
  })
  await tx.supplyDepositoMovimiento.create({
    data: {
      depositoId,
      tipo: 'APERTURA',
      monto: new Prisma.Decimal(dep.montoOriginal),
      saldoAntes: new Prisma.Decimal(0),
      saldoDespues: new Prisma.Decimal(dep.montoOriginal),
      motivo: 'Pago confirmado: el depósito queda disponible.',
      actorId: actorId ?? null,
    },
  })
}

interface DepositoBloqueado {
  id: string
  estado: SupplyDepositoEstado
  proveedorId: string
  montoOriginal: number
  montoAplicado: number
  montoDevuelto: number
}

async function bloquearDeposito(tx: Tx, depositoId: string): Promise<DepositoBloqueado> {
  const filas = await tx.$queryRaw<{ id: string; estado: SupplyDepositoEstado; proveedorId: string; montoOriginal: string; montoAplicado: string; montoDevuelto: string }[]>`
    SELECT "id", "estado", "proveedorId", "montoOriginal"::text, "montoAplicado"::text, "montoDevuelto"::text
      FROM "supply_depositos" WHERE "id" = ${depositoId} FOR UPDATE
  `
  const f = filas[0]
  if (!f) throw new Error('Depósito no encontrado.')
  return {
    id: f.id,
    estado: f.estado,
    proveedorId: f.proveedorId,
    montoOriginal: Number(f.montoOriginal),
    montoAplicado: Number(f.montoAplicado),
    montoDevuelto: Number(f.montoDevuelto),
  }
}

/** Estado que corresponde a los montos, sin saltarse la máquina. */
function reestado(actual: SupplyDepositoEstado, d: DepositoBloqueado): SupplyDepositoEstado {
  const destino = estadoDeDeposito(d)
  if (destino === actual) return actual
  return puedeTransicionar(TRANSICIONES_DEPOSITO, actual, destino) ? destino : actual
}

export interface AplicacionHecha {
  movimientoId: string
  saldoAntes: number
  saldoDespues: number
  montoAplicado: number
}

/**
 * Aplica parte del depósito a una cuenta por pagar (por ejemplo, la de una
 * factura). Bloquea depósito y cuenta; nunca aplica más de lo disponible ni
 * más de lo pendiente en la cuenta.
 */
export async function aplicarDepositoEnTx(
  tx: Tx,
  depositoId: string,
  cuentaPorPagarId: string,
  monto: number,
  ctx: { actorId?: string | null; liquidacionId?: string | null; motivo?: string | null } = {}
): Promise<AplicacionHecha> {
  const dep = await bloquearDeposito(tx, depositoId)
  if (!DEPOSITO_VIVO.includes(dep.estado)) {
    throw new Error(`El depósito está ${dep.estado.toLowerCase()}: no tiene saldo aplicable.`)
  }
  const cuenta = await tx.supplyCuentaPorPagar.findUnique({
    where: { id: cuentaPorPagarId },
    select: { proveedorId: true, montoNeto: true, montoSaldado: true, facturaId: true, estado: true },
  })
  if (!cuenta) throw new Error('Cuenta por pagar no encontrada.')
  if (cuenta.proveedorId !== dep.proveedorId) throw new Error('El depósito y la cuenta son de proveedores distintos.')

  const pendiente = pendienteDeCuenta({ montoNeto: Number(cuenta.montoNeto), montoSaldado: Number(cuenta.montoSaldado) })
  const r = calcularAplicacion(dep, monto, pendiente)
  if (!r.ok) throw new Error(r.error)

  await saldarCuentaPorPagarEnTx(tx, cuentaPorPagarId, r.montoAplicado, { via: 'DEPOSITO', referencia: depositoId, actorId: ctx.actorId })

  const nuevo = { ...dep, montoAplicado: redondear2(dep.montoAplicado + r.montoAplicado) }
  await tx.supplyDeposito.update({
    where: { id: depositoId },
    data: {
      montoAplicado: new Prisma.Decimal(nuevo.montoAplicado),
      estado: reestado(dep.estado, nuevo),
      version: { increment: 1 },
    },
  })
  const mov = await tx.supplyDepositoMovimiento.create({
    data: {
      depositoId,
      tipo: 'APLICACION',
      monto: new Prisma.Decimal(r.montoAplicado),
      saldoAntes: new Prisma.Decimal(r.saldoAntes),
      saldoDespues: new Prisma.Decimal(r.saldoDespues),
      cuentaPorPagarId,
      facturaId: cuenta.facturaId,
      liquidacionId: ctx.liquidacionId ?? null,
      motivo: ctx.motivo ?? 'Aplicación del depósito a una cuenta por pagar.',
      actorId: ctx.actorId ?? null,
    },
    select: { id: true },
  })
  return { movimientoId: mov.id, saldoAntes: r.saldoAntes, saldoDespues: r.saldoDespues, montoAplicado: r.montoAplicado }
}

/**
 * Paga (total o parcialmente) una ORDEN DE COMPRA con el saldo de un depósito.
 * No asienta nada en el ledger financiero: el depósito ya se asentó al abrirse
 * y la compra se asentó al activar el lote; aquí solo se dice con qué dinero
 * se cubrió. Sube `montoPagado` de la orden y la fondea si corresponde.
 */
export async function aplicarDepositoAOrdenEnTx(
  tx: Tx,
  depositoId: string,
  ordenId: string,
  monto: number,
  ctx: { actorId?: string | null } = {}
): Promise<AplicacionHecha> {
  const dep = await bloquearDeposito(tx, depositoId)
  if (!DEPOSITO_VIVO.includes(dep.estado)) {
    throw new Error(`El depósito está ${dep.estado.toLowerCase()}: no tiene saldo aplicable.`)
  }
  const orden = await tx.supplyOrden.findUnique({
    where: { id: ordenId },
    select: { proveedorId: true, total: true, montoPagado: true, estado: true },
  })
  if (!orden) throw new Error('Orden no encontrada.')
  if (orden.proveedorId !== dep.proveedorId) throw new Error('El depósito y la orden son de proveedores distintos.')
  if (orden.estado === 'BORRADOR' || orden.estado === 'PENDIENTE_APROBACION' || orden.estado === 'CANCELADA') {
    throw new Error('Solo se paga una orden aprobada.')
  }
  const pendiente = redondear2(Math.max(0, Number(orden.total) - Number(orden.montoPagado)))
  const r = calcularAplicacion(dep, monto, pendiente)
  if (!r.ok) throw new Error(r.error)

  const nuevo = { ...dep, montoAplicado: redondear2(dep.montoAplicado + r.montoAplicado) }
  await tx.supplyDeposito.update({
    where: { id: depositoId },
    data: { montoAplicado: new Prisma.Decimal(nuevo.montoAplicado), estado: reestado(dep.estado, nuevo), version: { increment: 1 } },
  })
  const mov = await tx.supplyDepositoMovimiento.create({
    data: {
      depositoId,
      tipo: 'APLICACION',
      monto: new Prisma.Decimal(r.montoAplicado),
      saldoAntes: new Prisma.Decimal(r.saldoAntes),
      saldoDespues: new Prisma.Decimal(r.saldoDespues),
      ordenId,
      motivo: 'Pago de una orden de compra con el depósito.',
      actorId: ctx.actorId ?? null,
    },
    select: { id: true },
  })
  const { fondearOrdenEnTx } = await import('./procurement')
  await fondearOrdenEnTx(tx, ordenId)
  return { movimientoId: mov.id, saldoAntes: r.saldoAntes, saldoDespues: r.saldoDespues, montoAplicado: r.montoAplicado }
}

export async function aplicarDepositoAOrden(depositoId: string, ordenId: string, monto: number, actorId?: string | null): Promise<AplicacionHecha> {
  return sinEmpresa('Membego Supply: pagar una orden con un depósito', (tx) => aplicarDepositoAOrdenEnTx(tx, depositoId, ordenId, monto, { actorId }))
}

export async function aplicarDeposito(
  depositoId: string,
  cuentaPorPagarId: string,
  monto: number,
  actorId?: string | null
): Promise<AplicacionHecha> {
  return sinEmpresa('Membego Supply: aplicar un depósito a una cuenta por pagar', (tx) =>
    aplicarDepositoEnTx(tx, depositoId, cuentaPorPagarId, monto, { actorId })
  )
}

/**
 * El proveedor devolvió saldo no usado. Registra un pago de tipo REEMBOLSO
 * CONFIRMADO (el dinero ya llegó: es un hecho, no un plan) con su asiento
 * positivo, y el movimiento DEVOLUCION en el depósito.
 */
export async function devolverDeposito(
  depositoId: string,
  monto: number,
  referenciaCruda: string | null,
  actorId?: string | null
): Promise<{ saldoDespues: number }> {
  const referencia = referenciaCruda ?? null
  if (!Number.isFinite(monto) || monto <= 0) throw new Error('El monto devuelto tiene que ser positivo.')
  return sinEmpresa('Membego Supply: devolución de saldo de un depósito', async (tx) => {
    const dep = await bloquearDeposito(tx, depositoId)
    if (!DEPOSITO_VIVO.includes(dep.estado)) throw new Error(`El depósito está ${dep.estado.toLowerCase()}.`)
    const disponible = saldoDisponibleDeposito(dep)
    if (monto > disponible + 0.005) throw new Error(`Solo hay ${disponible} disponibles para devolver.`)

    const fila = await tx.supplyDeposito.findUniqueOrThrow({
      where: { id: depositoId },
      select: { acuerdoId: true, moneda: true },
    })
    if (!fila.acuerdoId) throw new Error('El depósito no tiene acuerdo.')

    const pago = await registrarPagoEnTx(tx, {
      acuerdoId: fila.acuerdoId,
      tipo: 'REEMBOLSO',
      monto,
      referencia,
      notas: `Devolución de saldo del depósito ${depositoId}.`,
      registradoPorId: actorId ?? null,
    })
    // Se confirma aquí mismo, sin pasar por tesorería: el dinero YA llegó.
    await tx.supplyPago.update({ where: { id: pago.id }, data: { estado: 'CONFIRMADO', confirmadoAt: new Date() } })
    await tx.supplyAsientoFinanciero.create({
      data: {
        proveedorId: dep.proveedorId,
        acuerdoId: fila.acuerdoId,
        pagoId: pago.id,
        tipo: 'REEMBOLSO',
        monto: new Prisma.Decimal(redondear2(monto)),
        moneda: fila.moneda,
        referencia,
        motivo: 'El proveedor devolvió saldo del depósito.',
        actorId: actorId ?? null,
      },
    })

    const nuevo = { ...dep, montoDevuelto: redondear2(dep.montoDevuelto + monto) }
    await tx.supplyDeposito.update({
      where: { id: depositoId },
      data: { montoDevuelto: new Prisma.Decimal(nuevo.montoDevuelto), estado: reestado(dep.estado, nuevo), version: { increment: 1 } },
    })
    const saldoDespues = saldoDisponibleDeposito(nuevo)
    await tx.supplyDepositoMovimiento.create({
      data: {
        depositoId,
        tipo: 'DEVOLUCION',
        monto: new Prisma.Decimal(redondear2(monto)),
        saldoAntes: new Prisma.Decimal(disponible),
        saldoDespues: new Prisma.Decimal(saldoDespues),
        referencia,
        motivo: 'Devolución del proveedor.',
        actorId: actorId ?? null,
      },
    })
    return { saldoDespues }
  })
}

/**
 * Cierra el depósito. Con saldo vivo exige decir qué pasa con él: si el
 * proveedor lo devolvió, primero se registra la devolución; si se pierde o se
 * negocia aparte, el motivo lo dice y el saldo queda a la vista en el cierre.
 */
export async function cerrarDeposito(depositoId: string, motivo: string, actorId?: string | null): Promise<void> {
  if (!motivo.trim()) throw new Error('Cerrar un depósito exige un motivo.')
  await sinEmpresa('Membego Supply: cerrar un depósito', async (tx) => {
    const dep = await bloquearDeposito(tx, depositoId)
    const hasta: SupplyDepositoEstado = dep.estado === 'PENDIENTE' ? 'CANCELADO' : 'CERRADO'
    exigirTransicion(TRANSICIONES_DEPOSITO, dep.estado, hasta, 'Depósito')
    if (dep.estado === 'PENDIENTE') {
      const pago = await tx.supplyDeposito.findUnique({ where: { id: depositoId }, select: { pagoId: true } })
      if (pago?.pagoId) {
        await tx.supplyPago.update({ where: { id: pago.pagoId }, data: { estado: 'ANULADO', anuladoAt: new Date(), anuladoMotivo: motivo.trim() } })
      }
    }
    await tx.supplyDeposito.update({
      where: { id: depositoId },
      data: { estado: hasta, cerradoAt: new Date(), cerradoMotivo: motivo.trim(), version: { increment: 1 } },
    })
    void actorId
  })
}

// ── Lecturas ────────────────────────────────────────────────────────────────

export interface FilaDeposito {
  id: string
  codigo: string
  proveedorId: string
  proveedor: string
  acuerdo: string | null
  estado: SupplyDepositoEstado
  montoOriginal: number
  montoAplicado: number
  montoDevuelto: number
  disponible: number
  moneda: string
  referencia: string | null
  abiertoAt: Date | null
  cierraAt: Date | null
  cerradoAt: Date | null
  registradoPor: string | null
  createdAt: Date
}

export async function listarDepositos(f: { proveedorId?: string; estado?: SupplyDepositoEstado; limite?: number } = {}): Promise<FilaDeposito[]> {
  const filas = await sinEmpresa('Membego Supply: depósitos de la plataforma', (tx) =>
    tx.supplyDeposito.findMany({
      where: { ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}), ...(f.estado ? { estado: f.estado } : {}) },
      orderBy: [{ estado: 'asc' }, { createdAt: 'desc' }],
      take: f.limite ?? 200,
      select: {
        id: true, codigo: true, proveedorId: true, estado: true, montoOriginal: true, montoAplicado: true,
        montoDevuelto: true, moneda: true, referencia: true, abiertoAt: true, cierraAt: true, cerradoAt: true, createdAt: true,
        proveedor: { select: { name: true } },
        acuerdo: { select: { codigo: true } },
        registradoPor: { select: { name: true } },
      },
    })
  )
  return filas.map((d) => {
    const m = { montoOriginal: Number(d.montoOriginal), montoAplicado: Number(d.montoAplicado), montoDevuelto: Number(d.montoDevuelto) }
    return {
      id: d.id, codigo: d.codigo, proveedorId: d.proveedorId, proveedor: d.proveedor.name,
      acuerdo: d.acuerdo?.codigo ?? null, estado: d.estado, ...m,
      disponible: DEPOSITO_VIVO.includes(d.estado) ? saldoDisponibleDeposito(m) : 0,
      moneda: d.moneda, referencia: d.referencia, abiertoAt: d.abiertoAt, cierraAt: d.cierraAt, cerradoAt: d.cerradoAt,
      registradoPor: d.registradoPor?.name ?? null, createdAt: d.createdAt,
    }
  })
}

export async function fichaDeposito(id: string) {
  return sinEmpresa('Membego Supply: ficha de un depósito', (tx) =>
    tx.supplyDeposito.findUnique({
      where: { id },
      include: {
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true } },
        pago: { select: { id: true, estado: true, referencia: true, confirmadoAt: true } },
        registradoPor: { select: { name: true } },
        aprobadoPor: { select: { name: true } },
        movimientos: {
          orderBy: { createdAt: 'asc' },
          include: {
            actor: { select: { name: true } },
            factura: { select: { codigo: true, numero: true } },
            cuentaPorPagar: { select: { codigo: true, descripcion: true } },
            liquidacion: { select: { codigo: true } },
          },
        },
      },
    })
  )
}

/** Saldo disponible total en depósitos vivos (tablero). */
export async function saldoDepositos(tx: Tx, proveedorId?: string): Promise<{ disponible: number; depositos: number }> {
  const filas = await tx.supplyDeposito.findMany({
    where: { estado: { in: [...DEPOSITO_VIVO] }, ...(proveedorId ? { proveedorId } : {}) },
    select: { montoOriginal: true, montoAplicado: true, montoDevuelto: true },
  })
  return {
    depositos: filas.length,
    disponible: redondear2(
      filas.reduce(
        (t, d) => t + saldoDisponibleDeposito({ montoOriginal: Number(d.montoOriginal), montoAplicado: Number(d.montoAplicado), montoDevuelto: Number(d.montoDevuelto) }),
        0
      )
    ),
  }
}
