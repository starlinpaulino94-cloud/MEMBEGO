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
  /**
   * Icono del módulo, a la izquierda del título. Decorativo: el título ya dice
   * de qué es la pantalla, así que va oculto a los lectores de pantalla.
   */
  icon?: React.ReactNode
  /**
   * Migas de pan, sobre el título. Recibe los nodos ya armados (con `<Link>`),
   * igual que `eyebrow`, y las envuelve en un `<nav aria-label="Migas de pan">`.
   * Una página con profundidad (cliente › membresía) las lleva; el Resumen no.
   */
  breadcrumbs?: React.ReactNode
  /** Estado junto al título («Activa», «Borrador»): un `EstadoChip`. */
  badge?: React.ReactNode
  /** Enlace de vuelta («‹ Clientes»), sobre el título, para detalles y formularios. */
  back?: React.ReactNode
  /**
   * `pagina` (por defecto) ocupa todo el ancho. `formulario` se alinea con la
   * columna de un formulario (hasta 720 px, docs/auditoria-admin/10 §8): la
   * página no elige su propio `max-w-*`, elige un TIPO de página.
   */
  variant?: 'pagina' | 'formulario'
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
 *
 * FASE 4 · `icon`, `breadcrumbs`, `badge`, `back` y `variant` son opcionales y
 * NO cambian nada si no se usan: con las props de antes la salida es la misma,
 * byte a byte (lo fija `tests/primitivas-panel.test.ts`). El peso y el tamaño
 * del título nuevos (24/32, 600) NO se cambian aquí: salen del ámbito
 * `.panel-ds` de `globals.css`, que sigue apagado.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  nav,
  icon,
  breadcrumbs,
  badge,
  back,
  variant = 'pagina',
  className,
}: PageHeaderProps) {
  const titulo = <h1 className="text-h1 text-foreground font-extrabold tracking-tight">{title}</h1>

  return (
    <div className={cn('mb-6 sm:mb-8', variant === 'formulario' && 'mx-auto w-full max-w-[720px]', className)}>
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="w-full min-w-0 flex-1">
          {back && <div className="mb-1.5 text-small">{back}</div>}
          {breadcrumbs && (
            <nav aria-label="Migas de pan" className="mb-1.5 text-small text-muted-foreground">
              {breadcrumbs}
            </nav>
          )}
          {eyebrow && <div className="mb-1 text-overline">{eyebrow}</div>}
          {icon || badge ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              {icon && (
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5"
                >
                  {icon}
                </span>
              )}
              {titulo}
              {badge}
            </div>
          ) : (
            titulo
          )}
          {description && (
            <p className="mt-1.5 w-full text-small text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>
        {action && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-1 sm:self-start">
            {action}
          </div>
        )}
      </div>
      {nav && <div className="mt-4 sm:mt-5">{nav}</div>}
    </div>
  )
}
