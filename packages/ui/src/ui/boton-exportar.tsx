import { Download } from 'lucide-react'
import { Button } from './button'
import { cn } from '../cn'

/**
 * DESCARGAR LO QUE SE ESTÁ VIENDO, EN CSV.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Diez pantallas tenían su propio botón de exportar, y en diez copias ya habían
 * divergido: dos decían «CSV» y ocho «Exportar CSV»; había variantes `ghost`,
 * `secondary` y `outline` para la misma acción; el icono era `h-4` en unas y
 * `h-3.5` en otras, con `mr-2` o con `gap-1.5`, y con `aria-hidden` solo a
 * veces. Nada de eso rompe nada — simplemente hace que la misma acción no se
 * reconozca de una pantalla a otra, que es justo lo que un design system
 * existe para evitar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES UN `<a>`, NO UN `<Link>`
 *
 * Tres de las diez usaban `<Link>` de Next. Un `<Link>` es para navegar DENTRO
 * de la aplicación: Next intenta resolverlo por el router del cliente. Una ruta
 * de exportación no es una página — devuelve un archivo con
 * `Content-Disposition: attachment`—, así que no hay nada que el router pueda
 * renderizar y el navegador acaba haciendo la navegación completa igual. Un
 * ancla normal hace lo correcto directamente y sin intermediarios.
 *
 * El nombre del archivo lo pone el servidor en la cabecera, no un atributo
 * `download` aquí: así el CSV se llama igual venga de donde venga.
 */
export function BotonExportar({
  href,
  /**
   * Qué se exporta, cuando no es obvio por el contexto. Con varios botones en
   * la misma cabecera, «Exportar CSV» a secas no distingue cuál es cuál.
   */
  label = 'Exportar CSV',
  variant = 'secondary',
  size = 'default',
  className,
}: {
  href: string
  label?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
}) {
  return (
    <Button asChild variant={variant} size={size} className={cn('gap-2', className)}>
      <a href={href}>
        <Download className="h-4 w-4" aria-hidden />
        {label}
      </a>
    </Button>
  )
}
