import Link from 'next/link'
import { ArrowRight, Landmark } from 'lucide-react'
import type { SupplyV2ObligationStatus } from '@prisma/client'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { dineroSupplyV2, OBLIGATION_STATUS_LABELS, OBLIGATION_STATUS_TONE, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'
import type { ObligacionFila } from '@/modules/supply-v2/finance/queries'
import { MONO, TarjetaSeccion } from '../resumen/superficie'

const CHIP = 'inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]'
const TONO = {
  success: ['bg-sv2-secondary-container text-sv2-on-secondary-container', 'bg-sv2-secondary'],
  danger: ['bg-sv2-error-container text-sv2-on-error-container', 'bg-sv2-error'],
  warning: ['bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed', 'bg-sv2-tertiary'],
  info: ['bg-sv2-primary-fixed text-sv2-on-primary-fixed', 'bg-sv2-primary'],
  neutral: ['bg-sv2-soft-hover text-sv2-ink-variant', 'bg-sv2-outline'],
} as const

function ChipEstado({ estado }: { estado: SupplyV2ObligationStatus }) {
  const [fondo, punto] = TONO[OBLIGATION_STATUS_TONE[estado]]
  return (
    <span className={cn(CHIP, fondo)} data-testid="estado-obligacion">
      <span aria-hidden className={cn('size-1.5 rounded-full', punto)} />
      {OBLIGATION_STATUS_LABELS[estado]}
    </span>
  )
}

/** Las deudas vivas más recientes (una página de `listarObligaciones`), con el detalle completo en Obligaciones. */
export function TablaObligaciones({ filas, total, ahora }: { filas: ObligacionFila[]; total: number; ahora: Date }) {
  return (
    <TarjetaSeccion
      icono={Landmark}
      titulo="Deudas vivas con proveedores"
      data-testid="obligaciones-recientes"
      extra={
        <Link href={`${RUTA_FINANZAS}/obligaciones`} className="inline-flex items-center gap-1 text-[13px] font-semibold leading-4 text-sv2-primary hover:underline">
          Ver las {total.toLocaleString('es-DO')}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      }
    >
      {filas.length === 0 ? (
        <p className="p-4 text-[13px] leading-[18px] text-sv2-ink-variant" data-testid="obligaciones-vacio">No hay deudas vivas con proveedores.</p>
      ) : (
        <table className="block w-full text-left @4xl:table">
          <thead className="hidden bg-sv2-well @4xl:table-header-group">
            <tr className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">
              <th className="px-4 py-2 font-semibold">Obligación</th>
              <th className="px-4 py-2 font-semibold">Proveedor</th>
              <th className="px-4 py-2 font-semibold">Origen</th>
              <th className="px-4 py-2 font-semibold">Vence</th>
              <th className="px-4 py-2 text-right font-semibold">Saldo</th>
              <th className="px-4 py-2 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-sv2-divider @4xl:table-row-group">
            {filas.map((o) => {
              const vencida = o.dueAt != null && o.dueAt < ahora
              return (
                <tr key={o.id} className="grid grid-cols-2 gap-x-3 gap-y-1 p-4 @4xl:table-row" data-testid="obligacion-reciente">
                  <td className="@4xl:px-4 @4xl:py-3"><span className={cn(MONO, 'font-semibold')}>{o.number}</span></td>
                  <td className="text-right @4xl:px-4 @4xl:py-3 @4xl:text-left"><Link href={`${RUTA_FINANZAS}/obligaciones?proveedor=${o.proveedorId}`} className="text-[13px] font-medium leading-[18px] hover:text-sv2-primary hover:underline">{o.proveedor}</Link></td>
                  <td className="text-[13px] leading-[18px] text-sv2-ink-variant @4xl:px-4 @4xl:py-3">{o.origen}</td>
                  <td className={cn('text-right text-[13px] leading-[18px] @4xl:px-4 @4xl:py-3 @4xl:text-left', vencida ? 'font-semibold text-sv2-error' : 'text-sv2-ink-variant')}>{o.dueAt ? formatDate(o.dueAt) : 'Sin fecha'}{vencida ? ' · vencida' : ''}</td>
                  <td className={cn(MONO, 'text-[13px] font-bold tabular-nums @4xl:px-4 @4xl:py-3 @4xl:text-right')}>{dineroSupplyV2(o.outstandingAmount, o.currency)}</td>
                  <td className="text-right @4xl:px-4 @4xl:py-3 @4xl:text-left"><ChipEstado estado={o.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </TarjetaSeccion>
  )
}
