import { cn } from '../cn'

/**
 * Sección de un formulario largo (§63).
 *
 * Un formulario de veinte campos seguidos no se lee: se rellena a ciegas y se
 * envía a ver qué pasa. Agrupar por intención —qué es, cuánto cuesta, qué
 * incluye— convierte esa lista en una serie de preguntas contestables, y
 * permite volver a "el precio" sin releerlo entero.
 *
 * Usa `<fieldset>` y `<legend>` de verdad, no un `div` con un `h3`: los
 * lectores de pantalla anuncian la leyenda al entrar en cada campo del grupo,
 * así que quien navega sin ver sabe en qué sección está sin tener que
 * recordarlo. Un título suelto no hace eso.
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn('min-w-0 border-t border-border pt-6', className)}>
      <legend className="sr-only">{title}</legend>
      <div className="grid gap-6 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {/* `aria-hidden`: la leyenda ya lo anuncia; sin esto el lector de
              pantalla diría el título dos veces en cada campo. */}
          <h3 aria-hidden className="text-h4 text-foreground">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-caption text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </fieldset>
  )
}

/**
 * Barra de acciones pegada al fondo para formularios largos (§63).
 *
 * Sin ella, guardar exige bajar hasta el final: en un formulario de plan con
 * ocho secciones eso son varias pantallas de scroll cada vez que se cambia un
 * campo y se quiere confirmar.
 */
export function FormActions({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6',
        className
      )}
    >
      {children}
    </div>
  )
}
