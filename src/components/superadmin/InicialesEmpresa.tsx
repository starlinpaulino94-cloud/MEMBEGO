import { cn } from '@/lib/utils'

/**
 * Las dos letras de una empresa que aún no ha subido su logo.
 *
 * Antes todas llevaban el mismo degradado azul de la marca: en una lista de veinte empresas sin logo, veinte cuadros
 * idénticos que no ayudaban a encontrar ninguna. Ahora cada empresa tiene su tinte, y es SIEMPRE el mismo porque sale
 * de su nombre (no del orden de la lista ni del azar): CARTOWN es violeta hoy y mañana.
 */
const TINTES = [
  'bg-tinte-violeta text-tinte-violeta-ink',
  'bg-tinte-turquesa text-tinte-turquesa-ink',
  'bg-tinte-naranja text-tinte-naranja-ink',
  'bg-tinte-rosa text-tinte-rosa-ink',
  'bg-tinte-azul text-tinte-azul-ink',
  'bg-tinte-verde text-tinte-verde-ink',
] as const

export function tinteDeNombre(nombre: string): (typeof TINTES)[number] {
  let h = 0
  for (const c of nombre.trim().toLowerCase()) h = (h * 47 + c.charCodeAt(0)) >>> 0
  return TINTES[h % TINTES.length]
}

/** «car wash prueva» → CW, «MESTIZO Restaurante» → MR; con una sola palabra, sus dos primeras letras. */
export function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p))
  const texto = palabras.length >= 2 ? palabras[0][0] + palabras[1][0] : (palabras[0] ?? nombre).slice(0, 2)
  return texto.toUpperCase()
}

export function InicialesEmpresa({ nombre, className }: { nombre: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center text-overline font-bold',
        tinteDeNombre(nombre),
        className
      )}
    >
      {iniciales(nombre)}
    </span>
  )
}
