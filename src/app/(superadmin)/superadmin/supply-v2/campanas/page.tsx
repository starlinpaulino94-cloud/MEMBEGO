import Link from 'next/link'
import { ChevronDown, Filter, LineChart, Megaphone, PlusCircle, Scale, ShieldAlert, ShieldCheck, ShoppingCart, Banknote, Wallet, X } from 'lucide-react'
import type { SupplyV2CampaignStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { cn } from '@/lib/utils'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { MONO, Tarjeta, claseBotonSuave } from '@/components/supply-v2/resumen/superficie'
import { TablaCampanas } from '@/components/supply-v2/campanas/tabla-campanas'
import { AlertasCampanas, EmbudoCampanas, type AlertaCampanas } from '@/components/supply-v2/campanas/embudo-campanas'
import { listarCampanas, tableroCampanas } from '@/modules/supply-v2/campaigns/queries'
import { proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { BASE_SUPPLY_V2, CAMPAIGN_STATUS_LABELS, dineroSupplyV2, RUTA_CAMPANAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Campañas · Supply 2.0' }

const ESTADOS: SupplyV2CampaignStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']
const FILAS = [10, 25, 50]
const RUTA_ECONOMIA = `${BASE_SUPPLY_V2}/economia`
const CAMPO = 'h-10 w-full rounded-[8px] border border-sv2-border bg-card px-2 text-[14px] leading-5 text-foreground focus:border-sv2-accent focus:outline-none focus:ring-2 focus:ring-sv2-accent/15'
const ETIQUETA = 'text-[12px] font-semibold leading-4 text-sv2-ink-variant'

function fechaDe(v: string | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

interface Filtros { q: string; estado: SupplyV2CampaignStatus | ''; proveedor: string; desde: string; hasta: string }

function href(f: Filtros & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.estado) p.set('estado', f.estado)
  if (f.proveedor) p.set('proveedor', f.proveedor)
  if (f.desde) p.set('desde', f.desde)
  if (f.hasta) p.set('hasta', f.hasta)
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA_CAMPANAS}?${qs}` : RUTA_CAMPANAS
}

function normal(t: string): string {
  return t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · TABLERO DE CAMPAÑAS (§26), rediseño Stitch
 * (propuesta A, dirección blanca).
 *
 * Las cifras salen de operaciones REALES: pedidos con la campaña congelada al
 * comprarlos. Un pedido cuenta una vez y solo los pagados son ventas; las
 * reservas en curso se informan aparte para no inflar el GMV. El embudo y las
 * alertas usan solo esas cifras: sin vistas, clics ni recomendaciones
 * inventadas.
 */
export default async function CampanasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; proveedor?: string; desde?: string; hasta?: string; pagina?: string; filas?: string }>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f: Filtros = {
    q: (sp.q ?? '').trim().slice(0, 80),
    estado: ESTADOS.includes(sp.estado as SupplyV2CampaignStatus) ? (sp.estado as SupplyV2CampaignStatus) : '',
    proveedor: sp.proveedor ?? '',
    desde: fechaDe(sp.desde) ? sp.desde! : '',
    hasta: fechaDe(sp.hasta) ? sp.hasta! : '',
  }
  const filtro = { status: f.estado || null, supplierId: f.proveedor || null, desde: fechaDe(f.desde), hasta: fechaDe(f.hasta) }
  const [todas, tablero, proveedores] = await Promise.all([listarCampanas(filtro), tableroCampanas(filtro), proveedoresParaFinanzas()])
  const ahora = new Date()

  // El filtro rápido de la cabecera busca en lo ya cargado (nombre, código o proveedor).
  const q = normal(f.q)
  const campanas = q ? todas.filter((c) => normal(`${c.name} ${c.code} ${c.proveedor ?? ''}`).includes(q)) : todas
  const filas = FILAS.includes(Number(sp.filas)) ? Number(sp.filas) : 10
  const pagina = Math.min(Math.max(1, Math.floor(Number(sp.pagina)) || 1), Math.max(1, Math.ceil(campanas.length / filas)))
  const visibles = campanas.slice((pagina - 1) * filas, pagina * filas)
  const hayFiltros = Boolean(f.q || f.estado || f.proveedor || f.desde || f.hasta)
  const vigentes = todas.filter((c) => c.vigenteAhora).length

  const chips: { texto: string; quitar: string }[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, quitar: href({ ...f, q: '' }) })
  if (f.estado) chips.push({ texto: `Estado: ${CAMPAIGN_STATUS_LABELS[f.estado]}`, quitar: href({ ...f, estado: '' }) })
  if (f.proveedor) chips.push({ texto: `Proveedor: ${proveedores.find((p) => p.id === f.proveedor)?.commercialName ?? '—'}`, quitar: href({ ...f, proveedor: '' }) })
  if (f.desde) chips.push({ texto: `Desde: ${f.desde}`, quitar: href({ ...f, desde: '' }) })
  if (f.hasta) chips.push({ texto: `Hasta: ${f.hasta}`, quitar: href({ ...f, hasta: '' }) })

  // Alertas reales (§26): campañas que esperan revisión, sin techo o cerca de él.
  const abiertas = todas.filter((c) => c.status !== 'CANCELLED' && c.status !== 'COMPLETED')
  const enRevision = abiertas.filter((c) => c.status === 'PENDING_APPROVAL')
  const sinTope = abiertas.filter((c) => c.budgetTotal == null)
  const cercaDelTope = abiertas.filter((c) => c.budgetTotal && Number(c.budgetTotal) > 0 && Number(c.budgetConsumido) / Number(c.budgetTotal) >= 0.8)
  const nombres = (l: typeof todas) => l.slice(0, 2).map((c) => `«${c.name}»`).join(', ') + (l.length > 2 ? ` y ${l.length - 2} más` : '')
  const alertas: AlertaCampanas[] = []
  if (enRevision.length > 0) alertas.push({ icono: 'revision', titulo: `${enRevision.length} ${enRevision.length === 1 ? 'campaña en revisión' : 'campañas en revisión'}`, texto: `${nombres(enRevision)} ${enRevision.length === 1 ? 'espera' : 'esperan'} la aprobación de otra persona.` })
  if (sinTope.length > 0) alertas.push({ icono: 'tope', titulo: `${sinTope.length} sin tope de presupuesto`, texto: `${nombres(sinTope)}: su subsidio no tiene techo.` })
  if (cercaDelTope.length > 0) alertas.push({ icono: 'consumo', titulo: `${cercaDelTope.length} cerca de su tope`, texto: `${nombres(cercaDelTope)} ya ${cercaDelTope.length === 1 ? 'consumió' : 'consumieron'} el 80 % o más de su presupuesto.` })
  if (alertas.length === 0) alertas.push({ icono: 'ok', titulo: 'Presupuesto bajo control', texto: 'Ninguna campaña espera revisión, todas tienen tope y ninguna pasa del 80 % de él.' })

  const contribucion = Number(tablero.contribucion)

  return (
    <MarcoSupplyV2 activa="campanas" acciones={<AccionesCabeceraSupplyV2 destino={RUTA_CAMPANAS} filtro={f.q} />}>
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col gap-4 p-5 @4xl:flex-row @4xl:items-center @4xl:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(MONO, 'font-bold uppercase tracking-wide text-sv2-primary')}>Supply 2.0</span>
              <span aria-hidden className="text-sv2-outline">•</span>
              <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">Estrategia comercial &amp; promociones</span>
              <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4', vigentes > 0 ? 'bg-sv2-secondary-container text-sv2-on-secondary-container' : 'bg-sv2-soft text-sv2-ink-variant')}>
                <span aria-hidden className={cn('size-1.5 rounded-full', vigentes > 0 ? 'bg-sv2-secondary' : 'bg-sv2-outline')} />
                {vigentes} {vigentes === 1 ? 'vigente ahora' : 'vigentes ahora'}
              </span>
            </div>
            <h2 className="text-[28px] font-bold leading-9 tracking-[-0.02em]">Campañas y promociones</h2>
            <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
              Agrupan ofertas de la red con una promoción común. La campaña pone el techo del presupuesto y la vigencia; el dinero lo mueven sus promociones.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href={RUTA_ECONOMIA} className={cn(claseBotonSuave, 'h-10 gap-1.5 border border-sv2-border bg-card px-3 text-[14px] leading-5 hover:bg-sv2-soft')}>
              <LineChart aria-hidden className="size-4 text-sv2-ink-variant" />
              Economía de campañas
            </Link>
            <Link
              href={`${RUTA_CAMPANAS}/nueva`}
              data-testid="btn-crear-campana-nav"
              className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-4 text-[14px] font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2"
            >
              <PlusCircle aria-hidden className="size-4" />
              Crear campaña
            </Link>
          </div>
        </Tarjeta>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-5" data-testid="tablero-campanas">
          <TarjetaIndicador
            etiqueta="Campañas activas"
            icono={Megaphone}
            tonoIcono="primario"
            valor={tablero.activas.toLocaleString('es-DO')}
            unidad={tablero.activas === 1 ? 'activa' : 'activas'}
            pie={`${tablero.programadas} ${tablero.programadas === 1 ? 'programada' : 'programadas'} · ${tablero.enRevision} en revisión`}
            iconoPie={ShieldCheck}
            tonoPie="exito"
            testId="tablero-activas"
          />
          <TarjetaIndicador
            etiqueta="Ventas confirmadas"
            icono={ShoppingCart}
            tonoIcono="primario"
            valor={tablero.ventasConfirmadas.toLocaleString('es-DO')}
            unidad={tablero.ventasConfirmadas === 1 ? 'venta' : 'ventas'}
            pie={tablero.pedidosEnCurso > 0 ? `${tablero.pedidosEnCurso} en curso (no son ventas)` : 'Pedidos pagados y atribuidos'}
            tonoPie={tablero.pedidosEnCurso > 0 ? 'aviso' : 'neutral'}
            testId="tablero-ventas"
          />
          <TarjetaIndicador etiqueta="GMV atribuido" icono={Banknote} tonoIcono="primario" valor={dineroSupplyV2(tablero.gmv)} pie={`Subsidio Membego ${dineroSupplyV2(tablero.subsidio)}`} testId="tablero-gmv" />
          <TarjetaIndicador
            etiqueta="Contribución neta"
            icono={Scale}
            tonoIcono={contribucion < 0 ? 'error' : 'neutral'}
            valor={dineroSupplyV2(tablero.contribucion)}
            pie={`Comisión ${dineroSupplyV2(tablero.comision)} − subsidio ${dineroSupplyV2(tablero.subsidio)}`}
            tonoPie={contribucion < 0 ? 'error' : 'aviso'}
            testId="tablero-contribucion"
          />
          <TarjetaIndicador
            etiqueta="Presupuesto comercial"
            icono={Wallet}
            tonoIcono="primario"
            valor={dineroSupplyV2(tablero.presupuestoAprobado)}
            pie={tablero.campanasSinTope > 0 ? `${tablero.campanasSinTope} sin tope de presupuesto` : 'Todas con tope de presupuesto'}
            iconoPie={tablero.campanasSinTope > 0 ? ShieldAlert : ShieldCheck}
            tonoPie={tablero.campanasSinTope > 0 ? 'aviso' : 'exito'}
            testId="tablero-presupuesto"
          />
        </div>

        {tablero.campanasSinTope > 0 && (
          <p className="flex items-start gap-2 rounded-[8px] border border-sv2-border bg-sv2-tertiary-fixed px-3 py-2 text-[13px] leading-[18px] text-sv2-on-tertiary-fixed" data-testid="aviso-sin-tope">
            <ShieldAlert aria-hidden className="mt-px size-4 shrink-0" />
            {tablero.campanasSinTope} campaña(s) sin presupuesto máximo. Van con autorización financiera registrada, pero su subsidio no tiene techo: revísalas.
          </p>
        )}

        <Tarjeta className="flex flex-col gap-3 bg-sv2-well p-3 shadow-none">
          <form method="get" action={RUTA_CAMPANAS} className="grid grid-cols-1 items-end gap-3 @xl:grid-cols-2 @5xl:grid-cols-12" data-testid="filtros-campanas">
            {f.q && <input type="hidden" name="q" value={f.q} />}
            <div className="flex flex-col gap-1 @5xl:col-span-3">
              <label htmlFor="estado" className={ETIQUETA}>Estado</label>
              <div className="relative flex items-center">
              <select id="estado" name="estado" defaultValue={f.estado} className={cn(CAMPO, 'cursor-pointer appearance-none pr-8')}>
                <option value="">Todos los estados</option>
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>{CAMPAIGN_STATUS_LABELS[e]}</option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-2 size-[18px] text-sv2-ink-variant" />
              </div>
            </div>
            <div className="flex flex-col gap-1 @5xl:col-span-3">
              <label htmlFor="proveedor" className={ETIQUETA}>Proveedor participante</label>
              <div className="relative flex items-center">
              <select id="proveedor" name="proveedor" defaultValue={f.proveedor} className={cn(CAMPO, 'cursor-pointer appearance-none pr-8')}>
                <option value="">Todos los proveedores</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.commercialName}</option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-2 size-[18px] text-sv2-ink-variant" />
              </div>
            </div>
            <div className="flex flex-col gap-1 @5xl:col-span-2">
              <label htmlFor="desde" className={ETIQUETA}>Desde</label>
              <input id="desde" name="desde" type="date" defaultValue={f.desde} className={CAMPO} />
            </div>
            <div className="flex flex-col gap-1 @5xl:col-span-2">
              <label htmlFor="hasta" className={ETIQUETA}>Hasta</label>
              <input id="hasta" name="hasta" type="date" defaultValue={f.hasta} className={CAMPO} />
            </div>
            <div className="flex items-center justify-end gap-2 @xl:col-span-2 @5xl:col-span-2">
              <button type="submit" className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-sv2-accent px-4 text-[14px] font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2" data-testid="btn-filtrar">
                <Filter aria-hidden className="size-4" />
                Aplicar
              </button>
              <Link href={RUTA_CAMPANAS} className="inline-flex h-10 items-center rounded-[8px] border border-sv2-border bg-card px-3 text-[14px] font-medium leading-5 text-sv2-ink-variant transition-colors hover:bg-sv2-soft hover:text-foreground">
                Limpiar
              </Link>
            </div>
          </form>
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[12px] font-semibold leading-4 tracking-[0.04em]">
              <span className="text-sv2-outline">Filtros aplicados:</span>
              {chips.map((c) => (
                <span key={c.texto} className="inline-flex items-center gap-1 rounded-full border border-sv2-border bg-card px-2 py-0.5 font-medium text-sv2-ink-variant">
                  {c.texto}
                  <Link href={c.quitar} aria-label={`Quitar ${c.texto}`} className="hover:text-sv2-error">
                    <X aria-hidden className="size-3.5" />
                  </Link>
                </span>
              ))}
            </div>
          )}
        </Tarjeta>

        {visibles.length === 0 ? (
          <Tarjeta className="flex flex-col items-start gap-2 p-5" data-testid="campanas-vacio">
            <p className="text-[15px] font-semibold leading-5">{hayFiltros ? 'No hay campañas con ese filtro' : 'Todavía no hay campañas'}</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">
              Una campaña agrupa ofertas de la red con una promoción común: descuentos, cupones o bonos financiados por Membego, por el proveedor o entre los dos.
            </p>
            <Link href={`${RUTA_CAMPANAS}/nueva`} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white hover:bg-sv2-accent-hover">
              <PlusCircle aria-hidden className="size-4" />
              Crear campaña
            </Link>
          </Tarjeta>
        ) : (
          <TablaCampanas
            filas={visibles}
            total={campanas.length}
            ahora={ahora}
            pie={<PaginacionSupplyV2 pagina={pagina} filas={filas} total={campanas.length} sustantivo={campanas.length === 1 ? 'campaña registrada' : 'campañas registradas'} href={(p, n) => href({ ...f, pagina: p, filas: n })} />}
          />
        )}

        <div className="grid grid-cols-1 gap-3 @5xl:grid-cols-3">
          <EmbudoCampanas t={tablero} />
          <AlertasCampanas alertas={alertas} accion={enRevision.length > 0 ? { href: href({ q: '', estado: 'PENDING_APPROVAL', proveedor: '', desde: '', hasta: '' }), texto: 'Ver campañas en revisión' } : undefined} />
        </div>
      </div>
    </MarcoSupplyV2>
  )
}
