'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Trash2, Pencil, X, HelpCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearFaq,
  actualizarFaq,
  eliminarFaq,
  toggleFaq,
  type ActionState,
} from '@/modules/soporte/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

interface Faq {
  id: string
  pregunta: string
  respuesta: string
  orden: number
  activo: boolean
}

const init: ActionState = {}

function SaveBtn({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {label}
    </Button>
  )
}

export function FaqManager({
  companyId,
  faqs,
}: {
  companyId: string | null
  faqs: Faq[]
}) {
  const [createState, createAction] = useActionState(crearFaq, init)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (createState.success) toast.success('Pregunta agregada.')
    if (createState.error) toast.error(createState.error)
  }, [createState.success, createState.error])

  function onToggle(id: string, activo: boolean) {
    startTransition(async () => {
      const r = await toggleFaq(id, activo)
      if (r.error) toast.error(r.error)
    })
  }

  function onDelete(id: string) {
    if (!confirm('¿Eliminar esta pregunta frecuente?')) return
    startTransition(async () => {
      const r = await eliminarFaq(id)
      if (r.error) toast.error(r.error)
      else toast.success('Pregunta eliminada.')
    })
  }

  return (
    <div className="space-y-5">
      {/* Formulario para agregar */}
      <Card>
        <CardContent className="pt-6">
          <form action={createAction} className="space-y-3">
            {companyId && <input type="hidden" name="companyId" value={companyId} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem]">
              <div className="space-y-1.5">
                <Label htmlFor="pregunta">Pregunta</Label>
                <Input id="pregunta" name="pregunta" placeholder="¿Cómo activo mi membresía?" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="orden">Orden</Label>
                <Input id="orden" name="orden" type="number" defaultValue={faqs.length} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="respuesta">Respuesta</Label>
              <Textarea id="respuesta" name="respuesta" rows={2} placeholder="Escribe la respuesta…" required />
            </div>
            <SaveBtn label="Agregar pregunta" />
          </form>
        </CardContent>
      </Card>

      {/* Lista */}
      {faqs.length === 0 ? (
        <EmptyState
          icon={<HelpCircle className="h-6 w-6" />}
          title="Sin preguntas frecuentes"
          description="Agrega preguntas para que tus clientes encuentren respuestas rápidas."
        />
      ) : (
        <div className="space-y-2">
          {faqs.map((f) =>
            editingId === f.id ? (
              <EditFaqCard key={f.id} faq={f} onDone={() => setEditingId(null)} />
            ) : (
              <Card key={f.id} className={f.activo ? '' : 'opacity-60'}>
                <CardContent className="flex items-start gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{f.pregunta}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{f.respuesta}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={f.activo}
                      disabled={isPending}
                      onCheckedChange={(v) => onToggle(f.id, v)}
                    />
                    <Button variant="ghost" size="icon" aria-label="Editar pregunta" title="Editar" onClick={() => setEditingId(f.id)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isPending}
                      aria-label="Eliminar pregunta"
                      title="Eliminar"
                      onClick={() => onDelete(f.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  )
}

function EditFaqCard({ faq, onDone }: { faq: Faq; onDone: () => void }) {
  const [state, action] = useActionState(actualizarFaq, init)
  useEffect(() => {
    if (state.success) {
      toast.success('Pregunta actualizada.')
      onDone()
    }
    if (state.error) toast.error(state.error)
  }, [state.success, state.error, onDone])

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={faq.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem]">
            <div className="space-y-1.5">
              <Label>Pregunta</Label>
              <Input name="pregunta" defaultValue={faq.pregunta} required />
            </div>
            <div className="space-y-1.5">
              <Label>Orden</Label>
              <Input name="orden" type="number" defaultValue={faq.orden} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Respuesta</Label>
            <Textarea name="respuesta" defaultValue={faq.respuesta} rows={2} required />
          </div>
          <div className="flex gap-2">
            <SaveBtn label="Guardar cambios" />
            <Button type="button" variant="ghost" size="sm" onClick={onDone}>
              <X className="mr-2 h-4 w-4" /> Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
