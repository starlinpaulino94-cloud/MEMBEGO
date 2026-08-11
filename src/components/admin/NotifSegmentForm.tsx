'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  enviarNotificacionSegmento,
  type NotifSegmentState,
} from '@/modules/admin/notifSegmentActions'
import {
  SEGMENTOS,
  VER_SEGMENTO,
  type ConteoSegmentos,
  type SegmentoValue,
} from '@/modules/admin/segmentos-def'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface PlanOption {
  id: string
  nombre: string
}

const init: NotifSegmentState = {}

export function NotifSegmentForm({
  conteos,
  planes,
}: {
  conteos: ConteoSegmentos
  planes: PlanOption[]
}) {
  const [state, action, pending] = useActionState(enviarNotificacionSegmento, init)
  const [segmento, setSegmento] = useState<string>('seguidores')
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success) {
      toast.success(`Notificación enviada a ${state.enviadas} destinatario(s).`)
      formRef.current?.reset()
    }
  }, [state.success, state.enviadas])

  const conteoDe = (value: string): number | null => {
    if (value === 'plan') return null
    return conteos[value as keyof ConteoSegmentos] ?? null
  }

  return (
    <form ref={formRef} action={action} className="max-w-xl space-y-5">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="segmento">Segmento destinatario *</Label>
        <Select name="segmento" value={segmento} onValueChange={setSegmento}>
          <SelectTrigger id="segmento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEGMENTOS.map((s) => {
              const n = conteoDe(s.value)
              return (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                  {n != null ? ` (${n})` : ''}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Solo se notifica al segmento elegido — nunca a usuarios ajenos a tu
          empresa.
        </p>
        {/* Ver antes de mandar. Estos segmentos se calculaban desde hace tiempo
            y solo servían para ENVIAR: había que apretar el botón sin saber a
            quién le iba a llegar, que es lo que hace que nadie se atreva. */}
        {VER_SEGMENTO[segmento as SegmentoValue] && (
          <Link
            href={VER_SEGMENTO[segmento as SegmentoValue]!}
            className="text-caption text-primary hover:underline"
          >
            Ver quiénes son antes de enviar →
          </Link>
        )}
      </div>

      {segmento === 'plan' && (
        <div className="space-y-2">
          <Label htmlFor="planId">Plan *</Label>
          <Select name="planId">
            <SelectTrigger id="planId">
              <SelectValue placeholder="Selecciona un plan" />
            </SelectTrigger>
            <SelectContent>
              {planes.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="titulo">Título *</Label>
        <Input
          id="titulo"
          name="titulo"
          maxLength={100}
          placeholder="Ej: ¡Este fin de semana 2x1!"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mensaje">Mensaje *</Label>
        <Textarea
          id="mensaje"
          name="mensaje"
          rows={3}
          maxLength={500}
          placeholder="Texto que verá el cliente en su campana de notificaciones."
          required
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        Enviar notificación
      </Button>
    </form>
  )
}
