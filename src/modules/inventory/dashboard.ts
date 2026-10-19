import { conEmpresa } from '@/lib/tenant'
import type { Costo } from './costos'
import type { TotalMargen } from './margen'
import { totalesDeMargenEnTx } from './margen-queries'
import type { TotalGrupo } from './mermas'
import { perdidoEnRangoEnTx } from './mermas-queries'
import { resumenVencimientosEnTx, type ResumenVencimientos } from './vencimientos-queries'
import { mesActual, rangoDeMes, valorTotalEnTx } from './valor'

/**
 * COMMERCE CORE · inventario — INV-4c: lo que el DASHBOARD de la empresa enseña de su inventario. Una sola lectura, barata
 * (agregados, nunca filas), con lo que mueve a actuar: cuánto hay, cuánto vale, cuánto se ganó y cuánto se perdió este mes.
 *
 * EL DINERO SOLO CON LA FUNCIÓN `costos`. Con `conCostos` en falso no se lee ni un costo: ni el valor del inventario, ni el margen
 * (que es costo contra precio), ni lo que valió lo perdido; quien no la tiene ve unidades. La tarjeta es la misma cuenta de los
 * informes (valor, margen real y mermas), no una estimación aparte.
 */
export interface ResumenInventario {
  /** El mes `YYYY-MM` (calendario de la empresa) al que se refieren el margen y lo perdido. */
  mes: string
  conCostos: boolean
  /** Lo que hay físicamente: vendible + apartado + dañado, en todas las sucursales. */
  unidadesEnExistencia: number
  /** Lo que vale todo el inventario; null si no se pueden ver costos. */
  valor: Costo | null
  /** Unidades que existen pero no tienen costo (no suman al valor); null si no se pueden ver costos. */
  unidadesSinCosto: number | null
  /** El margen real de las ventas del mes; null si no se pueden ver costos. */
  margen: TotalMargen | null
  /** Lo perdido este mes (faltantes y bajas de lo dañado). Sin costos, solo unidades y movimientos. */
  perdido: TotalGrupo
  /** INV-5b1: lo que vence pronto (lotes). Son conteos y unidades: no lee costos, así que lo ve quien ve la tarjeta. */
  vencimientos: ResumenVencimientos
}

export async function resumenInventarioEmpresa(companyId: string, zonaHoraria: string, opciones: { conCostos: boolean; ahora?: Date }): Promise<ResumenInventario> {
  const mes = mesActual(zonaHoraria, opciones.ahora)
  const rango = rangoDeMes(mes, zonaHoraria)
  return conEmpresa(companyId, async (tx) => {
    let unidadesEnExistencia: number
    let valor: Costo | null = null
    let unidadesSinCosto: number | null = null
    let margen: TotalMargen | null = null
    if (opciones.conCostos) {
      const v = await valorTotalEnTx(tx, companyId)
      unidadesEnExistencia = v.unidades
      valor = v.valor
      unidadesSinCosto = v.unidadesSinCosto
      margen = (await totalesDeMargenEnTx(tx, companyId, rango)).totales
    } else {
      // Sin la función `costos` ni se toca la tabla de costos: solo cuántas unidades hay.
      const u = await tx.inventoryLevel.aggregate({ where: { companyId }, _sum: { onHand: true, damaged: true } })
      unidadesEnExistencia = (u._sum.onHand ?? 0) + (u._sum.damaged ?? 0)
    }
    const perdido = await perdidoEnRangoEnTx(tx, companyId, rango, opciones.conCostos)
    const vencimientos = await resumenVencimientosEnTx(tx, companyId, { zonaHoraria, ahora: opciones.ahora })
    return { mes, conCostos: opciones.conCostos, unidadesEnExistencia, valor, unidadesSinCosto, margen, perdido, vencimientos }
  })
}
