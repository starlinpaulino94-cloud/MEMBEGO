import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../cn'

interface StatCardProps {
  label: string
  /** Valor del KPI. Acepta un nodo (p. ej. un contador animado). */
  value: ReactNode
  sub?: string
  icon?: LucideIcon
  trend?: { value: number; positive?: boolean }
  /**
   * Destino al pulsar la tarjeta.
   *
   * Existe porque la mitad de las tarjetas de un panel llevaban a algún sitio y
   * la otra mitad no, con el mismo aspecto: el usuario aprende «las tarjetas se
   * pulsan» y las que no responden parecen rotas. Con `href` la tarjeta entera
   * es el área pulsable —no un enlace pequeño dentro— y lleva su propio foco de
   * teclado.
   *
   * Se renderiza como `<a>` nativo y no como `Link` de Next: este paquete no
   * depende del framework. En rutas internas Next lo intercepta igual.
   */
  href?: string
  /**
   * Qué hay al otro lado, para quien no ve la pantalla. Sin esto un lector
   * anuncia «enlace, Clientes totales 99» sin decir a dónde va.
   */
  hrefLabel?: string
  /**
   * DS 2.0 · Los acentos SEMÁNTICOS son los buenos: dicen qué significa el
   * dato, no de qué color es. Los nombres de tono (`sky`, `green`…) son de
   * antes del sistema de tokens y siguen funcionando para no restyle de
   * golpe los paneles de administración; se retiran cuando la Fase 8 migre
   * sus 31 llamadas.
   */
  accent?:
    | 'brand'
    | 'success'
    | 'warning'
    | 'danger'
    /** @deprecated usa `brand` */
    | 'sky'
    /** @deprecated usa `success` */
    | 'green'
    /** @deprecated usa `warning` */
    | 'amber'
    /** @deprecated usa `danger` */
    | 'red'
    /** @deprecated usa `brand` */
    | 'indigo'
    /** @deprecated usa `brand` */
    | 'violet'
  className?: string
}

/* Colores con alpha para que funcionen igual en tema claro y oscuro. */
const ACCENT = {
  // Semánticos: sobre tokens, así que siguen a la marca y al tema.
  brand:   { bar: 'bg-primary',     iconBg: 'bg-primary/10 ring-primary/20',         iconText: 'text-primary' },
  success: { bar: 'bg-success',     iconBg: 'bg-success/10 ring-success/20',         iconText: 'text-success' },
  warning: { bar: 'bg-warning',     iconBg: 'bg-warning/10 ring-warning/20',         iconText: 'text-warning-foreground' },
  danger:  { bar: 'bg-destructive', iconBg: 'bg-destructive/10 ring-destructive/20', iconText: 'text-destructive' },
  // Heredados (ver el comentario del tipo).
  sky:    { bar: 'bg-info',     iconBg: 'bg-info/10 ring-info/20',         iconText: 'text-info' },
  green:  { bar: 'bg-success', iconBg: 'bg-success/10 ring-success/20', iconText: 'text-success' },
  amber:  { bar: 'bg-warning',   iconBg: 'bg-warning/10 ring-warning/20',     iconText: 'text-warning' },
  red:    { bar: 'bg-destructive',     iconBg: 'bg-destructive/10 ring-destructive/20',         iconText: 'text-destructive' },
  indigo: { bar: 'bg-indigo-500',  iconBg: 'bg-indigo-500/10 ring-indigo-500/20',   iconText: 'text-indigo-600 dark:text-indigo-400' },
  violet: { bar: 'bg-violet-500',  iconBg: 'bg-violet-500/10 ring-violet-500/20',   iconText: 'text-violet-600 dark:text-violet-400' },
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  accent,
  href,
  hrefLabel,
  className,
}: StatCardProps) {
  const a = accent ? ACCENT[accent] : null
  const Contenedor = href ? 'a' : 'div'

  return (
    <Contenedor
      {...(href
        ? {
            href,
            'aria-label': hrefLabel ? `${label}: ${hrefLabel}` : undefined,
          }
        : {})}
      className={cn(
        'group relative block overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-card transition-all duration-base hover:shadow-card-hover hover:-translate-y-0.5',
        // El foco visible solo cuando es pulsable: un anillo en algo que no
        // hace nada al pulsarlo es una promesa falsa.
        href &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      {/* Top accent bar */}
      {a && <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', a.bar)} />}

      {/* Subtle blurred orb */}
      {a && <div className={cn('absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-xl', a.bar)} />}

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          {trend && (
            <span
              className={cn(
                'mt-1.5 inline-flex items-center rounded-lg px-1.5 py-0.5 text-xs font-medium',
                trend.positive !== false
                  ? 'bg-success/10 text-success'
                  : 'bg-destructive/10 text-destructive'
              )}
            >
              {trend.positive !== false ? '↑' : '↓'} {Math.abs(trend.value)}%
            </span>
          )}
        </div>

        {Icon && a && (
          <div className={cn('shrink-0 rounded-xl p-2.5 ring-1', a.iconBg)}>
            <Icon className={cn('h-5 w-5', a.iconText)} />
          </div>
        )}
      </div>
    </Contenedor>
  )
}
