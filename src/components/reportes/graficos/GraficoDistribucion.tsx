'use client'

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

export interface PorcionDistribucion {
  nombre: string
  valor: number
}

/** Las seis clases de la paleta categórica, en orden. */
const CLASES = [
  'fill-chart-1',
  'fill-chart-2',
  'fill-chart-3',
  'fill-chart-4',
  'fill-chart-5',
  'fill-chart-6',
] as const

/**
 * DE QUÉ SE COMPONE UN TOTAL.
 *
 * Un anillo solo sirve para eso: partes de un todo, y pocas. Con más de seis
 * porciones deja de leerse y la respuesta correcta es una barra ordenada — por
 * eso quien llama agrupa la cola antes de pasar los datos.
 *
 * La leyenda va FUERA del dibujo y lleva el porcentaje escrito. Un anillo donde
 * hay que adivinar la proporción por el ángulo no es un dato, es una
 * decoración; y quien no distingue los colores necesita leer la cifra.
 */
export function GraficoDistribucion({
  datos,
  formato,
  total,
  alto = 'h-64',
}: {
  datos: PorcionDistribucion[]
  formato: (n: number) => string
  /** El total que se reparte; se pinta en el centro del anillo. */
  total: number
  alto?: string
}) {
  const suma = datos.reduce((s, d) => s + d.valor, 0)
  const pct = (n: number) => (suma === 0 ? 0 : Math.round((n / suma) * 100))

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className={`${alto} w-full text-muted-foreground sm:w-1/2`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={datos}
              dataKey="valor"
              nameKey="nombre"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
            >
              {datos.map((d, i) => (
                <Cell key={d.nombre} className={CLASES[i % CLASES.length]} />
              ))}
            </Pie>
            <Tooltip
              wrapperClassName="rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
              contentStyle={{
                background: 'transparent',
                border: 'none',
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(v: number | string, n: string) => [formato(Number(v)), n]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="w-full space-y-1.5 sm:w-1/2">
        <li className="mb-2 border-b border-border/60 pb-2">
          <span className="text-overline">Total</span>
          <span className="block text-h3 tabular-nums text-foreground">{formato(total)}</span>
        </li>
        {datos.map((d, i) => (
          <li key={d.nombre} className="flex items-center gap-2 text-small">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${CLASES[i % CLASES.length].replace('fill-', 'bg-')}`}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-foreground">{d.nombre}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formato(d.valor)}</span>
            <span className="w-10 shrink-0 text-right tabular-nums font-semibold text-foreground">
              {pct(d.valor)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
