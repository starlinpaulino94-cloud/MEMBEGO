import { cn } from '../cn'

interface PageHeaderProps {
  title: string
  description?: string
  /** Acción principal de la pantalla, a la derecha del título. */
  action?: React.ReactNode
  /**
   * Contexto sobre el título: el dominio al que pertenece la pantalla, o un
   * enlace de vuelta al listado desde un detalle. Recibe nodos para poder
   * pasar un `<Link>` sin que el design system dependa del router.
   */
  eyebrow?: React.ReactNode
  /**
   * Navegación secundaria de la sección (pestañas), bajo el título. Es lo que
   * evita que un detalle parezca una página suelta.
   */
  nav?: React.ReactNode
  className?: string
}

/**
 * Cabecera estándar de página. Toda pantalla empieza aquí — un solo `h1` por
 * pantalla, siempre en el mismo sitio y con el mismo tamaño.
 *
 * El título ya NO se trunca: un `truncate` sobre un `h1` convierte
 * "Configuración de métodos de pago" en "Configuración de méto…" en cuanto la
 * ventana se estrecha. Ahora ajusta en varias líneas con `text-wrap: balance`,
 * que reparte las palabras en vez de dejar una huérfana.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  nav,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-8', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="mb-1 text-overline">{eyebrow}</div>}
          <h1 className="text-h1 text-balance text-foreground">{title}</h1>
          {description && (
            <p className="mt-1.5 max-w-prose text-small text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      {nav && <div className="mt-5">{nav}</div>}
    </div>
  )
}
