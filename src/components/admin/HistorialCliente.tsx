import {
  Banknote,
  CalendarDays,
  Car,
  Bell,
  StickyNote,
  Tag,
  UserPlus,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import type { EventoCliente, TipoEvento } from '@/modules/cliente/historial'
import { EmptyState } from '@/components/system/EmptyState'

/**
 * La línea de tiempo del cliente.
 *
 * Un solo hilo vertical y los eventos colgando de él, del más reciente al más
 * antiguo. Es deliberadamente aburrido: quien abre esto está al teléfono con
 * alguien y necesita entender su historia en cinco segundos, no admirar una
 * visualización.
 *
 * El dinero se marca en negrita a la derecha porque es lo que se busca primero
 * («¿este cliente ha pagado algo?»), y el autor solo aparece cuando lo hizo una
 * persona: repetir «Sistema» en cada fila es ruido.
 */

const ICONO: Record<TipoEvento, LucideIcon> = {
  REGISTRO: UserPlus,
  MEMBRESIA: WalletCards,
  PAGO: Banknote,
  VISITA: Car,
  COMPRA: Tag,
  CITA: CalendarDays,
  NOTA: StickyNote,
  NOTIFICACION: Bell,
}

const TONO: Record<TipoEvento, string> = {
  REGISTRO: 'bg-muted text-muted-foreground',
  MEMBRESIA: 'bg-primary/10 text-primary',
  PAGO: 'bg-success/15 text-success',
  VISITA: 'bg-info/10 text-info',
  COMPRA: 'bg-primary/10 text-primary',
  CITA: 'bg-warning/15 text-warning',
  NOTA: 'bg-muted text-foreground',
  NOTIFICACION: 'bg-muted text-muted-foreground',
}

export function HistorialCliente({
  eventos,
  formatearFecha,
  formatearMonto,
}: {
  eventos: EventoCliente[]
  formatearFecha: (d: Date) => string
  formatearMonto: (n: number) => string
}) {
  if (eventos.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Todavía no hay historial"
        description="Aquí aparecerán sus visitas, pagos, citas y notas, en orden."
      />
    )
  }

  return (
    <ol className="relative space-y-4 border-l border-border/70 pl-6">
      {eventos.map((e) => {
        const Icono = ICONO[e.tipo]
        return (
          <li key={e.id} className="relative">
            {/* El punto del hilo. -left compensa el padding y el borde para que
                caiga justo encima de la línea. */}
            <span
              className={`absolute -left-[34px] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background ${TONO[e.tipo]}`}
              aria-hidden
            >
              <Icono className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-medium text-foreground">{e.titulo}</p>
              {e.monto != null && (
                <p className="font-semibold tabular-nums text-foreground">
                  {formatearMonto(e.monto)}
                </p>
              )}
            </div>
            {e.detalle && (
              <p className="mt-0.5 text-sm text-muted-foreground">{e.detalle}</p>
            )}
            <p className="mt-0.5 text-caption">
              {formatearFecha(e.fecha)}
              {e.autor && e.autor !== 'Sistema' ? ` · ${e.autor}` : ''}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
