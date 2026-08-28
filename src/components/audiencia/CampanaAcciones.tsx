'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Play, CalendarClock, Pause, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  programarCampanaAction,
  activarCampanaAction,
  pausarCampanaAction,
  finalizarCampanaAction,
  type ActionState,
} from '@/modules/geo/segmentacion/actions'
import type { Estimacion } from '@/modules/geo/segmentacion/estimador'

/**
 * Acciones de estado de una campaña dirigida (programar → activar → pausar /
 * finalizar). Cada una re-evalúa la audiencia: si queda bajo el umbral mínimo,
 * la acción se bloquea y el error se muestra aquí.
 */

export default function CampanaAcciones({
  campanaId,
  estado,
}: {
  campanaId: string
  estado: string
}) {
  const router = useRouter()
  const [cargando, setCargando] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ActionState | null>(null)

  async function ejecutar(tipo: string, fn: (fd: FormData) => Promise<ActionState>) {
    setCargando(tipo)
    setResultado(null)
    const fd = new FormData()
    fd.set('campanaId', campanaId)
    const r = await fn(fd)
    setCargando(null)
    setResultado(r)
    if (r.success) {
      toast.success(tipo === 'PROGRAMAR' ? 'Campaña programada.' : tipo === 'ACTIVAR' ? 'Campaña activada.' : tipo === 'PAUSAR' ? 'Campaña pausada.' : 'Campaña finalizada.')
      router.refresh()
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(estado === 'BORRADOR' || estado === 'PROGRAMADA') && (
          <Button
            type="button"
            disabled={cargando !== null}
            onClick={() => ejecutar('PROGRAMAR', (fd) => programarCampanaAction({}, fd))}
          >
            {cargando === 'PROGRAMAR' && <Loader2 className="h-4 w-4 animate-spin" />}
            <CalendarClock className="h-4 w-4" /> Programar
          </Button>
        )}
        {(estado === 'BORRADOR' || estado === 'PROGRAMADA' || estado === 'PAUSADA') && (
          <Button
            type="button"
            disabled={cargando !== null}
            onClick={() => ejecutar('ACTIVAR', (fd) => activarCampanaAction({}, fd))}
          >
            {cargando === 'ACTIVAR' && <Loader2 className="h-4 w-4 animate-spin" />}
            <Play className="h-4 w-4" /> Activar y enviar
          </Button>
        )}
        {(estado === 'ACTIVA' || estado === 'PROGRAMADA') && (
          <Button
            type="button"
            variant="outline"
            disabled={cargando !== null}
            onClick={() => ejecutar('PAUSAR', (fd) => pausarCampanaAction({}, fd))}
          >
            <Pause className="h-4 w-4" /> Pausar
          </Button>
        )}
        {(estado === 'ACTIVA' || estado === 'PAUSADA' || estado === 'PROGRAMADA') && (
          <Button
            type="button"
            variant="ghost"
            disabled={cargando !== null}
            onClick={() => ejecutar('FINALIZAR', (fd) => finalizarCampanaAction({}, fd))}
          >
            <Flag className="h-4 w-4" /> Finalizar
          </Button>
        )}
      </div>

      {resultado?.error && (
        <p className="text-sm font-medium text-destructive">{resultado.error}</p>
      )}
      {resultado?.success && resultado.estimacion && (
        <ResultadoEstimacion estimacion={resultado.estimacion} />
      )}
    </div>
  )
}

function ResultadoEstimacion({ estimacion }: { estimacion: Estimacion }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="font-semibold">Audiencia confirmada: {estimacion.totalElegibles} clientes</div>
      {estimacion.sinConsentimiento > 0 && (
        <p className="text-muted-foreground">
          {estimacion.sinConsentimiento} excluidos por no tener consentimiento.
        </p>
      )}
      {estimacion.advertencias.map((a, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {a}
        </p>
      ))}
    </div>
  )
}
