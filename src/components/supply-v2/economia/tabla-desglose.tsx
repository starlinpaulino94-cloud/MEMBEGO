import { Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'
import type { FilaDesglose } from '@/modules/supply-v2/economics/queries'
import { MONO, TarjetaSeccion } from '../resumen/superficie'

const CHIP = 'inline-flex w-fit items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]'
const MODALIDAD = {
  PREPAGO: { texto: 'Supply adquirido', clase: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed' },
  COMISION: { texto: 'A comisión', clase: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed' },
} as const

function Margen({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-sv2-outline">—</span>
  const tono = pct < 0 ? 'text-sv2-error' : 'text-sv2-secondary'
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px] font-semibold leading-4', tono)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', pct < 0 ? 'bg-sv2-error' : 'bg-sv2-secondary')} />
      {pct.toLocaleString('es-DO', { maximumFractionDigits: 1 })} %
    </span>
  )
}

/** Desglose por producto del mismo periodo y filtro de los indicadores; en pantallas angostas cada fila es una tarjeta. */
export function TablaDesglose({ filas, pie }: { filas: FilaDesglose[]; pie?: React.ReactNode }) {
  return (
    <TarjetaSeccion
      icono={Table2}
      titulo="Desglose por producto y servicio"
      data-testid="desglose-economia"
      extra={<span className="hidden text-[12px] leading-4 text-sv2-ink-variant @xl:inline">Eventos económicos del periodo, agrupados por producto</span>}
    >
      {filas.length === 0 ? (
        <p className="p-4 text-[13px] leading-[18px] text-sv2-ink-variant" data-testid="desglose-vacio">Sin ventas por producto en este periodo y filtro.</p>
      ) : (
        <table className="block w-full text-left @4xl:table">
          <thead className="hidden bg-sv2-well @4xl:table-header-group">
            <tr className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">
              <th className="px-4 py-2 font-semibold">Producto / SKU</th>
              <th className="px-4 py-2 font-semibold">Modalidad</th>
              <th className="px-4 py-2 text-right font-semibold">Unidades</th>
              <th className="px-4 py-2 text-right font-semibold">GMV</th>
              <th className="px-4 py-2 text-right font-semibold">Costo unit.</th>
              <th className="px-4 py-2 text-right font-semibold">Subsidio</th>
              <th className="px-4 py-2 text-right font-semibold">Ingreso</th>
              <th className="px-4 py-2 text-right font-semibold">Margen</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-sv2-divider @4xl:table-row-group">
            {filas.map((f) => (
              <tr key={f.catalogItemId ?? 'sin-producto'} className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-4 @4xl:table-row" data-testid="fila-desglose">
                <td className="col-span-2 @4xl:table-cell @4xl:px-4 @4xl:py-3">
                  <div className="text-[14px] font-medium leading-5">{f.producto}</div>
                  <div className={cn(MONO, 'text-sv2-outline')}>{[f.sku, f.proveedor].filter(Boolean).join(' · ') || '—'}</div>
                </td>
                <td className="col-span-2 @4xl:table-cell @4xl:px-4 @4xl:py-3">
                  <div className="flex flex-wrap gap-1">
                    {f.modalidades.map((m) => <span key={m} className={cn(CHIP, MODALIDAD[m].clase)}>{MODALIDAD[m].texto}</span>)}
                    {f.modalidades.length === 0 && <span className={cn(CHIP, 'bg-sv2-soft text-sv2-ink-variant')}>Solo subsidio</span>}
                  </div>
                </td>
                <Celda etiqueta="Unidades" valor={`${f.unidades.toLocaleString('es-DO')} u.`} />
                <Celda etiqueta="GMV" valor={dineroSupplyV2(f.gmv)} />
                <Celda etiqueta="Costo unit." valor={f.costoUnitario != null ? `${dineroSupplyV2(f.costoUnitario)} / u.` : 'N/A'} apagado={f.costoUnitario == null} />
                <Celda etiqueta="Subsidio" valor={dineroSupplyV2(f.subsidio)} apagado={Number(f.subsidio) === 0} aviso={Number(f.subsidio) > 0} />
                <Celda etiqueta="Ingreso" valor={dineroSupplyV2(f.ingreso)} fuerte />
                <td className="flex items-center justify-between @4xl:table-cell @4xl:px-4 @4xl:py-3 @4xl:text-right">
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-sv2-outline @4xl:hidden">Margen</span>
                  <Margen pct={f.margenPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pie}
    </TarjetaSeccion>
  )
}

function Celda({ etiqueta, valor, fuerte, apagado, aviso }: { etiqueta: string; valor: string; fuerte?: boolean; apagado?: boolean; aviso?: boolean }) {
  return (
    <td className="flex items-center justify-between gap-2 @4xl:table-cell @4xl:px-4 @4xl:py-3 @4xl:text-right">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-sv2-outline @4xl:hidden">{etiqueta}</span>
      <span className={cn(MONO, 'whitespace-nowrap text-[13px] tabular-nums', fuerte && 'font-bold', apagado && 'text-sv2-outline', aviso && 'text-sv2-tertiary')}>{valor}</span>
    </td>
  )
}
