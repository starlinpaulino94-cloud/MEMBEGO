'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface Punto {
  dia: string
  ventas: number
  entregas: number
}

/**
 * Actividad diaria del periodo: ventas cobradas y entregas sin cobro.
 *
 * Los colores vienen del tema por CLASES (`fill-primary`, `stroke-border`,
 * `currentColor`), no por hexadecimales fijos ni por `var(--…)` metido en un
 * atributo SVG —que no siempre resuelve—. El panel arranca en oscuro y una
 * gráfica con paleta clara quemada se ve como un parche pegado encima.
 */
export function ReporteChart({ data }: { data: Punto[] }) {
  // Con muchos días las etiquetas se pisan: se muestran salteadas.
  const salto = data.length > 45 ? 6 : data.length > 20 ? 2 : 0

  const formateado = data.map((d) => {
    const [, mes, dia] = d.dia.split('-')
    return { ...d, etiqueta: `${dia}/${mes}` }
  })

  return (
    <div className="h-64 w-full text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formateado} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" vertical={false} />
          <XAxis
            dataKey="etiqueta"
            tick={{ fontSize: 11, fill: 'currentColor' }}
            stroke="currentColor"
            interval={salto}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'currentColor' }}
            stroke="currentColor"
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ className: 'fill-muted/40' }}
            wrapperClassName="rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
            contentStyle={{
              background: 'transparent',
              border: 'none',
              borderRadius: 12,
              fontSize: 12,
            }}
            labelClassName="font-semibold text-foreground"
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="ventas" name="Ventas" stackId="a" className="fill-primary" />
          <Bar
            dataKey="entregas"
            name="Entregas sin cobro"
            stackId="a"
            className="fill-success"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
