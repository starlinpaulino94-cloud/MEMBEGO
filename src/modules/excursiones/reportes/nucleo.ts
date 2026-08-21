/**
 * EXCURSIONES · Reportes — NÚCLEO PURO.
 *
 * Lo que se exporta no es «lo que se ve en pantalla»: es el período completo,
 * calculado en el servidor. La exportación desde el navegador volcaba solo las
 * filas cargadas y se descargaba sin avisar de lo que faltaba — la forma más
 * silenciosa de perder datos, y la razón de que el CSV se arme aquí.
 *
 * Las funciones de este archivo convierten filas ya leídas en filas de CSV. No
 * tocan la base, así que se puede probar exactamente lo que va a llegarle al
 * contador.
 */

import { OFFSET_PLATAFORMA_MIN, type Rango } from '@/modules/excursiones/metricas/nucleo'

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * El rango que pide la URL. Sin parámetros —o con basura— cae al MES en curso,
 * que es el reporte que se pide nueve de cada diez veces. Las fechas se
 * interpretan en hora local: «hasta el 31» incluye la noche del 31.
 */
export function rangoDeParametros(
  desde: string | null | undefined,
  hasta: string | null | undefined,
  ahora: Date
): Rango {
  const local = new Date(ahora.getTime() + OFFSET_PLATAFORMA_MIN * 60_000)
  const inicioMes = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET_PLATAFORMA_MIN * 60_000
  )
  const finMes = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0, 23, 59, 59, 999) -
      OFFSET_PLATAFORMA_MIN * 60_000
  )

  const d = typeof desde === 'string' && FECHA_RE.test(desde) ? desde : null
  const h = typeof hasta === 'string' && FECHA_RE.test(hasta) ? hasta : null
  if (!d || !h) return { desde: inicioMes, hasta: finMes }

  // Fechas al revés: se enderezan ANTES de convertirlas, porque cada extremo
  // lleva su propia hora (una empieza el día y la otra lo termina). Intercambiar
  // los instantes ya calculados daría un rango de un segundo. Se enderezan en
  // vez de devolver un archivo vacío que el usuario leería como «no hubo ventas».
  const [inicio, fin] = d <= h ? [d, h] : [h, d]
  const desdeUtc = new Date(`${inicio}T00:00:00.000Z`).getTime() - OFFSET_PLATAFORMA_MIN * 60_000
  const hastaUtc = new Date(`${fin}T23:59:59.999Z`).getTime() - OFFSET_PLATAFORMA_MIN * 60_000
  if (Number.isNaN(desdeUtc) || Number.isNaN(hastaUtc)) return { desde: inicioMes, hasta: finMes }
  return { desde: new Date(desdeUtc), hasta: new Date(hastaUtc) }
}

/** Nombre del archivo: lleva su período dentro, no la fecha de descarga. */
export function nombreReporte(rango: Rango): string {
  const dia = (f: Date) =>
    new Date(f.getTime() + OFFSET_PLATAFORMA_MIN * 60_000).toISOString().slice(0, 10)
  return `excursiones-${dia(rango.desde)}_${dia(rango.hasta)}`
}

// ── Filas ────────────────────────────────────────────────────────────────────

export const ENCABEZADOS_VENTAS = [
  'Número', 'Fecha', 'Cliente', 'Excursión', 'Vendedor', 'Código vendedor',
  'Pasajeros', 'Total', 'Moneda', 'Estado',
]

export interface FilaVenta {
  numero: string
  fecha: string
  cliente: string
  excursion: string
  vendedor: string | null
  vendedorCodigo: string | null
  pasajeros: number
  total: number
  moneda: string
  estado: string
}

/**
 * Una venta sin vendedor es una VENTA DIRECTA, no un dato que falta: se escribe
 * así en el archivo para que nadie lo lea como un error de la exportación.
 */
export function filasDeVentas(ventas: FilaVenta[]): unknown[][] {
  return ventas.map((v) => [
    v.numero,
    v.fecha,
    v.cliente,
    v.excursion,
    v.vendedor ?? 'Venta directa',
    v.vendedorCodigo ?? '',
    v.pasajeros,
    v.total.toFixed(2),
    v.moneda,
    v.estado,
  ])
}

export const ENCABEZADOS_COMISIONES = [
  'Fecha', 'Vendedor', 'Código', 'Venta', 'Cálculo', 'Base', 'Generada',
  'Ajustes', 'Neto', 'Moneda', 'Estado', 'Liquidación',
]

export interface FilaComision {
  fecha: string
  vendedor: string
  vendedorCodigo: string | null
  venta: string | null
  desglose: string
  base: number
  monto: number
  ajustes: number
  neto: number
  moneda: string
  estado: string
  liquidacion: string | null
}

/**
 * La columna de ajustes es la diferencia entre lo generado y lo que se paga.
 * Sin ella, dos cifras distintas en la misma fila parecen un error; con ella,
 * el contador ve de un vistazo que hubo una corrección y de cuánto.
 */
export function filasDeComisiones(comisiones: FilaComision[]): unknown[][] {
  return comisiones.map((c) => [
    c.fecha,
    c.vendedor,
    c.vendedorCodigo ?? '',
    c.venta ?? '',
    c.desglose,
    c.base.toFixed(2),
    c.monto.toFixed(2),
    c.ajustes.toFixed(2),
    c.neto.toFixed(2),
    c.moneda,
    c.estado,
    c.liquidacion ?? '',
  ])
}

export const ENCABEZADOS_LIQUIDACIONES = [
  'Número', 'Vendedor', 'Código', 'Desde', 'Hasta', 'Comisiones',
  'Total', 'Moneda', 'Estado', 'Método', 'Referencia', 'Pagada',
]

export interface FilaLiquidacion {
  numero: string
  vendedor: string
  vendedorCodigo: string | null
  desde: string
  hasta: string
  comisiones: number
  total: number
  moneda: string
  estado: string
  metodo: string | null
  referencia: string | null
  pagada: string
}

export function filasDeLiquidaciones(liquidaciones: FilaLiquidacion[]): unknown[][] {
  return liquidaciones.map((l) => [
    l.numero,
    l.vendedor,
    l.vendedorCodigo ?? '',
    l.desde,
    l.hasta,
    l.comisiones,
    l.total.toFixed(2),
    l.moneda,
    l.estado,
    l.metodo ?? '',
    l.referencia ?? '',
    l.pagada,
  ])
}

/**
 * El aviso de recorte va DENTRO del archivo. Un CSV que se corta en silencio
 * es peor que uno que no se descarga: el que lo recibe cuadra su contabilidad
 * con datos incompletos sin saberlo.
 */
export function avisoDeTope(total: number, tope: number): unknown[][] {
  if (total <= tope) return []
  return [[`AVISO: hay ${total} filas y este archivo trae solo las primeras ${tope}. Acota el período para exportarlas todas.`]]
}
