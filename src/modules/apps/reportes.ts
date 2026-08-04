import { conEmpresa } from '@/lib/tenant'
import { utcDesdeLocal, ymdEnTz, sumarDias } from '@/modules/citas/disponibilidad'

/**
 * REPORTES OPERATIVOS de una app de negocio (F3 del plan del equipo).
 *
 * Responde "¿cómo nos fue?" — a diferencia del tablero del día
 * (`dashboard.ts`), que responde "¿qué está pasando ahora?". Y a diferencia de
 * /admin/reportes, que es de NEGOCIO (ingresos, clientes): esto es de
 * OPERACIÓN (cuántos carros, cuánto tardamos, qué se consumió).
 *
 * Todo se arma con datos que ya existen. Las métricas que dependen de módulos
 * opcionales (cola, inventario) son DEFENSIVAS: si la capacidad está apagada o
 * la migración no corrió, devuelven vacío en vez de romper el reporte.
 */

export interface RangoReporte {
  /** 'YYYY-MM-DD' en la zona horaria del negocio. */
  desde: string
  hasta: string
}

export interface DiaOperativo {
  fecha: string
  vehiculos: number
  canjes: number
  ventas: number
  montoVentas: number
}

export interface ServicioMasPedido {
  servicio: string
  veces: number
}

export interface ConsumoInsumo {
  producto: string
  unidad: string
  cantidad: number
}

export interface ReporteOperativo {
  rango: RangoReporte
  /** Serie por día para la tabla principal. */
  dias: DiaOperativo[]
  totalVehiculos: number
  totalCanjes: number
  totalVentas: number
  montoTotal: number
  /** Minutos promedio entre que entra el vehículo y se entrega. null = sin datos. */
  minutosPromedio: number | null
  /** Cuántas entregas tuvieron tiempo medible (base del promedio). */
  entregasMedidas: number
  serviciosTop: ServicioMasPedido[]
  consumo: ConsumoInsumo[]
  /** true si el rango pedido excedía el máximo y se recortó. */
  recortado: boolean
}

/** Tope de días por consulta: protege la base de datos de un rango absurdo. */
const MAX_DIAS = 92

/** Lista de fechas 'YYYY-MM-DD' entre dos extremos, inclusive. */
function diasDelRango(desde: string, hasta: string): string[] {
  const out: string[] = []
  let cursor = desde
  while (cursor <= hasta && out.length < MAX_DIAS) {
    out.push(cursor)
    cursor = sumarDias(cursor, 1)
  }
  return out
}

/** Normaliza el rango pedido: valida formato, ordena y recorta al máximo. */
export function normalizarRango(
  desde: string | undefined,
  hasta: string | undefined,
  timeZone: string
): { rango: RangoReporte; recortado: boolean } {
  const hoy = ymdEnTz(new Date(), timeZone)
  const valido = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)

  let fin = valido(hasta) ?? hoy
  let ini = valido(desde) ?? sumarDias(fin, -29) // por defecto: últimos 30 días
  if (ini > fin) [ini, fin] = [fin, ini]

  const dias = diasDelRango(ini, fin)
  const recortado = dias.length >= MAX_DIAS && sumarDias(fin, 1) > sumarDias(ini, MAX_DIAS)
  return {
    rango: { desde: dias[0] ?? ini, hasta: dias[dias.length - 1] ?? fin },
    recortado,
  }
}

export async function getReporteOperativo(
  companyId: string,
  rangoPedido: { desde?: string; hasta?: string },
  timeZone: string
): Promise<ReporteOperativo> {
  const { rango, recortado } = normalizarRango(rangoPedido.desde, rangoPedido.hasta, timeZone)
  const inicio = utcDesdeLocal(rango.desde, '00:00', timeZone)
  const fin = utcDesdeLocal(sumarDias(rango.hasta, 1), '00:00', timeZone)
  const ventana = { gte: inicio, lt: fin }

  const [entradasCola, transacciones, movimientos] = await Promise.all([
    // Cola: puede no existir (capacidad apagada o migración pendiente).
    conEmpresa(companyId, (tx) =>
      tx.colaVehiculo.findMany({
        where: { companyId, createdAt: ventana },
        select: {
          createdAt: true,
          entregadoAt: true,
          estado: true,
          servicio: true,
        },
      })
    ).catch(() => []),
    conEmpresa(companyId, (tx) =>
      tx.transaction.findMany({
        where: { companyId, estado: 'APPLIED', createdAt: ventana },
        select: { tipo: true, monto: true, createdAt: true },
      })
    ).catch(() => []),
    conEmpresa(companyId, (tx) =>
      tx.movimientoInventario.findMany({
        where: { companyId, tipo: 'SALIDA', createdAt: ventana },
        select: { cantidad: true, producto: { select: { nombre: true, unidad: true } } },
      })
    ).catch(() => []),
  ])

  // ── Serie por día ──────────────────────────────────────────────────────────
  const porDia = new Map<string, DiaOperativo>()
  for (const fecha of diasDelRango(rango.desde, rango.hasta)) {
    porDia.set(fecha, { fecha, vehiculos: 0, canjes: 0, ventas: 0, montoVentas: 0 })
  }
  const sumar = (fecha: string, fn: (d: DiaOperativo) => void) => {
    const d = porDia.get(fecha)
    if (d) fn(d)
  }

  for (const e of entradasCola) {
    sumar(ymdEnTz(e.createdAt, timeZone), (d) => {
      d.vehiculos += 1
    })
  }
  for (const t of transacciones) {
    const fecha = ymdEnTz(t.createdAt, timeZone)
    if (t.tipo === 'PROMOTION_USE') sumar(fecha, (d) => { d.canjes += 1 })
    if (t.tipo === 'SALE') {
      sumar(fecha, (d) => {
        d.ventas += 1
        d.montoVentas += t.monto != null ? Number(t.monto) : 0
      })
    }
  }

  const dias = [...porDia.values()]

  // ── Tiempo de servicio (entrada → entrega) ────────────────────────────────
  const duraciones = entradasCola
    .filter((e) => e.estado === 'ENTREGADO' && e.entregadoAt)
    .map((e) => (e.entregadoAt!.getTime() - e.createdAt.getTime()) / 60000)
    .filter((m) => m >= 0 && m < 60 * 24) // descarta olvidos de un día para otro
  const minutosPromedio =
    duraciones.length > 0
      ? Math.round(duraciones.reduce((a, b) => a + b, 0) / duraciones.length)
      : null

  // ── Servicios más pedidos ─────────────────────────────────────────────────
  const conteoServicios = new Map<string, number>()
  for (const e of entradasCola) {
    const s = e.servicio?.trim()
    if (!s) continue
    conteoServicios.set(s, (conteoServicios.get(s) ?? 0) + 1)
  }
  const serviciosTop = [...conteoServicios.entries()]
    .map(([servicio, veces]) => ({ servicio, veces }))
    .sort((a, b) => b.veces - a.veces)
    .slice(0, 10)

  // ── Consumo de insumos ────────────────────────────────────────────────────
  const conteoConsumo = new Map<string, ConsumoInsumo>()
  for (const m of movimientos) {
    const clave = m.producto.nombre
    const actual = conteoConsumo.get(clave) ?? {
      producto: clave,
      unidad: m.producto.unidad,
      cantidad: 0,
    }
    actual.cantidad = Math.round((actual.cantidad + Number(m.cantidad)) * 100) / 100
    conteoConsumo.set(clave, actual)
  }
  const consumo = [...conteoConsumo.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 15)

  return {
    rango,
    dias,
    totalVehiculos: dias.reduce((a, d) => a + d.vehiculos, 0),
    totalCanjes: dias.reduce((a, d) => a + d.canjes, 0),
    totalVentas: dias.reduce((a, d) => a + d.ventas, 0),
    montoTotal: Math.round(dias.reduce((a, d) => a + d.montoVentas, 0) * 100) / 100,
    minutosPromedio,
    entregasMedidas: duraciones.length,
    serviciosTop,
    consumo,
    recortado,
  }
}

/** CSV del detalle por día (con BOM para que Excel respete los acentos). */
export function reporteToCsv(reporte: ReporteOperativo): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const encabezados = ['Fecha', 'Vehiculos', 'Canjes', 'Ventas', 'Monto vendido']
  const filas = reporte.dias.map((d) =>
    [d.fecha, d.vehiculos, d.canjes, d.ventas, d.montoVentas.toFixed(2)].map(esc).join(';')
  )
  const totales = [
    'TOTAL',
    reporte.totalVehiculos,
    reporte.totalCanjes,
    reporte.totalVentas,
    reporte.montoTotal.toFixed(2),
  ]
    .map(esc)
    .join(';')
  return `﻿${[encabezados.join(';'), ...filas, totales].join('\n')}`
}
