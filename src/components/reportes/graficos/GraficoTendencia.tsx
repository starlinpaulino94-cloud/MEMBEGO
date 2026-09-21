'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface PuntoTendencia {
  /** `YYYY-MM-DD`, o la etiqueta ya formateada si la granularidad no es diaria. */
  dia: string
  valor: number
  /** El mismo punto del periodo con el que se compara. */
  anterior?: number
}

/**
 * EVOLUCIÓN EN EL TIEMPO, CON SU COMPARACIÓN.
 *
 * Los colores van por CLASES de Tailwind (`fill-chart-1`, `stroke-chart-1`),
 * nunca en hexadecimal ni con `var(--…)` dentro de un atributo SVG —que no
 * siempre resuelve—. El panel arranca en claro pero se puede poner en oscuro, y
 * una gráfica con la paleta quemada se ve como un parche pegado encima.
 *
 * La serie de comparación va PUNTEADA además de en otro color: quien no
 * distingue los dos azules tiene que poder separarlas igual. Es la misma regla
 * que obliga a que un estado no se diga solo con color.
 */
export function GraficoTendencia({
  datos,
  etiqueta,
  etiquetaAnterior = 'Periodo anterior',
  formato,
  alto = 'h-72',
  tipo = 'area',
}: {
  datos: PuntoTendencia[]
  /** Cómo se llama la serie principal («Ingresos», «Canjes»…). */
  etiqueta: string
  etiquetaAnterior?: string
  /** El mismo formateador que usa la tarjeta: dinero con dinero, enteros con enteros. */
  formato: (n: number) => string
  alto?: string
  tipo?: 'area' | 'linea'
}) {
  // Con muchos días las etiquetas se pisan: se muestran salteadas.
  const salto = datos.length > 45 ? 6 : datos.length > 20 ? 2 : 0
  const hayComparacion = datos.some((d) => d.anterior != null)

  const formateado = datos.map((d) => {
    const partes = d.dia.split('-')
    return {
      ...d,
      etiquetaX: partes.length === 3 ? `${partes[2]}/${partes[1]}` : d.dia,
    }
  })

  const ejes = (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" vertical={false} />
      <XAxis
        dataKey="etiquetaX"
        tick={{ fontSize: 12, fill: 'currentColor' }}
        stroke="currentColor"
        interval={salto}
        tickLine={false}
      />
      <YAxis
        tick={{ fontSize: 12, fill: 'currentColor' }}
        stroke="currentColor"
        tickLine={false}
        width={72}
        tickFormatter={(v: number) => formato(v)}
      />
      <Tooltip
        cursor={{ className: 'fill-muted/40' }}
        wrapperClassName="rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        contentStyle={{ background: 'transparent', border: 'none', borderRadius: 12, fontSize: 12 }}
        labelClassName="font-semibold text-foreground"
        formatter={(v: number | string) => formato(Number(v))}
      />
      {hayComparacion && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  )

  return (
    <div className={`${alto} w-full text-muted-foreground`}>
      <ResponsiveContainer width="100%" height="100%">
        {tipo === 'area' ? (
          <AreaChart data={formateado} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              {/* El degradado usa `currentColor` heredado del contenedor teñido,
                  así el relleno sigue al tema sin un hexadecimal escrito. */}
              <linearGradient id="grad-tendencia" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {ejes}
            {hayComparacion && (
              <Area
                type="monotone"
                dataKey="anterior"
                name={etiquetaAnterior}
                className="text-chart-6 stroke-chart-6"
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
            )}
            <Area
              type="monotone"
              dataKey="valor"
              name={etiqueta}
              className="text-chart-1 stroke-chart-1"
              fill="url(#grad-tendencia)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        ) : (
          <AreaChart data={formateado} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            {ejes}
            {hayComparacion && (
              <Line
                type="monotone"
                dataKey="anterior"
                name={etiquetaAnterior}
                className="stroke-chart-6"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="valor"
              name={etiqueta}
              className="stroke-chart-1"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
