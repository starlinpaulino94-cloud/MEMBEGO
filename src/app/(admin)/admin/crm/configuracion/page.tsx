'use client'

import { useState } from 'react'
import { Settings, Workflow, Zap, Lock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const verticals = [
  { id: 'carwash', name: 'Carwash', stages: ['Nuevo', 'Contactado', 'Cotización', 'Negociación', 'Cerrado'] },
  { id: 'restaurante', name: 'Restaurante', stages: ['Nuevo', 'Contactado', 'Reserva', 'Fidelización', 'Cerrado'] },
  { id: 'gym', name: 'Gimnasio', stages: ['Nuevo', 'Contactado', 'Clase Trial', 'Inscripción', 'Cerrado'] },
  { id: 'barberia', name: 'Barbería', stages: ['Nuevo', 'Contactado', 'Primera Visita', 'Recurrente', 'Cerrado'] },
]

const automatizaciones = [
  { id: 'bienvenida', label: 'Mensaje de bienvenida', descripcion: 'Envía un saludo cuando un lead entra al pipeline' },
  { id: 'recordatorio', label: 'Recordatorio de seguimiento', descripcion: 'Avisa si un lead lleva 3 días sin contacto' },
  { id: 'cierre', label: 'Confirmación de cierre', descripcion: 'Notifica cuando un lead se marca como cerrado' },
]

export default function ConfiguracionPage() {
  const [verticalId, setVerticalId] = useState('carwash')
  const vertical = verticals.find((v) => v.id === verticalId) ?? verticals[0]

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Selector de vertical */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <Settings className="h-4 w-4 text-muted-foreground" aria-hidden />
            Vertical del negocio
          </CardTitle>
        </CardHeader>
        <CardContent>
          <label className="block text-small font-medium text-foreground" htmlFor="vertical-select">
            Selecciona la vertical que mejor describe tu negocio
          </label>
          <select
            id="vertical-select"
            value={verticalId}
            onChange={(e) => setVerticalId(e.target.value)}
            className="mt-2 w-full max-w-xs rounded-xl border border-border bg-card px-3 py-2 text-small text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-caption text-muted-foreground">
            La vertical define las etapas predeterminadas de tu pipeline de seguimiento.
          </p>
        </CardContent>
      </Card>

      {/* Etapas del pipeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <Workflow className="h-4 w-4 text-muted-foreground" aria-hidden />
            Etapas del pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-small text-muted-foreground">
            Estas son las etapas configuradas para <span className="font-medium text-foreground">{vertical.name}</span>. 
            Próximamente podrás personalizarlas.
          </p>
          <ol className="flex flex-wrap items-center gap-2">
            {vertical.stages.map((stage, i) => (
              <li key={stage} className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-small font-medium text-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-caption font-bold text-primary">
                    {i + 1}
                  </span>
                  {stage}
                </span>
                {i < vertical.stages.length - 1 && (
                  <span className="text-muted-foreground">→</span>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Automatizaciones (deshabilitadas) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
            Automatizaciones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-small text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            Las automatizaciones estarán disponibles en una próxima actualización.
          </div>
          {automatizaciones.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 opacity-60"
            >
              <div className="min-w-0">
                <p className="text-small font-medium text-foreground">{a.label}</p>
                <p className="text-caption text-muted-foreground">{a.descripcion}</p>
              </div>
              <button
                type="button"
                disabled
                aria-label={`${a.label} — próximamente`}
                className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border border-border bg-muted transition-colors"
              >
                <span className="pointer-events-none inline-block h-5 w-5 translate-x-0 translate-y-0 rounded-full bg-muted-foreground/40 shadow-sm ring-0" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
