import { cn } from '@/lib/utils'
import { BotonCopiar } from '@/components/connect/BotonCopiar'

/**
 * UN BLOQUE DE CÓDIGO OSCURO, con «Copiar».
 *
 * Es el componente del centro de desarrolladores para claves, ejemplos de
 * `curl` y fragmentos de verificación de firma. Oscuro sobre el mismo tono
 * del riel de navegación —no un negro cualquiera— para que se lea como parte
 * del producto y no como una captura pegada.
 *
 * El `<pre>` DESPLAZA en horizontal en vez de desbordar: una URL con
 * parámetros es más larga que la pantalla de un teléfono, y sin scroll propio
 * sacaba la barra horizontal de toda la página.
 *
 * Un solo dueño de este `<pre>`: la guía y el resumen lo importan de aquí. Dos
 * copias del estilo se separan a la tercera semana.
 */
export function BloqueCodigo({
  codigo,
  etiqueta,
  className,
}: {
  codigo: string
  /** Un rótulo encima del bloque («Ejemplo de autenticación»). */
  etiqueta?: string
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {etiqueta && <p className="text-sm font-semibold text-foreground">{etiqueta}</p>}
      <div className="relative">
        <pre className="overflow-x-auto rounded-xl bg-sidebar-rail px-4 py-3 pr-24 font-mono text-caption leading-relaxed text-sidebar-accent-foreground">
          <code>{codigo}</code>
        </pre>
        <BotonCopiar texto={codigo} className="absolute right-2 top-2" />
      </div>
    </div>
  )
}
