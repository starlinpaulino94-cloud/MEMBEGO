import * as React from "react"
import { cn } from "../cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground/50 selection:bg-primary selection:text-primary-foreground",
        // DS 2.0 · h-10 (40px), a juego con el tamaño por defecto del botón:
        // un input de 36px junto a un botón de 40 se veía desalineado, y 36
        // queda corto para el dedo. Ver `tokens.minTouchTarget`.
        "border-input flex h-10 w-full min-w-0 rounded-xl border bg-background px-3 py-1 text-sm",
        "shadow-sm transition-[color,box-shadow,border-color] duration-150 outline-none",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "hover:border-foreground/25",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        "dark:bg-white/5 dark:border-white/10 dark:hover:border-white/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
