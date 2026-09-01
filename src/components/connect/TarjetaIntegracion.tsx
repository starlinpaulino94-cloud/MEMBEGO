import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EstadoIntegracion } from '@/components/connect/EstadoIntegracion'
import { LogoIntegracion } from '@/components/connect/LogoIntegracion'
import type { EntradaCatalogo } from '@/modules/connect/catalogo'

/**
 * UNA TARJETA del catálogo.
 *
 * El botón NO se decide aquí: viene calculado en `entrada.accion` por el mismo
 * ensamblador que decide el estado. Si `accion` es null no se pinta ninguno,
 * porque un botón que no hace nada es peor que ningún botón — y ésa es la
 * diferencia entre «Próximamente» honesto y una promesa falsa.
 */
export function TarjetaIntegracion({ entrada }: { entrada: EntradaCatalogo }) {
  const clicable = entrada.accion !== null

  const cuerpo = (
    <>
      <div className="flex items-start gap-3">
        <LogoIntegracion
          slug={entrada.slug}
          nombre={entrada.nombre}
          marca={entrada.marca}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{entrada.nombre}</p>
          <p className="text-caption text-muted-foreground">{entrada.categoriaLabel}</p>
        </div>
        <EstadoIntegracion estado={entrada.estado} />
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{entrada.descripcion}</p>

      {entrada.detalle && (
        <p className="mt-2 line-clamp-2 text-caption text-muted-foreground">{entrada.detalle}</p>
      )}
    </>
  )

  const clases =
    'flex h-full flex-col rounded-xl border border-border/60 bg-card p-4 text-left transition-colors'

  if (!clicable) {
    return (
      <div className={`${clases} opacity-70`} aria-disabled>
        {cuerpo}
        <div className="mt-auto pt-4">
          <Button variant="ghost" size="sm" disabled className="pointer-events-none">
            {entrada.estado === 'PROXIMAMENTE' ? 'Próximamente' : 'No disponible'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Link href={entrada.ruta} className={`${clases} hover:border-primary/40 hover:bg-muted/30`}>
      {cuerpo}
      <div className="mt-auto flex items-center gap-1 pt-4 text-sm font-semibold text-primary">
        {entrada.accion}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </div>
    </Link>
  )
}
