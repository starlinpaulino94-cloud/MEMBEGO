import Link from 'next/link'
import { Award, CalendarDays, IdCard, LineChart, Plus, Share2, Sparkles } from 'lucide-react'
import type { SupplyV2LoyaltyModality, SupplyV2LoyaltyProgramStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { cn } from '@/lib/utils'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { BarraFiltrosSupplyV2, type ChipFiltro } from '@/components/supply-v2/filtros'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { claseBotonSuave, MONO, Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { TablaProgramas } from '@/components/supply-v2/fidelizacion/tabla-programas'
import { PanelDinero } from '@/components/supply-v2/fidelizacion/panel-dinero'
import { ReglasFidelizacion } from '@/components/supply-v2/fidelizacion/reglas-fidelizacion'
import { tableroDeFidelizacion } from '@/modules/supply-v2/loyalty/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { BASE_SUPPLY_V2, LOYALTY_MODALITY_LABELS, LOYALTY_PROGRAM_STATUS_LABELS, RUTA_FIDELIZACION } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fidelización · Supply 2.0' }

const FILAS = [10, 25, 50]
const RUTA_ECONOMIA = `${BASE_SUPPLY_V2}/economia`
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

interface Filtros { q: string; tipo: SupplyV2LoyaltyModality | ''; estado: SupplyV2LoyaltyProgramStatus | ''; mes: string }

function href(f: Filtros & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.tipo) p.set('tipo', f.tipo)
  if (f.estado) p.set('estado', f.estado)
  if (f.mes) p.set('mes', f.mes)
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA_FIDELIZACION}?${qs}` : RUTA_FIDELIZACION
}

/** «2026-10» → [1 oct 2026, 1 nov 2026) en UTC; null si no es un mes válido. */
function rangoDeMes(mes: string): { desde: Date; hasta: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!m) return null
  const n = Number(m[2])
  if (n < 1 || n > 12) return null
  return { desde: new Date(Date.UTC(Number(m[1]), n - 1, 1)), hasta: new Date(Date.UTC(Number(m[1]), n, 1)) }
}

function normal(t: string): string {
  return t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · TABLERO DE FIDELIZACIÓN (§41), rediseño Stitch
 * (propuesta A, dirección blanca).
 *
 * Las cifras de resultado son REALES: miembros activos, referidos pagados,
 * puntos emitidos y costo ya realizado. La única estimación —lo que costarían
 * los puntos que la gente todavía no ha canjeado— va marcada como tal y con su
 * advertencia al lado, porque una estimación no se enseña como si fuera dinero
 * que ya se debe. El dinero solo se ve con el permiso de finanzas.
 */
export default async function FidelizacionPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tipo?: string; estado?: string; mes?: string; pagina?: string; filas?: string }>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f: Filtros = {
    q: (sp.q ?? '').trim().slice(0, 80),
    tipo: sp.tipo && sp.tipo in LOYALTY_MODALITY_LABELS ? (sp.tipo as SupplyV2LoyaltyModality) : '',
    estado: sp.estado && sp.estado in LOYALTY_PROGRAM_STATUS_LABELS ? (sp.estado as SupplyV2LoyaltyProgramStatus) : '',
    mes: rangoDeMes(sp.mes ?? '') ? sp.mes! : '',
  }
  const [tablero, puedeCrear, puedeFinanzas] = await Promise.all([
    tableroDeFidelizacion(),
    puedeSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE'),
    puedeSupplyV2('SUPPLY_V2_LOYALTY_FINANCE_VIEW'),
  ])
  const t = tablero.totales

  // Filtros en memoria: el tablero ya carga hasta 50 programas con sus cifras.
  const q = normal(f.q)
  const rango = rangoDeMes(f.mes)
  const coinciden = tablero.programas.filter(
    (p) =>
      (!q || normal(`${p.nombre} ${p.code} ${p.negocio ?? p.propietario}`).includes(q)) &&
      (!f.tipo || p.modalidades.includes(f.tipo)) &&
      (!f.estado || p.estado === f.estado) &&
      (!rango || (p.startsAt < rango.hasta && (!p.endsAt || p.endsAt >= rango.desde)))
  )
  const filas = FILAS.includes(Number(sp.filas)) ? Number(sp.filas) : 10
  const pagina = Math.min(Math.max(1, Math.floor(Number(sp.pagina)) || 1), Math.max(1, Math.ceil(coinciden.length / filas)))
  const visibles = coinciden.slice((pagina - 1) * filas, pagina * filas)
  const hayFiltros = Boolean(f.q || f.tipo || f.estado || f.mes)

  const chips: ChipFiltro[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, quitar: href({ ...f, q: '' }) })
  if (f.tipo) chips.push({ texto: `Tipo: ${LOYALTY_MODALITY_LABELS[f.tipo]}`, quitar: href({ ...f, tipo: '' }) })
  if (f.estado) chips.push({ texto: `Estado: ${LOYALTY_PROGRAM_STATUS_LABELS[f.estado]}`, quitar: href({ ...f, estado: '' }) })
  if (f.mes) {
    const [a, m] = f.mes.split('-')
    chips.push({ texto: `Vigentes en ${MESES[Number(m) - 1]} ${a}`, quitar: href({ ...f, mes: '' }) })
  }

  const activos = tablero.programas.filter((p) => p.estado === 'ACTIVE')
  const porModalidad = (m: SupplyV2LoyaltyModality) => activos.filter((p) => p.modalidades.includes(m)).length
  const conVencimiento = tablero.programas.filter((p) => p.puntosVencenEnDias != null && p.modalidades.includes('POINTS'))
  const sinVencimiento = tablero.programas.filter((p) => p.puntosVencenEnDias == null && p.modalidades.includes('POINTS'))
  const dias = conVencimiento.map((p) => p.puntosVencenEnDias as number)

  return (
    <MarcoSupplyV2 activa="fidelizacion" acciones={<AccionesCabeceraSupplyV2 destino={RUTA_FIDELIZACION} filtro={f.q} />}>
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col gap-4 p-5 @4xl:flex-row @4xl:items-center @4xl:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(MONO, 'font-bold uppercase tracking-wide text-sv2-primary')}>Supply 2.0</span>
              <span aria-hidden className="text-sv2-outline">•</span>
              <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">Programas de lealtad y recompensas</span>
              <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4', t.programasActivos > 0 ? 'bg-sv2-secondary-container text-sv2-on-secondary-container' : 'bg-sv2-soft text-sv2-ink-variant')}>
                <span aria-hidden className={cn('size-1.5 rounded-full', t.programasActivos > 0 ? 'bg-sv2-secondary' : 'bg-sv2-outline')} />
                {t.programasActivos} {t.programasActivos === 1 ? 'programa activo' : 'programas activos'}
              </span>
            </div>
            <h2 className="text-[28px] font-bold leading-9 tracking-[-0.02em]">Fidelización de Supply</h2>
            <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
              Membresías, referidos, puntos y recompensas. Los beneficios de un plan o de una recompensa son los del catálogo de siempre, con su presupuesto y su ledger: aquí se agrupan y se les pone el techo.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href={RUTA_ECONOMIA} className={cn(claseBotonSuave, 'h-10 gap-1.5 border border-sv2-border bg-card px-3 text-[14px] leading-5 hover:bg-sv2-soft')}>
              <LineChart aria-hidden className="size-4 text-sv2-ink-variant" />
              Economía de fidelización
            </Link>
            {puedeCrear && (
              <Link
                href={`${RUTA_FIDELIZACION}/nuevo`}
                data-testid="btn-crear-programa-nav"
                className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-4 text-[14px] font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2"
              >
                <Plus aria-hidden className="size-4" />
                Crear programa
              </Link>
            )}
          </div>
        </Tarjeta>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @6xl:grid-cols-4" data-testid="tablero-fidelizacion">
          <TarjetaIndicador
            etiqueta="Programas activos"
            icono={Award}
            tonoIcono="primario"
            valor={t.programasActivos.toLocaleString('es-DO')}
            unidad={t.programasActivos === 1 ? 'activo' : 'activos'}
            pie={`${porModalidad('MEMBERSHIPS')} membresías · ${porModalidad('REFERRALS')} referidos · ${porModalidad('POINTS')} puntos`}
            tonoPie="exito"
            testId="tablero-programas"
          />
          <TarjetaIndicador etiqueta="Miembros activos" icono={IdCard} tonoIcono="primario" valor={t.miembrosActivos.toLocaleString('es-DO')} unidad={t.miembrosActivos === 1 ? 'miembro' : 'miembros'} pie="Membresías vigentes ahora" testId="tablero-miembros" />
          <TarjetaIndicador etiqueta="Referidos pagados" icono={Share2} tonoIcono="aviso" valor={t.referidosValidos.toLocaleString('es-DO')} unidad={t.referidosValidos === 1 ? 'referido' : 'referidos'} pie="Invitaciones que ya cobraron" testId="tablero-referidos" />
          <TarjetaIndicador etiqueta="Puntos emitidos" icono={Sparkles} tonoIcono="exito" valor={t.puntosEmitidos.toLocaleString('es-DO')} unidad="pts" pie={`${t.puntosDisponibles.toLocaleString('es-DO')} sin canjear todavía`} testId="tablero-puntos" />
        </div>

        {puedeFinanzas && <PanelDinero t={t} />}

        <BarraFiltrosSupplyV2
          ruta={RUTA_FIDELIZACION}
          variante="suave"
          testId="filtros-fidelizacion"
          busqueda={{ valor: f.q, etiqueta: 'Buscar programas', placeholder: 'Nombre, código o negocio...', testId: 'buscar-programas' }}
          selectores={[
            { name: 'tipo', etiqueta: 'Tipo', todos: 'Todas las modalidades', valor: f.tipo, opciones: Object.entries(LOYALTY_MODALITY_LABELS).map(([valor, texto]) => ({ valor, texto })) },
            { name: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: Object.entries(LOYALTY_PROGRAM_STATUS_LABELS).map(([valor, texto]) => ({ valor, texto })) },
          ]}
          extra={
            <div className="relative flex min-w-[160px] flex-1 items-center @5xl:max-w-[175px]">
              <CalendarDays aria-hidden className="pointer-events-none absolute left-2 size-4 text-sv2-ink-variant" />
              <label className="sr-only" htmlFor="fid-mes">Vigentes en el mes</label>
              <input
                id="fid-mes"
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

        {visibles.length === 0 ? (
          <Tarjeta className="flex flex-col items-start gap-2 p-5" data-testid="programas-vacio">
            <p className="text-[15px] font-semibold leading-5">{hayFiltros ? 'No hay programas con ese filtro' : 'Todavía no hay ningún programa'}</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">
              {hayFiltros ? 'Prueba con otra búsqueda o reinicia los filtros.' : 'Un programa de fidelización agrupa las membresías, los referidos, los puntos y las recompensas de un negocio o de Membego.'}
            </p>
            {!hayFiltros && puedeCrear && (
              <Link href={`${RUTA_FIDELIZACION}/nuevo`} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white hover:bg-sv2-accent-hover">
                <Plus aria-hidden className="size-4" />
                Crear el primero
              </Link>
            )}
          </Tarjeta>
        ) : (
          <TablaProgramas
            filas={visibles}
            total={coinciden.length}
            finanzas={puedeFinanzas}
            pie={<PaginacionSupplyV2 pagina={pagina} filas={filas} total={coinciden.length} sustantivo={coinciden.length === 1 ? 'programa configurado' : 'programas configurados'} href={(p, n) => href({ ...f, pagina: p, filas: n })} />}
          />
        )}

        <ReglasFidelizacion conVencimiento={conVencimiento.length} sinVencimiento={sinVencimiento.length} dias={dias} />
      </div>
    </MarcoSupplyV2>
  )
}
