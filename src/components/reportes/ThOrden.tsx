import Link from 'next/link'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { Direccion } from '@/modules/reportes/tabla'

/**
 * UN ENCABEZADO QUE ORDENA LA CONSULTA.
 *
 * Para las tablas largas de `/detalle`. No es el mismo control que el de
 * `TablaReporte`: aquel reordena en el navegador unas filas que ya están todas
 * en la página; este **cambia la consulta**, porque la lista viene recortada a
 * 300 y el recorte lo decide el `orderBy`. La nota larga está en
 * `modules/reportes/orden-detalle.ts`.
 *
 * Es un enlace, no un botón con JavaScript: funciona sin hidratar, sobrevive al
 * «atrás» del navegador y el estado de la tabla se puede pegar en un chat.
 *
 * La flecha no se imprime —en el papel no hay nada que pulsar— pero el
 * encabezado sí, con el mismo texto de siempre.
 */
export function ThOrden({
  campo,
  activo,
  direccion,
  href,
  derecha = false,
  children,
}: {
  campo: string
  /** La clave del orden vigente, para saber si esta columna es la activa. */
  activo: string
  direccion: Direccion
  /** A dónde lleva pulsar. La página ya sabe qué dirección toca. */
  href: string
  derecha?: boolean
  children: React.ReactNode
}) {
  const esta = activo === campo
  const dir = esta ? direccion : null

  return (
    <th
      scope="col"
      className={`px-3 py-2 text-overline ${derecha ? 'text-right' : ''}`}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      <Link
        href={href}
        className={`inline-flex items-center gap-1 text-overline hover:text-foreground ${
          derecha ? 'flex-row-reverse' : ''
        } ${esta ? 'text-foreground' : ''}`}
      >
        {children}
        {dir === 'asc' ? (
          <ArrowUp className="h-3 w-3 print:hidden" aria-hidden />
        ) : dir === 'desc' ? (
          <ArrowDown className="h-3 w-3 print:hidden" aria-hidden />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40 print:hidden" aria-hidden />
        )}
      </Link>
    </th>
  )
}
