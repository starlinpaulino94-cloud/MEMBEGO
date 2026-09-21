import Link from 'next/link'
import { ArrowRight, Info, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Sparkline } from '@/components/reportes/graficos/Sparkline'

/**
 * Una cifra del reporte con su comparación contra el periodo anterior.
 *
 * Estaba escrita dentro de `/admin/reportes` y el reporte de plataforma no la
 * tenía en absoluto: sus cuatro tarjetas eran números sueltos. «Ingresos del
 * mes: RD$ 412.000» no dice nada sin el «−18 % frente al mes anterior», que es
 * lo único que convierte un dato en una decisión.
 *
 * `invertido` es para las métricas donde subir es malo (bajas, incidencias):
 * el color sigue al SIGNIFICADO, no al signo. Una caída de cancelaciones es
 * una buena noticia y se pinta como tal.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LO QUE SE LE AÑADIÓ, Y POR QUÉ
 *
 * La tarjeta decía «RD$248.540 · +14,8 %» y ahí se acababa. Tres cosas que
 * faltaban para que una cifra sirva para decidir:
 *
 *  · CONTRA QUÉ. El porcentaje sin el valor anterior obliga a calcular de
 *    cabeza cuánto es en dinero. Ahora se enseña el «vs. RD$216.510» y, cuando
 *    ayuda, la diferencia absoluta.
 *  · QUÉ FORMA TIENE. Un −12 % después de tres semanas subiendo no es lo mismo
 *    que un −12 % de una caída sostenida, y la cifra sola no los distingue.
 *  · QUÉ SIGNIFICA EXACTAMENTE. Una métrica sin definición se interpreta, y dos
 *    personas la interpretan distinto en la misma reunión.
 *
 * Y una que faltaba para poder investigar: un KPI que no se puede abrir
 * obliga a creerse el número. Con `href`, la tarjeta es la puerta al reporte
 * que lo explica.
 *
 * Todo es OPCIONAL: las siete pantallas que ya la usaban siguen igual.
 */
export interface KpiValor {
  valor: number
  anterior: number
  /** Porcentaje contra el periodo anterior; `null` si antes no hubo nada. */
  variacion: number | null
}

export function KpiReporte({
  label,
  kpi,
  formato,
  invertido = false,
  /** Métricas que son una foto de hoy y no dependen del periodo. */
  nota,
  definicion,
  serie,
  href,
  hrefLabel = 'Ver reporte',
}: {
  label: string
  /** `null` = quien mira no tiene permiso para esta cifra. */
  kpi: KpiValor | null
  formato: (n: number) => string
  invertido?: boolean
  nota?: string
  /**
   * Qué mide exactamente esta cifra. Sale como ayuda al pasar el ratón y como
   * texto accesible; no es decoración, es lo que evita que dos personas
   * entiendan cosas distintas del mismo número en la misma reunión.
   */
  definicion?: string
  /** La serie del periodo, para la forma. Con menos de tres puntos no se pinta. */
  serie?: number[]
  /** A dónde lleva investigar esta cifra. */
  href?: string
  hrefLabel?: string
}) {
  // Sin permiso NO se pinta un cero. Un cero afirma que el negocio no facturó,
  // y eso es una mentira sobre el negocio, no una restricción sobre quien mira.
  if (!kpi) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-5 print:border-black print:p-2">
        <p className="text-overline">{label}</p>
        <p className="mt-1.5 truncate text-h3 text-muted-foreground print:text-base">Sin permiso</p>
        <p className="mt-1 text-xs text-muted-foreground">Pídelo a quien administra el negocio</p>
      </div>
    )
  }

  const sube = kpi.variacion != null && kpi.variacion > 0
  const tono: 'bueno' | 'malo' | 'neutro' =
    kpi.variacion == null || kpi.variacion === 0
      ? 'neutro'
      : (invertido ? !sube : sube)
        ? 'bueno'
        : 'malo'

  const cuerpo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-overline">{label}</p>
        {definicion && (
          <span
            className="shrink-0 text-muted-foreground print:hidden"
            title={definicion}
            aria-label={`Qué mide: ${definicion}`}
            role="img"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-h1 tabular-nums text-foreground print:text-base print:font-bold">
        {formato(kpi.valor)}
      </p>
      {nota ? (
        <p className="mt-1 text-xs text-muted-foreground">{nota}</p>
      ) : (
        <Variacion kpi={kpi} invertido={invertido} formato={formato} />
      )}
      {serie && serie.length >= 3 && (
        <div className="mt-2.5">
          <Sparkline datos={serie} tono={tono} />
        </div>
      )}
      {href && (
        <span className="mt-2 inline-flex items-center gap-1 text-caption text-primary print:hidden">
          {hrefLabel}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </span>
      )}
    </>
  )

  const clases =
    'block rounded-xl border border-border bg-card p-5 text-left print:border-black print:p-2'

  // Con destino, la tarjeta ENTERA es el enlace: un objetivo grande se pulsa
  // bien con el pulgar y el foco del teclado cae una sola vez, en vez de
  // obligar a tabular hasta un «ver más» diminuto de la esquina.
  if (href) {
    return (
      <Link
        href={href}
        className={`${clases} transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        {cuerpo}
      </Link>
    )
  }

  return <div className={clases}>{cuerpo}</div>
}

function Variacion({
  kpi,
  invertido,
  formato,
}: {
  kpi: KpiValor
  invertido: boolean
  formato: (n: number) => string
}) {
  if (kpi.variacion == null) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {kpi.anterior === 0 && kpi.valor > 0 ? 'primer periodo con datos' : 'sin datos antes'}
      </p>
    )
  }
  const sube = kpi.variacion > 0
  const bueno = invertido ? !sube : sube
  const plano = kpi.variacion === 0
  // Estable tiene su propio icono: con la flecha hacia abajo, un 0 % se leía
  // como una caída pequeña.
  const Icono = plano ? Minus : sube ? TrendingUp : TrendingDown
  return (
    <>
      <p
        className={`mt-1 flex items-center gap-1 text-xs ${
          plano ? 'text-muted-foreground' : bueno ? 'text-success' : 'text-destructive'
        }`}
      >
        <Icono className="h-3.5 w-3.5" aria-hidden />
        {/* El color no puede ser la única señal de si esto es bueno o malo: quien
            no distingue verde de rojo ve «+12 %» y nada más. */}
        <span className="sr-only">{plano ? 'sin cambio:' : bueno ? 'mejora:' : 'empeora:'} </span>
        <span className="tabular-nums">
          {sube ? '+' : ''}
          {kpi.variacion} %
        </span>
      </p>
      {/* Contra QUÉ. El porcentaje solo obliga a calcular de cabeza cuánto es
          eso en dinero o en operaciones. */}
      <p className="mt-0.5 text-caption tabular-nums">vs. {formato(kpi.anterior)} antes</p>
    </>
  )
}
