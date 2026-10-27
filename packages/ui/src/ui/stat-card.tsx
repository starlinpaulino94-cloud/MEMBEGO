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
  /**
   * `clasica` (por defecto) es la tarjeta de siempre. `panel` es la del sistema de diseño del panel administrativo
   * (docs/auditoria-admin/10 §7): plana, con borde, una sola talla de cifra, y con `ventana`, `unidad`, `pie` y `sinPermiso`.
   * Las cuatro props siguientes SOLO las lee `panel`; en `clasica` se ignoran.
   */
  variante?: 'clasica' | 'panel'
  /**
   * El periodo al que se refiere la cifra, escrito: «1–20 oct 2026», «últimos 30 días». Una cifra sin su ventana obliga a
   * adivinar (05 · D-06: ingresos del mes calendario junto a «nuevos» de 30 días rodantes bajo un mismo rótulo).
   */
  ventana?: string
  /** Unidad pegada a la cifra («%», «días»). El dinero NO va aquí: llega ya formateado en `value`. */
  unidad?: string
  /** Línea al pie, con tono: «▲ 18,5 % frente a 1–20 sep» (éxito), «2 por vencer» (aviso). */
  pie?: { texto: string; tono?: 'exito' | 'aviso' | 'neutro' }
  /**
   * El rol no puede ver esta cifra. Se pinta «Sin permiso» en lugar de la cifra, y `value` ni siquiera se renderiza: el
   * servidor ya debió dejar de calcularla (05 · D-01); esto solo evita un hueco mudo.
   */
  sinPermiso?: boolean
  className?: string
}

/** El color del texto del pie según su tono. Una función y no una tabla: es de la tarjeta, no un contrato de estado. */
const clasePie = (tono: 'exito' | 'aviso' | 'neutro' = 'neutro') =>
  tono === 'exito' ? 'text-success' : tono === 'aviso' ? 'text-warning' : 'text-muted-foreground'

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
  variante = 'clasica',
  ventana,
  unidad,
  pie,
  sinPermiso = false,
  className,
}: StatCardProps) {
  const a = accent ? ACCENT[accent] : null
  const Contenedor = href ? 'a' : 'div'

  if (variante === 'panel') {
    return (
      <Contenedor
        data-slot="stat-card"
        {...(href ? { href, 'aria-label': hrefLabel ? `${label}: ${hrefLabel}` : undefined } : {})}
        className={cn(
          'group relative block min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5',
          href &&
            'cursor-pointer transition-colors duration-fast hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          className
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-small font-medium text-muted-foreground">{label}</p>
          {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        </div>
        {sinPermiso ? (
          <p className="mt-1.5 text-h4 font-medium text-muted-foreground">Sin permiso</p>
        ) : (
          <p className="mt-1 text-kpi text-foreground tabular-nums">
            {value}
            {unidad && <span className="ml-1 text-small font-medium text-muted-foreground">{unidad}</span>}
          </p>
        )}
        {ventana && <p className="mt-0.5 text-caption text-muted-foreground">{ventana}</p>}
        {sub && !sinPermiso && <p className="mt-0.5 text-caption text-muted-foreground">{sub}</p>}
        {trend && !sinPermiso && (
          <span
            className={cn(
              'mt-1.5 inline-flex items-center rounded-lg px-1.5 py-0.5 text-caption font-medium',
              trend.positive !== false ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            )}
          >
            {trend.positive !== false ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
        )}
        {pie && !sinPermiso && <p className={cn('mt-2 text-small', clasePie(pie.tono))}>{pie.texto}</p>}
      </Contenedor>
    )
  }

  return (
    <Contenedor
      {...(href
        ? {
            href,
            'aria-label': hrefLabel ? `${label}: ${hrefLabel}` : undefined,
          }
        : {})}
      className={cn(
        // `@container`: la cifra y el icono se ajustan al ancho de la TARJETA,
        // no al de la pantalla. Con dos columnas en un móvil (o cuatro junto a
        // la barra lateral a 1 024 px) la tarjeta mide ~170 px y una cifra como
        // «RD$11,313.33» a text-3xl se salía y `overflow-hidden` la cortaba.
        '@container group relative block overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-card transition-all duration-base hover:shadow-card-hover hover:-translate-y-0.5',
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
          {/* Un escalón más grande desde 11rem de contenido (la consulta mide
              sin el p-5: ~14,5rem de tarjeta). Una cifra larga —el dinero:
              «RD$11,313»— va un escalón por debajo de una corta para caber junto
              al icono. `overflow-wrap:anywhere` es la última red: partir la
              cifra antes que esconder parte de ella. */}
          <p
            className={cn(
              'mt-1.5 font-bold tracking-tight text-foreground tabular-nums [overflow-wrap:anywhere]',
              typeof value === 'string' && value.length > 7
                ? 'text-lg @min-[11rem]:text-2xl'
                : 'text-2xl @min-[11rem]:text-3xl'
            )}
          >
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
          // Decorativo: con menos de 10rem de contenido le quitaba a la cifra
          // casi la mitad del ancho.
          <div className={cn('hidden shrink-0 rounded-xl p-2.5 ring-1 @min-[10rem]:block', a.iconBg)}>
            <Icon className={cn('h-5 w-5', a.iconText)} />
          </div>
        )}
      </div>
    </Contenedor>
  )
}
