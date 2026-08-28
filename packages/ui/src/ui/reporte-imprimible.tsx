import { cn } from '../cn'

/**
 * REPORTE IMPRIMIBLE — un solo `@media print` para todo el panel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Había cinco bloques `@media print` escritos a mano, cada uno con su propia
 * variante de `body * { visibility: hidden }` y su propio nombre de clase
 * (`.registros-print`, `.seguimiento-print`…). Copiar un truco de CSS cinco
 * veces tiene una consecuencia concreta: el sexto reporte que alguien quiera
 * imprimir se escribe mal, y los cinco anteriores no se arreglan a la vez
 * cuando se descubre el fallo. Aquí está una sola vez.
 *
 * QUÉ NO CUBRE, A PROPÓSITO: los tickets de 80 mm (recibos de caja,
 * comprobantes del escáner, facturas). Eso no es un reporte en A4 con
 * cabecera y tablas, es papel térmico de rollo continuo con su propio ancho,
 * su propia tipografía y su propia lógica de reimpresión. Meterlos aquí sería
 * unificar dos cosas que solo se parecen en que salen por una impresora.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE USA
 *
 *     <ReporteImprimible
 *       titulo="Reportes de la plataforma"
 *       subtitulo="Mayo 2026 · todas las empresas"
 *       controles={<BotonImprimir />}
 *     >
 *       …contenido…
 *     </ReporteImprimible>
 *
 * En pantalla se ve todo. En papel se ve SOLO lo de dentro, sin el menú
 * lateral ni la cabecera del panel, y sin lo que lleve `print:hidden`
 * (los `controles` ya lo llevan).
 *
 * Guardar como PDF es el mismo botón: el diálogo del navegador ofrece
 * «Guardar como PDF» en todos los sistemas. No hace falta una librería de PDF
 * en el servidor para eso, y no tenerla evita cargar el despliegue con una
 * dependencia pesada para resolver algo que el sistema operativo ya hace.
 */

/** Clase que marca la región imprimible. Pública para casos a medida. */
export const CLASE_IMPRIMIBLE = 'membego-imprimible'

/**
 * `visibility` y no `display`: ocultando con `display: none` el navegador
 * recalcula el layout de toda la página antes de imprimir, y los elementos
 * medidos en tiempo de pintado —gráficas, contenedores responsivos— salen en
 * blanco. Con `visibility` el layout se conserva y solo se deja de pintar.
 *
 * El `position: absolute` sobre la región es lo que la despega del hueco que
 * ocupaba dentro del panel; sin él, la primera página sale en blanco hasta
 * donde llegaba el menú lateral.
 */
const ESTILOS = `
@media print {
  @page { margin: 14mm; size: A4; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  .${CLASE_IMPRIMIBLE}, .${CLASE_IMPRIMIBLE} * { visibility: visible !important; }
  .${CLASE_IMPRIMIBLE} {
    /* display explícito para el modo soloPapel, que en pantalla está oculto
       con "hidden" y solo existe en la hoja. */
    display: block !important;
    position: absolute !important;
    left: 0; top: 0; width: 100%;
    color: #000 !important;
    background: #fff !important;
  }
  .${CLASE_IMPRIMIBLE} .print\\:hidden,
  .${CLASE_IMPRIMIBLE} .print\\:hidden * { display: none !important; }
  /* Una tabla partida por la mitad entre dos hojas es ilegible. */
  .${CLASE_IMPRIMIBLE} table { page-break-inside: auto; border-collapse: collapse; width: 100%; }
  .${CLASE_IMPRIMIBLE} tr, .${CLASE_IMPRIMIBLE} li { page-break-inside: avoid; }
  .${CLASE_IMPRIMIBLE} thead { display: table-header-group; }
  .${CLASE_IMPRIMIBLE} h1, .${CLASE_IMPRIMIBLE} h2, .${CLASE_IMPRIMIBLE} h3 { page-break-after: avoid; }
  /* Los enlaces en papel son texto: subrayarlos en azul solo confunde. */
  .${CLASE_IMPRIMIBLE} a { color: #000 !important; text-decoration: none !important; }
}
`

export interface ReporteImprimibleProps {
  titulo: string
  /** Periodo, empresa, alcance: lo que hace falta para no confundir dos copias. */
  subtitulo?: string
  /**
   * Cuándo se generó. Va SIEMPRE en el papel: una hoja impresa sobrevive al
   * dato que la produjo, y sin fecha no hay forma de saber si la que está
   * encima de la mesa es de esta semana o del trimestre pasado.
   */
  generadoEn?: string
  /** Botones (imprimir, exportar). No salen en papel. */
  controles?: React.ReactNode
  /** Pie del papel: notas metodológicas, avisos de recorte. */
  pie?: React.ReactNode
  /**
   * Solo existe en la hoja: en pantalla no se ve nada.
   *
   * Para las pantallas que necesitan una versión DISTINTA en papel. El caso que
   * lo motiva es Registros: su tabla en pantalla tiene nueve columnas y 860 px
   * de ancho mínimo, que en A4 sale cortada. La versión impresa lleva siete
   * columnas y letra pequeña. No es duplicación gratuita — es que el papel
   * tiene un ancho fijo y la pantalla no.
   */
  soloPapel?: boolean
  children: React.ReactNode
  className?: string
}

export function ReporteImprimible({
  titulo,
  subtitulo,
  generadoEn,
  controles,
  pie,
  soloPapel = false,
  children,
  className,
}: ReporteImprimibleProps) {
  return (
    <div
      className={cn(
        CLASE_IMPRIMIBLE,
        soloPapel ? 'hidden' : 'space-y-6 print:space-y-4',
        className
      )}
      aria-hidden={soloPapel || undefined}
    >
      <style>{ESTILOS}</style>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-h1 text-balance text-foreground print:text-lg print:font-bold">
            {titulo}
          </h1>
          {subtitulo && (
            <p className="mt-1.5 text-small text-muted-foreground print:text-xs">{subtitulo}</p>
          )}
          {/* Solo en papel: en pantalla la fecha de generación es ruido,
              porque lo que se ve es siempre lo de ahora mismo. En modo
              `soloPapel` el bloque entero ya es de papel. */}
          {generadoEn && (
            <p className={soloPapel ? 'text-xs' : 'hidden text-xs print:mt-0.5 print:block'}>
              Generado el {generadoEn}
            </p>
          )}
        </div>
        {controles && (
          <div className="print:hidden flex shrink-0 flex-wrap items-center gap-2">{controles}</div>
        )}
      </div>

      {children}

      {pie && <div className="text-caption text-muted-foreground print:text-xs">{pie}</div>}
    </div>
  )
}

/**
 * Tabla de un reporte, con la semántica que la pantalla venía negándole.
 *
 * Los desgloses («activas por plan», «cómo pagaron») estaban escritos como
 * `<ul>` con `flex justify-between`. Se ven bien y son datos tabulares: un
 * lector de pantalla los lee como una lista de frases sueltas sin relación
 * entre la etiqueta y el número, y en papel una fila de 380 px deja dos
 * tercios de la hoja en blanco.
 *
 * `alinearDerecha` marca las columnas numéricas, que además reciben
 * `tabular-nums`: sin eso las cifras no alinean por unidades y una columna de
 * montos deja de poder leerse en vertical.
 */
export interface TablaReporteProps {
  columnas: { clave: string; titulo: string; alinearDerecha?: boolean }[]
  /** `__clave` es la key de React; el índice solo sirve si no la hay. */
  filas: (Record<string, React.ReactNode> & { __clave?: string })[]
  /** Nombre accesible de la tabla. Se ve en papel, se oculta en pantalla. */
  titulo?: string
  /** Fila de totales, con el mismo orden de columnas. */
  total?: Record<string, React.ReactNode>
  vacio?: string
  className?: string
}

export function TablaReporte({
  columnas,
  filas,
  titulo,
  total,
  vacio = 'Sin datos en este periodo.',
  className,
}: TablaReporteProps) {
  if (filas.length === 0) {
    return <p className="text-sm text-muted-foreground">{vacio}</p>
  }
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm print:text-xs">
        {titulo && (
          <caption className="sr-only text-left print:not-sr-only print:mb-1 print:font-bold">
            {titulo}
          </caption>
        )}
        <thead>
          <tr className="border-b border-border text-left print:border-black">
            {columnas.map((c) => (
              <th
                key={c.clave}
                scope="col"
                className={cn(
                  'py-2 pr-3 text-overline font-semibold print:py-1 print:text-xs',
                  c.alinearDerecha && 'pr-0 text-right'
                )}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.__clave ?? i} className="border-b border-border/50">
              {columnas.map((c) => (
                <td
                  key={c.clave}
                  className={cn(
                    'py-2 pr-3 text-foreground print:py-0.5',
                    c.alinearDerecha && 'pr-0 text-right tabular-nums'
                  )}
                >
                  {f[c.clave]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="border-t-2 border-border font-semibold print:border-black">
              {columnas.map((c) => (
                <td
                  key={c.clave}
                  className={cn(
                    'py-2 pr-3 text-foreground print:py-0.5',
                    c.alinearDerecha && 'pr-0 text-right tabular-nums'
                  )}
                >
                  {total[c.clave]}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
