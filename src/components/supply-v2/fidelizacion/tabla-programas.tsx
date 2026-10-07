import Link from 'next/link'
import { ArrowRight, Gift, Share2, Sparkles, Star } from 'lucide-react'
import type { SupplyV2LoyaltyModality, SupplyV2LoyaltyProgramStatus } from '@prisma/client'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BENEFIT_FUNDING_LABELS, LOYALTY_MODALITY_LABELS, LOYALTY_PROGRAM_STATUS_LABELS, LOYALTY_PROGRAM_STATUS_TONE, RUTA_FIDELIZACION } from '@/modules/supply-v2/core/catalogo'
import type { TableroDeFidelizacion } from '@/modules/supply-v2/loyalty/queries'
import { claseBotonSuave, MONO, Tarjeta } from '../resumen/superficie'

type Programa = TableroDeFidelizacion['programas'][number]

const CHIP = 'inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]'

const TONO = {
  success: { fondo: 'bg-sv2-secondary-container text-sv2-on-secondary-container', punto: 'bg-sv2-secondary' },
  danger: { fondo: 'bg-sv2-error-container text-sv2-on-error-container', punto: 'bg-sv2-error' },
  warning: { fondo: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed', punto: 'bg-sv2-tertiary' },
  info: { fondo: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed', punto: 'bg-sv2-primary' },
  neutral: { fondo: 'bg-sv2-soft-hover text-sv2-ink-variant', punto: 'bg-sv2-outline' },
} as const

const ICONO_MODALIDAD: Record<SupplyV2LoyaltyModality, typeof Star> = { MEMBERSHIPS: Star, REFERRALS: Share2, POINTS: Sparkles, REWARDS: Gift }

/** Mismos textos, tonos e identificador que `ChipPrograma`, con la geometría Stitch. */
function ChipEstado({ estado }: { estado: SupplyV2LoyaltyProgramStatus }) {
  const t = TONO[LOYALTY_PROGRAM_STATUS_TONE[estado]]
  return (
    <span className={cn(CHIP, t.fondo)} data-testid="estado-programa">
      <span aria-hidden className={cn('size-1.5 rounded-full', t.punto, estado === 'PENDING_APPROVAL' && 'animate-pulse')} />
      {LOYALTY_PROGRAM_STATUS_LABELS[estado]}
    </span>
  )
}

function Consumo({ p, finanzas }: { p: Programa; finanzas: boolean }) {
  // La barra mide lo gastado sobre el presupuesto; solo se pinta con permiso de finanzas y con tope.
  const gastado = Number(p.costoRealizado.replace(/[^0-9.-]/g, ''))
  const tope = p.presupuestoAprobado ? Number(p.presupuestoAprobado.replace(/[^0-9.-]/g, '')) : 0
  const pct = tope > 0 ? Math.min(100, (gastado / tope) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[12px] font-medium leading-4">
        <span className="whitespace-nowrap">
          <span data-testid="programa-canjes" className="font-bold tabular-nums">{p.recompensasReclamadas.toLocaleString('es-DO')}</span> {p.recompensasReclamadas === 1 ? 'canje' : 'canjes'} ·{' '}
          <span data-testid="programa-puntos" className="font-bold tabular-nums">{p.puntosEmitidos.toLocaleString('es-DO')}</span> pts
        </span>
        {finanzas && tope > 0 && <span className={cn(MONO, 'font-bold text-sv2-primary')}>{pct.toLocaleString('es-DO', { maximumFractionDigits: 1 })}%</span>}
      </div>
      {finanzas && tope > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-sv2-track" role="img" aria-label={`${Math.round(pct)} % del presupuesto gastado`}>
          <div className="h-full rounded-full bg-sv2-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
      {finanzas && <span className="text-[12px] leading-4 text-sv2-ink-variant">{p.presupuestoAprobado ? `Gastado ${p.costoRealizado} de ${p.presupuestoAprobado}` : 'Sin tope de presupuesto'}</span>}
    </div>
  )
}

function Vigencia({ p }: { p: Programa }) {
  return (
    <span className="whitespace-nowrap text-[12px] leading-4 text-sv2-ink-variant">
      {formatDate(p.startsAt)}
      {p.endsAt ? ` → ${formatDate(p.endsAt)}` : ' → sin fin'}
    </span>
  )
}

/**
 * Programas de fidelización (Stitch, propuesta A). Una sola tabla que en
 * contenedores estrechos reacomoda cada programa como tarjeta: cada programa
 * existe una vez (las pruebas buscan `fila-programa`). El dinero (presupuesto y
 * gastado) solo se pinta con el permiso de finanzas, como antes.
 */
export function TablaProgramas({ filas, total, pie, finanzas }: { filas: Programa[]; total: number; pie: React.ReactNode; finanzas: boolean }) {
  const th = 'px-2 text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline'
  const td = 'block @4xl:table-cell @4xl:px-2 @4xl:py-3 @4xl:align-middle'
  return (
    <Tarjeta className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sv2-divider px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em]">Programas de fidelización</h2>
          <span className={cn(MONO, 'rounded-full bg-sv2-primary-fixed px-2 py-0.5 font-semibold text-sv2-on-primary-fixed')}>{total.toLocaleString('es-DO')} {total === 1 ? 'programa' : 'programas'}</span>
        </div>
      </div>
      <div className="@4xl:overflow-x-auto">
        <table className="block w-full border-collapse text-left text-[13px] leading-[18px] text-foreground @4xl:table" data-testid="tabla-programas">
          <thead className="hidden @4xl:table-header-group">
            <tr className="h-11 border-b border-sv2-border bg-sv2-head">
              <th scope="col" className={cn(th, 'pl-4')}>Programa / ID</th>
              <th scope="col" className={th}>Modalidades</th>
              <th scope="col" className={th}>Beneficiarios</th>
              <th scope="col" className={cn(th, 'min-w-[190px]')}>Consumo / cuota</th>
              {finanzas && <th scope="col" className={cn(th, 'text-right')}>Gastado / presupuesto</th>}
              <th scope="col" className={th}>Estado</th>
              <th scope="col" className={cn(th, 'pr-4 text-right')}>Acción</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-sv2-divider @4xl:table-row-group">
            {filas.map((p) => (
              <tr key={p.id} data-testid="fila-programa" className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 transition-colors hover:bg-sv2-well/60 @xl:grid-cols-3 @4xl:table-row @4xl:p-0">
                <td className={cn(td, 'col-span-2 @xl:col-span-3 @4xl:col-span-1 @4xl:max-w-[210px] @4xl:pl-4')}>
                  <div className="flex flex-col gap-1">
                    <Link href={`${RUTA_FIDELIZACION}/${p.id}`} className="text-[14px] font-semibold leading-5 hover:underline" data-testid="programa-nombre">{p.nombre}</Link>
                    <span className={cn(MONO, 'text-sv2-outline')}>{p.code}</span>
                    <span className="text-[12px] leading-4 text-sv2-ink-variant">{p.negocio ?? p.propietario}</span>
                  </div>
                </td>
                <td className={cn(td, '@4xl:max-w-[170px]')}>
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap gap-1">
                      {p.modalidades.map((m) => {
                        const I = ICONO_MODALIDAD[m]
                        return (
                          <span key={m} className="inline-flex items-center gap-1 rounded-full border border-sv2-border bg-sv2-primary-fixed px-2 py-0.5 text-[12px] font-medium leading-4 text-sv2-primary">
                            <I aria-hidden className="size-3" />
                            {LOYALTY_MODALITY_LABELS[m]}
                          </span>
                        )
                      })}
                    </div>
                    <span className="text-[12px] leading-4 text-sv2-ink-variant">{BENEFIT_FUNDING_LABELS[p.funding]}</span>
                  </div>
                </td>
                <td className={td}>
                  <div className="flex flex-col">
                    <span><span data-testid="programa-miembros" className="text-[14px] font-bold tabular-nums">{p.miembrosActivos.toLocaleString('es-DO')}</span> <span className="text-sv2-ink-variant">{p.miembrosActivos === 1 ? 'miembro' : 'miembros'}</span></span>
                    <span><span data-testid="programa-referidos" className="font-bold tabular-nums">{p.referidosValidos.toLocaleString('es-DO')}</span> <span className="text-sv2-ink-variant">{p.referidosValidos === 1 ? 'referido pagado' : 'referidos pagados'}</span></span>
                  </div>
                </td>
                <td className={cn(td, 'col-span-2 @xl:col-span-1')}>
                  <Consumo p={p} finanzas={finanzas} />
                </td>
                {finanzas && (
                  <td className={cn(td, '@4xl:text-right')}>
                    <div className="flex flex-col @4xl:items-end">
                      <span className="whitespace-nowrap text-[14px] font-bold tabular-nums" data-testid="programa-gastado">{p.costoRealizado}</span>
                      {p.presupuestoAprobado ? (
                        <span className="text-[12px] leading-4 text-sv2-ink-variant">Presupuesto <span data-testid="programa-presupuesto">{p.presupuestoAprobado}</span></span>
                      ) : (
                        <span className="text-[12px] font-medium leading-4 text-sv2-tertiary" data-testid="programa-presupuesto">Sin tope</span>
                      )}
                    </div>
                  </td>
                )}
                <td className={td}>
                  <div className="flex flex-col gap-1.5">
                    <ChipEstado estado={p.estado} />
                    <Vigencia p={p} />
                  </div>
                </td>
                <td className={cn(td, 'self-end @4xl:pr-4 @4xl:text-right')}>
                  <Link href={`${RUTA_FIDELIZACION}/${p.id}`} data-testid="link-programa" className={cn(claseBotonSuave, 'h-8 gap-1 whitespace-nowrap border border-sv2-border bg-card px-3 text-[13px] leading-4 hover:bg-sv2-soft')}>
                    Ver<span className="@4xl:sr-only"> ficha</span> <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pie}
    </Tarjeta>
  )
}
