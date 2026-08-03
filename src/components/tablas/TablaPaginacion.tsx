import Link from 'next/link'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@membego/ui/cn'
import {
  resumirPaginas,
  urlDePagina,
  TAMANOS_PAGINA,
  type Paginacion,
} from '@/lib/paginacion'

/**
 * Controles de paginación para tablas del servidor.
 *
 * Es un Server Component a propósito: la navegación son ENLACES reales, así
 * que la página funciona sin JavaScript, se puede abrir en otra pestaña, y el
 * estado (página, tamaño, filtros) vive en la URL — compartible y sobrevive a
 * recargar. Los filtros activos se conservan al saltar de página.
 */
export function TablaPaginacion({
  paginacion,
  total,
  params,
  etiqueta = 'registros',
  clave = '',
  className,
}: {
  paginacion: Pick<Paginacion, 'pagina' | 'tamano'>
  /** Total REAL de filas que cumplen el filtro (count del servidor). */
  total: number
  /** searchParams actuales, para conservar los filtros en los enlaces. */
  params: Record<string, string | string[] | undefined>
  etiqueta?: string
  /** Prefijo de los parámetros cuando la página tiene varias tablas. */
  clave?: string
  className?: string
}) {
  const r = resumirPaginas(paginacion, total)

  // Con una sola página y tamaño por defecto no hay nada que navegar: solo se
  // informa el total, sin ensuciar la pantalla con controles inertes.
  const soloInforme = r.totalPaginas === 1

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-t border-border/60 px-1 py-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <p className="text-xs text-muted-foreground">
        {r.total === 0 ? (
          <>Sin {etiqueta}</>
        ) : (
          <>
            Mostrando <strong className="text-foreground">{r.desde}</strong>–
            <strong className="text-foreground">{r.hasta}</strong> de{' '}
            <strong className="text-foreground">{r.total.toLocaleString('es-DO')}</strong>{' '}
            {etiqueta}
          </>
        )}
      </p>

      {!soloInforme && (
        <div className="flex items-center gap-1">
          <Salto
            href={aRuta(urlDePagina(params, { page: 1, pageSize: r.tamano }, clave))}
            activo={r.hayAnterior}
            titulo="Primera página"
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden />
          </Salto>
          <Salto
            href={aRuta(urlDePagina(params, { page: r.pagina - 1, pageSize: r.tamano }, clave))}
            activo={r.hayAnterior}
            titulo="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Salto>

          <span className="px-2 text-xs font-medium text-muted-foreground">
            Página {r.pagina} de {r.totalPaginas}
          </span>

          <Salto
            href={aRuta(urlDePagina(params, { page: r.pagina + 1, pageSize: r.tamano }, clave))}
            activo={r.haySiguiente}
            titulo="Página siguiente"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Salto>
          <Salto
            href={aRuta(urlDePagina(params, { page: r.totalPaginas, pageSize: r.tamano }, clave))}
            activo={r.haySiguiente}
            titulo="Última página"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden />
          </Salto>
        </div>
      )}

      {/* Tamaño de página: enlaces, no un <select> con JS. */}
      {(r.total > TAMANOS_PAGINA[0] || r.tamano !== TAMANOS_PAGINA[0]) && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Por página:</span>
          {TAMANOS_PAGINA.map((t) => (
            <Link
              key={t}
              href={aRuta(urlDePagina(params, { page: 1, pageSize: t }, clave))}
              className={cn(
                'rounded-md px-2 py-1 transition-colors',
                t === r.tamano
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'hover:bg-muted hover:text-foreground'
              )}
              aria-current={t === r.tamano ? 'true' : undefined}
            >
              {t}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * La URL vacía significa "primera página, tamaño por defecto, sin filtros".
 * Un <Link href=""> resuelve contra la URL ACTUAL y se queda con su query, así
 * que volver al estado limpio no haría nada. '?' sí la limpia.
 */
const aRuta = (url: string) => url || '?'

/** Botón-enlace de salto; deshabilitado se renderiza como span (no navegable). */
function Salto({
  href,
  activo,
  titulo,
  children,
}: {
  href: string
  activo: boolean
  titulo: string
  children: React.ReactNode
}) {
  const base =
    'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 transition-colors'
  if (!activo) {
    return (
      <span className={cn(base, 'cursor-not-allowed opacity-40')} aria-hidden>
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      className={cn(base, 'text-foreground hover:bg-muted hover:border-primary/40')}
      title={titulo}
      aria-label={titulo}
      scroll={false}
    >
      {children}
    </Link>
  )
}
