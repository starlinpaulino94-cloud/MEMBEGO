import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export interface CategoriaReporte {
  titulo: string
  /** Qué pregunta responde. Sin esto es una lista de nombres, no un mapa. */
  pregunta: string
  href: string
  activo?: boolean
}

/**
 * EL MAPA DE LOS REPORTES.
 *
 * Antes era una fila de enlaces sueltos bajo el filtro: seis textos largos, sin
 * jerarquía, que crecía cada vez que nacía un reporte y que no decía qué había
 * al otro lado. Con doce categorías previstas, esa fila se convierte en una
 * lista interminable de pestañas — justo lo que hay que evitar.
 *
 * Cada tarjeta dice la PREGUNTA que el reporte responde, no solo su nombre.
 * «Finanzas» no le dice a nadie si ahí está lo que busca; «¿cuánto entró y por
 * qué vía?» sí. Es la diferencia entre un menú y un índice.
 *
 * No se imprime: en la hoja estorba, porque el papel ya es un reporte concreto.
 */
export function NavegacionReportes({ categorias }: { categorias: CategoriaReporte[] }) {
  return (
    <nav aria-label="Reportes disponibles" className="print:hidden">
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {categorias.map((c) => (
          <li key={c.href}>
            <Link
              href={c.href}
              aria-current={c.activo ? 'page' : undefined}
              className={`group flex h-full items-start justify-between gap-3 rounded-xl border p-3 transition-colors ${
                c.activo
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'
              }`}
            >
              <span className="min-w-0">
                <span className="block text-small font-semibold text-foreground">{c.titulo}</span>
                <span className="mt-0.5 block text-caption">{c.pregunta}</span>
              </span>
              <ArrowRight
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
