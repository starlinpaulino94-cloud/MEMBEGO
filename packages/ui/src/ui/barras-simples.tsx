import { cn } from '../cn'

interface BarrasSimplesProps {
  /** Nombre de la gráfica: lo lee el lector de pantalla y encabeza la tabla alternativa. */
  titulo: string
  /** Una palabra para lo que se cuenta: «canjes», «registros». Va en el eje, en el `title` de cada barra y en la tabla. */
  unidad: string
  valores: readonly number[]
  /** Una etiqueta por valor, del mismo largo que `valores` (si no, se usa el más corto). */
  etiquetas: readonly string[]
  /** Cada cuántas barras se escribe su etiqueta. Por defecto, las que hagan falta para que quepan (≈ 7). */
  etiquetasCada?: number
  /** Texto cuando no hay un solo dato. La gráfica vacía NO se pinta con barras de altura cero (02 · U-02). */
  vacio?: string
  /** Cómo escribir un valor (por defecto, separador de miles). Dinero: pasa tu formateador. */
  formato?: (valor: number) => string
  className?: string
}

const ALTO = 'h-40'

/**
 * Gráfica de barras SIMPLE y accesible del panel (docs/auditoria-admin/05 · D-13 y 10 §7).
 *
 * Lo que las «barras `div` sin eje» de hoy no tienen y esta sí:
 *   · Un eje con valores (0, la mitad, el tope) y líneas de guía.
 *   · El valor del pico escrito sobre la barra.
 *   · Una alternativa accesible: nombre completo en `aria-label` y la tabla de datos tras «Ver como tabla».
 *   · Un mensaje cuando no hay datos, en vez de un eje vacío.
 *
 * Está hecha con HTML y CSS, no con un SVG escalado: el texto mide siempre 12 px reales y no se encoge en un móvil. De
 * SERVIDOR (sin JavaScript). Para series largas o interactivas, `ReporteChart` (Recharts, cargado de forma diferida).
 */
export function BarrasSimples({
  titulo,
  unidad,
  valores,
  etiquetas,
  etiquetasCada,
  vacio = 'Sin datos en este periodo',
  formato = (v) => v.toLocaleString('es-DO'),
  className,
}: BarrasSimplesProps) {
  const n = Math.min(valores.length, etiquetas.length)
  const datos = valores.slice(0, n)
  const nombres = etiquetas.slice(0, n)

  if (n === 0 || datos.every((v) => !(v > 0))) {
    return (
      <p data-slot="barras-simples" className={cn('rounded-xl border border-dashed border-border px-4 py-8 text-center text-small text-muted-foreground', className)}>
        {vacio}
      </p>
    )
  }

  const max = Math.max(...datos)
  // Un tope múltiplo de 4: la mitad del eje es siempre un entero (0 · 8 · 16, nunca 0 · 7,5 · 15).
  const tope = Math.max(4, Math.ceil(max / 4) * 4)
  const cada = Math.max(1, etiquetasCada ?? Math.ceil(n / 7))
  const iPico = datos.indexOf(max)
  const resumen = datos.map((v, i) => `${nombres[i]} ${formato(v)}`).join(', ')

  return (
    <figure data-slot="barras-simples" className={cn('m-0 grid gap-2', className)}>
      <figcaption className="sr-only">{titulo}</figcaption>
      <div role="img" aria-label={`${titulo}: ${resumen}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div aria-hidden className={cn('flex flex-col justify-between pb-px text-right text-caption tabular-nums text-muted-foreground', ALTO)}>
          <span>{formato(tope)}</span>
          <span>{formato(tope / 2)}</span>
          <span>0</span>
        </div>
        <div className={cn('relative border-b border-border', ALTO)}>
          <div aria-hidden className="absolute inset-x-0 top-0 border-t border-border/60" />
          <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/60" />
          <div className="absolute inset-0 flex items-end gap-1">
            {datos.map((v, i) => (
              <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${nombres[i]}: ${formato(v)} ${unidad}`}>
                {i === iPico && <span className="mb-0.5 text-caption font-medium tabular-nums text-foreground">{formato(v)}</span>}
                <div
                  className={cn('w-full rounded-t-lg', i === iPico ? 'bg-primary' : 'bg-primary/70')}
                  style={{ height: `${(v / tope) * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <span aria-hidden />
        <div aria-hidden className="mt-1 flex gap-1">
          {nombres.map((nombre, i) => (
            <span key={i} className="min-w-0 flex-1 truncate text-center text-caption tabular-nums text-muted-foreground">
              {i % cada === 0 ? nombre : ''}
            </span>
          ))}
        </div>
      </div>
      <details className="text-small">
        <summary className="cursor-pointer font-medium text-primary">Ver como tabla</summary>
        <div className="mt-2 overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-small">
            <caption className="sr-only">{titulo}</caption>
            <thead>
              <tr className="bg-muted/60">
                <th scope="col" className="px-3 py-2 text-left text-overline text-muted-foreground">
                  Periodo
                </th>
                <th scope="col" className="px-3 py-2 text-right text-overline text-muted-foreground">
                  {unidad}
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.map((v, i) => (
                <tr key={i} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {nombres[i]}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{formato(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
