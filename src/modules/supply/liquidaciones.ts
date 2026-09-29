import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyLiquidacionEstado, SupplyLiquidacionLineaTipo } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { CUENTA_VIVA, DEPOSITO_VIVO } from './catalogo'
import { codigoLiquidacion } from './codigos'
import { saldarCuentaPorCobrarEnTx, saldarCuentaPorPagarEnTx } from './cuentas'
import { aplicarDepositoEnTx } from './depositos'
import { depositoAplicableAlCorte, netearLiquidacion, pendienteDeCuenta, redondear2, saldoDisponibleDeposito, type LineaNeteo } from './dinero'
import { LIQUIDACION_PAGADA, TRANSICIONES_LIQUIDACION, exigirTransicion } from './estados'
import { registrarPagoEnTx } from './finanzas'

/**
 * MEMBEGO SUPPLY · LIQUIDACIONES (§17 del encargo).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CORTE
 *
 * Una liquidación agrupa todo lo devengado con un proveedor en un período y lo
 * convierte en UN número: las cuentas por pagar abiertas (facturas, ventas
 * entregadas), las redenciones por pagar de los acuerdos que pagan al
 * redimir, y en contra las cuentas por cobrar y el depósito que se decida
 * aplicar. Se calcula, se revisa, la APRUEBA otra persona, se paga —y ahí se
 * asienta— y se concilia contra el proveedor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NADIE LIQUIDA DOS VECES LA MISMA PIZZA
 *
 * Cada cosa que entra se RECLAMA con `UPDATE … SET "liquidacionId" = X WHERE
 * "liquidacionId" IS NULL`: dos cortes calculados a la vez no pueden llevarse
 * la misma cuenta ni la misma redención, y el índice único parcial impide dos
 * liquidaciones vivas del mismo proveedor y período. Cancelar suelta lo
 * reclamado; las líneas se quedan como historia de lo que se propuso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SNAPSHOT
 *
 * Las líneas llevan sus montos y el acuerdo su versión: enmendar la comisión
 * la semana siguiente no cambia un peso de este corte (§17: «una modificación
 * posterior del acuerdo NO debe alterar una liquidación histórica»).
 */

export interface DatosCorte {
  proveedorId: string
  acuerdoId?: string | null
  desde: Date
  hasta: Date
  /** Consumir el saldo de depósitos vivos antes de transferir. */
  aplicarDeposito?: boolean
  notas?: string | null
  calculadaPorId?: string | null
  claveIdempotencia?: string | null
}

export interface CorteCalculado {
  id: string
  codigo: string
  netoLiquidar: number
  lineas: number
  reutilizada: boolean
}

interface LineaCalculada {
  tipo: SupplyLiquidacionLineaTipo
  referencia: string
  descripcion: string
  monto: number
  cuentaPorPagarId?: string | null
  cuentaPorCobrarId?: string | null
  redencionId?: string | null
  depositoId?: string | null
  bruto?: number
  comision?: number
}

/** Reclama y construye las líneas de un corte. Exige la transacción abierta. */
async function reclamarYArmar(tx: Tx, liquidacionId: string, d: DatosCorte): Promise<LineaCalculada[]> {
  const lineas: LineaCalculada[] = []
  const filtroAcuerdo = d.acuerdoId ? Prisma.sql`AND "acuerdoId" = ${d.acuerdoId}` : Prisma.empty

  // 1 · Cuentas por pagar vivas, no disputadas, nacidas hasta el fin del período.
  const cxps = await tx.$queryRaw<{ id: string; codigo: string; descripcion: string; montoNeto: string; montoSaldado: string; montoBruto: string; comision: string; origen: string }[]>`
    UPDATE "supply_cuentas_por_pagar" SET "liquidacionId" = ${liquidacionId}
     WHERE "proveedorId" = ${d.proveedorId} ${filtroAcuerdo}
       AND "liquidacionId" IS NULL AND "estado" IN ('ABIERTA', 'PARCIALMENTE_SALDADA')
       AND "createdAt" <= ${d.hasta}
    RETURNING "id", "codigo", "descripcion", "montoNeto"::text, "montoSaldado"::text, "montoBruto"::text, "comision"::text, "origen"::text
  `
  for (const c of cxps) {
    const pendiente = pendienteDeCuenta({ montoNeto: Number(c.montoNeto), montoSaldado: Number(c.montoSaldado) })
    if (pendiente <= 0) continue
    lineas.push({
      tipo: 'CUENTA_POR_PAGAR', referencia: c.codigo, descripcion: c.descripcion, monto: pendiente, cuentaPorPagarId: c.id,
      ...(c.origen === 'VENTA_DIRECTA' ? { bruto: Number(c.montoBruto), comision: Number(c.comision) } : {}),
    })
  }

  // 2 · Cuentas por cobrar vivas: restan.
  const cxcs = await tx.$queryRaw<{ id: string; codigo: string; descripcion: string; montoNeto: string; montoSaldado: string }[]>`
    UPDATE "supply_cuentas_por_cobrar" SET "liquidacionId" = ${liquidacionId}
     WHERE "proveedorId" = ${d.proveedorId} ${filtroAcuerdo}
       AND "liquidacionId" IS NULL AND "estado" IN ('ABIERTA', 'PARCIALMENTE_SALDADA')
       AND "createdAt" <= ${d.hasta}
    RETURNING "id", "codigo", "descripcion", "montoNeto"::text, "montoSaldado"::text
  `
  for (const c of cxcs) {
    const pendiente = pendienteDeCuenta({ montoNeto: Number(c.montoNeto), montoSaldado: Number(c.montoSaldado) })
    if (pendiente <= 0) continue
    lineas.push({ tipo: 'CUENTA_POR_COBRAR', referencia: c.codigo, descripcion: c.descripcion, monto: -pendiente, cuentaPorCobrarId: c.id })
  }

  // 3 · Redenciones por pagar (y sus reversas) del período, sin liquidar.
  const asientos = await tx.$queryRaw<{ id: string; tipo: string; monto: string; redencionId: string | null; referencia: string | null }[]>`
    UPDATE "supply_asientos_financieros" SET "liquidacionId" = ${liquidacionId}
     WHERE "proveedorId" = ${d.proveedorId} ${filtroAcuerdo}
       AND "liquidacionId" IS NULL AND "redencionId" IS NOT NULL
       AND "tipo" IN ('REDENCION_POR_PAGAR', 'REVERSA')
       AND "createdAt" >= ${d.desde} AND "createdAt" <= ${d.hasta}
    RETURNING "id", "tipo"::text, "monto"::text, "redencionId", "referencia"
  `
  // Una redención reversada dentro del mismo corte suma cero: se reclama (para
  // que no vuelva a entrar) y no se lista. Una reversa cuya redención ya se
  // liquidó antes entra como ajuste negativo.
  const porRedencion = new Map<string, { monto: number; tipos: string[] }>()
  for (const a of asientos) {
    const k = a.redencionId ?? a.id
    const prev = porRedencion.get(k) ?? { monto: 0, tipos: [] }
    prev.monto += Number(a.monto)
    prev.tipos.push(a.tipo)
    porRedencion.set(k, prev)
  }
  for (const [redencionId, r] of porRedencion) {
    const monto = redondear2(r.monto)
    if (Math.abs(monto) < 0.005) continue
    lineas.push({
      tipo: monto > 0 ? 'REDENCION' : 'AJUSTE',
      referencia: redencionId,
      descripcion: monto > 0 ? 'Unidad entregada bajo pago por redención' : 'Reversa de una redención liquidada antes',
      monto,
      redencionId,
    })
  }

  // 4 · Depósito: lo que cubre el neto positivo, de los depósitos vivos más
  // antiguos primero. Es un PLAN: se ejecuta al pagar, cuando se comprueba de
  // nuevo el saldo.
  if (d.aplicarDeposito) {
    const netoAntes = lineas.reduce((t, l) => t + l.monto, 0)
    const depositos = await tx.supplyDeposito.findMany({
      where: { proveedorId: d.proveedorId, estado: { in: [...DEPOSITO_VIVO] }, ...(d.acuerdoId ? { acuerdoId: d.acuerdoId } : {}) },
      orderBy: [{ cierraAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, codigo: true, montoOriginal: true, montoAplicado: true, montoDevuelto: true },
    })
    let restante = netoAntes
    for (const dep of depositos) {
      const disponible = saldoDisponibleDeposito({ montoOriginal: Number(dep.montoOriginal), montoAplicado: Number(dep.montoAplicado), montoDevuelto: Number(dep.montoDevuelto) })
      const aplicar = depositoAplicableAlCorte(restante, disponible)
      if (aplicar <= 0) break
      lineas.push({ tipo: 'DEPOSITO_APLICADO', referencia: dep.codigo, descripcion: 'Saldo de depósito aplicado al corte', monto: -aplicar, depositoId: dep.id })
      restante = redondear2(restante - aplicar)
    }
  }
  return lineas
}

/**
 * Calcula un corte. Nace directamente CALCULADA con sus líneas y su snapshot;
 * BORRADOR queda para un corte creado sin calcular (no se usa desde la UI).
 */
export async function calcularLiquidacion(d: DatosCorte): Promise<CorteCalculado> {
  if (d.hasta <= d.desde) throw new Error('El período termina antes de empezar.')
  return sinEmpresa('Membego Supply: calcular la liquidación de un proveedor', async (tx) => {
    if (d.claveIdempotencia) {
      const previa = await tx.supplyLiquidacion.findUnique({
        where: { claveIdempotencia: d.claveIdempotencia },
        select: { id: true, codigo: true, netoLiquidar: true, _count: { select: { lineas: true } } },
      })
      if (previa) return { id: previa.id, codigo: previa.codigo, netoLiquidar: Number(previa.netoLiquidar), lineas: previa._count.lineas, reutilizada: true }
    }
    const viva = await tx.supplyLiquidacion.findFirst({
      where: { proveedorId: d.proveedorId, periodoDesde: d.desde, periodoHasta: d.hasta, estado: { not: 'CANCELADA' } },
      select: { codigo: true },
    })
    if (viva) throw new Error(`Ya existe la liquidación ${viva.codigo} para ese proveedor y período.`)

    const proveedor = await tx.company.findUnique({ where: { id: d.proveedorId }, select: { id: true } })
    if (!proveedor) throw new Error('Proveedor no encontrado.')
    const acuerdo = d.acuerdoId
      ? await tx.supplyAcuerdo.findUnique({ where: { id: d.acuerdoId }, select: { proveedorId: true, version: true, moneda: true } })
      : null
    if (d.acuerdoId && (!acuerdo || acuerdo.proveedorId !== d.proveedorId)) throw new Error('El acuerdo no es de este proveedor.')

    const secuencia = (await tx.supplyLiquidacion.count()) + 1
    const liq = await tx.supplyLiquidacion.create({
      data: {
        codigo: codigoLiquidacion(secuencia),
        proveedorId: d.proveedorId,
        acuerdoId: d.acuerdoId ?? null,
        acuerdoVersion: acuerdo?.version ?? null,
        estado: 'BORRADOR',
        periodoDesde: d.desde,
        periodoHasta: d.hasta,
        moneda: acuerdo?.moneda ?? 'DOP',
        notas: d.notas ?? null,
        calculadaPorId: d.calculadaPorId ?? null,
        claveIdempotencia: d.claveIdempotencia ?? null,
      },
      select: { id: true, codigo: true },
    })

    const lineas = await reclamarYArmar(tx, liq.id, d)
    const snapshot = netearLiquidacion(lineas as LineaNeteo[])
    if (lineas.length > 0) {
      await tx.supplyLiquidacionLinea.createMany({
        data: lineas.map((l) => ({
          liquidacionId: liq.id,
          tipo: l.tipo,
          referencia: l.referencia,
          descripcion: l.descripcion,
          monto: new Prisma.Decimal(l.monto),
          cuentaPorPagarId: l.cuentaPorPagarId ?? null,
          cuentaPorCobrarId: l.cuentaPorCobrarId ?? null,
          redencionId: l.redencionId ?? null,
          depositoId: l.depositoId ?? null,
        })),
      })
    }
    await tx.supplyLiquidacion.update({
      where: { id: liq.id },
      data: {
        estado: 'CALCULADA',
        calculadaAt: new Date(),
        ventasBrutas: new Prisma.Decimal(snapshot.ventasBrutas),
        comisionMembego: new Prisma.Decimal(snapshot.comisionMembego),
        montoProveedor: new Prisma.Decimal(snapshot.montoProveedor),
        redencionesMonto: new Prisma.Decimal(snapshot.redencionesMonto),
        reembolsos: new Prisma.Decimal(snapshot.reembolsos),
        ajustes: new Prisma.Decimal(snapshot.ajustes),
        depositoAplicado: new Prisma.Decimal(snapshot.depositoAplicado),
        netoLiquidar: new Prisma.Decimal(snapshot.netoLiquidar),
        redenciones: lineas.filter((l) => l.tipo === 'REDENCION').length,
        ventas: lineas.filter((l) => l.tipo === 'CUENTA_POR_PAGAR' && l.bruto != null).length,
        snapshot: { ...snapshot, lineas: lineas.length, acuerdoVersion: acuerdo?.version ?? null, calculadaAt: new Date().toISOString() },
      },
    })
    return { id: liq.id, codigo: liq.codigo, netoLiquidar: snapshot.netoLiquidar, lineas: lineas.length, reutilizada: false }
  })
}

/** Suelta todo lo que la liquidación había reclamado. */
async function soltarReclamosEnTx(tx: Tx, liquidacionId: string): Promise<void> {
  await tx.supplyCuentaPorPagar.updateMany({ where: { liquidacionId }, data: { liquidacionId: null } })
  await tx.supplyCuentaPorCobrar.updateMany({ where: { liquidacionId }, data: { liquidacionId: null } })
  await tx.supplyAsientoFinanciero.updateMany({ where: { liquidacionId, tipo: { in: ['REDENCION_POR_PAGAR', 'REVERSA'] } }, data: { liquidacionId: null } })
}

/**
 * Mueve la liquidación: revisar, aprobar, disputar, cancelar, conciliar.
 * PAGADA no pasa por aquí: va por `pagarLiquidacion`, que asienta.
 */
export async function moverLiquidacion(
  liquidacionId: string,
  hasta: Exclude<SupplyLiquidacionEstado, 'PAGADA' | 'BORRADOR' | 'CALCULADA'>,
  actorId: string | null,
  motivo?: string | null
): Promise<void> {
  if ((hasta === 'DISPUTADA' || hasta === 'CANCELADA') && !motivo?.trim()) {
    throw new Error('Disputar o cancelar una liquidación exige un motivo.')
  }
  await sinEmpresa('Membego Supply: ciclo de vida de una liquidación', async (tx) => {
    const liq = await tx.supplyLiquidacion.findUnique({
      where: { id: liquidacionId },
      select: { estado: true, calculadaPorId: true },
    })
    if (!liq) throw new Error('Liquidación no encontrada.')
    exigirTransicion(TRANSICIONES_LIQUIDACION, liq.estado, hasta, 'Liquidación')

    // Quien calcula no aprueba: es el mismo principio que la orden de compra.
    if (hasta === 'APROBADA' && actorId && liq.calculadaPorId && actorId === liq.calculadaPorId) {
      throw new Error('Una liquidación no la puede aprobar quien la calculó.')
    }
    if (hasta === 'CANCELADA' && LIQUIDACION_PAGADA.includes(liq.estado)) {
      throw new Error('Una liquidación pagada no se cancela: se disputa y se corrige con un ajuste.')
    }

    await tx.supplyLiquidacion.update({
      where: { id: liquidacionId },
      data: {
        estado: hasta,
        ...(hasta === 'APROBADA' ? { aprobadaPorId: actorId, aprobadaAt: new Date() } : {}),
        ...(hasta === 'CONCILIADA' ? { conciliadaAt: new Date() } : {}),
        ...(hasta === 'DISPUTADA' || hasta === 'CANCELADA' ? { disputaMotivo: motivo!.trim() } : {}),
      },
    })
    if (hasta === 'CANCELADA') await soltarReclamosEnTx(tx, liquidacionId)
  })
}

/**
 * Recalcula una liquidación disputada: suelta lo reclamado, vuelve a reclamar
 * con lo que hay hoy y reemplaza las líneas. El snapshot anterior queda en
 * `snapshot.anteriores` para poder explicar qué cambió.
 */
export async function recalcularLiquidacion(liquidacionId: string, actorId?: string | null, aplicarDeposito = false): Promise<CorteCalculado> {
  return sinEmpresa('Membego Supply: recalcular una liquidación disputada', async (tx) => {
    const liq = await tx.supplyLiquidacion.findUnique({ where: { id: liquidacionId } })
    if (!liq) throw new Error('Liquidación no encontrada.')
    exigirTransicion(TRANSICIONES_LIQUIDACION, liq.estado, 'CALCULADA', 'Liquidación')
    await soltarReclamosEnTx(tx, liquidacionId)
    await tx.supplyLiquidacionLinea.deleteMany({ where: { liquidacionId } })
    const lineas = await reclamarYArmar(tx, liquidacionId, {
      proveedorId: liq.proveedorId,
      acuerdoId: liq.acuerdoId,
      desde: liq.periodoDesde,
      hasta: liq.periodoHasta,
      aplicarDeposito,
    })
    const snapshot = netearLiquidacion(lineas as LineaNeteo[])
    if (lineas.length > 0) {
      await tx.supplyLiquidacionLinea.createMany({
        data: lineas.map((l) => ({
          liquidacionId, tipo: l.tipo, referencia: l.referencia, descripcion: l.descripcion, monto: new Prisma.Decimal(l.monto),
          cuentaPorPagarId: l.cuentaPorPagarId ?? null, cuentaPorCobrarId: l.cuentaPorCobrarId ?? null, redencionId: l.redencionId ?? null, depositoId: l.depositoId ?? null,
        })),
      })
    }
    const anterior = (liq.snapshot ?? {}) as Record<string, unknown>
    const anteriores = Array.isArray(anterior.anteriores) ? anterior.anteriores : []
    await tx.supplyLiquidacion.update({
      where: { id: liquidacionId },
      data: {
        estado: 'CALCULADA', calculadaAt: new Date(), calculadaPorId: actorId ?? liq.calculadaPorId, disputaMotivo: null,
        aprobadaPorId: null, aprobadaAt: null,
        ventasBrutas: new Prisma.Decimal(snapshot.ventasBrutas), comisionMembego: new Prisma.Decimal(snapshot.comisionMembego),
        montoProveedor: new Prisma.Decimal(snapshot.montoProveedor), redencionesMonto: new Prisma.Decimal(snapshot.redencionesMonto),
        reembolsos: new Prisma.Decimal(snapshot.reembolsos), ajustes: new Prisma.Decimal(snapshot.ajustes),
        depositoAplicado: new Prisma.Decimal(snapshot.depositoAplicado), netoLiquidar: new Prisma.Decimal(snapshot.netoLiquidar),
        redenciones: lineas.filter((l) => l.tipo === 'REDENCION').length,
        ventas: lineas.filter((l) => l.tipo === 'CUENTA_POR_PAGAR' && l.bruto != null).length,
        snapshot: {
          ...snapshot, lineas: lineas.length, calculadaAt: new Date().toISOString(),
          anteriores: [...anteriores, { ...anterior, anteriores: undefined, disputaMotivo: liq.disputaMotivo }],
        } as Prisma.InputJsonValue,
      },
    })
    return { id: liq.id, codigo: liq.codigo, netoLiquidar: snapshot.netoLiquidar, lineas: lineas.length, reutilizada: false }
  })
}

export interface LiquidacionPagada {
  pagoId: string | null
  netoLiquidar: number
  depositoAplicado: number
}

/**
 * PAGA la liquidación APROBADA: aplica el depósito planeado, salda cada cuenta,
 * registra el pago por el neto (o el cobro al proveedor si el neto es
 * negativo) y lo asienta. Todo en una transacción; dos clics no pagan dos
 * veces porque el estado se comprueba con la fila bloqueada.
 */
export async function pagarLiquidacion(
  liquidacionId: string,
  d: { metodo?: string | null; referencia?: string | null; actorId?: string | null }
): Promise<LiquidacionPagada> {
  const res = await sinEmpresa('Membego Supply: pagar una liquidación aprobada', async (tx) => {
    const bloqueo = await tx.$queryRaw<{ estado: SupplyLiquidacionEstado }[]>`
      SELECT "estado" FROM "supply_liquidaciones" WHERE "id" = ${liquidacionId} FOR UPDATE
    `
    if (!bloqueo[0]) throw new Error('Liquidación no encontrada.')
    exigirTransicion(TRANSICIONES_LIQUIDACION, bloqueo[0].estado, 'PAGADA', 'Liquidación')
    if (bloqueo[0].estado !== 'APROBADA') throw new Error('Solo se paga una liquidación aprobada.')

    const liq = await tx.supplyLiquidacion.findUniqueOrThrow({
      where: { id: liquidacionId },
      include: { lineas: true, acuerdo: { select: { id: true } } },
    })
    // Sin acuerdo explícito, el pago se cuelga del acuerdo del proveedor con
    // más movimiento en el corte (los pagos exigen acuerdo en el esquema).
    let acuerdoId = liq.acuerdoId
    if (!acuerdoId) {
      const cualquiera = await tx.supplyAcuerdo.findFirst({
        where: { proveedorId: liq.proveedorId, estado: { in: ['ACTIVO', 'SUSPENDIDO', 'COMPLETADO', 'VENCIDO', 'APROBADO'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (!cualquiera) throw new Error('El proveedor no tiene ningún acuerdo contra el que registrar el pago.')
      acuerdoId = cualquiera.id
    }

    // 1 · Depósito planeado → aplicación real sobre las cuentas por pagar del corte.
    let depositoAplicado = 0
    const planes = liq.lineas.filter((l) => l.tipo === 'DEPOSITO_APLICADO' && l.depositoId)
    const cxpsDelCorte = liq.lineas.filter((l) => l.tipo === 'CUENTA_POR_PAGAR' && l.cuentaPorPagarId)
    for (const plan of planes) {
      let restante = Math.abs(Number(plan.monto))
      for (const linea of cxpsDelCorte) {
        if (restante <= 0.005) break
        const cuenta = await tx.supplyCuentaPorPagar.findUnique({ where: { id: linea.cuentaPorPagarId! }, select: { montoNeto: true, montoSaldado: true, estado: true } })
        if (!cuenta || !CUENTA_VIVA.includes(cuenta.estado)) continue
        const pendiente = pendienteDeCuenta({ montoNeto: Number(cuenta.montoNeto), montoSaldado: Number(cuenta.montoSaldado) })
        const aplicar = redondear2(Math.min(restante, pendiente))
        if (aplicar <= 0) continue
        await aplicarDepositoEnTx(tx, plan.depositoId!, linea.cuentaPorPagarId!, aplicar, {
          actorId: d.actorId, liquidacionId, motivo: `Aplicado en la liquidación ${liq.codigo}.`,
        })
        restante = redondear2(restante - aplicar)
        depositoAplicado = redondear2(depositoAplicado + aplicar)
      }
      if (restante > 0.005) {
        throw new Error('El depósito ya no tiene el saldo que se planeó aplicar: recalcula la liquidación.')
      }
    }

    // 2 · Las cuentas del corte quedan saldadas por la liquidación.
    for (const linea of cxpsDelCorte) {
      const cuenta = await tx.supplyCuentaPorPagar.findUnique({ where: { id: linea.cuentaPorPagarId! }, select: { montoNeto: true, montoSaldado: true, estado: true } })
      if (!cuenta || !CUENTA_VIVA.includes(cuenta.estado)) continue
      const pendiente = pendienteDeCuenta({ montoNeto: Number(cuenta.montoNeto), montoSaldado: Number(cuenta.montoSaldado) })
      if (pendiente > 0) await saldarCuentaPorPagarEnTx(tx, linea.cuentaPorPagarId!, pendiente, { via: 'LIQUIDACION', referencia: liq.codigo, actorId: d.actorId })
    }
    for (const linea of liq.lineas.filter((l) => l.tipo === 'CUENTA_POR_COBRAR' && l.cuentaPorCobrarId)) {
      const cuenta = await tx.supplyCuentaPorCobrar.findUnique({ where: { id: linea.cuentaPorCobrarId! }, select: { montoNeto: true, montoSaldado: true, estado: true } })
      if (!cuenta || !CUENTA_VIVA.includes(cuenta.estado)) continue
      const pendiente = pendienteDeCuenta({ montoNeto: Number(cuenta.montoNeto), montoSaldado: Number(cuenta.montoSaldado) })
      if (pendiente > 0) await saldarCuentaPorCobrarEnTx(tx, linea.cuentaPorCobrarId!, pendiente, { via: 'LIQUIDACION', referencia: liq.codigo, actorId: d.actorId })
    }

    // 3 · El dinero que se mueve de verdad: neto positivo = Membego paga;
    // negativo = el proveedor devuelve; cero = todo se compensó.
    const neto = Number(liq.netoLiquidar)
    let pagoId: string | null = null
    if (Math.abs(neto) >= 0.005) {
      const esPago = neto > 0
      const pago = await registrarPagoEnTx(tx, {
        acuerdoId,
        tipo: esPago ? 'LIQUIDACION_REDENCIONES' : 'REEMBOLSO',
        monto: Math.abs(neto),
        metodo: d.metodo ?? null,
        referencia: d.referencia ?? liq.codigo,
        notas: `Liquidación ${liq.codigo} (${liq.periodoDesde.toISOString().slice(0, 10)} → ${liq.periodoHasta.toISOString().slice(0, 10)}).`,
        periodoDesde: liq.periodoDesde,
        periodoHasta: liq.periodoHasta,
        registradoPorId: d.actorId ?? null,
        claveIdempotencia: `liquidacion-pago:${liq.id}`,
      })
      pagoId = pago.id
      await tx.supplyPago.update({ where: { id: pago.id }, data: { estado: 'CONFIRMADO', confirmadoAt: new Date() } })
      await tx.supplyAsientoFinanciero.create({
        data: {
          proveedorId: liq.proveedorId,
          acuerdoId,
          pagoId: pago.id,
          liquidacionId,
          tipo: esPago ? 'PAGO' : 'REEMBOLSO',
          monto: new Prisma.Decimal(esPago ? -neto : -neto),
          moneda: liq.moneda,
          referencia: liq.codigo,
          motivo: esPago ? `Pago de la liquidación ${liq.codigo}.` : `Cobro al proveedor por la liquidación ${liq.codigo}.`,
          actorId: d.actorId ?? null,
        },
      })
    }

    await tx.supplyLiquidacion.update({
      where: { id: liquidacionId },
      data: { estado: 'PAGADA', pagadaAt: new Date(), pagoId, depositoAplicado: new Prisma.Decimal(depositoAplicado) },
    })
    return { pagoId, netoLiquidar: neto, depositoAplicado }
  })

  if (res.pagoId) {
    const { avisarLiquidacion } = await import('./notificar')
    await avisarLiquidacion(res.pagoId)
  }
  return res
}

// ── Lecturas ────────────────────────────────────────────────────────────────

export async function listarLiquidaciones(f: { proveedorId?: string; estado?: SupplyLiquidacionEstado; limite?: number } = {}) {
  return sinEmpresa('Membego Supply: liquidaciones de la plataforma', (tx) =>
    tx.supplyLiquidacion.findMany({
      where: { ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}), ...(f.estado ? { estado: f.estado } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: f.limite ?? 200,
      select: {
        id: true, codigo: true, estado: true, periodoDesde: true, periodoHasta: true, moneda: true,
        ventasBrutas: true, comisionMembego: true, montoProveedor: true, redencionesMonto: true, reembolsos: true,
        ajustes: true, depositoAplicado: true, netoLiquidar: true, redenciones: true, ventas: true,
        calculadaAt: true, aprobadaAt: true, pagadaAt: true, conciliadaAt: true, disputaMotivo: true, createdAt: true,
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true } },
        calculadaPor: { select: { name: true } },
        aprobadaPor: { select: { name: true } },
        _count: { select: { lineas: true } },
      },
    })
  )
}

export async function fichaLiquidacion(id: string) {
  return sinEmpresa('Membego Supply: ficha de una liquidación', (tx) =>
    tx.supplyLiquidacion.findUnique({
      where: { id },
      include: {
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true, version: true } },
        calculadaPor: { select: { id: true, name: true } },
        aprobadaPor: { select: { name: true } },
        pago: { select: { id: true, tipo: true, monto: true, referencia: true, confirmadoAt: true } },
        lineas: { orderBy: [{ tipo: 'asc' }, { createdAt: 'asc' }] },
        conciliaciones: { select: { id: true, codigo: true, estado: true } },
      },
    })
  )
}

/** Cifras del tablero. */
export async function resumenLiquidaciones(tx: Tx, proveedorId?: string) {
  const pendientes = await tx.supplyLiquidacion.findMany({
    where: { estado: { in: ['CALCULADA', 'EN_REVISION', 'APROBADA', 'DISPUTADA'] }, ...(proveedorId ? { proveedorId } : {}) },
    select: { netoLiquidar: true, estado: true },
  })
  return {
    pendientes: pendientes.length,
    montoPendiente: redondear2(pendientes.reduce((t, l) => t + Math.max(0, Number(l.netoLiquidar)), 0)),
    disputadas: pendientes.filter((l) => l.estado === 'DISPUTADA').length,
  }
}
