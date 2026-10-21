import { Inter } from 'next/font/google'

/**
 * Inter para el panel administrativo (docs/auditoria-admin/10 §2; decisión D-02, adoptada).
 *
 * HOY EL PANEL NO CARGA INTER: `src/app/layout.tsx` carga Geist y Plus Jakarta Sans, e Inter solo vive en
 * `(cliente)/layout.tsx` y en supply-v2. Verificado en la fase 2 (`docs/auditoria-admin/fase-2/ACTA-FASE-2.md` §2): Google
 * sirve una fuente VARIABLE (eje de peso 100–900, cubre 400/500/600) con `tnum`, así que `font-variant-numeric:
 * tabular-nums` funciona. No trae `cv*`, `ss*` ni `case`.
 *
 * ESTE MÓDULO NO SE IMPORTA TODAVÍA. La fase 4 construye la infraestructura sin cambiar ninguna pantalla; un módulo de
 * `next/font` que nadie importa no entra en ningún paquete. Para ENCENDER el panel nuevo (fase 5, un solo cambio):
 *
 *   1. En `AppShell`, importar `fuentePanel` y ponerle a la raíz `className={`${fuentePanel.variable} panel-ds …`}`.
 *   2. Actualizar `tests/panel-ds.test.ts` (el contador de usos pasa de 0 a 1) y medir antes y después con el harness de
 *      capturas (`scripts/visual/`): el cliente tiene que quedar idéntico y el panel cambiar SOLO en tipografía.
 *
 * `preload: false`: la fuente se descarga cuando una pantalla la usa, no en todas las páginas del panel por si acaso.
 */
export const fuentePanel = Inter({
  variable: '--font-panel-inter',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
