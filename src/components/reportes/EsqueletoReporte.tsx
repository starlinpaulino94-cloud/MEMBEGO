import { Skeleton } from '@/components/ui/skeleton'

/**
 * EL REPORTE MIENTRAS CARGA.
 *
 * Había un `loading.tsx` en `/admin`, así que Reportes no salía en blanco: caía
 * en el genérico de seis tarjetas iguales. El problema de ese genérico es que
 * promete una forma que no llega — seis tarjetas en rejilla— y cuando aparece
 * el reporte de verdad TODO se mueve de sitio. Un esqueleto que no calca la
 * página no reduce la espera, la hace más brusca.
 *
 * Por eso este calca la forma real y en su orden: la barra del periodo, la fila
 * de cifras, y los paneles de gráfico con su cabecera. Las consultas de estos
 * reportes son pesadas —agregados sobre varios periodos a la vez—, así que esta
 * pantalla se ve de verdad, no es decoración para un parpadeo.
 *
 * `role="status"` con el texto escondido: quien navega con lector de pantalla
 * oye «cargando el reporte» en vez del silencio de un montón de cajas grises.
 */
export function EsqueletoReporte({
  kpis = 4,
  paneles = 0,
  tablas = 2,
  /** El índice enseña además el mapa de categorías. */
  conNavegacion = false,
}: {
  kpis?: number
  /** Paneles de gráfico. Cinco reportes todavía no tienen ninguno. */
  paneles?: number
  /** Secciones de tabla, que es de lo que están hechos los reportes sin gráfico. */
  tablas?: number
  conNavegacion?: boolean
}) {
  return (
    <div className="space-y-8" role="status" aria-busy="true">
      <span className="sr-only">Cargando el reporte…</span>

      {/* Cabecera: título y periodo */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* La barra del periodo: tres controles y el botón de restablecer */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-44 rounded-lg" />
        <Skeleton className="h-10 w-52 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>

      {conNavegacion && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card p-4">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="mt-2 h-3 w-full" />
            </div>
          ))}
        </div>
      )}

      {/* La fila de cifras: cada tarjeta con su rótulo, su número y su sparkline */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: kpis }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-full" />
          </div>
        ))}
      </div>

      {/* Los paneles de gráfico, con su cabecera de pregunta y periodo. Los
          números de cada pantalla salen de contar la vista real, no de una
          estimación: una prueba los compara para que no se queden atrás. */}
      {Array.from({ length: paneles }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/70 bg-card">
          <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-3 w-28 shrink-0" />
          </div>
          <div className="px-5 py-4">
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      ))}

      {/* Los reportes sin gráfico son cifras y tablas: prometer un panel que no
          llega movería la página entera al aparecer. */}
      {Array.from({ length: tablas }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-80 max-w-full" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 5 }).map((_, f) => (
              <div key={f} className="flex items-center gap-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="ml-auto h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * LAS PANTALLAS DE DETALLE, que no tienen cifras ni gráficos: son pestañas y
 * una tabla larga con su paginación. Calcar el esqueleto del resumen aquí
 * prometería una fila de KPIs que nunca llega.
 */
export function EsqueletoDetalleReporte({ pestanas = 4 }: { pestanas?: number }) {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Cargando el detalle…</span>

      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: pestanas }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-lg" />
        ))}
      </div>

      <div className="rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border/70 bg-muted/50 px-4 py-3">
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="divide-y divide-border/40 px-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-4 w-1/6" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <Skeleton className="h-9 w-56 rounded-lg" />
      </div>
    </div>
  )
}
