import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { fuentePanel } from './fuente-panel'

/**
 * Enciende el sistema de diseño del panel (`.panel-ds`: Inter 14/20, títulos en 600, cifras tabulares) SOLO dentro de este
 * contenedor (docs/auditoria-admin/10 §2; fase 4 tarea 4.8; fase 5).
 *
 * POR QUÉ POR PANTALLA Y NO EN `AppShell`. Encenderlo en el shell cambia la tipografía de las ~200 pantallas del panel de un
 * golpe, y la mayoría no se ha revisado (fases 6 y 7). Aquí se enciende en las que la fase 5 rediseña —Resumen, Pagos,
 * Clientes y Beneficios—: el resto no cambia ni un píxel. El precio es transitorio y se conoce: el menú lateral y la cabecera
 * siguen con la tipografía de hoy hasta que la fase 6 reconstruya la navegación. Encenderlo en todo el panel es un cambio de
 * UNA línea (esta clase en la raíz del shell) y una decisión del dueño.
 *
 * `fuentePanel.variable` carga Inter con `next/font` (`--font-panel-inter`, `preload: false`: solo se descarga si una
 * pantalla la usa). `tests/panel-ds.test.ts` lleva la cuenta de quién enciende el ámbito.
 */
export function PanelDs({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(fuentePanel.variable, 'panel-ds', className)}>{children}</div>
}
