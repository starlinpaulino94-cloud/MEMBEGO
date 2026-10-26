import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip } from '@/components/ui/estado-chip'
import type { DetalleConversionMoneda } from '@/modules/excursiones/config'
import { tonoDeChip } from '@/modules/excursiones/lista-comun'
import { formatDate, formatMoney } from '@/lib/format'

/** Cómo se llama cada forma de calcular una comisión, y de qué tono es su chip. */
const TIPO_REMUNERACION_INFO: Record<string, { etiqueta: string; tono: Parameters<typeof tonoDeChip>[0] }> = {
  PORCENTAJE: { etiqueta: '% Porcentaje', tono: 'info' },
  FIJO_ADULTO: { etiqueta: 'Fijo adulto', tono: 'success' },
  FIJO_NINO: { etiqueta: 'Fijo niño', tono: 'success' },
  FIJO_VENTA: { etiqueta: 'Fijo venta', tono: 'neutral' },
  FIJO_PASAJERO: { etiqueta: 'Fijo pasajero', tono: 'neutral' },
  ESCALON: { etiqueta: 'Escalón por volumen', tono: 'info' },
  PAQUETE_REGALO: { etiqueta: 'Paquete de regalo', tono: 'warning' },
}

export interface LineaLiquidacion {
  id: string
  venta: string
  tipoCalculo: string
  desglose: string
  createdAt: Date | string
  ajustes: { monto: number; motivo: string }[]
  neto: number
  monedaOriginal: string
  netoOriginal: number
  conversion: DetalleConversionMoneda
}

export interface BonoLiquidacion {
  id: string
  descripcion: string
  createdAt: Date | string
  monto: number | string
  estado: string
}

/**
 * LO QUE LLEVA UNA LIQUIDACIÓN, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-15).
 *
 * El recibo muestra TODAS las líneas del lote pagado —no se pagina un comprobante—, ahora con título para el lector de pantalla,
 * `scope` en los encabezados y el neto a la derecha. El total que antes iba en un `<tfoot>` va en el pie de la tabla.
 */
export function ComisionesLiquidacionTabla({
  lineas,
  moneda,
  total,
}: {
  lineas: LineaLiquidacion[]
  moneda: string
  total: number | string
}) {
  const dinero = (n: number | string) => formatMoney(n, { moneda }, 2)
  const columnas: Columna<LineaLiquidacion>[] = [
    { clave: 'venta', encabezado: 'Venta', celda: (l) => <span className="font-mono font-semibold text-foreground">{l.venta}</span> },
    {
      clave: 'tipo',
      encabezado: 'Tipo',
      prioridad: 2,
      celda: (l) => {
        const info = TIPO_REMUNERACION_INFO[l.tipoCalculo] ?? { etiqueta: l.tipoCalculo, tono: 'neutral' as const }
        return <EstadoChip tono={tonoDeChip(info.tono)}>{info.etiqueta}</EstadoChip>
      },
    },
    {
      clave: 'calculo',
      encabezado: 'Cálculo y desglose',
      celda: (l) => (
        <div className="max-w-sm">
          <p className="text-foreground">{l.desglose}</p>
          {l.ajustes.length > 0 ? (
            <ul className="mt-1 space-y-0.5 border-t border-border/50 pt-1">
              {l.ajustes.map((a, i) => (
                <li key={i} className="text-caption text-muted-foreground">
                  Ajuste {a.monto > 0 ? '+' : ''}
                  {dinero(a.monto)} · {a.motivo}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ),
    },
    { clave: 'fecha', encabezado: 'Fecha', prioridad: 3, celda: (l) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(l.createdAt)}</span> },
    {
      clave: 'neto',
      encabezado: 'Neto a liquidar',
      alineacion: 'derecha',
      celda: (l) => {
        const esEspecie = l.tipoCalculo === 'PAQUETE_REGALO'
        if (esEspecie) return <span className="font-mono text-small font-semibold text-muted-foreground">Premio en voucher</span>
        return (
          <>
            <span className="font-mono font-bold text-foreground">{dinero(l.neto)}</span>
            {l.conversion.esConversion ? (
              <span className="mt-1 block space-y-0.5 text-right">
                <span className="block font-mono text-caption font-medium text-primary" title={`Tasa predeterminada aplicada: ${l.conversion.tasaLabel}`}>
                  Convertida a {moneda}: {l.conversion.tasaLabel}
                </span>
                <span className="block font-mono text-caption text-muted-foreground">
                  Original: {formatMoney(l.netoOriginal, { moneda: l.monedaOriginal }, 2)}
                </span>
                {!l.conversion.tasaConfigurada ? <span className="block text-caption font-semibold text-muted-foreground">Tasa 1:1 no configurada</span> : null}
              </span>
            ) : null}
          </>
        )
      },
    },
  ]
  const pie: ReactNode = (
    <div className="flex flex-wrap items-baseline justify-end gap-3">
      <span className="font-semibold text-foreground">Total en efectivo o transferencia</span>
      <span className="font-mono text-h3 font-bold text-foreground">{dinero(total)}</span>
    </div>
  )
  return (
    <Tabla
      caption="Comisiones de ventas incluidas en esta liquidación, con su neto a liquidar"
      columnas={columnas}
      filas={lineas}
      claveDe={(l) => l.id}
      columnaIdentificadora="venta"
      pie={pie}
    />
  )
}

export function BonosLiquidacionTabla({ bonos, moneda }: { bonos: BonoLiquidacion[]; moneda: string }) {
  const columnas: Columna<BonoLiquidacion>[] = [
    { clave: 'descripcion', encabezado: 'Descripción o meta' },
    { clave: 'fecha', encabezado: 'Fecha otorgado', prioridad: 2, celda: (b) => <span className="text-muted-foreground">{formatDate(b.createdAt)}</span> },
    {
      clave: 'monto',
      encabezado: 'Monto',
      alineacion: 'derecha',
      celda: (b) => <span className="font-mono font-bold text-foreground">{formatMoney(b.monto, { moneda }, 2)}</span>,
    },
    {
      clave: 'estado',
      encabezado: 'Estado',
      celda: (b) => <EstadoChip tono={b.estado === 'PAGADO' ? 'exito' : 'aviso'}>{b.estado === 'PAGADO' ? 'Pagado' : 'Por liquidar'}</EstadoChip>,
    },
  ]
  return (
    <Tabla
      caption="Bonos por metas cumplidas incluidos en esta liquidación"
      columnas={columnas}
      filas={bonos}
      claveDe={(b) => b.id}
      columnaIdentificadora="descripcion"
    />
  )
}
