'use client'

/**
 * Mini-calendario mensual de vista previa de precios efectivos.
 * Muestra el precio por día, coloreado según si aplica regla dinámica o base.
 * Hover con desglose de la regla aplicable.
 */

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ReglaCalendario {
  diasSemana: number[]
  horasSalida: string[]
  precioAdulto: number
  precioNino: number | null
  precioResidente: number | null
  precioNinoResidente: number | null
}

interface CalendarioPreviewPreciosProps {
  reglas: ReglaCalendario[]
  precioBaseAdulto: number
  precioBaseNino: number | null
  precioBaseResidente: number | null
  precioBaseNinoResidente: number | null
  moneda: string
}

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function obtenerDiaSemanaISO(fecha: Date): number {
  const jsDay = fecha.getDay() // 0=Dom, 1=Lun...
  return jsDay === 0 ? 7 : jsDay // ISO: 1=Lun, 7=Dom
}

function buscarReglaAplicable(
  diaSemana: number,
  reglas: ReglaCalendario[]
): ReglaCalendario | null {
  for (const regla of reglas) {
    if (regla.diasSemana.includes(diaSemana)) {
      return regla
    }
  }
  return null
}

export function CalendarioPreviewPrecios({
  reglas,
  precioBaseAdulto,
  precioBaseNino,
  precioBaseResidente,
  precioBaseNinoResidente,
  moneda,
}: CalendarioPreviewPreciosProps) {
  const [mesActual, setMesActual] = useState(() => new Date())
  const [diaHover, setDiaHover] = useState<Date | null>(null)

  const anio = mesActual.getFullYear()
  const mes = mesActual.getMonth()

  const diasDelMes = useMemo(() => {
    const primerDia = new Date(anio, mes, 1)
    const ultimoDia = new Date(anio, mes + 1, 0)
    const dias: { fecha: Date; diaMes: number; diaSemana: number }[] = []

    // Rellenar días vacíos al inicio (ISO: Lun=1)
    const diaSemanaInicio = obtenerDiaSemanaISO(primerDia)
    for (let i = 1; i < diaSemanaInicio; i++) {
      const fecha = new Date(anio, mes, 1 - (diaSemanaInicio - i))
      dias.push({ fecha, diaMes: fecha.getDate(), diaSemana: obtenerDiaSemanaISO(fecha) })
    }

    // Días del mes
    for (let d = 1; d <= ultimoDia.getDate(); d++) {
      const fecha = new Date(anio, mes, d)
      dias.push({ fecha, diaMes: d, diaSemana: obtenerDiaSemanaISO(fecha) })
    }

    return dias
  }, [anio, mes])

  const navegarMes = (delta: number) => {
    setMesActual((prev) => {
      const nueva = new Date(prev)
      nueva.setMonth(nueva.getMonth() + delta)
      return nueva
    })
  }

  const datosHover = useMemo(() => {
    if (!diaHover) return null
    const diaSemana = obtenerDiaSemanaISO(diaHover)
    const regla = buscarReglaAplicable(diaSemana, reglas)
    return {
      fecha: diaHover,
      diaSemana,
      regla,
      precioAdulto: regla?.precioAdulto ?? precioBaseAdulto,
      precioNino: regla?.precioNino ?? precioBaseNino,
      precioResidente: regla?.precioResidente ?? precioBaseResidente,
      precioNinoResidente: regla?.precioNinoResidente ?? precioBaseNinoResidente,
    }
  }, [diaHover, reglas, precioBaseAdulto, precioBaseNino, precioBaseResidente, precioBaseNinoResidente])

  const formatearMoneda = (valor: number | null) => {
    if (valor == null) return '—'
    if (valor === 0) return 'Gratis'
    return `${moneda} $${valor.toFixed(2)}`
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => navegarMes(-1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs font-semibold text-foreground">
          {MESES[mes]} {anio}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => navegarMes(1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px text-center">
        {DIAS_CORTOS.map((d) => (
          <div key={d} className="text-xs font-semibold text-muted-foreground py-0.5">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px">
        {diasDelMes.map((d, i) => {
          const esMesActual = d.fecha.getMonth() === mes
          const regla = esMesActual ? buscarReglaAplicable(d.diaSemana, reglas) : null
          const tieneRegla = regla !== null
          const esHoy = d.fecha.toDateString() === new Date().toDateString()

          return (
            <div
              key={i}
              className={`relative aspect-square flex flex-col items-center justify-center rounded text-xs transition
                ${!esMesActual ? 'text-muted-foreground/30' : ''}
                ${esMesActual && tieneRegla ? 'bg-primary/15 text-primary font-semibold' : ''}
                ${esMesActual && !tieneRegla ? 'text-foreground' : ''}
                ${esHoy ? 'ring-1 ring-primary/50' : ''}
              `}
              onMouseEnter={() => esMesActual && setDiaHover(d.fecha)}
              onMouseLeave={() => setDiaHover(null)}
            >
              <span>{d.diaMes}</span>
              {esMesActual && tieneRegla && (
                <span className="text-xs leading-none text-primary/70">
                  {formatearMoneda(regla.precioAdulto)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {datosHover && (
        <div className="rounded-lg border border-border bg-muted/50 p-2 text-xs space-y-1">
          <p className="font-semibold text-foreground">
            {datosHover.fecha.toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {datosHover.regla ? (
            <>
              <p className="text-primary font-medium">Regla dinámica aplicable</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                <span>Ad. Turista:</span>
                <span className="font-medium text-foreground">{formatearMoneda(datosHover.precioAdulto)}</span>
                {datosHover.precioNino != null && (
                  <>
                    <span>Niño Turista:</span>
                    <span className="font-medium text-foreground">{formatearMoneda(datosHover.precioNino)}</span>
                  </>
                )}
                {datosHover.precioResidente != null && (
                  <>
                    <span>Ad. Residente:</span>
                    <span className="font-medium text-foreground">{formatearMoneda(datosHover.precioResidente)}</span>
                  </>
                )}
                {datosHover.precioNinoResidente != null && (
                  <>
                    <span>Niño Residente:</span>
                    <span className="font-medium text-foreground">{formatearMoneda(datosHover.precioNinoResidente)}</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">Sin regla dinámica</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                <span>Ad. Turista:</span>
                <span className="font-medium text-foreground">{formatearMoneda(datosHover.precioAdulto)}</span>
                {datosHover.precioNino != null && (
                  <>
                    <span>Niño Turista:</span>
                    <span className="font-medium text-foreground">{formatearMoneda(datosHover.precioNino)}</span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded bg-primary/15" /> Con regla
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded bg-muted" /> Tarifa base
        </span>
      </div>
    </div>
  )
}
