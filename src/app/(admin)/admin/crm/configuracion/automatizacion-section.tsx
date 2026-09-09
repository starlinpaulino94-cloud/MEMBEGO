'use client'

import { useState } from 'react'
import { Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { updateAutomatizaciones } from '@/modules/crm/config-actions'
import type { AutomatizacionesConfig } from '@/modules/crm/queries'
import type { ConfigActionState } from '@/modules/crm/config-actions'

interface AutomatizacionSectionProps {
  companyId: string
  initialAutomatizaciones: AutomatizacionesConfig
}

export function AutomatizacionSection({ companyId, initialAutomatizaciones }: AutomatizacionSectionProps) {
  const [autoBienvenida, setAutoBienvenida] = useState(initialAutomatizaciones.bienvenida)
  const [autoRecordatorio, setAutoRecordatorio] = useState(initialAutomatizaciones.recordatorio)
  const [autoRecordatorioDias, setAutoRecordatorioDias] = useState(initialAutomatizaciones.recordatorioDias)
  const [autoCierre, setAutoCierre] = useState(initialAutomatizaciones.cierre)

  const save = async (data: AutomatizacionesConfig) => {
    const fd = new FormData()
    fd.append('companyId', companyId)
    fd.append('bienvenida', String(data.bienvenida))
    fd.append('recordatorio', String(data.recordatorio))
    fd.append('recordatorioDias', String(data.recordatorioDias))
    fd.append('cierre', String(data.cierre))
    await updateAutomatizaciones({} as ConfigActionState, fd)
  }

  const toggleBienvenida = (val: boolean) => {
    setAutoBienvenida(val)
    save({ bienvenida: val, recordatorio: autoRecordatorio, recordatorioDias: autoRecordatorioDias, cierre: autoCierre })
    toast.success(val ? 'Bienvenida activada' : 'Bienvenida desactivada')
  }

  const toggleRecordatorio = (val: boolean) => {
    setAutoRecordatorio(val)
    save({ bienvenida: autoBienvenida, recordatorio: val, recordatorioDias: autoRecordatorioDias, cierre: autoCierre })
    toast.success(val ? 'Recordatorio activado' : 'Recordatorio desactivado')
  }

  const updateRecordatorioDias = (dias: number) => {
    const clamped = Math.max(1, Math.min(30, dias || 3))
    setAutoRecordatorioDias(clamped)
    save({ bienvenida: autoBienvenida, recordatorio: autoRecordatorio, recordatorioDias: clamped, cierre: autoCierre })
  }

  const toggleCierre = (val: boolean) => {
    setAutoCierre(val)
    save({ bienvenida: autoBienvenida, recordatorio: autoRecordatorio, recordatorioDias: autoRecordatorioDias, cierre: val })
    toast.success(val ? 'Cierre activado' : 'Cierre desactivado')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-h4">
          <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
          Automatizaciones
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0">
            <p className="text-small font-medium text-foreground">Mensaje de bienvenida</p>
            <p className="text-caption text-muted-foreground">Envía un saludo cuando un lead entra al pipeline</p>
          </div>
          <Switch checked={autoBienvenida} onCheckedChange={toggleBienvenida} />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0 flex-1">
            <p className="text-small font-medium text-foreground">Recordatorio de seguimiento</p>
            <p className="text-caption text-muted-foreground">Avisa si un lead lleva días sin contacto</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {autoRecordatorio && (
              <div className="flex items-center gap-1.5">
                <Input
                  aria-label="Días de espera antes del recordatorio automático"
                  type="number"
                  min={1}
                  max={30}
                  value={autoRecordatorioDias}
                  onChange={(e) => updateRecordatorioDias(Number(e.target.value))}
                  className="h-8 w-16 text-center tabular-nums"
                />
                <span className="text-caption text-muted-foreground">días</span>
              </div>
            )}
            <Switch checked={autoRecordatorio} onCheckedChange={toggleRecordatorio} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0">
            <p className="text-small font-medium text-foreground">Confirmación de cierre</p>
            <p className="text-caption text-muted-foreground">Notifica cuando un lead se marca como cerrado</p>
          </div>
          <Switch checked={autoCierre} onCheckedChange={toggleCierre} />
        </div>
      </CardContent>
    </Card>
  )
}
