import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EstadoIntegracion } from '@/components/connect/EstadoIntegracion'
import { LogoIntegracion } from '@/components/connect/LogoIntegracion'
import type { EntradaCatalogo } from '@/modules/connect/catalogo'

/**
 * UNA TARJETA del catálogo de integraciones (rediseño «hub de integraciones»).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES ZONAS, SIEMPRE LAS MISMAS
 *
 *   Cabecera  logotipo a la izquierda · estado como píldora a la derecha
 *   Cuerpo    nombre, categoría y la descripción, recortada a tres líneas
 *   Pie       una línea y la acción, a la derecha, como enlace con flecha
 *
 * El recorte a tres líneas no es estética: sin él, una descripción larga
 * estira su tarjeta y desalinea la fila entera, así que el ojo tiene que
 * recolocarse en cada columna. Con altura uniforme, los pies quedan a la misma
 * altura y la rejilla se recorre de un vistazo.
 *
 * La barra de acento del borde izquierdo es gris en reposo y toma el color de
 * marca al pasar el cursor: es la señal de «esto se abre» que el diseño usa
 * en lugar de un botón a lo ancho.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL BOTÓN NO SE DECIDE AQUÍ
 *
 * `entrada.accion` viene calculada por el MISMO ensamblador que decide el
 * estado (`catalogoDeEmpresa`). Si es null no se pinta ninguna acción, porque
 * un botón que no hace nada es peor que ningún botón — y ésa es la diferencia
 * entre un «Próximamente» honesto y una promesa falsa.
 */
export function TarjetaIntegracion({ entrada }: { entrada: EntradaCatalogo }) {
  const clicable = entrada.accion !== null

  const cuerpo = (
    <>
      {/* Barra de acento: gris en reposo, marca al pasar. Solo en las que se
          abren; en una prevista no hay nada que anunciar. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-1 transition-colors duration-fast',
          clicable ? 'bg-border group-hover:bg-primary' : 'bg-border/60'
        )}
      />

      <div className="flex items-start justify-between gap-3">
        <LogoIntegracion
          slug={entrada.slug}
          nombre={entrada.nombre}
          marca={entrada.marca}
          className="h-12 w-12 text-lg"
        />
        <EstadoIntegracion estado={entrada.estado} />
      </div>

      <p className="mt-4 truncate text-h3 font-semibold text-foreground">{entrada.nombre}</p>
      <p className="truncate text-caption text-muted-foreground">{entrada.categoriaLabel}</p>

      <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{entrada.descripcion}</p>

      {entrada.detalle && (
        <p className="mt-2 line-clamp-2 text-caption text-muted-foreground">{entrada.detalle}</p>
      )}
    </>
  )

  /**
   * El pie es una línea y la acción, a la derecha. Se pinta SIEMPRE con la
   * misma altura —haya acción o no— para que las tarjetas de una fila terminen
   * en la misma línea. Se alinea con `justify-end` en el contenedor y no
   * empujando la acción con un margen automático: en un teléfono, ese margen
   * sobre un texto largo saca la acción de la pantalla.
   */
  const pie = (
    <div className="mt-auto flex justify-end border-t border-border/60 pt-4">
      <span
        className={cn(
          'inline-flex items-center gap-1 text-sm',
          clicable
            ? 'font-semibold text-primary transition-colors duration-fast group-hover:underline'
            : 'font-medium text-muted-foreground'
        )}
      >
        {entrada.accion ??
          (entrada.estado === 'PROXIMAMENTE' ? 'Próximamente' : 'No disponible')}
        <ArrowRight
          className={cn(
            'h-4 w-4 shrink-0',
            clicable && 'transition-transform duration-fast group-hover:translate-x-0.5'
          )}
          aria-hidden
        />
      </span>
    </div>
  )

  // `overflow-hidden` para que la barra de acento respete las esquinas.
  const clases =
    'relative flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card p-6 text-left elevation-1 transition-all duration-fast'

  if (!clicable) {
    return (
      <div className={cn(clases, 'opacity-70')} aria-disabled>
        {cuerpo}
        {pie}
      </div>
    )
  }

  return (
    <Link
      href={entrada.ruta}
      className={cn(
        'group',
        clases,
        'outline-none hover:border-primary/40 hover:elevation-2 focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      {cuerpo}
      {pie}
    </Link>
  )
}
