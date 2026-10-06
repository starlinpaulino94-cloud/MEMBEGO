import Link from 'next/link'
import { ArrowLeftRight, ChartNoAxesCombined, CircleCheck, Clock, ReceiptText, ShieldCheck } from 'lucide-react'
import { formatMoneyRD } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SupplyPorProducto, VerificacionesLotes } from '@/modules/supply-v2/pool/queries'
import { claseBotonSuave, MONO, Tarjeta } from '../resumen/superficie'

const COLORES = ['bg-sv2-primary', 'bg-sv2-secondary', 'bg-sv2-tertiary', 'bg-sv2-outline', 'bg-sv2-error']
const PUNTOS = ['bg-sv2-primary', 'bg-sv2-secondary', 'bg-sv2-tertiary', 'bg-sv2-outline', 'bg-sv2-error']

/**
 * Proyección de rentabilidad (Stitch): costo de lo que queda en el pool frente
 * a lo que valdría al precio público del catálogo. Solo cuenta productos con
 * precio público; los que no lo tienen se dicen aparte.
 */
export function PanelRentabilidad({ productos }: { productos: SupplyPorProducto[] }) {
  // Lo que queda en el pool: disponibles + asignadas (lo reservado o emitido ya está vendido o en camino).
  const enPool = (p: SupplyPorProducto) => p.disponibles + p.asignadas
  const conPrecio = productos.filter((p) => p.precioPublico !== null && enPool(p) > 0)
  const sinPrecio = productos.filter((p) => p.precioPublico === null && enPool(p) > 0).length
  const unidades = productos.reduce((t, p) => t + enPool(p), 0)
  const costo = conPrecio.reduce((t, p) => t + enPool(p) * p.costoUnitario, 0)
  const gmv = conPrecio.reduce((t, p) => t + enPool(p) * (p.precioPublico ?? 0), 0)
  const margen = gmv - costo
  const markup = costo > 0 ? ((gmv - costo) / costo) * 100 : null
  const rentabilidad = gmv > 0 ? (margen / gmv) * 100 : null
  const distribucion = productos.filter((p) => enPool(p) > 0).slice(0, 5)
  return (
    <Tarjeta className="flex flex-col justify-between gap-3 p-4 @5xl:col-span-2" data-testid="panel-rentabilidad">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-[15px] font-bold leading-5 tracking-[-0.005em]">Proyección de Rentabilidad &amp; Margen de Supply</h3>
          <span className="text-[13px] leading-[18px] text-sv2-ink-variant">Valor en costo adquirido frente a GMV proyectado al precio público del catálogo</span>
        </div>
        <ChartNoAxesCombined aria-hidden className="size-5 shrink-0 text-sv2-ink-variant" />
      </div>
      <div className="grid grid-cols-1 gap-3 rounded-[8px] bg-sv2-well p-3 @xl:grid-cols-3">
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-ink-variant">Costo total inventario</span>
          <span className="text-[28px] font-bold leading-8 tracking-[-0.025em] tabular-nums">{formatMoneyRD(Math.round(costo))}</span>
          <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">{unidades.toLocaleString('es-DO')} unidades en el pool</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-ink-variant">GMV bruto proyectado</span>
          <span className="text-[28px] font-bold leading-8 tracking-[-0.025em] text-sv2-secondary tabular-nums">{formatMoneyRD(Math.round(gmv))}</span>
          <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-secondary">{markup === null ? 'Sin precio público' : `+${markup.toFixed(1)}% mark-up potencial`}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-ink-variant">Margen bruto estimado</span>
          <span className="text-[28px] font-bold leading-8 tracking-[-0.025em] text-sv2-primary tabular-nums">{formatMoneyRD(Math.round(margen))}</span>
          <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-primary">{rentabilidad === null ? '—' : `${rentabilidad.toFixed(1)}% rentabilidad`}</span>
        </div>
      </div>
      {sinPrecio > 0 && (
        <p className="text-[12px] leading-4 text-sv2-tertiary">{sinPrecio} {sinPrecio === 1 ? 'producto no tiene' : 'productos no tienen'} precio público y no {sinPrecio === 1 ? 'entra' : 'entran'} en la proyección.</p>
      )}
      {unidades > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">Distribución del stock en el pool ({unidades.toLocaleString('es-DO')} unidades)</span>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-sv2-track" role="img" aria-label="Distribución del stock por producto">
            {distribucion.map((p, i) => (
              <span key={p.catalogItemId} className={cn('h-full', COLORES[i % COLORES.length])} style={{ width: `${(enPool(p) / unidades) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {distribucion.map((p, i) => (
              <span key={p.catalogItemId} className="flex items-center gap-1 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">
                <span aria-hidden className={cn('size-2 rounded-full', PUNTOS[i % PUNTOS.length])} />
                {p.producto}{p.sku ? ` (${p.sku})` : ''} · {Math.round((enPool(p) / unidades) * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </Tarjeta>
  )
}

function Fila({ icono: Icono, texto, valor, ok }: { icono: typeof CircleCheck; texto: string; valor: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-[8px] bg-sv2-well px-3 py-2">
      <span className="flex items-center gap-2 text-[13px] leading-[18px]">
        <Icono aria-hidden className={cn('size-[18px] shrink-0', ok ? 'text-sv2-secondary' : 'text-sv2-error')} />
        {texto}
      </span>
      <span className={cn(MONO, 'whitespace-nowrap font-bold', ok ? 'text-foreground' : 'text-sv2-error')}>{valor}</span>
    </li>
  )
}

/** Estado de lotes (Stitch) con tres verificaciones reales sobre la base. */
export function PanelEstadoLotes({ v }: { v: VerificacionesLotes }) {
  return (
    <Tarjeta className="flex flex-col gap-3 p-4" data-testid="panel-estado-lotes">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-[15px] font-bold leading-5 tracking-[-0.005em]">Estado de Lotes &amp; Emisión</h3>
          <span className="text-[13px] leading-[18px] text-sv2-ink-variant">Verificaciones sobre los lotes y lo recibido en las compras.</span>
        </div>
        <ShieldCheck aria-hidden className="size-5 shrink-0 text-sv2-ink-variant" />
      </div>
      <ul className="flex flex-col gap-2">
        <Fila icono={CircleCheck} texto="Cuadre de unidades por lote" valor={`${v.lotesCuadrados}/${v.lotesTotal} OK`} ok={v.lotesCuadrados === v.lotesTotal} />
        <Fila icono={Clock} texto="Lotes que vencen en ≤ 7 días" valor={String(v.vencenPronto)} ok={v.vencenPronto === 0} />
        <Fila icono={ArrowLeftRight} texto="Recibido en compras = lotes" valor={`${v.lineasConciliadas}/${v.lineasConRecepcion} líneas`} ok={v.lineasConciliadas === v.lineasConRecepcion} />
      </ul>
      <Link href="/superadmin/supply/finanzas/conciliaciones" className={cn(claseBotonSuave, 'mt-auto h-9 w-full text-[13px] leading-4')}>
        <ReceiptText aria-hidden className="size-4" />
        Ver conciliación contable
      </Link>
    </Tarjeta>
  )
}
