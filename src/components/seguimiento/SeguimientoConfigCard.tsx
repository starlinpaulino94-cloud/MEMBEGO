'use client'

/**
 * Seguimiento · Fase S3: panel de parametrización del módulo. Umbral de
 * "por vencer", recordatorio automático (activo/días/frecuencia), plantilla
 * del mensaje y promos excluidas del rastreo.
 */

import { useActionState } from 'react'
import { Loader2, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  guardarSeguimientoConfig,
  type SeguimientoConfigState,
} from '@/modules/seguimiento/actions'
import type { SeguimientoConfig } from '@/modules/seguimiento/config'

export function SeguimientoConfigCard({
  config,
  promos,
}: {
  config: SeguimientoConfig
  promos: { id: string; titulo: string }[]
}) {
  const [state, action, pending] = useActionState<SeguimientoConfigState, FormData>(
    guardarSeguimientoConfig,
    {}
  )

  return (
    <details className="rounded-2xl border border-border/70 bg-card">
      <summary className="flex cursor-pointer items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-foreground">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        Configuración del seguimiento
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          umbral, recordatorio automático, plantilla del mensaje
        </span>
      </summary>
      <form action={action} className="space-y-4 border-t border-border/60 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="umbralPorVencerDias">&quot;Por vencer&quot; = vence en (días)</Label>
            <Input
              id="umbralPorVencerDias"
              name="umbralPorVencerDias"
              type="number"
              min={1}
              max={90}
              defaultValue={config.umbralPorVencerDias}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recordatorioDiasAntes">Recordar cuando falten (días)</Label>
            <Input
              id="recordatorioDiasAntes"
              name="recordatorioDiasAntes"
              type="number"
              min={1}
              max={90}
              defaultValue={config.recordatorioDiasAntes}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recordatorioFrecuenciaDias">No repetir antes de (días)</Label>
            <Input
              id="recordatorioFrecuenciaDias"
              name="recordatorioFrecuenciaDias"
              type="number"
              min={1}
              max={90}
              defaultValue={config.recordatorioFrecuenciaDias}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="recordatorioAuto"
            defaultChecked={config.recordatorioAuto}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span>
            <strong>Recordatorio automático diario</strong>
            <span className="block text-xs text-muted-foreground">
              El sistema avisa dentro de la app a los clientes con recompensas sin usar que están
              por vencer. Cada aviso queda en auditoría.
            </span>
          </span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="plantillaMensaje">Plantilla del mensaje</Label>
          <Textarea
            id="plantillaMensaje"
            name="plantillaMensaje"
            rows={3}
            maxLength={500}
            defaultValue={config.plantillaMensaje}
          />
          <p className="text-xs text-muted-foreground">
            Variables: {'{cliente}'} {'{empresa}'} {'{recompensa}'} {'{vence}'}. Se usa en el
            botón de WhatsApp, el correo y los recordatorios.
          </p>
        </div>

        {promos.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-foreground">Recompensas rastreadas</legend>
            <p className="text-xs text-muted-foreground">
              Desmarca las que NO quieras seguir (desaparecen del panel y de los recordatorios).
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {promos.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-foreground">
                  {/* Marcado = rastrear. El servidor excluye las NO marcadas
                      usando la lista completa (promoTodas). */}
                  <input type="hidden" name="promoTodas" value={p.id} />
                  <input
                    type="checkbox"
                    name="promoRastrear"
                    value={p.id}
                    defaultChecked={!config.promosExcluidas.includes(p.id)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className="truncate">{p.titulo}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.success && <p className="text-sm text-success">{state.success}</p>}

        <Button type="submit" disabled={pending} className="gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar configuración
        </Button>
      </form>
    </details>
  )
}
