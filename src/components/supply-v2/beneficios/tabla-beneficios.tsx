import Link from 'next/link'
import { ArrowRight, BadgeCheck, Box, Handshake, Link2, Store, Users } from 'lucide-react'
import type { SupplyV2BenefitFunding, SupplyV2BenefitStatus } from '@prisma/client'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BENEFIT_FUNDING_LABELS, BENEFIT_SCOPE_LABELS, BENEFIT_STATUS_LABELS, BENEFIT_STATUS_TONE, BENEFIT_VALUE_TYPE_LABELS, dineroSupplyV2, RUTA_BENEFICIOS } from '@/modules/supply-v2/core/catalogo'
import type { BeneficioEnLista } from '@/modules/supply-v2/benefits/queries'
import { diasHasta } from '../supply/estado-stock'
import { claseBotonSuave, MONO, Tarjeta } from '../resumen/superficie'

const CHIP = 'inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]'

const TONO: Record<(typeof BENEFIT_STATUS_TONE)[SupplyV2BenefitStatus], { fondo: string; punto: string }> = {
  success: { fondo: 'bg-sv2-secondary-container text-sv2-on-secondary-container', punto: 'bg-sv2-secondary' },
  danger: { fondo: 'bg-sv2-error-container text-sv2-on-error-container', punto: 'bg-sv2-error' },
  warning: { fondo: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed', punto: 'bg-sv2-tertiary' },
  info: { fondo: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed', punto: 'bg-sv2-primary' },
  neutral: { fondo: 'bg-sv2-soft-hover text-sv2-ink-variant', punto: 'bg-sv2-outline' },
}

/** Mismos textos, tonos e identificador que `ChipBeneficio`, con la geometría Stitch. */
function ChipEstado({ estado }: { estado: SupplyV2BenefitStatus }) {
  const t = TONO[BENEFIT_STATUS_TONE[estado]]
  return (
    <span className={cn(CHIP, t.fondo)} data-testid="estado-beneficio">
      <span aria-hidden className={cn('size-1.5 rounded-full', t.punto, estado === 'ACTIVE' && 'animate-pulse')} />
      {BENEFIT_STATUS_LABELS[estado]}
    </span>
  )
}

const FINANCIA: Record<SupplyV2BenefitFunding, { corto: string; tono: keyof typeof TONO }> = {
  MEMBEGO: { corto: 'Financiado Membego', tono: 'info' },
  SUPPLIER: { corto: 'Asumido por proveedor', tono: 'neutral' },
  SHARED: { corto: 'Compartido', tono: 'warning' },
}

/** Quién financia (§4), en corto; el texto completo queda en el `title`. */
function ChipFinancia({ funding }: { funding: SupplyV2BenefitFunding }) {
  const f = FINANCIA[funding]
  return (
    <span className={cn(CHIP, TONO[f.tono].fondo)} title={BENEFIT_FUNDING_LABELS[funding]} data-testid="chip-financiacion">
      <span aria-hidden className={cn('size-1.5 rounded-full', TONO[f.tono].punto)} />
      {f.corto}
    </span>
  )
}

function porcentaje(v: string): string {
  return `${Number(v).toLocaleString('es-DO', { maximumFractionDigits: 2 })} %`
}

/** La rebaja tal como la define el beneficio: parte de Membego, del proveedor o las dos. */
function valor(b: BeneficioEnLista): string {
  const f = (v: string) => (b.valueType === 'PERCENTAGE' ? porcentaje(v) : dineroSupplyV2(v, b.currency))
  if (b.funding === 'MEMBEGO') return f(b.membegoValue)
  if (b.funding === 'SUPPLIER') return f(b.supplierValue)
  return `${f(b.membegoValue)} + ${f(b.supplierValue)}`
}

function tope(b: BeneficioEnLista): string | null {
  const topes = [b.funding !== 'SUPPLIER' ? b.maxMembegoAmount : null, b.funding !== 'MEMBEGO' ? b.maxSupplierAmount : null].filter((t): t is string => t != null)
  if (topes.length === 0) return null
  return `Tope ${topes.map((t) => dineroSupplyV2(t, b.currency)).join(' + ')} por unidad`
}

const ICONO_ALCANCE = { SPECIFIC_OFFER: Link2, CATALOG_ITEM: Box, SUPPLIER: Store } as const

function Vigencia({ b, ahora }: { b: BeneficioEnLista; ahora: Date }) {
  const cerrado = b.status === 'CANCELLED' || b.status === 'EXPIRED'
  let aviso: { texto: string; tono: 'aviso' | 'neutral' } | null = null
  if (!cerrado) {
    if (b.startsAt > ahora) {
      const d = diasHasta(b.startsAt, ahora)
      aviso = { texto: `Empieza en ${d} ${d === 1 ? 'día' : 'días'}`, tono: 'neutral' }
    } else if (b.endsAt) {
      const d = diasHasta(b.endsAt, ahora)
      aviso = d <= 0 ? { texto: 'Vence hoy', tono: 'aviso' } : { texto: `Vence en ${d} ${d === 1 ? 'día' : 'días'}`, tono: d <= 30 ? 'aviso' : 'neutral' }
    } else {
      aviso = { texto: 'Sin vencimiento', tono: 'neutral' }
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="whitespace-nowrap text-[12px] leading-4 text-sv2-ink-variant">
        {b.endsAt ? (
          <>
            {formatDate(b.startsAt)} →<br className="hidden @4xl:inline" /> {formatDate(b.endsAt)}
          </>
        ) : (
          <>Desde {formatDate(b.startsAt)}</>
        )}
      </span>
      {aviso && (
        <span className={cn(CHIP, 'px-1.5', aviso.tono === 'aviso' ? 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed' : 'bg-sv2-soft text-sv2-ink-variant')}>
          {aviso.tono === 'aviso' && <span aria-hidden className="size-1.5 rounded-full bg-sv2-tertiary" />}
          {aviso.texto}
        </span>
      )}
    </div>
  )
}

/**
 * Consumo y presupuesto (§29): usos arriba, barra de lo consumido sobre el
 * tope (con lo reservado en un tono más claro) y SIEMPRE las tres cifras por
 * separado. Mezclarlas es el error que hace que un bono se pase de dinero sin
 * que nadie lo vea.
 */
function Consumo({ b }: { b: BeneficioEnLista }) {
  const total = b.budgetTotal ? Number(b.budgetTotal) : 0
  const pctConsumido = total > 0 ? Math.min(100, (Number(b.budgetConsumed) / total) * 100) : 0
  const pctReservado = total > 0 ? Math.min(100 - pctConsumido, (Number(b.budgetReserved) / total) * 100) : 0
  const cifra = (etiqueta: string, monto: string, testId: string, clase?: string) => (
    <div className="flex min-w-0 flex-col">
      <span className="text-[12px] leading-4 text-sv2-outline">{etiqueta}</span>
      <span className={cn('whitespace-nowrap text-[12px] font-semibold leading-4 tabular-nums', clase)} data-testid={testId}>{monto}</span>
    </div>
  )
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-[12px] font-medium leading-4">
        <span>
          {b.aplicaciones.toLocaleString('es-DO')} {b.aplicaciones === 1 ? 'uso' : 'usos'}
          {b.reservasVivas > 0 && <span className="text-sv2-tertiary"> · {b.reservasVivas} en curso</span>}
        </span>
        {total > 0 && <span className={cn(MONO, 'font-bold text-sv2-primary')}>{Math.round(pctConsumido)}%</span>}
      </div>
      {total > 0 ? (
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-sv2-track" role="img" aria-label={`${Math.round(pctConsumido)} % del presupuesto consumido`}>
          <div className="h-full bg-sv2-accent" style={{ width: `${pctConsumido}%` }} />
          <div className="h-full bg-sv2-accent/35" style={{ width: `${pctReservado}%` }} />
        </div>
      ) : (
        <span className="text-[12px] leading-4 text-sv2-outline">{b.funding === 'SUPPLIER' ? 'Sin presupuesto de Membego (lo asume el proveedor)' : 'Sin tope de presupuesto'}</span>
      )}
      <div className="grid grid-cols-3 gap-x-2">
        {cifra('Consumido', dineroSupplyV2(b.budgetConsumed, b.currency), 'beneficio-consumido')}
        {cifra('Reservado', dineroSupplyV2(b.budgetReserved, b.currency), 'beneficio-reservado', Number(b.budgetReserved) > 0 ? 'text-sv2-tertiary' : undefined)}
        {cifra('Disponible', b.budgetDisponible ? dineroSupplyV2(b.budgetDisponible, b.currency) : '—', 'beneficio-disponible')}
      </div>
      <span className={cn(MONO, 'text-sv2-outline')}>Tope: {b.budgetTotal ? dineroSupplyV2(b.budgetTotal, b.currency) : 'sin tope'}</span>
    </div>
  )
}

/**
 * Beneficios y presupuesto (Stitch, propuesta A). Una sola tabla que en
 * contenedores estrechos reacomoda cada fila como tarjeta: cada beneficio
 * existe una vez (las pruebas buscan su `tr` dentro de `tabla-beneficios`).
 */
export function TablaBeneficios({ filas, total, pie, ahora }: { filas: BeneficioEnLista[]; total: number; pie: React.ReactNode; ahora: Date }) {
  const th = 'px-2 text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline'
  const td = 'block @4xl:table-cell @4xl:px-2 @4xl:py-3 @4xl:align-middle'
  return (
    <Tarjeta className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sv2-divider px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em]">Beneficios y presupuesto</h2>
          <span className={cn(MONO, 'rounded-full bg-sv2-primary-fixed px-2 py-0.5 font-semibold text-sv2-on-primary-fixed')}>{total.toLocaleString('es-DO')} {total === 1 ? 'resultado' : 'resultados'}</span>
        </div>
        <span className="text-[12px] font-medium leading-4 text-sv2-ink-variant">Consumido · reservado · disponible</span>
      </div>
      <div className="@4xl:overflow-x-auto">
        <table className="block w-full border-collapse text-left text-[13px] leading-[18px] text-foreground @4xl:table" data-testid="tabla-beneficios">
          <thead className="hidden @4xl:table-header-group">
            <tr className="h-11 border-b border-sv2-border bg-sv2-head">
              <th scope="col" className={cn(th, 'pl-4')}>Beneficio &amp; código</th>
              <th scope="col" className={th}>Financiador</th>
              <th scope="col" className={th}>Valor / rebaja</th>
              <th scope="col" className={th}>Aplicación</th>
              <th scope="col" className={cn(th, 'min-w-[230px]')}>Consumo / presupuesto</th>
              <th scope="col" className={th}>Vigencia</th>
              <th scope="col" className={th}>Estado</th>
              <th scope="col" className={cn(th, 'pr-4 text-right')}>Acción</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-sv2-divider @4xl:table-row-group">
            {filas.map((b) => {
              const IconoAlcance = ICONO_ALCANCE[b.scope]
              const t = tope(b)
              return (
                <tr key={b.id} data-testid="fila-beneficio" className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 transition-colors hover:bg-sv2-well/60 @xl:grid-cols-3 @4xl:table-row @4xl:p-0">
                  <td className={cn(td, 'col-span-2 @xl:col-span-3 @4xl:col-span-1 @4xl:max-w-[190px] @4xl:pl-4')}>
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5">
                        <Link href={`${RUTA_BENEFICIOS}/${b.id}`} className="text-[14px] font-semibold leading-5 hover:underline">{b.name}</Link>
                        {b.funding === 'MEMBEGO' ? <BadgeCheck aria-hidden className="size-4 shrink-0 text-sv2-primary" /> : <Handshake aria-hidden className="size-4 shrink-0 text-sv2-outline" />}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-sv2-ink-variant">
                        <span className={cn(MONO, 'whitespace-nowrap text-sv2-outline')}>{b.code}</span>
                        <span aria-hidden>•</span>
                        <span className="whitespace-nowrap">{BENEFIT_VALUE_TYPE_LABELS[b.valueType]}</span>
                      </span>
                    </div>
                  </td>
                  <td className={td}>
                    <div className="flex flex-col gap-1">
                      <ChipFinancia funding={b.funding} />
                      <span className="text-[12px] leading-4 text-sv2-ink-variant">{b.funding === 'MEMBEGO' ? 'Presupuesto de Membego' : (b.proveedor ?? '—')}</span>
                    </div>
                  </td>
                  <td className={td}>
                    <div className="flex flex-col">
                      <span className={cn('text-[14px] font-bold leading-5 tabular-nums', b.funding !== 'SHARED' && 'whitespace-nowrap', b.funding === 'MEMBEGO' ? 'text-sv2-secondary' : 'text-sv2-primary')}>{valor(b)}</span>
                      <span className="text-[12px] leading-4 text-sv2-ink-variant">{t ?? 'Por unidad'}</span>
                    </div>
                  </td>
                  <td className={cn(td, '@4xl:max-w-[170px]')}>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{b.alcance}</span>
                      <span className="flex items-center gap-1 text-[12px] font-medium leading-4 text-sv2-primary">
                        <IconoAlcance aria-hidden className="size-3.5 shrink-0" />
                        {BENEFIT_SCOPE_LABELS[b.scope]}
                      </span>
                      <span className="flex items-center gap-1 text-[12px] leading-4 text-sv2-outline">
                        <Users aria-hidden className="size-3.5 shrink-0" />
                        {b.requiresAssignment ? `${b.asignaciones.toLocaleString('es-DO')} ${b.asignaciones === 1 ? 'asignado' : 'asignados'}` : 'Sin asignación previa'}
                      </span>
                    </div>
                  </td>
                  <td className={cn(td, 'col-span-2 @xl:col-span-2 @4xl:col-span-1')}>
                    <Consumo b={b} />
                  </td>
                  <td className={td}>
                    <Vigencia b={b} ahora={ahora} />
                  </td>
                  <td className={td}>
                    <ChipEstado estado={b.status} />
                  </td>
                  <td className={cn(td, 'self-end @4xl:pr-4 @4xl:text-right')}>
                    <Link href={`${RUTA_BENEFICIOS}/${b.id}`} data-testid="link-beneficio" className={cn(claseBotonSuave, 'h-8 gap-1 whitespace-nowrap border border-sv2-border bg-card px-3 text-[13px] leading-4 hover:bg-sv2-soft')}>
                      Ver<span className="@4xl:sr-only"> ficha</span> <ArrowRight aria-hidden className="size-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pie}
    </Tarjeta>
  )
}
