import * as React from "react"
import { cn } from "../cn"

/**
 * Lista desplegable NATIVA con el aspecto de `Input` (misma altura, borde, foco y error).
 *
 * Para los formularios donde el valor lo controla el estado del formulario o donde importa la validación nativa
 * (`required`, `form` sin JavaScript) y el menú de Radix (`Select`) no la da. En el móvil abre el selector del sistema,
 * que es mejor que un menú propio para una lista corta. Se usa dentro de `Campo` con `{...control}`.
 */
function SelectNativo({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select-nativo"
      className={cn(
        "border-input flex h-10 w-full min-w-0 rounded-xl border bg-background px-3 py-1 text-sm",
        "shadow-sm transition-[color,box-shadow,border-color] duration-fast outline-none",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "hover:border-foreground/25",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        "dark:bg-white/5 dark:border-white/10 dark:hover:border-white/20",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { SelectNativo }
