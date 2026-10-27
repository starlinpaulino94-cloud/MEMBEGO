import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip } from '@/components/ui/estado-chip'
import { ESTADO_LIQUIDACION_LABEL, type EstadoLiquidacion } from '@/modules/excursiones/liquidaciones/nucleo'
import { tonoDeLiquidacion } from '@/modules/excursiones/liquidaciones/lista'
import { formatDate, formatMoney } from '@/lib/format'

export interface LiquidacionFila {
  id: string
  numero: string
  vendedorId: string
  vendedor: string
  vendedorCodigo: string | null
  periodoDesde: Date | string
  periodoHasta: Date | string
  total: number
  moneda: string
  estado: string
  pagadaAt: Date | string | null
  comisiones: number
}

/**
 * LAS LIQUIDACIONES, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-10, T-15).
 *
 * El número es el identificador de la fila (y su enlace al recibo), con el vendedor al lado; el total va a la derecha en la moneda
 * de la empresa —el encabezado la dice, cada fila ya viene convertida— y el estado se dice con texto. Cuántas comisiones trae es
 * de menos prioridad y se oculta en pantallas estrechas.
 */
export function LiquidacionesTabla({
  filas,
  monedaDefecto,
  vacio,
  sinResultados,
  hayFiltros,
  pie,
}: {
  filas: LiquidacionFila[]
  monedaDefecto: string
  vacio: { titulo: string; descripcion?: string; accion?: ReactNode }
  sinResultados: { titulo: string; descripcion?: string; accion?: ReactNode }
  hayFiltros: boolean
  pie?: ReactNode
}) {
  const columnas: Columna<LiquidacionFila>[] = [
    {
      clave: 'numero',
      encabezado: 'Número',
      celda: (l) => (
        <Link href={`/admin/excursiones/liquidaciones/${l.id}`} className="font-mono font-semibold text-primary hover:underline">
          {l.numero}
        </Link>
      ),
    },
    {
      clave: 'vendedor',
      encabezado: 'Vendedor',
      celda: (l) => (
        <>
          <span className="font-medium text-foreground">{l.vendedor}</span>
          {l.vendedorCodigo ? <span className="block font-mono text-caption text-muted-foreground">{l.vendedorCodigo}</span> : null}
        </>
      ),
    },
    {
      clave: 'periodo',
      encabezado: 'Período',
      prioridad: 2,
      celda: (l) => (
        <span className="text-muted-foreground">
          {formatDate(l.periodoDesde)} → {formatDate(l.periodoHasta)}
        </span>
      ),
    },
    {
      clave: 'comisiones',
      encabezado: 'Comisiones',
      tipo: 'numero',
      prioridad: 3,
      valor: (l) => l.comisiones,
    },
    {
      clave: 'total',
      encabezado: `Total (${monedaDefecto})`,
      alineacion: 'derecha',
      celda: (l) => <span className="font-mono font-semibold text-foreground">{formatMoney(l.total, { moneda: monedaDefecto }, 2)}</span>,
    },
    {
      clave: 'estado',
      encabezado: 'Estado',
      celda: (l) => <EstadoChip tono={tonoDeLiquidacion(l.estado)}>{ESTADO_LIQUIDACION_LABEL[l.estado as EstadoLiquidacion] ?? l.estado}</EstadoChip>,
    },
  ]
  return (
    <Tabla
      caption={`Liquidaciones a vendedores, de la más reciente a la más antigua, con los totales en ${monedaDefecto}`}
      columnas={columnas}
      filas={filas}
      claveDe={(l) => l.id}
      columnaIdentificadora="numero"
      filaNavegable
      vacio={vacio}
      sinResultados={sinResultados}
      hayFiltros={hayFiltros}
      pie={pie}
    />
  )
}
