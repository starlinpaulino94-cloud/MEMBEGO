import { TrendingDown, TrendingUp } from 'lucide-react'

/**
 * Una cifra del reporte con su comparación contra el periodo anterior.
 *
 * Estaba escrita dentro de `/admin/reportes` y el reporte de plataforma no la
 * tenía en absoluto: sus cuatro tarjetas eran números sueltos. «Ingresos del
 * mes: RD$ 412.000» no dice nada sin el «−18 % frente al mes anterior», que es
 * lo único que convierte un dato en una decisión.
 *
 * `invertido` es para las métricas donde subir es malo (bajas, incidencias):
 * el color sigue al SIGNIFICADO, no al signo.
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
}: {
  label: string
  kpi: KpiValor
  formato: (n: number) => string
  invertido?: boolean
  nota?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 print:border-black print:p-2">
      <p className="text-overline">{label}</p>
      <p className="mt-1.5 truncate text-h1 tabular-nums text-foreground print:text-base print:font-bold">
        {formato(kpi.valor)}
      </p>
      {nota ? <p className="mt-1 text-xs text-muted-foreground">{nota}</p> : <Variacion kpi={kpi} invertido={invertido} />}
    </div>
  )
}

function Variacion({ kpi, invertido }: { kpi: KpiValor; invertido: boolean }) {
  if (kpi.variacion == null) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {kpi.anterior === 0 && kpi.valor > 0 ? 'primer periodo con datos' : 'sin datos antes'}
      </p>
    )
  }
  const sube = kpi.variacion > 0
  const bueno = invertido ? !sube : sube
  const Icono = sube ? TrendingUp : TrendingDown
  const texto = `${sube ? '+' : ''}${kpi.variacion}% vs. periodo anterior`
  return (
    <p
      className={`mt-1 flex items-center gap-1 text-xs ${
        kpi.variacion === 0 ? 'text-muted-foreground' : bueno ? 'text-success' : 'text-destructive'
      }`}
    >
      <Icono className="h-3.5 w-3.5" aria-hidden />
      {/* El color no puede ser la única señal de si esto es bueno o malo: quien
          no distingue verde de rojo ve «+12 %» y nada más. */}
      <span className="sr-only">
        {kpi.variacion === 0 ? 'sin cambio' : bueno ? 'mejora:' : 'empeora:'}{' '}
      </span>
      {texto}
    </p>
  )
}
