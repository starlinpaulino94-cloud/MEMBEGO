import { cn } from '@/lib/utils'
import { requireRole } from '@/lib/auth/guards'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { MONO, Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { FiltrosEconomia, SelectorVentana, VENTANAS } from '@/components/supply-v2/economia/filtros-economia'
import { IndicadoresEconomia } from '@/components/supply-v2/economia/indicadores-economia'
import { TarjetasModalidad } from '@/components/supply-v2/economia/tarjetas-modalidad'
import { TablaDesglose } from '@/components/supply-v2/economia/tabla-desglose'
import { Definiciones } from '@/components/supply-v2/economia/definiciones'
import { calcularEconomia, desglosePorProducto, opcionesDeFiltroEconomia } from '@/modules/supply-v2/economics/queries'
import type { VentanaEconomia } from '@/modules/supply-v2/economics/domain'
import { RUTA_ECONOMIA } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Economía · Supply' }

const FILAS = [10, 25, 50]

function fechaDe(v: string | undefined, finDeDia = false): Date | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  if (finDeDia) d.setUTCHours(23, 59, 59, 999)
  return d
}

/**
 * MEMBEGO SUPPLY · REPORTE ECONÓMICO (§31–§32, §68), rediseño Stitch
 * (propuesta A, dirección blanca). Una sola fuente (`calcularEconomia`), filtros
 * en el servidor y sin valores escritos a mano. El desglose por producto sale de
 * los MISMOS eventos y filtros, así que cuadra con los indicadores.
 *
 *   GMV = valor vendido al cliente · Revenue = ingreso reconocido por Membego
 *   Cost = costo real del supply vendido · Gross Margin = Revenue − Cost
 *   Breakage = derechos emitidos que vencieron sin redención
 *   Slice 6 (§28): el descuento del proveedor, el subsidio de Membego, lo
 *   cobrado al cliente y la contribución tras el subsidio son cifras APARTE.
 *   Nada se compensa en silencio: una promoción que quema margen se ve.
 */
export default async function EconomiaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const s = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '')
  const ventana = (VENTANAS.some((x) => x.v === s('ventana')) ? s('ventana') : '30D') as VentanaEconomia
  const filtro = { ventana, desde: fechaDe(s('desde')), hasta: fechaDe(s('hasta'), true), supplierId: s('proveedor') || null, catalogItemId: s('producto') || null }
  const [e, opciones, desglose] = await Promise.all([calcularEconomia(filtro), opcionesDeFiltroEconomia(), desglosePorProducto(filtro)])
  const filas = FILAS.includes(Number(s('filas'))) ? Number(s('filas')) : 10
  const pagina = Math.min(Math.max(1, Math.floor(Number(s('pagina'))) || 1), Math.max(1, Math.ceil(desglose.length / filas)))
  const visibles = desglose.slice((pagina - 1) * filas, pagina * filas)
  const hrefPagina = (p: number, n: number) => {
    const q = new URLSearchParams()
    for (const k of ['ventana', 'proveedor', 'producto', 'desde', 'hasta']) if (s(k)) q.set(k, s(k))
    if (n !== 10) q.set('filas', String(n))
    if (p > 1) q.set('pagina', String(p))
    const t = q.toString()
    return t ? `${RUTA_ECONOMIA}?${t}` : RUTA_ECONOMIA
  }
  const hrefVentana = (v: VentanaEconomia) => {
    const p = new URLSearchParams()
    p.set('ventana', v)
    if (s('proveedor')) p.set('proveedor', s('proveedor'))
    if (s('producto')) p.set('producto', s('producto'))
    return `${RUTA_ECONOMIA}?${p.toString()}`
  }

  return (
    <MarcoSupplyV2 activa="economia">
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col gap-4 p-5 @4xl:flex-row @4xl:items-center @4xl:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(MONO, 'font-bold uppercase tracking-wide text-sv2-primary')}>Supply</span>
              <span aria-hidden className="text-sv2-outline">•</span>
              <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">Reporte económico</span>
              <span className="flex items-center gap-1.5 rounded-full bg-sv2-secondary-container px-2 py-0.5 text-[12px] font-semibold leading-4 text-sv2-on-secondary-container">
                <span aria-hidden className="size-1.5 rounded-full bg-sv2-secondary" />
                Costo congelado al vender
              </span>
            </div>
            <h2 className="text-[28px] font-bold leading-9 tracking-[-0.02em]">Economía del supply</h2>
            <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
              Cuánto se vendió, cuánto ingresó Membego, cuánto costó cada unidad y cuál fue el margen real. Costo reconocido una sola vez, al vender; nunca desde precios actuales.
            </p>
          </div>
          <SelectorVentana ventana={ventana} href={hrefVentana} />
        </Tarjeta>

        <FiltrosEconomia ventana={ventana} proveedor={s('proveedor')} producto={s('producto')} desde={s('desde')} hasta={s('hasta')} opciones={opciones} periodo={{ desde: e.desde, hasta: e.hasta }} />

        {!e.hayDatos ? (
          <Tarjeta className="p-5">
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant" data-testid="economia-sin-datos">Sin datos todavía para este periodo y filtro.</p>
          </Tarjeta>
        ) : (
          <>
            <IndicadoresEconomia e={e} />
            <TarjetasModalidad e={e} />
            <TablaDesglose filas={visibles} pie={<PaginacionSupplyV2 pagina={pagina} filas={filas} total={desglose.length} sustantivo={desglose.length === 1 ? 'producto con ventas' : 'productos con ventas'} href={hrefPagina} />} />
          </>
        )}

        <Definiciones />
      </div>
    </MarcoSupplyV2>
  )
}
