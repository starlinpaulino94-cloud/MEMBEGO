import type { ReactNode } from 'react'

/**
 * EL MARCO DE TODO GRÁFICO DE REPORTES.
 *
 * Existe por una razón concreta: en este panel **los gráficos no imprimen**.
 * `ResponsiveContainer` de Recharts mide el contenedor al pintar, y en la hoja
 * no hay contenedor que medir — sale un hueco en blanco. Hasta ahora cada vista
 * se acordaba (o no) de pintar además una tabla equivalente; aquí la regla deja
 * de depender de la memoria de quien escribe la pantalla: **el marco exige las
 * dos piezas**, el gráfico para la pantalla y la tabla para el papel.
 *
 * Esa tabla no es solo para imprimir. Es la alternativa textual de un lector de
 * pantalla y la respuesta a «¿puedo ver los datos?» sin salir del reporte, así
 * que también se puede desplegar en pantalla.
 *
 * El resto del marco es lo que convierte un dibujo en una respuesta: qué
 * pregunta contesta, de qué periodo, y a dónde ir si quieres el detalle.
 */
export function PanelGrafico({
  titulo,
  pregunta,
  periodo,
  grafico,
  tabla,
  accion,
  nota,
  className = '',
}: {
  titulo: string
  /** La pregunta de negocio que este gráfico responde. Si no hay, sobra el gráfico. */
  pregunta?: string
  /** El periodo que se está mirando, para que la hoja impresa se defienda sola. */
  periodo?: string
  grafico: ReactNode
  /** Los MISMOS datos en tabla: alternativa textual y versión para papel. */
  tabla: ReactNode
  /** Enlace al reporte que profundiza en esto. */
  accion?: ReactNode
  nota?: string
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-border/70 bg-card ${className}`}
      aria-label={titulo}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-h3 text-foreground">{titulo}</h3>
          {pregunta && <p className="mt-0.5 text-caption">{pregunta}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {periodo && <span className="text-caption tabular-nums">{periodo}</span>}
          {accion && <div className="print:hidden">{accion}</div>}
        </div>
      </header>

      {/* El gráfico NO va a la hoja: ahí va la tabla de abajo. */}
      <div className="px-2 py-4 print:hidden sm:px-4">{grafico}</div>

      {/* En pantalla se despliega a petición; en papel está siempre.
          `open` en print lo fuerza abierto porque un <details> cerrado no
          imprime su contenido. */}
      <details className="group border-t border-border/60 print:block print:border-0" open={false}>
        <summary className="cursor-pointer list-none px-5 py-2.5 text-caption text-primary hover:underline print:hidden">
          Ver los datos de este gráfico
        </summary>
        <div className="px-5 pb-4 print:px-0 print:pb-0">{tabla}</div>
      </details>

      {nota && <p className="px-5 pb-4 text-caption">{nota}</p>}
    </section>
  )
}
