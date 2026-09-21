'use client'

export interface FilaRanking {
  nombre: string
  valor: number
  /** Opcional: el mismo dato en el periodo anterior, para la variación. */
  anterior?: number
}

/**
 * QUIÉN VA DELANTE Y POR CUÁNTO.
 *
 * Barras horizontales y no un gráfico de Recharts: para un ranking de pocas
 * filas, una barra CSS se lee igual, pesa cero, **sí se imprime** y el nombre
 * largo de una sucursal no se corta como en un eje. Cuando la lista crece, lo
 * que hace falta es una tabla ordenada, no un dibujo más grande.
 *
 * La barra es una ayuda visual, no el dato: la cifra va siempre escrita al
 * lado, porque una barra sin número no se puede leer en voz alta.
 */
export function GraficoRanking({
  filas,
  formato,
  maximo,
}: {
  filas: FilaRanking[]
  formato: (n: number) => string
  /** Referencia del 100 %. Por defecto, el mayor de la lista. */
  maximo?: number
}) {
  const tope = maximo ?? Math.max(...filas.map((f) => f.valor), 1)

  return (
    <ol className="space-y-2.5">
      {filas.map((f, i) => {
        const ancho = tope === 0 ? 0 : Math.round((f.valor / tope) * 100)
        const variacion =
          f.anterior != null && f.anterior > 0
            ? Math.round(((f.valor - f.anterior) / f.anterior) * 100)
            : null
        return (
          <li key={f.nombre} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3">
            <span className="text-caption tabular-nums" aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0 truncate text-small text-foreground">{f.nombre}</span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className="text-small font-semibold text-foreground">{formato(f.valor)}</span>
              {variacion != null && (
                <span
                  className={`text-caption ${
                    variacion === 0
                      ? 'text-muted-foreground'
                      : variacion > 0
                        ? 'text-success'
                        : 'text-destructive'
                  }`}
                >
                  <span className="sr-only">{variacion > 0 ? 'sube' : 'baja'} </span>
                  {variacion > 0 ? '+' : ''}
                  {variacion} %
                </span>
              )}
            </span>
            {/* La barra ocupa la fila de abajo, a lo ancho de la columna del
                nombre y la cifra: así el texto nunca compite con el dibujo. */}
            <span className="col-start-2 col-end-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-chart-1"
                style={{ width: `${ancho}%` }}
                aria-hidden
              />
            </span>
          </li>
        )
      })}
    </ol>
  )
}
