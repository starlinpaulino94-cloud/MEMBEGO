import Link from 'next/link'
import {
  ArrowRight,
  Hourglass,
  Plug,
  RefreshCw,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { EstadoIntegracion } from '@/components/connect/EstadoIntegracion'
import { LogoIntegracion } from '@/components/connect/LogoIntegracion'
import type { EntradaCatalogo } from '@/modules/connect/catalogo'
import type { EstadoIntegracion as Estado } from '@/modules/connect/proveedores/tipos'

/**
 * UNA TARJETA del catálogo de integraciones.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES ZONAS, SIEMPRE LAS MISMAS
 *
 *   Cabecera  logotipo · nombre · categoría · estado
 *   Cuerpo    la descripción, recortada a tres líneas
 *   Pie       una sola acción, a lo ancho, con su icono
 *
 * El recorte a tres líneas no es estética: sin él, una descripción larga
 * estira su tarjeta y desalinea la fila entera, así que el ojo tiene que
 * recolocarse en cada columna. Con altura uniforme, los pies quedan a la misma
 * altura y la rejilla se recorre de un vistazo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL BOTÓN NO SE DECIDE AQUÍ
 *
 * `entrada.accion` viene calculada por el MISMO ensamblador que decide el
 * estado (`catalogoDeEmpresa`). Si es null no se pinta ninguna acción, porque
 * un botón que no hace nada es peor que ningún botón — y ésa es la diferencia
 * entre un «Próximamente» honesto y una promesa falsa.
 *
 * Lo único que este archivo añade es el ICONO, que es decisión visual y no de
 * negocio.
 */

/** El icono de cada acción posible. Presentación, no negocio. */
const ICONO_ACCION: Record<Estado, LucideIcon> = {
  PROXIMAMENTE: Hourglass,
  NO_DISPONIBLE: Hourglass,
  SIN_PLAN: Hourglass,
  DISPONIBLE: Plug,
  ALTA_SIN_TERMINAR: ArrowRight,
  CONECTADA: SlidersHorizontal,
  REQUIERE_ATENCION: Wrench,
  REAUTORIZAR: RefreshCw,
  CON_PROBLEMAS: Wrench,
}

export function TarjetaIntegracion({ entrada }: { entrada: EntradaCatalogo }) {
  const clicable = entrada.accion !== null
  const Icono = ICONO_ACCION[entrada.estado]

  const cuerpo = (
    <>
      <div className="flex items-start gap-3">
        <LogoIntegracion slug={entrada.slug} nombre={entrada.nombre} marca={entrada.marca} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-h4 font-semibold">{entrada.nombre}</p>
          <p className="truncate text-caption text-muted-foreground">{entrada.categoriaLabel}</p>
        </div>
        <EstadoIntegracion estado={entrada.estado} />
      </div>

      <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{entrada.descripcion}</p>

      {entrada.detalle && (
        <p className="mt-2 line-clamp-2 text-caption text-muted-foreground">{entrada.detalle}</p>
      )}
    </>
  )

  /**
   * El pie es un separador y una acción a lo ancho. Se pinta SIEMPRE con la
   * misma altura —haya botón o no— para que las tarjetas de una fila terminen
   * en la misma línea.
   */
  const pie = (
    <div className="mt-4 border-t border-border/60 pt-3">
      <span
        className={
          clicable
            ? 'flex min-h-9 items-center justify-center gap-2 rounded-lg border border-primary/40 px-3 text-sm font-semibold text-primary transition-colors duration-fast group-hover:border-primary group-hover:bg-primary/5'
            : 'flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border/60 px-3 text-sm font-medium text-muted-foreground'
        }
      >
        <Icono className="h-4 w-4 shrink-0" aria-hidden />
        {entrada.accion ??
          (entrada.estado === 'PROXIMAMENTE' ? 'Próximamente' : 'No disponible')}
      </span>
    </div>
  )

  const clases =
    'flex h-full flex-col rounded-xl border border-border/60 bg-card p-4 text-left transition-all duration-fast'

  if (!clicable) {
    return (
      <div className={`${clases} opacity-70`} aria-disabled>
        {cuerpo}
        <div className="mt-auto">{pie}</div>
      </div>
    )
  }

  return (
    <Link
      href={entrada.ruta}
      className={`group ${clases} outline-none hover:border-primary/40 hover:elevation-2 focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {cuerpo}
      <div className="mt-auto">{pie}</div>
    </Link>
  )
}
