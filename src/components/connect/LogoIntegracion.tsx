import { cn } from '@/lib/utils'
import type { MarcaProveedor } from '@/modules/connect/proveedores/tipos'

/**
 * EL LOGOTIPO de una integración.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ TODAVÍA NO HAY LOGOS OFICIALES
 *
 * La condición para guardarlos en el repositorio es comprobar antes que su uso
 * y su distribución son compatibles con la guía de marca de cada titular. Esa
 * comprobación no está hecha, así que ninguna marca tiene hoy
 * `logoVerificado: true` y todas caen en el monograma.
 *
 * El monograma NO es un icono genérico: lleva la inicial sobre el color oficial
 * de la marca, que es lo que hace reconocible una tarjeta de un vistazo. Un
 * logotipo redibujado a ojo, además de salir mal, puede infringir.
 *
 * Cuando un SVG oficial entre en `public/marcas/<slug>.svg` con su licencia
 * comprobada, basta poner el flag a true: este componente lo usa sin que haya
 * que tocar ninguna pantalla.
 */
export function LogoIntegracion({
  slug,
  nombre,
  marca,
  className,
}: {
  slug: string
  nombre: string
  marca: MarcaProveedor
  className?: string
}) {
  const base = cn(
    'flex shrink-0 items-center justify-center overflow-hidden rounded-xl',
    'h-10 w-10',
    className
  )

  if (marca.logoVerificado) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG local de tamaño fijo: `next/image` no aporta nada y añade una petición de optimización.
      <img
        src={`/marcas/${slug}.svg`}
        alt=""
        aria-hidden
        width={40}
        height={40}
        className={cn(base, 'bg-card object-contain')}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn(base, 'text-base font-black text-white')}
      // Color de una marca ajena: es un dato sobre un tercero, no una decisión
      // de nuestro tema. Ver la exención en `scripts/auditar-diseno.mjs`.
      style={{ backgroundColor: marca.color }}
    >
      {nombre.trim().charAt(0).toUpperCase()}
    </span>
  )
}
