import Link from 'next/link'
import {
  Archive,
  ArrowLeftRight,
  BadgeCheck,
  CirclePlus,
  CircleX,
  Clock,
  ExternalLink,
  History,
  Hourglass,
  Send,
  SlidersHorizontal,
  Split,
  Ticket,
  Undo2,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ActividadSupplyV2 } from '@/modules/supply-v2/pool/queries'
import { EnlaceSuave, MONO, Tarjeta } from './superficie'

type Tono = 'primary' | 'secondary' | 'tertiary' | 'error' | 'neutral' | 'tenue'

const TONO: Record<Tono, { recuadro: string; etiqueta: string }> = {
  primary: { recuadro: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed', etiqueta: 'text-sv2-primary' },
  secondary: { recuadro: 'bg-sv2-secondary-container text-sv2-on-secondary-container', etiqueta: 'text-sv2-secondary' },
  tertiary: { recuadro: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed', etiqueta: 'text-sv2-tertiary' },
  error: { recuadro: 'bg-sv2-error-container text-sv2-on-error-container', etiqueta: 'text-sv2-error' },
  neutral: { recuadro: 'bg-sv2-soft text-foreground', etiqueta: 'text-sv2-ink-variant' },
  tenue: { recuadro: 'bg-sv2-soft text-foreground', etiqueta: 'text-sv2-ink-variant' },
}

/** Categoría, icono y tono de cada tipo de movimiento (eventos de orden y asientos del ledger). */
const CATEGORIA: Record<string, { etiqueta: string; icono: LucideIcon; tono: Tono }> = {
  'ORDEN:CREATED': { etiqueta: 'Orden creada', icono: CirclePlus, tono: 'neutral' },
  'ORDEN:SUBMITTED': { etiqueta: 'Envío a aprobación', icono: Send, tono: 'neutral' },
  'ORDEN:APPROVED': { etiqueta: 'Aprobación', icono: BadgeCheck, tono: 'primary' },
  'ORDEN:REJECTED': { etiqueta: 'Rechazo', icono: CircleX, tono: 'error' },
  'ORDEN:CANCELLED': { etiqueta: 'Cancelación', icono: CircleX, tono: 'error' },
  'ORDEN:RECEIPT_CONFIRMED': { etiqueta: 'Recepción', icono: UserCheck, tono: 'secondary' },
  'ORDEN:RECEIVED': { etiqueta: 'Recepción', icono: UserCheck, tono: 'secondary' },
  'LEDGER:RECEIPT': { etiqueta: 'Supply', icono: Archive, tono: 'neutral' },
  'LEDGER:ALLOCATION': { etiqueta: 'Asignación', icono: Split, tono: 'primary' },
  'LEDGER:RELEASE_ALLOCATION': { etiqueta: 'Liberación', icono: Undo2, tono: 'neutral' },
  'LEDGER:RESERVATION': { etiqueta: 'Reserva', icono: Hourglass, tono: 'tertiary' },
  'LEDGER:RELEASE_RESERVATION': { etiqueta: 'Liberación', icono: Undo2, tono: 'neutral' },
  'LEDGER:ISSUE': { etiqueta: 'Emisión', icono: Ticket, tono: 'secondary' },
  'LEDGER:REDEMPTION': { etiqueta: 'Redención', icono: Ticket, tono: 'secondary' },
  'LEDGER:REVERSAL': { etiqueta: 'Reverso', icono: Undo2, tono: 'tertiary' },
  'LEDGER:EXPIRATION': { etiqueta: 'Vencimiento', icono: Clock, tono: 'tertiary' },
  'LEDGER:ADJUSTMENT': { etiqueta: 'Ajuste', icono: SlidersHorizontal, tono: 'neutral' },
  'LEDGER:CANCELLATION': { etiqueta: 'Cancelación', icono: CircleX, tono: 'error' },
  'LEDGER:TRANSFER': { etiqueta: 'Transferencia', icono: ArrowLeftRight, tono: 'neutral' },
}

const POR_DEFECTO = { etiqueta: 'Movimiento', icono: History, tono: 'neutral' as Tono }

const ES_CODIGO = /^(LOT|MBG)-/

/** «2 oct, 4:42 p. m.»: el año sobra en una actividad reciente. */
function cuandoCorto(d: Date): string {
  return formatDate(d, null, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** El título con la referencia (orden o lote) en monoespaciado, como en la maqueta. */
function Titulo({ a }: { a: ActividadSupplyV2 }) {
  const i = a.titulo.indexOf(a.referencia)
  if (i < 0) return <>{a.titulo}</>
  return (
    <>
      {a.titulo.slice(0, i)}
      <span className={cn('font-sv2-mono font-semibold', a.origen === 'ORDEN' && a.tipo !== 'CANCELLED' && a.tipo !== 'REJECTED' ? 'text-sv2-primary' : 'text-foreground')}>{a.referencia}</span>
      {a.titulo.slice(i + a.referencia.length)}
    </>
  )
}

export function ActividadReciente({ actividad }: { actividad: ActividadSupplyV2[] }) {
  return (
    <Tarjeta className="flex h-full flex-col gap-3 p-3" data-testid="resumen-actividad">
      <div className="flex items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-1">
          <History aria-hidden className="size-5 text-sv2-primary" strokeWidth={2} />
          <h2 className="text-[15px] font-bold leading-5 tracking-[-0.005em] text-foreground">Actividad reciente</h2>
        </div>
        <span className={cn(MONO, 'rounded-[4px] bg-sv2-soft-hover px-2 py-0.5 font-medium text-sv2-ink-variant')}>Audit Trail</span>
      </div>
      {actividad.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Sin movimientos todavía.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="actividad-reciente">
          {actividad.map((a) => {
            const c = CATEGORIA[`${a.origen}:${a.tipo}`] ?? POR_DEFECTO
            const t = TONO[c.tono]
            const Icono = c.icono
            const partes = a.detalle ? a.detalle.split(' · ') : []
            return (
              <li key={a.id}>
                <Link href={a.href} className="flex items-start gap-2 rounded-[8px] p-2 transition-colors hover:bg-sv2-well">
                  <span aria-hidden className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px]', t.recuadro)}>
                    <Icono className="size-4" strokeWidth={2} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center justify-between gap-1">
                      <span className={cn('text-[12px] font-bold uppercase leading-4 tracking-wide', t.etiqueta)}>{c.etiqueta}</span>
                      <span className="shrink-0 font-sv2-mono text-[12px] leading-4 text-sv2-outline">{cuandoCorto(a.cuando)}</span>
                    </span>
                    <span className="mt-0.5 break-words text-[13px] font-medium leading-[18px] text-foreground">
                      <Titulo a={a} />
                    </span>
                    {partes.length > 0 && (
                      <span className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[12px] leading-4 text-sv2-ink-variant">
                        {partes.map((parte, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <span aria-hidden>•</span>}
                            {a.motivo && parte === a.motivo ? (
                              <span className="font-medium text-sv2-error">Motivo: {parte}</span>
                            ) : (
                              <span className={cn(ES_CODIGO.test(parte) && 'font-sv2-mono text-[12px] leading-4')}>{parte}</span>
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <EnlaceSuave href="/superadmin/auditoria?q=SupplyV2" className="mt-auto h-8 w-full text-[12px] leading-4 tracking-[0.04em]">
        <span>Ver registro completo de auditoría</span>
        <ExternalLink aria-hidden className="size-4" />
      </EnlaceSuave>
    </Tarjeta>
  )
}
