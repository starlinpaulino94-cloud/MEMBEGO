import Link from 'next/link'
import { Tabla, type Columna } from '@/components/ui/tabla'
import type { MetaCampo, OrdenDetalle } from '@/modules/reportes/orden-detalle'

/**
 * LAS FILAS QUE PRODUJERON LA CIFRA, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-03, T-15).
 *
 * Sustituye a las cuatro `<table>` de `/reportes/…/detalle` y a su encabezado `ThOrden`. Lo que NO cambia es lo que importa de aquellas
 * pantallas: ordenar **cambia la consulta** (la lista viene recortada a 300 y el recorte lo decide el `orderBy`; nota larga en
 * `modules/reportes/orden-detalle.ts`), así que la cabecera es un enlace y no un control de navegador, y el estado de la tabla se puede
 * pegar en un chat.
 *
 * Una columna es ordenable SI Y SOLO SI su `clave` es un campo de la pantalla (`campos`). Antes lo vigilaba una prueba que leía el código
 * buscando `<ThOrden campo="…">`; ahora no se puede escribir: un encabezado que no es un campo simplemente no es un enlace, y no hay
 * forma de pedir «ordenar» por algo que la consulta no sabe ordenar.
 *
 * Todas las columnas son de prioridad 1 (ninguna se oculta en pantallas estrechas) A PROPÓSITO: un reporte se imprime y, en el papel, el
 * ancho de la página cuenta como pantalla estrecha. Una columna escondida en el papel de un reporte de dinero es peor que una tabla que
 * se desliza de lado en el móvil.
 */
export function TablaDetalle<F>({
  caption,
  columnas,
  filas,
  claveDe,
  campos,
  orden,
  enlaceOrden,
  columnaIdentificadora = 'cliente',
}: {
  caption: string
  columnas: readonly Columna<F>[]
  filas: readonly F[]
  claveDe: (fila: F) => string
  /** Los campos por los que la consulta sabe ordenar. */
  campos: readonly MetaCampo[]
  orden: OrdenDetalle
  /** El enlace de esta pantalla ordenada por `clave`. La página ya sabe qué dirección toca (`siguienteDireccion`). */
  enlaceOrden: (clave: string) => string
  columnaIdentificadora?: string
}) {
  const columnasConOrden = columnas.map((c) => ({ ...c, ordenable: campos.some((k) => k.clave === c.clave) }))
  return (
    <Tabla
      caption={caption}
      columnas={columnasConOrden}
      filas={filas}
      claveDe={claveDe}
      columnaIdentificadora={columnaIdentificadora}
      orden={{ clave: orden.clave, dir: orden.direccion }}
      hrefOrden={(clave) => enlaceOrden(clave)}
      enlace={({ href, className, children }) => (
        <Link href={href} className={className}>
          {children}
        </Link>
      )}
    />
  )
}
