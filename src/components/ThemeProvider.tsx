'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * Proveedor de tema (claro/oscuro) sobre next-themes. Aplica la clase `.dark`
 * en <html>; los tokens de globals.css definen los dos temas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL DEFECTO PASÓ DE OSCURO A CLARO
 *
 * El oscuro era una decisión de identidad («lienzo casi negro + esmeralda»).
 * Los diseños de Stitch —las cuatro pantallas del cliente y las ocho de
 * administración— son todos claros, y el encargo los fija como especificación
 * obligatoria. La app del cliente ya forzaba claro por su cuenta en el ámbito
 * `.retail`, así que el oscuro solo sobrevivía en el panel: dos identidades
 * para el mismo producto, según por qué puerta entraras.
 *
 * El toggle sigue donde estaba y la elección sigue persistiendo: quien
 * prefiera el oscuro no lo pierde. Lo que cambia es con qué se encuentra quien
 * no ha elegido nada.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
