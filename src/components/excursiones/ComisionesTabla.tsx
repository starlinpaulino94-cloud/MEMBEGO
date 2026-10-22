import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip } from '@/components/ui/estado-chip'
import { ESTADO_COMISION_LABEL, type EstadoComision } from '@/modules/excursiones/comisiones/nucleo'
import { tonoDeComision } from '@/modules/excursiones/comisiones/lista'
import type { ComisionDetalleItem } from '@/components/excursiones/ComisionDetalleSheet'
import { formatDate, formatMoney } from '@/lib/format'

export type ComisionFila = ComisionDetalleItem

/**
 * LAS COMISIONES, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-10, T-15).
 *
 * El vendedor es el identificador de la fila; la venta, su fecha y la liquidación van juntas porque es lo que se mira para
 * cuadrar un pago; el cálculo (con sus ajustes) es de menos prioridad y se oculta en pantallas estrechas, donde «Ver detalle» lo
 * muestra completo. El neto va a la derecha en la moneda de la empresa y el estado se dice con texto. La tabla es de servidor y no
 * sabe de botones: la celda de acciones se la pasa la página (`ComisionFilaAcciones`, de cliente).
 */
function columnasDeComisiones(acciones: (c: ComisionFila) => ReactNode): Columna<ComisionFila>[] {
  return [
  {
    clave: 'vendedor',
    encabezado: 'Vendedor',
    celda: (c) => (
      <>
        <Link href={`/admin/excursiones/vendedores/${c.vendedorId}`} className="font-semibold text-primary hover:underline">
          {c.vendedor}
        </Link>
        {c.vendedorCodigo ? <span className="block font-mono text-caption text-muted-foreground">{c.vendedorCodigo}</span> : null}
      </>
    ),
  },
  {
    clave: 'venta',
    encabezado: 'Venta y fecha',
    celda: (c) => (
      <>
        {c.venta ? (
          <Link href={`/admin/excursiones/ventas/${c.venta.id}`} className="font-mono font-semibold text-foreground hover:text-primary hover:underline">
            {c.venta.numero}
          </Link>
        ) : (
          <span className="font-mono text-muted-foreground">—</span>
        )}
        <span className="block text-caption text-muted-foreground">{formatDate(c.createdAt)}</span>
        {c.liquidacion ? (
          <Link href={`/admin/excursiones/liquidaciones/${c.liquidacion.id}`} className="block font-mono text-caption text-primary hover:underline">
            Liquidación {c.liquidacion.numero}
          </Link>
        ) : null}
      </>
    ),
  },
  {
    clave: 'calculo',
    encabezado: 'Cálculo y desglose',
    prioridad: 2,
    celda: (c) => (
      <div className="max-w-md">
        <p className="text-foreground">{c.desglose}</p>
        {c.esReglaPredeterminada ? <EstadoChip tono="neutro">Regla general predeterminada</EstadoChip> : null}
        {c.ajustes.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1">
            {c.ajustes.map((a, i) => (
              <li key={i} className="text-caption text-muted-foreground">
                Ajuste {a.monto > 0 ? '+' : ''}
                {formatMoney(a.monto, { moneda: c.moneda }, 2)} · {a.motivo}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ),
  },
  {
    clave: 'neto',
    encabezado: 'Neto',
    alineacion: 'derecha',
    celda: (c) => <span className="font-mono font-semibold text-foreground">{formatMoney(c.neto, { moneda: c.moneda }, 2)}</span>,
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (c) => <EstadoChip tono={tonoDeComision(c.estado)}>{ESTADO_COMISION_LABEL[c.estado as EstadoComision] ?? c.estado}</EstadoChip>,
  },
  {
    clave: 'acciones',
    encabezado: 'Acciones',
    soloLector: true,
    alineacion: 'derecha',
    celda: acciones,
  },
  ]
}

export function ComisionesTabla({
  filas,
  acciones,
  vacio,
  sinResultados,
  hayFiltros,
  pie,
}: {
  filas: ComisionFila[]
  /** La celda de acciones de cada fila: es lo único interactivo (abrir el detalle, aprobar, anular), así que la pone la página. */
  acciones: (c: ComisionFila) => ReactNode
  vacio: { titulo: string; descripcion?: string; accion?: ReactNode }
  sinResultados: { titulo: string; descripcion?: string; accion?: ReactNode }
  hayFiltros: boolean
  pie?: ReactNode
}) {
  return (
    <Tabla
      caption="Comisiones de los vendedores, de la más reciente a la más antigua"
      columnas={columnasDeComisiones(acciones)}
      filas={filas}
      claveDe={(c) => c.id}
      columnaIdentificadora="vendedor"
      vacio={vacio}
      sinResultados={sinResultados}
      hayFiltros={hayFiltros}
      pie={pie}
    />
  )
}
