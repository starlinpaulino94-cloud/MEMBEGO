/**
 * Aviso permanente de que se está dentro de una empresa de DEMOSTRACIÓN.
 *
 * POR QUÉ ES PERMANENTE Y NO SE PUEDE CERRAR: el riesgo de una empresa de
 * práctica no es que alguien la use mal, es que alguien no sepa que está en
 * ella. Un aviso que se cierra deja de avisar justo cuando importa — la sesión
 * de dentro de dos horas, o la persona que se sienta después.
 *
 * Va pegado justo debajo del encabezado (`top-14` = alto del header) y en el
 * mismo sitio en el panel y en el portal del cliente, para que la respuesta a
 * "¿esto es de verdad?" esté siempre en el mismo lugar de la pantalla, incluso
 * después de bajar por una lista larga.
 */

import { FlaskConical } from 'lucide-react'

/**
 * `variante="panel"`: la franja amarilla viva de los paneles (oct 2026). El tinte ámbar al 15 % se leía como un aviso
 * apagado y sucio; aquí el amarillo es el fondo entero, el texto casi negro (11:1) y una pastilla oscura dice PRÁCTICA
 * antes que nada. El portal del cliente sigue con la versión de siempre.
 */
export function BannerDemo({
  nombreEmpresa,
  variante = 'cliente',
}: {
  nombreEmpresa?: string | null
  variante?: 'cliente' | 'panel'
}) {
  if (variante === 'panel') {
    return (
      <div
        role="status"
        className="sticky top-14 z-40 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-demo-border bg-demo px-4 py-2.5 text-sm text-demo-foreground shadow-sm"
      >
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-demo-foreground px-2.5 py-0.5 text-xs font-bold tracking-wide text-demo">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          PRÁCTICA
        </span>
        <span className="min-w-0 flex-1 basis-56">
          {nombreEmpresa ? <span className="font-semibold">{nombreEmpresa}: </span> : null}
          los cobros y los datos de esta empresa no son reales.
        </span>
      </div>
    )
  }
  return (
    <div
      role="status"
      className="sticky top-14 z-40 mb-6 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/15 px-4 py-2 text-sm font-semibold text-foreground backdrop-blur"
    >
      {/* El texto en `foreground`: en `warning` sobre el fondo tintado daba 3,7:1 en cada pantalla de una empresa de práctica. */}
      <FlaskConical className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span className="flex-1">
        Modo demostración{nombreEmpresa ? ` · ${nombreEmpresa}` : ''} — todo lo que pase aquí es
        de práctica: ni los cobros ni los datos son reales.
      </span>
    </div>
  )
}
