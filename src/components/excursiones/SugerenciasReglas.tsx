'use client'

/**
 * Sugerencias de reglas dinámicas predefinidas.
 * Plantillas editables que el usuario puede aceptar, modificar o descartar.
 */

import { useState } from 'react'
import { Sparkles, TrendingUp, TrendingDown, Calendar, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SugerenciaRegla {
  id: string
  nombre: string
  descripcion: string
  icono: React.ReactNode
  color: string
  diasSemana: number[]
  horas: string[]
  calcularPrecios: (base: { adulto: number; nino: number | null; residente: number | null; ninoResidente: number | null }) => {
    precioAdulto: number
    precioNino: string
    precioResidente: string
    precioNinoResidente: string
  }
}

const SUGERENCIAS: SugerenciaRegla[] = [
  {
    id: 'finde',
    nombre: 'Finde más caro',
    descripcion: 'Sábados y domingos +20% sobre la tarifa base',
    icono: <TrendingUp className="h-4 w-4" />,
    color: 'text-orange-600 dark:text-orange-400',
    diasSemana: [6, 7],
    horas: [],
    calcularPrecios: (base) => ({
      precioAdulto: Math.round(base.adulto * 1.2 * 100) / 100,
      precioNino: base.nino != null ? String(Math.round(base.nino * 1.2 * 100) / 100) : '',
      precioResidente: base.residente != null ? String(Math.round(base.residente * 1.2 * 100) / 100) : '',
      precioNinoResidente: base.ninoResidente != null ? String(Math.round(base.ninoResidente * 1.2 * 100) / 100) : '',
    }),
  },
  {
    id: 'happy-hour',
    nombre: 'Happy Hour',
    descripcion: 'Turnos de 10:00-12:00 con -15% de descuento',
    icono: <TrendingDown className="h-4 w-4" />,
    color: 'text-blue-600 dark:text-blue-400',
    diasSemana: [],
    horas: ['10:00', '11:00'],
    calcularPrecios: (base) => ({
      precioAdulto: Math.round(base.adulto * 0.85 * 100) / 100,
      precioNino: base.nino != null ? String(Math.round(base.nino * 0.85 * 100) / 100) : '',
      precioResidente: base.residente != null ? String(Math.round(base.residente * 0.85 * 100) / 100) : '',
      precioNinoResidente: base.ninoResidente != null ? String(Math.round(base.ninoResidente * 0.85 * 100) / 100) : '',
    }),
  },
  {
    id: 'temporada-alta',
    nombre: 'Temporada alta',
    descripcion: 'Lunes a viernes +30% sobre la tarifa base',
    icono: <Calendar className="h-4 w-4" />,
    color: 'text-purple-600 dark:text-purple-400',
    diasSemana: [1, 2, 3, 4, 5],
    horas: [],
    calcularPrecios: (base) => ({
      precioAdulto: Math.round(base.adulto * 1.3 * 100) / 100,
      precioNino: base.nino != null ? String(Math.round(base.nino * 1.3 * 100) / 100) : '',
      precioResidente: base.residente != null ? String(Math.round(base.residente * 1.3 * 100) / 100) : '',
      precioNinoResidente: base.ninoResidente != null ? String(Math.round(base.ninoResidente * 1.3 * 100) / 100) : '',
    }),
  },
]

interface SugerenciasReglasProps {
  precioBaseAdulto: number
  precioBaseNino: number | null
  precioBaseResidente: number | null
  precioBaseNinoResidente: number | null
  horariosDisponibles: string[]
  onAplicar: (regla: {
    diasSemana: number[]
    horas: string[]
    precioAdulto: string
    precioNino: string
    precioResidente: string
    precioNinoResidente: string
  }) => void
}

export function SugerenciasReglas({
  precioBaseAdulto,
  precioBaseNino,
  precioBaseResidente,
  precioBaseNinoResidente,
  horariosDisponibles,
  onAplicar,
}: SugerenciasReglasProps) {
  const [expandido, setExpandido] = useState(false)

  const handleAplicar = (sugerencia: SugerenciaRegla) => {
    const precios = sugerencia.calcularPrecios({
      adulto: precioBaseAdulto,
      nino: precioBaseNino,
      residente: precioBaseResidente,
      ninoResidente: precioBaseNinoResidente,
    })
    onAplicar({
      diasSemana: sugerencia.diasSemana,
      horas: sugerencia.horas.filter((h) => horariosDisponibles.includes(h)),
      precioAdulto: String(precios.precioAdulto),
      precioNino: precios.precioNino,
      precioResidente: precios.precioResidente,
      precioNinoResidente: precios.precioNinoResidente,
    })
  }

  return (
    <div className="rounded-lg border border-primary/15 bg-primary/5 p-2.5">
      <button
        type="button"
        onClick={() => setExpandido(!expandido)}
        className="flex w-full items-center justify-between text-xs font-semibold text-primary"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          Sugerencias rápidas
        </span>
        {expandido ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expandido && (
        <div className="mt-2 space-y-1.5">
          {SUGERENCIAS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleAplicar(s)}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left transition hover:border-primary/40 hover:bg-muted/50"
            >
              <span className={s.color}>{s.icono}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-foreground">{s.nombre}</p>
                <p className="text-[10px] text-muted-foreground truncate">{s.descripcion}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] text-primary">
                Aplicar
              </Button>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
