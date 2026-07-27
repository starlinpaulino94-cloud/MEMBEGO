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

export function BannerDemo({ nombreEmpresa }: { nombreEmpresa?: string | null }) {
  return (
    <div
      role="status"
      className="sticky top-14 z-40 mb-6 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-900 backdrop-blur dark:text-amber-100"
    >
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">
        Modo demostración{nombreEmpresa ? ` · ${nombreEmpresa}` : ''} — todo lo que pase aquí es
        de práctica: ni los cobros ni los datos son reales.
      </span>
    </div>
  )
}
