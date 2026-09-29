import type { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth/guards'
import { armarCsvBloques, fechaCsv, respuestaCsv } from '@/lib/csv'
import { TZ_PLATAFORMA } from '@/lib/format'
import {
  reporteCampanas,
  reporteLotes,
  reporteProveedores,
  reporteRedenciones,
  resumenPool,
} from '@/modules/supply/pool'
import { alertasDeVencimiento } from '@/modules/supply/vencimientos'
import { conciliar } from '@/modules/supply/conciliacion'
import {
  rentabilidad,
  reporteDerechos,
  reporteIncidencias,
  reporteUtilizacion,
  reporteVencidos,
} from '@/modules/supply/tablero'
import { listarCuentasPorCobrar, listarCuentasPorPagar } from '@/modules/supply/cuentas'
import { listarLiquidaciones } from '@/modules/supply/liquidaciones'
import { listarConciliaciones } from '@/modules/supply/conciliacion-proveedor'
import { listarDepositos } from '@/modules/supply/depositos'
import { listarVentas } from '@/modules/supply/ventas'
import { pendienteDeCuenta } from '@/modules/supply/dinero'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY · exportación de los reportes obligatorios (Fase 48).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REUTILIZA LA INFRAESTRUCTURA QUE YA EXISTE
 *
 * `armarCsvBloques`, `fechaCsv` y `respuestaCsv` son las mismas funciones con
 * las que exportan Auditoría, Reportes y Clientes: mismo separador (punto y
 * coma, que es lo que Excel en español espera), mismo BOM y mismo nombre de
 * archivo fechado. La Fase 48 lo pide explícitamente —«no crear cinco sistemas
 * de exportación»— y aquí eso significa CERO líneas nuevas de serialización.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN ARCHIVO, VARIOS BLOQUES
 *
 * `?reporte=` elige uno; sin parámetro salen todos en bloques separados, que es
 * lo que hace falta para archivar el cierre de un mes o mandárselo a alguien
 * que no tiene acceso al panel.
 */
const REPORTES = [
  'overview',
  'proveedores',
  'lotes',
  'campanas',
  'redenciones',
  'vencimientos',
  'conciliacion',
  // Capa financiera (29-09-2026): los nueve que faltaban del §24.
  'utilizacion',
  'vencidos',
  'derechos',
  'cuentas-por-pagar',
  'cuentas-por-cobrar',
  'liquidaciones',
  'conciliaciones',
  'incidencias',
  'depositos',
  'ventas',
  'rentabilidad',
] as const
type Reporte = (typeof REPORTES)[number]

export async function GET(request: NextRequest) {
  await requireRole('SUPERADMIN')

  const sp = request.nextUrl.searchParams
  const pedido = sp.get('reporte') ?? ''
  const cuales: Reporte[] = (REPORTES as readonly string[]).includes(pedido)
    ? [pedido as Reporte]
    : [...REPORTES]

  const filtro = {
    proveedorId: sp.get('proveedor') ?? undefined,
    loteId: sp.get('lote') ?? undefined,
    acuerdoId: sp.get('acuerdo') ?? undefined,
    asignacionId: sp.get('campana') ?? undefined,
    clienteId: sp.get('cliente') ?? undefined,
    sucursalId: sp.get('sucursal') ?? undefined,
    estado: sp.get('estado') ?? undefined,
    desde: sp.get('desde') ? new Date(sp.get('desde') as string) : undefined,
    hasta: sp.get('hasta') ? new Date(sp.get('hasta') as string) : undefined,
  }

  const bloques: { titulo: string; encabezados: string[]; filas: unknown[][] }[] = []

  if (cuales.includes('overview')) {
    const p = await resumenPool()
    bloques.push({
      titulo: 'Supply Overview',
      encabezados: ['Concepto', 'Unidades', 'Valor'],
      filas: [
        ['Compradas', p.unidadesCompradas, p.valorAdquirido],
        ['Disponibles', p.disponibles, p.valorDisponible],
        ['Asignadas', p.asignadas, ''],
        ['Retenidas', p.retenidas, ''],
        ['Emitidas sin canjear', p.emitidas, ''],
        ['Redimidas', p.redimidas, p.valorConsumido],
        ['Vencidas o canceladas', p.cerradas, ''],
        ['Próximas a vencer (30 días)', p.proximasAVencer, p.valorEnRiesgo],
        ['Lotes activos', p.lotesActivos, ''],
        ['Proveedores', p.proveedores, ''],
      ],
    })
  }

  if (cuales.includes('proveedores')) {
    const filas = await reporteProveedores(filtro)
    bloques.push({
      titulo: 'Supplier Report',
      encabezados: [
        'Proveedor', 'Acuerdos', 'Compradas', 'Sin asignar', 'Emitidas', 'Redimidas',
        'En manos de clientes', 'Costo total', 'Costo consumido', 'Costo disponible',
        'Cumplimiento %', 'Reversas %', 'Incidencias', 'Puntaje',
      ],
      filas: filas.map((p) => [
        p.proveedor, p.acuerdos, p.compradas, p.sinAsignar, p.emitidas, p.redimidas,
        p.pendientesCliente, p.costoTotal, p.costoConsumido, p.costoDisponible,
        p.scorecard.tasaCumplimiento, p.scorecard.tasaReversa, p.scorecard.incidencias,
        p.scorecard.puntaje,
      ]),
    })
  }

  if (cuales.includes('lotes')) {
    const filas = await reporteLotes(filtro)
    bloques.push({
      titulo: 'Lot Report',
      encabezados: [
        'Lote', 'Proveedor', 'Producto', 'Variante', 'Estado', 'Inicio', 'Vence',
        'Compradas', 'Disponibles', 'Asignadas', 'Retenidas', 'Emitidas', 'Redimidas',
        'Cerradas', 'Suma', 'Cuadra', 'Costo unitario', 'Costo total', 'Costo consumido',
      ],
      filas: filas.map((l) => [
        l.codigo, l.proveedor, l.item, l.variante ?? '', l.estado,
        fechaCsv(l.inicioAt, TZ_PLATAFORMA), fechaCsv(l.venceAt, TZ_PLATAFORMA),
        l.compradas, l.disponibles, l.asignadas, l.retenidas, l.emitidas, l.redimidas,
        l.cerradas, l.suma, l.cuadra ? 'Sí' : 'NO', l.costoUnitario, l.costoTotal,
        l.costoConsumido,
      ]),
    })
  }

  if (cuales.includes('campanas')) {
    const filas = await reporteCampanas(filtro)
    bloques.push({
      titulo: 'Campaign Supply Report',
      encabezados: [
        'Campaña', 'Tipo', 'Lote', 'Proveedor', 'Asignadas', 'Emitidas', 'Liberadas',
        'Redimidas', 'Por emitir', 'Activas sin canjear', 'Tasa redención %',
        'Costo comprometido', 'Costo consumido', 'Costo expuesto', 'Ingresos',
      ],
      filas: filas.map((c) => [
        c.etiqueta, c.destinoTipo, c.loteCodigo, c.proveedor, c.asignadas, c.emitidas,
        c.liberadas, c.redimidas, c.porEmitir, c.activasSinCanjear, c.tasaRedencion,
        c.costoComprometido, c.costoConsumido, c.costoExpuesto, c.ingresos,
      ]),
    })
  }

  if (cuales.includes('redenciones')) {
    const filas = await reporteRedenciones(filtro, 5000)
    bloques.push({
      titulo: 'Redemption Report',
      encabezados: [
        'Fecha', 'Cliente', 'Producto', 'Proveedor', 'Sucursal', 'Empleado', 'Lote',
        'Campaña', 'Costo', 'Extras cobrados', 'Aporte del cliente', 'Reversada',
      ],
      filas: filas.map((r) => [
        fechaCsv(r.fecha, TZ_PLATAFORMA, true), r.cliente, r.item, r.proveedor,
        r.sucursal ?? '', r.empleado ?? '', r.loteCodigo, r.campana ?? '',
        r.costoUnitario, r.extras, r.aporteCliente, r.reversada ? 'Sí' : '',
      ]),
    })
  }

  if (cuales.includes('vencimientos')) {
    const filas = await alertasDeVencimiento(90)
    bloques.push({
      titulo: 'Expiration Report',
      encabezados: [
        'Lote', 'Proveedor', 'Producto', 'Sin repartir', 'En clientes', 'Costo unitario',
        'Exposición financiera', 'Vence', 'Días restantes', 'Nivel', 'Política',
      ],
      filas: filas.map((a) => [
        a.codigo, a.proveedorNombre, a.item, a.enRiesgo, a.expuestas, a.costoUnitario,
        a.exposicionFinanciera, fechaCsv(a.venceAt, TZ_PLATAFORMA), a.diasRestantes,
        a.nivel, a.politicaSobrante,
      ]),
    })
  }

  if (cuales.includes('conciliacion')) {
    const r = await conciliar(filtro.proveedorId)
    bloques.push({
      titulo: 'Reconciliation Report',
      encabezados: ['Gravedad', 'Tipo', 'Dónde', 'Detalle', 'Entidad', 'Id'],
      filas: r.hallazgos.map((h) => [
        h.gravedad, h.tipo, h.titulo, h.detalle, h.entidad, h.entidadId,
      ]),
    })
  }

  if (cuales.includes('utilizacion')) {
    const filas = await reporteUtilizacion(filtro)
    bloques.push({
      titulo: 'Utilization Report',
      encabezados: ['Lote', 'Proveedor', 'Producto', 'Estado', 'Vence', 'Compradas', 'Repartidas', 'Redimidas', 'Disponibles', 'Asignadas', 'Vencidas', '% repartido', '% redimido', '% vencido', 'Valor consumido', 'Valor vencido'],
      filas: filas.map((l) => [l.codigo, l.proveedor, l.item, l.estado, fechaCsv(l.venceAt, TZ_PLATAFORMA), l.compradas, l.repartidas, l.redimidas, l.disponibles, l.asignadas, l.vencidas, l.pctRepartido, l.pctRedimido, l.pctVencido, l.valorConsumido, l.valorVencido]),
    })
  }

  if (cuales.includes('vencidos')) {
    const filas = await reporteVencidos(filtro)
    bloques.push({
      titulo: 'Expired Supply Report',
      encabezados: ['Lote', 'Proveedor', 'Producto', 'Venció', 'Compradas', 'Redimidas', 'Vencidas', 'Política', 'Valor perdido'],
      filas: filas.map((l) => [l.codigo, l.proveedor, l.item, fechaCsv(l.venceAt, TZ_PLATAFORMA), l.compradas, l.redimidas, l.vencidas, l.politica, l.valorVencido]),
    })
  }

  if (cuales.includes('derechos')) {
    const filas = await reporteDerechos(filtro)
    bloques.push({
      titulo: 'Customer Entitlements Report',
      encabezados: ['Cliente', 'Producto', 'Proveedor', 'Lote', 'Campaña', 'Origen', 'Estado', 'Emitido', 'Vence', 'Redimido', 'Costo', 'Pagó'],
      filas: filas.map((d) => [d.cliente.nombre, d.lote.snapshotItemNombre, d.proveedor.name, d.lote.codigo, d.asignacion?.etiqueta ?? '', d.origen, d.estado, fechaCsv(d.emitidoAt, TZ_PLATAFORMA), fechaCsv(d.vencAt, TZ_PLATAFORMA), d.redimidoAt ? fechaCsv(d.redimidoAt, TZ_PLATAFORMA) : '', Number(d.costoUnitario), Number(d.precioCliente)]),
    })
  }

  if (cuales.includes('cuentas-por-pagar')) {
    const filas = await listarCuentasPorPagar({ proveedorId: filtro.proveedorId, acuerdoId: filtro.acuerdoId, estado: filtro.estado as never, desde: filtro.desde, hasta: filtro.hasta, limite: 5000 })
    bloques.push({
      titulo: 'Accounts Payable Report',
      encabezados: ['Código', 'Proveedor', 'Acuerdo', 'Origen', 'Descripción', 'Bruto', 'Comisión', 'Neto', 'Saldado', 'Pendiente', 'Vence', 'Estado', 'Liquidación'],
      filas: filas.map((c) => [c.codigo, c.proveedor.name, c.acuerdo?.codigo ?? '', c.origen, c.descripcion, Number(c.montoBruto), Number(c.comision), Number(c.montoNeto), Number(c.montoSaldado), pendienteDeCuenta({ montoNeto: Number(c.montoNeto), montoSaldado: Number(c.montoSaldado) }), c.vencimientoAt ? fechaCsv(c.vencimientoAt, TZ_PLATAFORMA) : '', c.estado, c.liquidacion?.codigo ?? '']),
    })
  }

  if (cuales.includes('cuentas-por-cobrar')) {
    const filas = await listarCuentasPorCobrar({ proveedorId: filtro.proveedorId, acuerdoId: filtro.acuerdoId, estado: filtro.estado as never, desde: filtro.desde, hasta: filtro.hasta, limite: 5000 })
    bloques.push({
      titulo: 'Accounts Receivable Report',
      encabezados: ['Código', 'Proveedor', 'Acuerdo', 'Origen', 'Descripción', 'Neto', 'Saldado', 'Pendiente', 'Vence', 'Estado', 'Liquidación'],
      filas: filas.map((c) => [c.codigo, c.proveedor.name, c.acuerdo?.codigo ?? '', c.origen, c.descripcion, Number(c.montoNeto), Number(c.montoSaldado), pendienteDeCuenta({ montoNeto: Number(c.montoNeto), montoSaldado: Number(c.montoSaldado) }), c.vencimientoAt ? fechaCsv(c.vencimientoAt, TZ_PLATAFORMA) : '', c.estado, c.liquidacion?.codigo ?? '']),
    })
  }

  if (cuales.includes('liquidaciones')) {
    const filas = await listarLiquidaciones({ proveedorId: filtro.proveedorId, estado: filtro.estado as never, limite: 2000 })
    bloques.push({
      titulo: 'Settlements Report',
      encabezados: ['Código', 'Proveedor', 'Acuerdo', 'Desde', 'Hasta', 'Estado', 'Ventas brutas', 'Comisión Membego', 'Monto proveedor', 'Redenciones', 'Reembolsos', 'Ajustes', 'Depósito aplicado', 'Neto', 'Calculó', 'Aprobó', 'Pagada'],
      filas: filas.map((l) => [l.codigo, l.proveedor.name, l.acuerdo?.codigo ?? '', fechaCsv(l.periodoDesde, TZ_PLATAFORMA), fechaCsv(l.periodoHasta, TZ_PLATAFORMA), l.estado, Number(l.ventasBrutas), Number(l.comisionMembego), Number(l.montoProveedor), Number(l.redencionesMonto), Number(l.reembolsos), Number(l.ajustes), Number(l.depositoAplicado), Number(l.netoLiquidar), l.calculadaPor?.name ?? '', l.aprobadaPor?.name ?? '', l.pagadaAt ? fechaCsv(l.pagadaAt, TZ_PLATAFORMA) : '']),
    })
  }

  if (cuales.includes('conciliaciones')) {
    const filas = await listarConciliaciones({ proveedorId: filtro.proveedorId, estado: filtro.estado as never, limite: 2000 })
    bloques.push({
      titulo: 'Supplier Reconciliation Report',
      encabezados: ['Código', 'Proveedor', 'Desde', 'Hasta', 'Estado', 'Redenciones Membego', 'Redenciones proveedor', 'Monto Membego', 'Monto proveedor', 'Ventas Membego', 'Ventas proveedor', 'Discrepancias', 'Vivas', 'Liquidación'],
      filas: filas.map((c) => [c.codigo, c.proveedor.name, fechaCsv(c.periodoDesde, TZ_PLATAFORMA), fechaCsv(c.periodoHasta, TZ_PLATAFORMA), c.estado, c.membegoRedenciones, c.proveedorRedenciones, Number(c.membegoMonto), Number(c.proveedorMonto), c.membegoVentas, c.proveedorVentas, c.discrepancias.length, c.discrepancias.filter((d) => d.estado !== 'APROBADA' && d.estado !== 'RECHAZADA').length, c.liquidacion?.codigo ?? '']),
    })
  }

  if (cuales.includes('incidencias')) {
    const filas = await reporteIncidencias(filtro)
    bloques.push({
      titulo: 'Incidents Report',
      encabezados: ['Fecha', 'Proveedor', 'Cliente', 'Tipo', 'Estado', 'Detalle', 'Resolución', 'Reportó', 'Resolvió', 'Resuelta'],
      filas: filas.map((i) => [fechaCsv(i.createdAt, TZ_PLATAFORMA, true), i.proveedor.name, i.cliente?.nombre ?? '', i.tipo, i.estado, i.detalle, i.resolucion ?? '', i.reportadoPor?.name ?? '', i.resueltoPor?.name ?? '', i.resueltoAt ? fechaCsv(i.resueltoAt, TZ_PLATAFORMA) : '']),
    })
  }

  if (cuales.includes('depositos')) {
    const filas = await listarDepositos({ proveedorId: filtro.proveedorId, estado: filtro.estado as never, limite: 2000 })
    bloques.push({
      titulo: 'Deposits Report',
      encabezados: ['Código', 'Proveedor', 'Acuerdo', 'Estado', 'Original', 'Aplicado', 'Devuelto', 'Disponible', 'Referencia', 'Abierto', 'Cierra', 'Cerrado', 'Registró'],
      filas: filas.map((d) => [d.codigo, d.proveedor, d.acuerdo ?? '', d.estado, d.montoOriginal, d.montoAplicado, d.montoDevuelto, d.disponible, d.referencia ?? '', d.abiertoAt ? fechaCsv(d.abiertoAt, TZ_PLATAFORMA) : '', d.cierraAt ? fechaCsv(d.cierraAt, TZ_PLATAFORMA) : '', d.cerradoAt ? fechaCsv(d.cerradoAt, TZ_PLATAFORMA) : '', d.registradoPor ?? '']),
    })
  }

  if (cuales.includes('ventas')) {
    const filas = await listarVentas({ proveedorId: filtro.proveedorId, estado: filtro.estado as never, desde: filtro.desde, hasta: filtro.hasta, limite: 5000 })
    bloques.push({
      titulo: 'Direct Sales Report',
      encabezados: ['Número', 'Fecha', 'Cliente', 'Proveedor', 'Acuerdo', 'Producto', 'Cantidad', 'Bruto', 'Comisión', 'Proveedor recibe', 'Estado', 'Pagada', 'Entregada', 'Entregó', 'CxP'],
      filas: filas.map((v) => [v.numero, fechaCsv(v.createdAt, TZ_PLATAFORMA, true), v.cliente.nombre, v.proveedor.name, v.acuerdo.codigo, v.itemNombre, v.cantidad, Number(v.montoBruto), Number(v.comisionMonto), Number(v.montoProveedor), v.estado, v.pagadaAt ? fechaCsv(v.pagadaAt, TZ_PLATAFORMA) : '', v.entregadaAt ? fechaCsv(v.entregadaAt, TZ_PLATAFORMA) : '', v.entregadaPor?.name ?? '', v.cuentaPorPagar?.codigo ?? '']),
    })
  }

  if (cuales.includes('rentabilidad')) {
    const r = await rentabilidad(filtro)
    bloques.push({
      titulo: 'Profitability & Unit Economics',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Costo adquirido (lotes)', r.costoAdquirido],
        ['Costo consumido (redimido)', r.costoConsumido],
        ['Costo regalado', r.costoRegalado],
        ['Costo vencido', r.costoVencido],
        ['Unidades regaladas', r.unidadesRegaladas],
        ['Unidades vendidas (precompra)', r.unidadesVendidas],
        ['Ingreso ventas precompra', r.ingresoVentasPrecompra],
        ['Subsidio Membego', r.subsidio],
        ['Margen precompra (ingreso − consumido)', r.margenPrecompra],
        ['Ventas sin precompra', r.comision.ventas],
        ['Ingreso bruto sin precompra', r.comision.ingresoBruto],
        ['Recibió el proveedor', r.comision.recibioProveedor],
        ['Retuvo Membego (comisión)', r.comision.retuvoMembego],
        ['Margen comisión %', r.comision.margenPorcentaje],
        ['Unidad promedio · costo', r.unidadPromedio?.costo ?? ''],
        ['Unidad promedio · precio público', r.unidadPromedio?.precioPublico ?? ''],
        ['Unidad promedio · precio cliente', r.unidadPromedio?.precioCliente ?? ''],
        ['Unidad promedio · subsidio', r.unidadPromedio?.subsidio ?? ''],
        ['Unidad promedio · margen', r.unidadPromedio?.margen ?? ''],
      ],
    })
  }

  return respuestaCsv(armarCsvBloques(bloques), 'membego-supply')
}
