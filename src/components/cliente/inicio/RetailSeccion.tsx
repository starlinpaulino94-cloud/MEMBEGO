import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

/**
 * La cabecera de sección del diseño: título, bajada y un enlace «Ver todas ›»
 * alineado a la derecha, sobre la línea del título.
 *
 * Existe como pieza propia porque el patrón se repite en las cinco secciones
 * del Inicio y en el resto de las pantallas del cliente. Escribirlo cinco
 * veces es cómo terminan cinco secciones con cinco tamaños distintos.
 *
 * `enlace` es opcional: si la sección no tiene a dónde llevar, no se inventa
 * un «Ver todas» que caiga en una pantalla vacía.
 */
export function RetailSeccionHeader({
  id,
  titulo,
  bajada,
  enlace,
}: {
  id: string
  titulo: string
  bajada?: string
  enlace?: { href: string; texto: string }
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-h2 text-foreground">
          {titulo}
        </h2>
        {bajada ? <p className="mt-0.5 text-small text-muted-foreground">{bajada}</p> : null}
      </div>
      {enlace ? (
        <Link
          href={enlace.href}
          className="mt-0.5 inline-flex min-h-9 shrink-0 items-center gap-0.5 rounded-lg px-1 text-small font-semibold text-primary outline-none transition hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {enlace.texto}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  )
}

/**
 * El botón de pie de sección: «Explorar más de 45 empresas asociadas ›».
 * Ancho completo, borde de 1px y radio de 8px, como manda el diseño para las
 * acciones secundarias.
 */
export function RetailSeccionPie({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-3 flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-border bg-card px-4 text-small font-semibold text-foreground outline-none transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.99]"
    >
      {children}
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  )
}

/**
 * La valoración con su número de reseñas: «★ 4.9 (120)».
 *
 * Sin reseñas no se pinta el paréntesis, y sin valoración no se pinta nada:
 * una estrella vacía o un «(0)» dicen algo peor que el silencio.
 */
export function RetailValoracion({
  valoracion,
  resenas,
}: {
  valoracion: number | null
  resenas: number
}) {
  if (valoracion === null) return null
  // Number() por si la cifra llega serializada (Decimal → string tras una
  // caché): formatear jamás puede tumbar la pantalla que la enseña.
  const media = Number(valoracion)
  if (!Number.isFinite(media)) return null
  return (
    <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
      <span aria-hidden className="text-retail-star">
        ★
      </span>
      <span className="font-semibold text-foreground">{media.toFixed(1)}</span>
      <span className="sr-only">de 5</span>
      {resenas > 0 ? (
        <span>
          ({resenas.toLocaleString('es-DO')}
          <span className="sr-only"> reseñas</span>)
        </span>
      ) : null}
    </span>
  )
}
