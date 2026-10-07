import Link from 'next/link'
import { BadgeCheck, CalendarDays, History, PieChart, PiggyBank, Plus, TrendingUp, Wallet, Zap } from 'lucide-react'
import type { SupplyV2BenefitFunding, SupplyV2BenefitStatus, SupplyV2BenefitValueType } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { cn } from '@/lib/utils'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { BarraFiltrosSupplyV2, type ChipFiltro } from '@/components/supply-v2/filtros'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { claseBotonSuave, MONO, Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { TablaBeneficios } from '@/components/supply-v2/beneficios/tabla-beneficios'
import { ComoFuncionaBeneficio } from '@/components/supply-v2/beneficios/como-funciona'
import { buscarBeneficios, resumenBeneficios } from '@/modules/supply-v2/benefits/queries'
import { BASE_SUPPLY_V2, BENEFIT_STATUS_LABELS, BENEFIT_VALUE_TYPE_LABELS, dineroSupplyV2, RUTA_BENEFICIOS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Beneficios · Supply 2.0' }

const FILAS = [10, 25, 50]
const RUTA_ECONOMIA = `${BASE_SUPPLY_V2}/economia`
/** Textos cortos del filtro (los largos de `BENEFIT_FUNDING_LABELS` no caben en un selector). */
const FINANCIADORES: Record<SupplyV2BenefitFunding, string> = { MEMBEGO: 'Membego', SUPPLIER: 'Proveedor', SHARED: 'Compartido' }
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

interface Filtros { q: string; financiador: SupplyV2BenefitFunding | ''; tipo: SupplyV2BenefitValueType | ''; estado: SupplyV2BenefitStatus | ''; mes: string }

function href(f: Filtros & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.financiador) p.set('financiador', f.financiador)
  if (f.tipo) p.set('tipo', f.tipo)
  if (f.estado) p.set('estado', f.estado)
  if (f.mes) p.set('mes', f.mes)
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA_BENEFICIOS}?${qs}` : RUTA_BENEFICIOS
}

/** «2026-10» → [1 oct 2026, 1 nov 2026) en UTC; null si no es un mes válido. */
function rangoDeMes(mes: string): { desde: Date; hasta: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!m) return null
  const anio = Number(m[1])
  const n = Number(m[2])
  if (n < 1 || n > 12) return null
  return { desde: new Date(Date.UTC(anio, n - 1, 1)), hasta: new Date(Date.UTC(anio, n, 1)) }
}

function textoMes(mes: string): string {
  const [a, m] = mes.split('-')
  return `${MESES[Number(m) - 1]} ${a}`
}

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · BENEFICIOS (§29), rediseño Stitch (propuesta
 * A, dirección blanca): indicadores reales del presupuesto, filtros por URL en
 * la base y la tabla con las tres cifras del presupuesto siempre por separado
 * (reservado, consumido, disponible): mezclarlas es el error que hace que un
 * bono se pase de dinero sin que nadie lo vea. Aprobar, pausar y cancelar
 * siguen en la ficha de cada beneficio.
 */
export default async function BeneficiosSupplyV2Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; financiador?: string; tipo?: string; estado?: string; mes?: string; pagina?: string; filas?: string }>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f: Filtros = {
    q: (sp.q ?? '').trim().slice(0, 80),
    financiador: sp.financiador && sp.financiador in FINANCIADORES ? (sp.financiador as SupplyV2BenefitFunding) : '',
    tipo: sp.tipo && sp.tipo in BENEFIT_VALUE_TYPE_LABELS ? (sp.tipo as SupplyV2BenefitValueType) : '',
    estado: sp.estado && sp.estado in BENEFIT_STATUS_LABELS ? (sp.estado as SupplyV2BenefitStatus) : '',
    mes: rangoDeMes(sp.mes ?? '') ? sp.mes! : '',
  }
  const filas = FILAS.includes(Number(sp.filas)) ? Number(sp.filas) : 10
  const paginaPedida = Math.max(1, Math.floor(Number(sp.pagina)) || 1)
  const rango = rangoDeMes(f.mes)
  const filtro = { q: f.q, funding: f.financiador || null, valueType: f.tipo || null, status: f.estado || null, vigentesDesde: rango?.desde ?? null, vigentesHasta: rango?.hasta ?? null }

  const [resumen, primera] = await Promise.all([resumenBeneficios(), buscarBeneficios(filtro, { pagina: paginaPedida, filas })])
  const pagina = Math.min(paginaPedida, Math.max(1, Math.ceil(primera.total / filas)))
  const r = pagina === paginaPedida ? primera : await buscarBeneficios(filtro, { pagina, filas })
  const hayFiltros = Boolean(f.q || f.financiador || f.tipo || f.estado || f.mes)
  const ahora = new Date()

  const chips: ChipFiltro[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, quitar: href({ ...f, q: '' }) })
  if (f.financiador) chips.push({ texto: `Financiador: ${FINANCIADORES[f.financiador]}`, quitar: href({ ...f, financiador: '' }) })
  if (f.tipo) chips.push({ texto: `Tipo: ${BENEFIT_VALUE_TYPE_LABELS[f.tipo]}`, quitar: href({ ...f, tipo: '' }) })
  if (f.estado) chips.push({ texto: `Estado: ${BENEFIT_STATUS_LABELS[f.estado]}`, quitar: href({ ...f, estado: '' }) })
  if (f.mes) chips.push({ texto: `Vigentes en ${textoMes(f.mes)}`, quitar: href({ ...f, mes: '' }) })

  const presupuestoActivo = Number(resumen.presupuestoActivo)
  const presupuestoTotal = Number(resumen.presupuestoTotal)
  const consumido = Number(resumen.consumido)
  const pctEjecutado = presupuestoTotal > 0 ? (consumido / presupuestoTotal) * 100 : null
  const ventas = Number(resumen.ventasConBeneficio)
  const subsidio = Number(resumen.consumido)
  const multiplo = subsidio > 0 && ventas > 0 ? ventas / subsidio : null
  const pf = resumen.activosPorFinanciacion
  const rd = (v: number) => `RD$${v.toLocaleString('es-DO', { maximumFractionDigits: 2 })}`

  return (
    <MarcoSupplyV2 activa="beneficios" acciones={<AccionesCabeceraSupplyV2 destino={RUTA_BENEFICIOS} filtro={f.q} />}>
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col gap-4 p-5 @4xl:flex-row @4xl:items-center @4xl:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(MONO, 'rounded-full bg-sv2-primary-fixed px-2 py-0.5 font-semibold uppercase tracking-wide text-sv2-primary')}>Supply 2.0</span>
              <span aria-hidden className="text-sv2-outline">•</span>
              <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">Subsidios &amp; incentivos comerciales</span>
            </div>
            <h2 className="text-[28px] font-bold leading-9 tracking-[-0.02em]">Beneficios de Supply</h2>
            <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
              Bonos que financia Membego y descuentos que asume el proveedor. Rebajan lo que paga el cliente sin tocar el precio público ni el importe contractual de la venta.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href={RUTA_ECONOMIA} className={cn(claseBotonSuave, 'h-10 gap-1.5 border border-sv2-border bg-card px-3 text-[14px] leading-5 hover:bg-sv2-soft')}>
              <History aria-hidden className="size-4 text-sv2-ink-variant" />
              Economía de beneficios
            </Link>
            <Link
              href={`${RUTA_BENEFICIOS}/nuevo`}
              data-testid="btn-crear-beneficio-nav"
              className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-4 text-[14px] font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2"
            >
              <Plus aria-hidden className="size-4" />
              Crear beneficio
            </Link>
          </div>
        </Tarjeta>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-5" data-testid="indicadores-beneficios">
          <TarjetaIndicador
            etiqueta="Beneficios activos"
            icono={BadgeCheck}
            tonoIcono="primario"
            valor={resumen.activos.toLocaleString('es-DO')}
            unidad={resumen.activos === 1 ? 'activo' : 'activos'}
            pie={`${pf.MEMBEGO} Membego · ${pf.SUPPLIER} proveedor · ${pf.SHARED} compartidos`}
            tonoPie="exito"
            testId="kpi-ben-activos"
          />
          <TarjetaIndicador
            etiqueta="Presupuesto comprometido"
            icono={Wallet}
            valor={rd(presupuestoActivo)}
            pie={resumen.activosSinTope > 0 ? `Topes de los activos · ${resumen.activosSinTope} sin tope` : 'Suma de topes de los beneficios activos'}
            tonoPie={resumen.activosSinTope > 0 ? 'aviso' : 'neutral'}
            testId="kpi-ben-presupuesto"
          />
          <Tarjeta className="@container flex flex-col justify-between gap-3 p-4" data-testid="kpi-ben-ejecutado">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline">Subsidio ejecutado</span>
              <PieChart aria-hidden className="size-[18px] text-sv2-primary" />
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="whitespace-nowrap text-[clamp(20px,16cqi,28px)] font-bold leading-8 tracking-[-0.025em] tabular-nums">{rd(consumido)}</span>
              {pctEjecutado !== null && (
                <span className={cn(MONO, 'rounded-full bg-sv2-primary-fixed px-1.5 py-0.5 font-bold text-sv2-on-primary-fixed')}>{pctEjecutado.toLocaleString('es-DO', { maximumFractionDigits: 1 })}%</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-sv2-track">
                <div className="h-full rounded-full bg-sv2-accent" style={{ width: `${Math.min(100, pctEjecutado ?? 0)}%` }} />
              </div>
              <span className={cn(MONO, 'text-sv2-ink-variant')}>de {rd(presupuestoTotal)} autorizados</span>
            </div>
          </Tarjeta>
          <TarjetaIndicador
            etiqueta="Ahorro a clientes"
            icono={PiggyBank}
            tonoIcono="exito"
            valor={rd(Number(resumen.ahorroClientes))}
            pie="Bono Membego + descuento proveedor"
            iconoPie={TrendingUp}
            tonoPie="exito"
            testId="kpi-ben-ahorro"
          />
          <TarjetaIndicador
            etiqueta="Ventas con beneficio"
            icono={Zap}
            tonoIcono="primario"
            valor={rd(ventas)}
            pie={multiplo === null ? 'Aún sin subsidio ejecutado' : `${multiplo.toLocaleString('es-DO', { maximumFractionDigits: 1 })}× el subsidio ejecutado`}
            testId="kpi-ben-ventas"
          />
        </div>
        <p className="sr-only" data-testid="beneficios-resumen">
          {resumen.activos} activo(s) · {resumen.borradores} borrador(es) pendientes de aprobación · {resumen.total} en total.
        </p>

        <BarraFiltrosSupplyV2
          ruta={RUTA_BENEFICIOS}
          variante="suave"
          testId="filtros-beneficios"
          busqueda={{ valor: f.q, etiqueta: 'Buscar beneficios', placeholder: 'Nombre, código o proveedor...', testId: 'buscar-beneficios' }}
          selectores={[
            { name: 'financiador', etiqueta: 'Financiador', valor: f.financiador, opciones: Object.entries(FINANCIADORES).map(([valor, texto]) => ({ valor, texto })) },
            { name: 'tipo', etiqueta: 'Tipo', valor: f.tipo, opciones: Object.entries(BENEFIT_VALUE_TYPE_LABELS).map(([valor, texto]) => ({ valor, texto })) },
            { name: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: Object.entries(BENEFIT_STATUS_LABELS).map(([valor, texto]) => ({ valor, texto })) },
          ]}
          extra={
            <div className="relative flex min-w-[160px] flex-1 items-center @5xl:max-w-[175px]">
              <CalendarDays aria-hidden className="pointer-events-none absolute left-2 size-4 text-sv2-ink-variant" />
              <label className="sr-only" htmlFor="ben-mes">Vigentes en el mes</label>
              <input
                id="ben-mes"
                type="month"
                name="mes"
                defaultValue={f.mes}
                title="Vigentes en el mes"
                className="h-10 w-full rounded-[8px] border border-sv2-border bg-card pl-8 pr-2 text-[14px] leading-5 text-foreground focus:border-sv2-accent focus:outline-none focus:ring-2 focus:ring-sv2-accent/15"
              />
            </div>
          }
          chips={chips}
        />

        {r.filas.length === 0 ? (
          <Tarjeta className="flex flex-col items-start gap-2 p-5" data-testid="beneficios-vacio">
            <p className="text-[15px] font-semibold leading-5">{hayFiltros ? 'Nada con esos filtros' : 'No hay beneficios todavía'}</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">
              {hayFiltros ? 'Prueba con otra búsqueda o reinicia los filtros.' : 'Crea un bono de Membego o un descuento del proveedor para rebajar lo que paga el cliente en una oferta.'}
            </p>
            {!hayFiltros && (
              <Link href={`${RUTA_BENEFICIOS}/nuevo`} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white hover:bg-sv2-accent-hover">
                <Plus aria-hidden className="size-4" />
                Crear beneficio
              </Link>
            )}
          </Tarjeta>
        ) : (
          <TablaBeneficios
            filas={r.filas}
            total={r.total}
            ahora={ahora}
            pie={
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sv2-divider bg-sv2-head px-4 py-2 text-[13px] leading-4 text-sv2-ink-variant">
                  <span>
                    Reservado en checkouts: <strong className="font-semibold text-foreground" data-testid="beneficios-reservado-total">{dineroSupplyV2(resumen.reservado)}</strong>
                  </span>
                  <span className={MONO}>
                    Subsidio total autorizado: <strong className="font-bold text-foreground">{dineroSupplyV2(resumen.presupuestoTotal)}</strong>
                  </span>
                </div>
                <PaginacionSupplyV2 pagina={pagina} filas={filas} total={r.total} sustantivo={r.total === 1 ? 'beneficio' : 'beneficios'} href={(p, n) => href({ ...f, pagina: p, filas: n })} />
              </>
            }
          />
        )}

        <ComoFuncionaBeneficio rutaEconomia={RUTA_ECONOMIA} />
      </div>
    </MarcoSupplyV2>
  )
}
