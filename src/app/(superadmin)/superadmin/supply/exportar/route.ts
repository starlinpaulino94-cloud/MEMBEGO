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

  return respuestaCsv(armarCsvBloques(bloques), 'membego-supply')
}
