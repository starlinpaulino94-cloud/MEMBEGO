'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
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
import { Campo } from '@/components/ui/campo'
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
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Campo
        id="segmento"
        etiqueta="Segmento destinatario"
        ayuda="Solo se notifica al segmento elegido — nunca a usuarios ajenos a tu empresa."
      >
        {(control) => (
          <Select name="segmento" value={segmento} onValueChange={setSegmento}>
            <SelectTrigger className="w-full" {...control}>
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
        )}
      </Campo>
      {/* Ver antes de mandar. Estos segmentos se calculaban desde hace tiempo
          y solo servían para ENVIAR: había que apretar el botón sin saber a
          quién le iba a llegar, que es lo que hace que nadie se atreva. */}
      {VER_SEGMENTO[segmento as SegmentoValue] && (
        <Link href={VER_SEGMENTO[segmento as SegmentoValue]!} className="-mt-3 block text-caption text-primary hover:underline">
          Ver quiénes son antes de enviar →
        </Link>
      )}

      {segmento === 'plan' && (
        <Campo id="planId" etiqueta="Plan">
          {(control) => (
            <Select name="planId">
              <SelectTrigger className="w-full" {...control}>
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
          )}
        </Campo>
      )}

      <Campo id="titulo" etiqueta="Título">
        {(control) => <Input name="titulo" maxLength={100} placeholder="Ej: ¡Este fin de semana 2x1!" required {...control} />}
      </Campo>

      <Campo id="mensaje" etiqueta="Mensaje">
        {(control) => (
          <Textarea
            name="mensaje"
            rows={3}
            maxLength={500}
            placeholder="Texto que verá el cliente en su campana de notificaciones."
            required
            {...control}
          />
        )}
      </Campo>

      <Button type="submit" loading={pending}>
        {!pending && <Send className="h-4 w-4" aria-hidden />}
        Enviar notificación
      </Button>
    </form>
  )
}
