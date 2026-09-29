import 'server-only'

import { $Enums } from '@prisma/client'
import { ACCION_LABEL } from '@/modules/auditoria/queries'

import { sinEmpresa, type Tx } from '@/lib/tenant'
import { CUENTA_VIVA, INCIDENCIA_VIVA } from './catalogo'
import { resumenCuentas } from './cuentas'
import { saldoDepositos } from './depositos'
import { economiaComision, redondear2 } from './dinero'
import { resumenLiquidaciones } from './liquidaciones'
import { discrepanciasAbiertas } from './conciliacion-proveedor'
import { resumenVentas } from './ventas'
import { resumenPool, type FiltroSupply, type ResumenPool } from './pool'
import { economiaUnidad } from './economia'

/**
 * MEMBEGO SUPPLY · TABLERO OPERACIONAL Y REPORTES (§23, §24, §25).
 *
 * La pantalla de Resumen no puede ser un empty state con cuatro cifras: tiene
 * que contestar de una vez cuánto capital hay invertido, cuánto dinero está
 * parado en depósitos, cuánto se debe y cuánto se le debe a Membego, qué
 * liquidaciones esperan, cuántas incidencias y discrepancias están abiertas
 * y cuánto se entregó hoy y este mes. Todo sale de las mismas tablas que las
 * pantallas de detalle: aquí no se inventa ninguna cifra.
 */

export interface ResumenFinanciero {
  pool: ResumenPool
  /** Capital comprometido = valor adquirido (lotes) + depósitos vivos. */
  capitalInvertido: number
  valorVencido: number
  unidadesVencidas: number
  depositos: { disponible: number; depositos: number }
  cuentasPorPagar: { abiertas: number; montoPendiente: number; vencidas: number; montoVencido: number; disputadas: number }
  cuentasPorCobrar: { abiertas: number; montoPendiente: number; vencidas: number; montoVencido: number; disputadas: number }
  liquidaciones: { pendientes: number; montoPendiente: number; disputadas: number }
  incidenciasAbiertas: number
  discrepanciasAbiertas: number
  redencionesHoy: number
  redencionesMes: number
  ventasMes: { ventas: number; entregadas: number; bruto: number; comision: number; proveedor: number }
  proveedoresActivos: number
  acuerdosActivos: number
  acuerdosSuspendidos: number
}

function inicioDelDia(ahora: Date): Date {
  const d = new Date(ahora)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function inicioDelMes(ahora: Date): Date {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1))
}

export async function resumenFinanciero(ahora: Date = new Date()): Promise<ResumenFinanciero> {
  const pool = await resumenPool(ahora)
  return sinEmpresa('Membego Supply: tablero financiero de la plataforma', async (tx) => {
    const [depositos, cxp, cxc, liquidaciones, incidenciasAbiertas, discrepancias, redencionesHoy, redencionesMes, ventasMes, vencidos, proveedores, acuerdos] =
      await Promise.all([
        saldoDepositos(tx),
        resumenCuentas(tx, 'CXP', ahora),
        resumenCuentas(tx, 'CXC', ahora),
        resumenLiquidaciones(tx),
        tx.supplyIncidencia.count({ where: { estado: { in: [...INCIDENCIA_VIVA] } } }),
        discrepanciasAbiertas(tx),
        tx.supplyRedencion.count({ where: { reversadaAt: null, createdAt: { gte: inicioDelDia(ahora) } } }),
        tx.supplyRedencion.count({ where: { reversadaAt: null, createdAt: { gte: inicioDelMes(ahora) } } }),
        resumenVentas(tx, inicioDelMes(ahora), ahora),
        tx.supplyLote.findMany({ where: { estado: { in: ['VENCIDO', 'CERRADO', 'CANCELADO'] } }, select: { cerradas: true, snapshotCostoUnitario: true } }),
        tx.supplyAcuerdo.groupBy({ by: ['proveedorId'], where: { estado: { in: ['ACTIVO', 'SUSPENDIDO'] } } }),
        tx.supplyAcuerdo.groupBy({ by: ['estado'], _count: { _all: true } }),
      ])
    // Lo vencido: unidades CERRADAS de lotes ya vencidos o cerrados, a costo. Las
    // cubetas CERRADO de un lote ACTIVO son cancelaciones, no vencimiento.
    const unidadesVencidas = vencidos.reduce((t, l) => t + l.cerradas, 0)
    const valorVencido = redondear2(vencidos.reduce((t, l) => t + l.cerradas * Number(l.snapshotCostoUnitario), 0))
    return {
      pool,
      capitalInvertido: redondear2(pool.valorAdquirido + depositos.disponible),
      valorVencido,
      unidadesVencidas,
      depositos,
      cuentasPorPagar: cxp,
      cuentasPorCobrar: cxc,
      liquidaciones,
      incidenciasAbiertas,
      discrepanciasAbiertas: discrepancias,
      redencionesHoy,
      redencionesMes,
      ventasMes,
      proveedoresActivos: proveedores.length,
      acuerdosActivos: acuerdos.find((a) => a.estado === 'ACTIVO')?._count._all ?? 0,
      acuerdosSuspendidos: acuerdos.find((a) => a.estado === 'SUSPENDIDO')?._count._all ?? 0,
    }
  })
}

// ── Supply por categoría (tablero) ──────────────────────────────────────────

export interface FilaCategoria {
  categoria: string
  lotes: number
  compradas: number
  redimidas: number
  disponibles: number
  valorAdquirido: number
  valorConsumido: number
}

/** Agrupa el supply por el tipo de negocio del proveedor. */
export async function supplyPorCategoria(): Promise<FilaCategoria[]> {
  return sinEmpresa('Membego Supply: supply por categoría de negocio', async (tx) => {
    const lotes = await tx.supplyLote.findMany({
      where: { estado: { notIn: ['CANCELADO'] } },
      select: { compradas: true, redimidas: true, disponibles: true, snapshotCostoUnitario: true, proveedor: { select: { tipoNegocioCodigo: true, type: true } } },
    })
    const mapa = new Map<string, FilaCategoria>()
    for (const l of lotes) {
      const categoria = l.proveedor.tipoNegocioCodigo ?? l.proveedor.type ?? 'otro'
      const fila = mapa.get(categoria) ?? { categoria, lotes: 0, compradas: 0, redimidas: 0, disponibles: 0, valorAdquirido: 0, valorConsumido: 0 }
      const costo = Number(l.snapshotCostoUnitario)
      fila.lotes += 1
      fila.compradas += l.compradas
      fila.redimidas += l.redimidas
      fila.disponibles += l.disponibles
      fila.valorAdquirido += l.compradas * costo
      fila.valorConsumido += l.redimidas * costo
      mapa.set(categoria, fila)
    }
    return [...mapa.values()]
      .map((f) => ({ ...f, valorAdquirido: redondear2(f.valorAdquirido), valorConsumido: redondear2(f.valorConsumido) }))
      .sort((a, b) => b.valorAdquirido - a.valorAdquirido)
  })
}

// ── Reportes (§24) ──────────────────────────────────────────────────────────

export interface FiltroReporte extends FiltroSupply {
  clienteId?: string
  asignacionId?: string
  sucursalId?: string
}

/** Utilización: por lote, qué parte de lo comprado se repartió y se consumió. */
export async function reporteUtilizacion(f: FiltroReporte = {}) {
  return sinEmpresa('Membego Supply: reporte de utilización', async (tx) => {
    const lotes = await tx.supplyLote.findMany({
      where: {
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}),
        ...(f.loteId ? { id: f.loteId } : {}),
        ...(f.estado ? { estado: f.estado as never } : {}),
      },
      orderBy: { venceAt: 'asc' },
      select: {
        codigo: true, estado: true, compradas: true, disponibles: true, asignadas: true, retenidas: true, emitidas: true,
        redimidas: true, cerradas: true, snapshotItemNombre: true, snapshotCostoUnitario: true, venceAt: true,
        proveedor: { select: { name: true } },
      },
    })
    return lotes.map((l) => {
      const pct = (n: number) => (l.compradas === 0 ? 0 : Number(((n / l.compradas) * 100).toFixed(1)))
      return {
        codigo: l.codigo, proveedor: l.proveedor.name, item: l.snapshotItemNombre, estado: l.estado, venceAt: l.venceAt,
        compradas: l.compradas, repartidas: l.emitidas + l.redimidas, redimidas: l.redimidas, disponibles: l.disponibles,
        asignadas: l.asignadas, vencidas: l.cerradas,
        pctRepartido: pct(l.emitidas + l.redimidas), pctRedimido: pct(l.redimidas), pctVencido: pct(l.cerradas),
        valorConsumido: redondear2(l.redimidas * Number(l.snapshotCostoUnitario)),
        valorVencido: redondear2(l.cerradas * Number(l.snapshotCostoUnitario)),
      }
    })
  })
}

/** Supply vencido: lo que se perdió, por lote y por proveedor. */
export async function reporteVencidos(f: FiltroReporte = {}) {
  return sinEmpresa('Membego Supply: reporte de supply vencido', async (tx) => {
    const lotes = await tx.supplyLote.findMany({
      where: {
        estado: { in: ['VENCIDO', 'CERRADO'] },
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.desde || f.hasta ? { venceAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } } : {}),
      },
      orderBy: { venceAt: 'desc' },
      select: {
        codigo: true, compradas: true, redimidas: true, cerradas: true, snapshotItemNombre: true, snapshotCostoUnitario: true, venceAt: true,
        proveedor: { select: { name: true } }, acuerdo: { select: { politicaSobrante: true } },
      },
    })
    return lotes.map((l) => ({
      codigo: l.codigo, proveedor: l.proveedor.name, item: l.snapshotItemNombre, venceAt: l.venceAt,
      compradas: l.compradas, redimidas: l.redimidas, vencidas: l.cerradas, politica: l.acuerdo.politicaSobrante,
      valorVencido: redondear2(l.cerradas * Number(l.snapshotCostoUnitario)),
    }))
  })
}

/** Derechos de clientes con todos los filtros del encargo. */
export async function reporteDerechos(f: FiltroReporte = {}, limite = 2000) {
  return sinEmpresa('Membego Supply: reporte de derechos', (tx) =>
    tx.supplyDerecho.findMany({
      where: {
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.loteId ? { loteId: f.loteId } : {}),
        ...(f.acuerdoId ? { lote: { acuerdoId: f.acuerdoId } } : {}),
        ...(f.asignacionId ? { asignacionId: f.asignacionId } : {}),
        ...(f.clienteId ? { clienteId: f.clienteId } : {}),
        ...(f.estado ? { estado: f.estado as never } : {}),
        ...(f.desde || f.hasta ? { emitidoAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } } : {}),
      },
      orderBy: { emitidoAt: 'desc' },
      take: limite,
      select: {
        id: true, estado: true, origen: true, emitidoAt: true, vencAt: true, redimidoAt: true, costoUnitario: true, precioCliente: true,
        cliente: { select: { nombre: true } }, proveedor: { select: { name: true } },
        lote: { select: { codigo: true, snapshotItemNombre: true } }, asignacion: { select: { etiqueta: true } },
      },
    })
  )
}

export async function reporteIncidencias(f: FiltroReporte = {}, limite = 2000) {
  return sinEmpresa('Membego Supply: reporte de incidencias', (tx) =>
    tx.supplyIncidencia.findMany({
      where: {
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.loteId ? { loteId: f.loteId } : {}),
        ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}),
        ...(f.clienteId ? { clienteId: f.clienteId } : {}),
        ...(f.sucursalId ? { sucursalId: f.sucursalId } : {}),
        ...(f.estado ? { estado: f.estado as never } : {}),
        ...(f.desde || f.hasta ? { createdAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true, tipo: true, estado: true, detalle: true, resolucion: true, createdAt: true, resueltoAt: true, loteId: true, ventaId: true,
        proveedor: { select: { name: true } }, cliente: { select: { nombre: true } },
        reportadoPor: { select: { name: true } }, resueltoPor: { select: { name: true } },
      },
    })
  )
}

// ── Rentabilidad y unit economics (§25) ─────────────────────────────────────

export interface Rentabilidad {
  /** Precompra: lotes. */
  costoAdquirido: number
  costoConsumido: number
  costoVencido: number
  costoRegalado: number
  ingresoVentasPrecompra: number
  unidadesRegaladas: number
  unidadesVendidas: number
  subsidio: number
  margenPrecompra: number
  /** Comisión: ventas sin precompra. */
  comision: { ventas: number; ingresoBruto: number; recibioProveedor: number; retuvoMembego: number; margenPorcentaje: number }
  /** Ejemplo del encargo por unidad promedio del período. */
  unidadPromedio: { costo: number; precioPublico: number | null; precioCliente: number; subsidio: number; margen: number } | null
}

/**
 * Las nueve preguntas del §25 para un período: cuánto costó, se vendió, se
 * regaló, expiró, produjo, recibió el proveedor, retuvo Membego, subsidió
 * Membego y cuál fue el margen. Lo regalado y lo vendido se miden sobre lo
 * REDIMIDO: un voucher sin canjear no costó ni produjo nada todavía.
 */
export async function rentabilidad(f: FiltroReporte = {}): Promise<Rentabilidad> {
  return sinEmpresa('Membego Supply: rentabilidad y unit economics', async (tx) => {
    const periodo = f.desde || f.hasta ? { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } : undefined
    const filtroProv = f.proveedorId ? { proveedorId: f.proveedorId } : {}
    const [lotes, redenciones, ventas] = await Promise.all([
      tx.supplyLote.findMany({
        where: { estado: { notIn: ['CANCELADO'] }, ...filtroProv, ...(periodo ? { createdAt: periodo } : {}), ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}) },
        select: { compradas: true, cerradas: true, estado: true, snapshotCostoUnitario: true, snapshotModelo: true, snapshotAporteMembego: true },
      }),
      tx.supplyRedencion.findMany({
        where: { reversadaAt: null, ...filtroProv, ...(periodo ? { createdAt: periodo } : {}), ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}), ...(f.asignacionId ? { asignacionId: f.asignacionId } : {}) },
        select: { costoUnitario: true, aporteClienteComercio: true, voucher: { select: { derecho: { select: { precioCliente: true, lote: { select: { snapshotPrecioReferencia: true, snapshotModelo: true, snapshotAporteMembego: true } } } } } } },
      }),
      tx.supplyVentaDirecta.findMany({
        where: { estado: 'ENTREGADA', ...filtroProv, ...(periodo ? { entregadaAt: periodo } : {}), ...(f.acuerdoId ? { acuerdoId: f.acuerdoId } : {}) },
        select: { montoBruto: true, comisionMonto: true, montoProveedor: true },
      }),
    ])
    let costoConsumido = 0, costoRegalado = 0, ingreso = 0, subsidio = 0, regaladas = 0, vendidas = 0, precioPublicoSuma = 0, conPrecio = 0
    for (const r of redenciones) {
      const costo = Number(r.costoUnitario)
      const d = r.voucher.derecho
      const precio = Number(d.precioCliente)
      costoConsumido += costo
      if (d.lote.snapshotModelo === 'SUBSIDIO') subsidio += Number(d.lote.snapshotAporteMembego ?? costo)
      if (precio > 0) { vendidas += 1; ingreso += precio } else { regaladas += 1; costoRegalado += costo }
      if (d.lote.snapshotPrecioReferencia) { precioPublicoSuma += Number(d.lote.snapshotPrecioReferencia); conPrecio += 1 }
    }
    const costoAdquirido = lotes.reduce((t, l) => t + l.compradas * Number(l.snapshotCostoUnitario), 0)
    const costoVencido = lotes.filter((l) => l.estado === 'VENCIDO' || l.estado === 'CERRADO').reduce((t, l) => t + l.cerradas * Number(l.snapshotCostoUnitario), 0)
    const n = redenciones.length
    const unidad = n === 0 ? null : (() => {
      const costo = costoConsumido / n
      const precioCliente = ingreso / n
      const precioPublico = conPrecio ? precioPublicoSuma / conPrecio : null
      const eco = economiaUnidad(costo, precioCliente, precioPublico)
      return {
        costo: redondear2(costo),
        precioPublico: precioPublico != null ? redondear2(precioPublico) : null,
        precioCliente: redondear2(precioCliente),
        subsidio: precioPublico != null ? redondear2(Math.max(0, precioPublico - precioCliente)) : 0,
        margen: eco.margenBruto,
      }
    })()
    return {
      costoAdquirido: redondear2(costoAdquirido),
      costoConsumido: redondear2(costoConsumido),
      costoVencido: redondear2(costoVencido),
      costoRegalado: redondear2(costoRegalado),
      ingresoVentasPrecompra: redondear2(ingreso),
      unidadesRegaladas: regaladas,
      unidadesVendidas: vendidas,
      subsidio: redondear2(subsidio),
      margenPrecompra: redondear2(ingreso - costoConsumido),
      comision: economiaComision(ventas.map((v) => ({ montoBruto: Number(v.montoBruto), comisionMonto: Number(v.comisionMonto), montoProveedor: Number(v.montoProveedor) }))),
      unidadPromedio: unidad,
    }
  })
}

/** Redenciones recientes para el tablero. */
export async function redencionesRecientes(tx: Tx, limite = 8) {
  return tx.supplyRedencion.findMany({
    where: { reversadaAt: null },
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: {
      id: true, createdAt: true, costoUnitario: true,
      cliente: { select: { nombre: true } }, proveedor: { select: { name: true } }, sucursal: { select: { nombre: true } },
      voucher: { select: { derecho: { select: { lote: { select: { snapshotItemNombre: true } } } } } },
    },
  })
}

/** Cuentas que ya deberían estar saldadas: obligaciones vencidas del tablero, por pagar y por cobrar. */
export async function obligacionesVencidas(tx: Tx, ahora = new Date(), limite = 8) {
  const sel = { id: true, codigo: true, descripcion: true, montoNeto: true, montoSaldado: true, vencimientoAt: true, proveedor: { select: { name: true } } } as const
  const [cxp, cxc] = await Promise.all([
    tx.supplyCuentaPorPagar.findMany({ where: { estado: { in: [...CUENTA_VIVA] }, vencimientoAt: { lt: ahora } }, orderBy: { vencimientoAt: 'asc' }, take: limite, select: sel }),
    tx.supplyCuentaPorCobrar.findMany({ where: { estado: { in: [...CUENTA_VIVA] }, vencimientoAt: { lt: ahora } }, orderBy: { vencimientoAt: 'asc' }, take: limite, select: sel }),
  ])
  const fila = (lado: 'CXP' | 'CXC') => (c: (typeof cxp)[number]) => ({
    lado,
    id: c.id,
    codigo: c.codigo,
    descripcion: c.descripcion,
    proveedor: c.proveedor.name,
    pendiente: Number(c.montoNeto) - Number(c.montoSaldado),
    vencimientoAt: c.vencimientoAt as Date,
  })
  return [...cxp.map(fila('CXP')), ...cxc.map(fila('CXC'))]
    .sort((a, b) => a.vencimientoAt.getTime() - b.vencimientoAt.getTime())
    .slice(0, limite)
}


// ── Economía global (§35) y actividad reciente (§37) ────────────────────────

export interface EconomiaGlobal {
  capitalInvertido: number
  /** Valor total transaccionado: unidades vendidas a clientes + ventas a comisión (bruto). */
  gmv: number
  /** Lo que entra a Membego: cobros de unidades precompradas + comisiones. */
  ingresos: number
  costoSupplyConsumido: number
  margenBruto: number
  /** Margen bruto menos el costo del supply regalado (CAC) y vencido. */
  margenNetoEstimado: number
  subsidios: number
  regalado: { unidades: number; valor: number }
  vendido: { unidades: number; valor: number; ingresos: number }
  vencido: { unidades: number; valor: number }
  cacReal: number
  clientesAdquiridos: number
  ltvObservado: number
  ventasComision: { ventas: number; bruto: number; comision: number }
}

export async function economiaGlobal(ahora: Date = new Date()): Promise<EconomiaGlobal> {
  return sinEmpresa('Membego Supply: economía global con datos reales', async (tx) => {
    const [lotes, redimidos, depositos, ventas] = await Promise.all([
      tx.supplyLote.findMany({
        where: { estado: { notIn: ['CANCELADO'] } },
        select: { compradas: true, cerradas: true, snapshotCostoUnitario: true, snapshotModelo: true, snapshotAporteMembego: true },
      }),
      tx.supplyDerecho.findMany({
        where: { estado: 'REDIMIDO' },
        select: { clienteId: true, precioCliente: true, costoUnitario: true, lote: { select: { snapshotModelo: true, snapshotAporteMembego: true } } },
        take: 20_000,
      }),
      saldoDepositos(tx),
      tx.supplyVentaDirecta.findMany({ where: { estado: 'ENTREGADA' }, select: { montoBruto: true, comisionMonto: true } }),
    ])
    let capital = 0, vencidoU = 0, vencidoV = 0
    for (const l of lotes) {
      const c = Number(l.snapshotCostoUnitario)
      capital += l.compradas * c
      vencidoU += l.cerradas
      vencidoV += l.cerradas * c
    }
    let regaladoU = 0, regaladoV = 0, vendidoU = 0, vendidoV = 0, ingresosVenta = 0, subsidios = 0, costoConsumido = 0
    const clientes = new Set<string>()
    for (const d of redimidos) {
      const costo = Number(d.costoUnitario)
      const precio = Number(d.precioCliente)
      costoConsumido += costo
      clientes.add(d.clienteId)
      if (d.lote.snapshotModelo === 'SUBSIDIO') subsidios += Number(d.lote.snapshotAporteMembego ?? costo)
      if (precio > 0) {
        vendidoU += 1
        vendidoV += costo
        ingresosVenta += precio
      } else {
        regaladoU += 1
        regaladoV += costo
      }
    }
    const comision = ventas.reduce((t, v) => t + Number(v.comisionMonto), 0)
    const brutoVentas = ventas.reduce((t, v) => t + Number(v.montoBruto), 0)
    const ingresos = ingresosVenta + comision
    const margenBruto = ingresos - vendidoV
    const cacReal = clientes.size > 0 ? regaladoV / clientes.size : 0
    // LTV observado: lo que esos clientes gastaron después en toda la red.
    let ltv = 0
    if (clientes.size > 0) {
      const gasto = await tx.transaction.aggregate({ where: { clienteId: { in: [...clientes] }, estado: 'APPLIED', createdAt: { lte: ahora } }, _sum: { monto: true } }).catch(() => ({ _sum: { monto: null } }))
      ltv = Number(gasto._sum.monto ?? 0) / clientes.size
    }
    return {
      capitalInvertido: redondear2(capital + depositos.disponible),
      gmv: redondear2(ingresosVenta + brutoVentas),
      ingresos: redondear2(ingresos),
      costoSupplyConsumido: redondear2(costoConsumido),
      margenBruto: redondear2(margenBruto),
      margenNetoEstimado: redondear2(margenBruto - regaladoV - vencidoV),
      subsidios: redondear2(subsidios),
      regalado: { unidades: regaladoU, valor: redondear2(regaladoV) },
      vendido: { unidades: vendidoU, valor: redondear2(vendidoV), ingresos: redondear2(ingresosVenta) },
      vencido: { unidades: vencidoU, valor: redondear2(vencidoV) },
      cacReal: redondear2(cacReal),
      clientesAdquiridos: clientes.size,
      ltvObservado: redondear2(ltv),
      ventasComision: { ventas: ventas.length, bruto: redondear2(brutoVentas), comision: redondear2(comision) },
    }
  })
}

export interface ActividadReciente {
  id: string
  fecha: Date
  quien: string
  accion: string
  entidadTipo: string
  entidadId: string
  detalle: string | null
}

/** «Starlin creó PO #123»: las últimas acciones SUPPLY_* de la bitácora (§37). */
export async function actividadReciente(limite = 15): Promise<ActividadReciente[]> {
  const acciones = Object.values($Enums.AuditAccion).filter((a) => a.startsWith('SUPPLY_'))
  const filas = await sinEmpresa('Membego Supply: actividad reciente del tablero', (tx) =>
    tx.auditLog.findMany({
      where: { accion: { in: acciones } },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: { id: true, createdAt: true, accion: true, entidadTipo: true, entidadId: true, payload: true, user: { select: { name: true } } },
    })
  )
  return filas.map((f) => {
    const p = (f.payload ?? {}) as Record<string, unknown>
    const ref = [p.numero, p.codigo].find((v) => typeof v === 'string') as string | undefined
    const monto = [p.monto, p.netoLiquidar, p.montoBruto].find((v) => typeof v === 'number') as number | undefined
    const detalle = [ref, monto != null ? `RD$${monto.toLocaleString('es-DO')}` : null].filter(Boolean).join(' · ') || null
    return {
      id: f.id,
      fecha: f.createdAt,
      quien: f.user?.name ?? 'Sistema',
      accion: ACCION_LABEL[f.accion] ?? f.accion,
      entidadTipo: f.entidadTipo,
      entidadId: f.entidadId,
      detalle,
    }
  })
}
