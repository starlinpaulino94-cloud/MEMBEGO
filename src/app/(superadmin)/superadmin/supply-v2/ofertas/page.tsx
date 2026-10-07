import Link from 'next/link'
import type { SupplyV2OfferSource, SupplyV2OfferStatus } from '@prisma/client'
import { ArrowRight, Car, CircleCheck, CirclePlus, Layers, ReceiptText, ShieldCheck, ShoppingCart, Store, TrendingUp, Wallet, Network } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { formatMoneyRD } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { BarraFiltrosSupplyV2, type ChipFiltro } from '@/components/supply-v2/filtros'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { claseBotonSuave, Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { TablaOfertas } from '@/components/supply-v2/ofertas/tabla-ofertas'
import { OFFER_SOURCE_LABELS, OFFER_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'
import { buscarOfertas, proveedoresConOfertas, resumenOfertas } from '@/modules/supply-v2/offers/queries'
import { calcularEconomia } from '@/modules/supply-v2/economics/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ofertas · Supply 2.0' }

const RUTA = '/superadmin/supply-v2/ofertas'
const FILAS = [10, 25, 50]

interface Filtros { q: string; modalidad: SupplyV2OfferSource | ''; proveedor: string; estado: SupplyV2OfferStatus | '' }

function href(f: Filtros & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.modalidad) p.set('modalidad', f.modalidad)
  if (f.proveedor) p.set('proveedor', f.proveedor)
  if (f.estado) p.set('estado', f.estado)
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA}?${qs}` : RUTA
}

function dinero(n: number): string {
  return `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/**
 * MEMBEGO SUPPLY 2.0 · ofertas (§42–§43), rediseño Stitch (propuesta A, dirección
 * blanca): cinco indicadores, filtros por URL aplicados en la base, tabla con
 * modalidad, cupos, precio y margen, y dos tarjetas con texto verdadero.
 */
export default async function OfertasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; modalidad?: string; proveedor?: string; estado?: string; pagina?: string; filas?: string }>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f: Filtros = {
    q: (sp.q ?? '').trim().slice(0, 80),
    modalidad: sp.modalidad && sp.modalidad in OFFER_SOURCE_LABELS ? (sp.modalidad as SupplyV2OfferSource) : '',
    proveedor: sp.proveedor ?? '',
    estado: sp.estado && sp.estado in OFFER_STATUS_LABELS ? (sp.estado as SupplyV2OfferStatus) : '',
  }
  const filas = FILAS.includes(Number(sp.filas)) ? Number(sp.filas) : 10
  const paginaPedida = Math.max(1, Math.floor(Number(sp.pagina)) || 1)
  const filtro = { q: f.q, sourceType: f.modalidad || null, supplierId: f.proveedor || null, status: f.estado || null }
  const ahora = new Date()

  const [resumen, proveedores, primera, economia, pagosPendientes] = await Promise.all([
    resumenOfertas(),
    proveedoresConOfertas(),
    buscarOfertas(filtro, { pagina: paginaPedida, filas }),
    calcularEconomia({ ventana: 'MES' }, ahora),
    sinEmpresa('Supply 2.0: pagos por revisar', (tx) => tx.supplyV2CustomerOrder.count({ where: { status: 'AWAITING_PAYMENT' } })),
  ])
  const pagina = Math.min(paginaPedida, Math.max(1, Math.ceil(primera.total / filas)))
  const r = pagina === paginaPedida ? primera : await buscarOfertas(filtro, { pagina, filas })
  const hayFiltros = Boolean(f.q || f.modalidad || f.proveedor || f.estado)

  const chips: ChipFiltro[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, quitar: href({ ...f, q: '' }) })
  if (f.modalidad) chips.push({ texto: `Modalidad: ${OFFER_SOURCE_LABELS[f.modalidad]}`, quitar: href({ ...f, modalidad: '' }) })
  if (f.proveedor) chips.push({ texto: `Proveedor: ${proveedores.find((p) => p.id === f.proveedor)?.nombre ?? '—'}`, quitar: href({ ...f, proveedor: '' }) })
  if (f.estado) chips.push({ texto: `Estado: ${OFFER_STATUS_LABELS[f.estado]}`, quitar: href({ ...f, estado: '' }) })

  const boton = cn(claseBotonSuave, 'h-9 gap-1.5 border border-sv2-border bg-card px-3 text-[13px] leading-4 hover:bg-sv2-soft')
  const unidadesVendidas = economia.unitsSold

  return (
    <MarcoSupplyV2 activa="ofertas" acciones={<AccionesCabeceraSupplyV2 destino={RUTA} filtro={f.q} />}>
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col justify-between gap-4 p-5 @4xl:flex-row @4xl:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase leading-4 tracking-wider">
              <span className="font-sv2-mono font-bold text-sv2-primary">Supply 2.0</span>
              <span aria-hidden className="text-sv2-outline">•</span>
              <span className="text-sv2-ink-variant">Catálogo &amp; comercialización</span>
            </div>
            <h2 className="text-[24px] font-bold leading-8 tracking-[-0.015em]">Ofertas de Supply</h2>
            <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
              Supply que Membego comercializa: con inventario adquirido (publicar aparta unidades de un lote) o a comisión con el proveedor (sin lote; se liquida el neto al entregar).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${RUTA}/ventas`} data-testid="link-ventas" className={boton}>
              <ReceiptText aria-hidden className="size-4 text-sv2-primary" />
              Ventas y cobros
              {pagosPendientes > 0 && <span className="rounded-full bg-sv2-tertiary-fixed px-1.5 text-[12px] font-semibold text-sv2-on-tertiary-fixed">{pagosPendientes} por revisar</span>}
            </Link>
            {/* El catálogo de categorías de vehículo no tiene pestaña propia: se llega desde aquí, porque quien pone precios es quien necesita mirarlo. */}
            <Link href="/superadmin/supply-v2/categorias" data-testid="link-categorias-vehiculo" className={boton}>
              <Car aria-hidden className="size-4 text-sv2-ink-variant" />
              Categorías de vehículo
            </Link>
            <Link href={`${RUTA}/nueva`} data-testid="btn-crear-oferta" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover">
              <CirclePlus aria-hidden className="size-[18px]" />
              Crear oferta
            </Link>
          </div>
        </Tarjeta>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-5" data-testid="indicadores-ofertas">
          <TarjetaIndicador etiqueta="Ofertas activas" icono={CircleCheck} tonoIcono="exito" valor={resumen.activas.toLocaleString('es-DO')} unidad={resumen.activas === 1 ? 'activa' : 'activas'} pie={`${resumen.borradores} en borrador · ${resumen.pausadas} pausadas`} testId="kpi-ofertas-activas" />
          <TarjetaIndicador etiqueta="Unidades asignadas" icono={Layers} tonoIcono="primario" valor={resumen.unidadesAsignadas.toLocaleString('es-DO')} unidad="u." pie={resumen.loteReciente ? `Lote ${resumen.loteReciente}` : 'Sin lotes apartados'} tonoPie={resumen.loteReciente ? 'primario' : 'neutral'} testId="kpi-ofertas-unidades" />
          <TarjetaIndicador etiqueta="GMV en vitrina" icono={Store} tonoIcono="aviso" valor={formatMoneyRD(Math.round(resumen.gmvVitrina))} pie={resumen.precioReciente !== null ? `Precio unitario ${dinero(resumen.precioReciente)}` : 'Sin ofertas activas'} testId="kpi-ofertas-gmv" />
          <TarjetaIndicador etiqueta="Margen proyectado" icono={TrendingUp} tonoIcono="exito" valor={resumen.margenPct === null ? '—' : `${resumen.margenPct.toFixed(1)}%`} pie={resumen.costoMedio !== null && resumen.utilidadMedia !== null ? `Costo ${dinero(Math.round(resumen.costoMedio))} · Util. ${dinero(Math.round(resumen.utilidadMedia))}/u` : 'Sin ofertas con lote'} testId="kpi-ofertas-margen" />
          <TarjetaIndicador etiqueta="Ventas del mes" icono={ShoppingCart} valor={unidadesVendidas.toLocaleString('es-DO')} unidad="u." pie={unidadesVendidas > 0 ? `${formatMoneyRD(Number(economia.gmv.toFixed(2)))} vendidos` : 'Sin ventas este mes'} tonoPie={unidadesVendidas > 0 ? 'exito' : 'neutral'} testId="kpi-ofertas-ventas" />
        </div>

        <BarraFiltrosSupplyV2
          ruta={RUTA}
          variante="suave"
          testId="filtros-ofertas"
          busqueda={{ valor: f.q, etiqueta: 'Buscar ofertas', placeholder: 'Buscar oferta por título, SKU o proveedor...', testId: 'buscar-ofertas' }}
          selectores={[
            { name: 'modalidad', etiqueta: 'Modalidad', todos: 'Todas', valor: f.modalidad, opciones: Object.entries(OFFER_SOURCE_LABELS).map(([valor, texto]) => ({ valor, texto })) },
            { name: 'proveedor', etiqueta: 'Proveedor', valor: f.proveedor, opciones: proveedores.map((p) => ({ valor: p.id, texto: p.nombre })) },
            { name: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: Object.entries(OFFER_STATUS_LABELS).map(([valor, texto]) => ({ valor, texto })) },
          ]}
          chips={chips}
        />

        {r.filas.length === 0 ? (
          <Tarjeta className="flex flex-col items-start gap-2 p-5" data-testid="ofertas-vacio">
            <p className="text-[15px] font-semibold leading-5">{hayFiltros ? 'Ninguna oferta coincide con los filtros' : 'No hay ofertas todavía'}</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">{hayFiltros ? 'Prueba con otra búsqueda o reinicia los filtros.' : 'Usa Supply disponible para crear tu primera oferta.'}</p>
            <Link href={hayFiltros ? RUTA : `${RUTA}/nueva`} className={cn(boton, 'mt-1')}>{hayFiltros ? 'Limpiar filtros' : 'Crear oferta'}</Link>
          </Tarjeta>
        ) : (
          <TablaOfertas
            ofertas={r.filas}
            ahora={ahora}
            pie={
              <PaginacionSupplyV2
                pagina={pagina}
                filas={filas}
                total={r.total}
                sustantivo={r.total === 1 ? 'oferta configurada' : 'ofertas configuradas'}
                href={(p, n) => href({ ...f, pagina: p, filas: n })}
                extra={<span>{r.adquiridas} con inventario apartado · {r.comision} a comisión</span>}
              />
            }
          />
        )}

        <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
          <Tarjeta className="flex flex-col justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sv2-primary-fixed text-sv2-primary"><Wallet className="size-5" /></span>
              <div className="flex flex-col gap-1">
                <h3 className="text-[15px] font-bold leading-5">Margen fijado al publicar</h3>
                <p className="text-[13px] leading-5 text-sv2-ink-variant">
                  Al publicar una oferta con <strong className="text-foreground">supply adquirido</strong> se apartan sus unidades del lote y el costo de ese lote fija el margen. <strong className="text-foreground">A comisión</strong> no hay lote: Membego cobra su porcentaje y liquida el neto al proveedor.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-sv2-well px-3 py-2.5 text-[13px] leading-5">
              <span className="flex items-center gap-1.5"><ShieldCheck aria-hidden className="size-[18px] text-sv2-secondary" /> Margen promedio de ofertas activas: <strong>{resumen.margenPct === null ? '—' : `${resumen.margenPct.toFixed(1)}%`}</strong></span>
              <Link href="/superadmin/supply-v2/economia" className="flex items-center gap-0.5 font-semibold text-sv2-primary hover:underline">Ver economía <ArrowRight aria-hidden className="size-3.5" /></Link>
            </div>
          </Tarjeta>
          <Tarjeta className="flex flex-col justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sv2-secondary-container text-sv2-on-secondary-container"><Network className="size-5" /></span>
              <div className="flex flex-col gap-1">
                <h3 className="text-[15px] font-bold leading-5">Dónde se ven las ofertas</h3>
                <p className="text-[13px] leading-5 text-sv2-ink-variant">Las ofertas activas aparecen en la vitrina de Promociones; también pueden formar parte de campañas o ser recompensa de fidelización.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
              {[
                { t: 'Vitrina Promociones', v: `${resumen.activas} ${resumen.activas === 1 ? 'activa' : 'activas'}`, ok: resumen.activas > 0 },
                { t: 'Campañas', v: `${resumen.enCampanas} ${resumen.enCampanas === 1 ? 'oferta' : 'ofertas'}`, ok: resumen.enCampanas > 0 },
                { t: 'Fidelización', v: `${resumen.enFidelizacion} ${resumen.enFidelizacion === 1 ? 'recompensa' : 'recompensas'}`, ok: resumen.enFidelizacion > 0 },
              ].map((c) => (
                <div key={c.t} className="flex flex-col gap-1 rounded-[8px] bg-sv2-well p-2.5">
                  <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">{c.t}</span>
                  <span className={cn('flex items-center gap-1.5 text-[13px] font-semibold leading-4', c.ok ? 'text-sv2-secondary' : 'text-sv2-ink-variant')}>
                    <span aria-hidden className={cn('size-1.5 rounded-full', c.ok ? 'bg-sv2-secondary' : 'bg-sv2-outline')} />
                    {c.v}
                  </span>
                </div>
              ))}
            </div>
          </Tarjeta>
        </div>
      </div>
    </MarcoSupplyV2>
  )
}
