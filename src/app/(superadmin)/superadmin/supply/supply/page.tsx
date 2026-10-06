import Link from 'next/link'
import { Banknote, CalendarCheck, CalendarDays, CircleCheck, CirclePlus, LayoutGrid, QrCode, Rows3, ShoppingBag, Tag } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { cn } from '@/lib/utils'
import { formatMoneyRD } from '@/lib/format'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { BarraFiltrosSupplyV2, type ChipFiltro } from '@/components/supply-v2/filtros'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { TablaSupply } from '@/components/supply-v2/supply/tabla-supply'
import { TarjetasSupply } from '@/components/supply-v2/supply/tarjetas-supply'
import { PanelEstadoLotes, PanelRentabilidad } from '@/components/supply-v2/supply/paneles-supply'
import { diasHasta, ESTADO_STOCK_LABELS, estadoStock, type EstadoStock } from '@/components/supply-v2/supply/estado-stock'
import { supplyPorProducto, verificacionesLotes } from '@/modules/supply-v2/pool/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Supply · Supply' }

const RUTA = '/superadmin/supply/supply'
const FILAS = [10, 25, 50]
const ASIGNACION = { libre: '100% disponible', parcial: 'En ofertas' } as const
type Asignacion = keyof typeof ASIGNACION

interface Filtros { q: string; proveedor: string; estado: EstadoStock | ''; asignacion: Asignacion | ''; vence: boolean; vista: 'tabla' | 'tarjetas' }

function href(f: Filtros & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.proveedor) p.set('proveedor', f.proveedor)
  if (f.estado) p.set('estado', f.estado)
  if (f.asignacion) p.set('asignacion', f.asignacion)
  if (f.vence) p.set('vence', '30')
  if (f.vista === 'tarjetas') p.set('vista', 'tarjetas')
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA}?${qs}` : RUTA
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * MEMBEGO SUPPLY · el pool agrupado por producto (§37), rediseño Stitch
 * (propuesta A): seis indicadores, filtros, tabla o tarjetas, la proyección de
 * rentabilidad al precio público y tres verificaciones de lotes. Los lotes
 * técnicos siguen un clic más adentro.
 */
export default async function SupplyPoolPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; proveedor?: string; estado?: string; asignacion?: string; vence?: string; vista?: string; pagina?: string; filas?: string }>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f: Filtros = {
    q: (sp.q ?? '').trim().slice(0, 80),
    proveedor: sp.proveedor ?? '',
    estado: sp.estado && sp.estado in ESTADO_STOCK_LABELS ? (sp.estado as EstadoStock) : '',
    asignacion: sp.asignacion && sp.asignacion in ASIGNACION ? (sp.asignacion as Asignacion) : '',
    vence: sp.vence === '30',
    vista: sp.vista === 'tarjetas' ? 'tarjetas' : 'tabla',
  }
  const filas = FILAS.includes(Number(sp.filas)) ? Number(sp.filas) : 10
  const ahora = new Date()
  const [todos, verificaciones] = await Promise.all([supplyPorProducto(), verificacionesLotes(ahora)])

  // Lo recibido más recientemente primero: es lo que se está operando. Por el momento
  // en que se registró el lote (`receivedAt` solo guarda el día y empataría).
  const productos = [...todos].sort((a, b) => (b.ultimoLote?.createdAt.getTime() ?? 0) - (a.ultimoLote?.createdAt.getTime() ?? 0) || a.producto.localeCompare(b.producto))
  const proveedores = [...new Map(productos.map((p) => [p.proveedorId, p.proveedor])).entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const q = normalizar(f.q)
  const filtrados = productos.filter(
    (p) =>
      (!q || [p.producto, p.sku, p.proveedor, p.ultimoLote?.code].some((c) => c && normalizar(c).includes(q))) &&
      (!f.proveedor || p.proveedorId === f.proveedor) &&
      (!f.estado || estadoStock(p) === f.estado) &&
      (!f.asignacion || (f.asignacion === 'libre' ? p.asignadas === 0 : p.asignadas > 0)) &&
      (!f.vence || (p.proximoVencimiento !== null && diasHasta(p.proximoVencimiento, ahora) <= 30))
  )
  const total = filtrados.length
  const pagina = Math.min(Math.max(1, Math.floor(Number(sp.pagina)) || 1), Math.max(1, Math.ceil(total / filas)))
  const visibles = filtrados.slice((pagina - 1) * filas, pagina * filas)

  // Indicadores sobre todo el pool (no sobre el filtro).
  const suma = (k: 'disponibles' | 'asignadas' | 'reservadas' | 'emitidas' | 'redimidas' | 'recibidas') => productos.reduce((t, p) => t + p[k], 0)
  const valor = productos.reduce((t, p) => t + p.valorDisponible, 0)
  const emitidas = suma('emitidas')
  const redimidas = suma('redimidas')
  const ofertaPrincipal = productos.find((p) => p.ofertaActiva)?.ofertaActiva ?? null
  const porVencer = productos.filter((p) => p.proximoVencimiento && diasHasta(p.proximoVencimiento, ahora) <= 7).length
  const activos = productos.filter((p) => p.disponibles > 0).length
  const unidadesFiltradas = filtrados.reduce((t, p) => t + p.recibidas, 0)

  const chips: ChipFiltro[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, quitar: href({ ...f, q: '' }) })
  if (f.proveedor) chips.push({ texto: `Proveedor: ${proveedores.find((p) => p.id === f.proveedor)?.nombre ?? '—'}`, quitar: href({ ...f, proveedor: '' }) })
  if (f.estado) chips.push({ texto: `Estado: ${ESTADO_STOCK_LABELS[f.estado]}`, quitar: href({ ...f, estado: '' }) })
  if (f.asignacion) chips.push({ texto: `Asignación: ${ASIGNACION[f.asignacion]}`, quitar: href({ ...f, asignacion: '' }) })
  if (f.vence) chips.push({ texto: 'Vencimientos: ≤ 30 días', quitar: href({ ...f, vence: false }) })

  const pie = (
    <PaginacionSupplyV2
      pagina={pagina}
      filas={filas}
      total={total}
      sustantivo={total === 1 ? 'producto' : 'productos'}
      href={(p, n) => href({ ...f, pagina: p, filas: n })}
      extra={<span>Total unidades acumuladas: <strong className="text-foreground">{unidadesFiltradas.toLocaleString('es-DO')} u.</strong></span>}
    />
  )
  const vista = (v: Filtros['vista'], etiqueta: string, Icono: typeof Rows3) => (
    <Link
      href={href({ ...f, vista: v })}
      aria-current={f.vista === v ? 'page' : undefined}
      className={cn('inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-[13px] leading-4 transition-all', f.vista === v ? 'bg-card font-semibold text-sv2-primary shadow-sm' : 'font-medium text-sv2-ink-variant hover:text-foreground')}
      data-testid={`vista-${v}`}
    >
      <Icono aria-hidden className="size-4" />
      {etiqueta}
    </Link>
  )

  return (
    <MarcoSupplyV2 activa="supply" acciones={<AccionesCabeceraSupplyV2 destino={RUTA} filtro={f.q} />}>
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col justify-between gap-3 p-4 @4xl:flex-row @4xl:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[24px] font-bold leading-8 tracking-[-0.015em]">Supply (Inventario adquirido)</h2>
              <span className="flex items-center gap-1.5 rounded-full bg-sv2-secondary-container px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-on-secondary-container">
                <span aria-hidden className="size-1.5 rounded-full bg-sv2-secondary" />
                {activos} {activos === 1 ? 'ítem activo' : 'ítems activos'}
              </span>
            </div>
            <p className="max-w-2xl text-[14px] leading-5 text-sv2-ink-variant">
              Productos y servicios adquiridos por Membego y disponibles para venta directa, asignación a ofertas activas o programas de fidelización.
            </p>
          </div>
          {productos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <nav aria-label="Vista" className="inline-flex items-center rounded-[8px] bg-sv2-well p-1">
                {vista('tabla', 'Tabla', Rows3)}
                {vista('tarjetas', 'Cards', LayoutGrid)}
              </nav>
              <Link
                href="/superadmin/supply/ofertas/nueva"
                data-testid="btn-crear-oferta"
                className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover"
              >
                <CirclePlus aria-hidden className="size-[18px]" />
                Crear oferta desde supply
              </Link>
            </div>
          )}
        </Tarjeta>

        {productos.length === 0 ? (
          <Tarjeta className="flex flex-col items-start gap-2 p-4">
            <p className="text-[15px] font-semibold leading-5">No hay Supply recibido todavía</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Crea una compra y registra una recepción: cada recepción confirmada se convierte en supply disponible.</p>
            <Link href="/superadmin/supply/compras/nueva" className="mt-1 inline-flex h-8 items-center rounded-[8px] bg-sv2-soft px-3 text-[13px] font-semibold leading-4 hover:bg-sv2-soft-hover">Nueva compra</Link>
          </Tarjeta>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-6" data-testid="indicadores-supply">
              <TarjetaIndicador etiqueta="Unidades disp." icono={CircleCheck} tonoIcono="exito" valor={suma('disponibles').toLocaleString('es-DO')} unidad="u." pie="Listas para emitir" tonoPie="exito" iconoPie={CircleCheck} testId="kpi-supply-disponibles" />
              <TarjetaIndicador etiqueta="Valor en stock" icono={Banknote} tonoIcono="primario" valor={formatMoneyRD(valor)} pie="Costo adquisición" testId="kpi-supply-valor" />
              <TarjetaIndicador etiqueta="En ofertas" icono={Tag} tonoIcono="primario" valor={suma('asignadas').toLocaleString('es-DO')} unidad="u." pie={ofertaPrincipal ? ofertaPrincipal.code : 'Sin ofertas activas'} tonoPie={ofertaPrincipal ? 'primario' : 'neutral'} testId="kpi-supply-ofertas" />
              <TarjetaIndicador etiqueta="Reservadas" icono={ShoppingBag} valor={suma('reservadas').toLocaleString('es-DO')} unidad="u." pie="En pedidos sin pagar" testId="kpi-supply-reservadas" />
              <TarjetaIndicador etiqueta="Emitidas / canje" icono={QrCode} valor={emitidas.toLocaleString('es-DO')} unidad="u." pie={`${redimidas.toLocaleString('es-DO')} canjeadas (${emitidas > 0 ? Math.round((redimidas / emitidas) * 100) : 0}%)`} testId="kpi-supply-emitidas" />
              <TarjetaIndicador etiqueta="Vencimiento" icono={CalendarCheck} tonoIcono={porVencer > 0 ? 'error' : 'neutral'} valor={porVencer > 0 ? String(porVencer) : 'Sin riesgo'} unidad={porVencer > 0 ? (porVencer === 1 ? 'por vencer' : 'por vencer') : undefined} pie={porVencer > 0 ? 'Vencen en ≤ 7 días' : 'Nada vence en ≤ 7 días'} tonoPie={porVencer > 0 ? 'error' : 'exito'} testId="kpi-supply-vencimiento" />
            </div>

            <BarraFiltrosSupplyV2
              ruta={RUTA}
              testId="filtros-supply"
              busqueda={{ valor: f.q, etiqueta: 'Buscar en el supply', placeholder: 'Filtrar por producto, SKU, lote o proveedor...', testId: 'buscar-supply' }}
              selectores={[
                { name: 'proveedor', etiqueta: 'Proveedor', valor: f.proveedor, opciones: proveedores.map((p) => ({ valor: p.id, texto: p.nombre })) },
                { name: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: Object.entries(ESTADO_STOCK_LABELS).map(([valor, texto]) => ({ valor, texto })) },
                { name: 'asignacion', etiqueta: 'Asignación', todos: 'Todas', valor: f.asignacion, opciones: Object.entries(ASIGNACION).map(([valor, texto]) => ({ valor, texto })) },
              ]}
              extra={
                <>
                  {f.vista === 'tarjetas' && <input type="hidden" name="vista" value="tarjetas" />}
                  {f.vence && <input type="hidden" name="vence" value="30" />}
                  <Link
                    href={href({ ...f, vence: !f.vence })}
                    aria-pressed={f.vence}
                    className={cn('inline-flex h-10 items-center gap-1 rounded-[8px] px-3 text-[14px] font-semibold leading-5 transition-colors', f.vence ? 'bg-sv2-accent text-white hover:bg-sv2-accent-hover' : 'border border-sv2-border bg-card text-foreground hover:bg-sv2-soft')}
                    data-testid="btn-vencimientos"
                  >
                    <CalendarDays aria-hidden className="size-4" />
                    Vencimientos
                  </Link>
                </>
              }
              chips={chips}
            />

            {visibles.length === 0 ? (
              <Tarjeta className="flex flex-col items-start gap-2 p-4" data-testid="supply-vacio">
                <p className="text-[15px] font-semibold leading-5">Ningún producto coincide con los filtros</p>
                <Link href={href({ q: '', proveedor: '', estado: '', asignacion: '', vence: false, vista: f.vista })} className="inline-flex h-8 items-center rounded-[8px] bg-sv2-soft px-3 text-[13px] font-semibold leading-4 hover:bg-sv2-soft-hover">Limpiar filtros</Link>
              </Tarjeta>
            ) : f.vista === 'tarjetas' ? (
              <TarjetasSupply productos={visibles} pie={pie} />
            ) : (
              <TablaSupply productos={visibles} ahora={ahora} pie={pie} />
            )}

            <div className="grid grid-cols-1 gap-3 @5xl:grid-cols-3">
              <PanelRentabilidad productos={productos} />
              <PanelEstadoLotes v={verificaciones} />
            </div>
          </>
        )}
      </div>
    </MarcoSupplyV2>
  )
}
