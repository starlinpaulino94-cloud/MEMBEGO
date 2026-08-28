'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, Trash2, Play, Pause, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearRuletaPremio,
  actualizarRuletaPremio,
  cambiarActivoRuletaPremio,
  eliminarRuletaPremio,
  type RuletaPremioState,
} from '@/modules/gamificacion/ruletaActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface PremioRow {
  id: string
  nombre: string
  tipo: 'PROMOCION' | 'NADA'
  promocionId: string | null
  promocion: { id: string; titulo: string } | null
  probabilidad: number
  color: string | null
  activo: boolean
  orden: number
}
export interface PromoOpt {
  id: string
  titulo: string
}

const init: RuletaPremioState = {}

export function RuletaAdmin({
  premios,
  promociones,
}: {
  premios: PremioRow[]
  promociones: PromoOpt[]
}) {
  const router = useRouter()
  const [editando, setEditando] = useState<PremioRow | null>(null)

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
      <div className="lg:sticky lg:top-6 lg:h-fit">
        <PremioForm
          key={editando?.id ?? 'nuevo'}
          editando={editando}
          promociones={promociones}
          onDone={() => {
            setEditando(null)
            router.refresh()
          }}
          onCancel={() => setEditando(null)}
        />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Premios ({premios.length})
        </h3>
        {premios.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Aún no hay premios. Crea al menos 2 (incluye un “Sigue participando”) para que la
            ruleta sea divertida.
          </div>
        ) : (
          <ul className="space-y-2">
            {premios.map((p) => (
              <PremioItem key={p.id} premio={p} onEditar={() => setEditando(p)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PremioForm({
  editando,
  promociones,
  onDone,
  onCancel,
}: {
  editando: PremioRow | null
  promociones: PromoOpt[]
  onDone: () => void
  onCancel: () => void
}) {
  const action = editando ? actualizarRuletaPremio : crearRuletaPremio
  const [state, formAction, pending] = useActionState(action, init)
  const [tipo, setTipo] = useState<'PROMOCION' | 'NADA'>(editando?.tipo ?? 'PROMOCION')

  useEffect(() => {
    if (state.success) {
      toast.success(editando ? 'Premio actualizado.' : 'Premio creado.')
      onDone()
    }
  }, [state.success, editando, onDone])

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">
          {editando ? 'Editar premio' : 'Nuevo premio'}
        </h3>
        {editando && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="gap-1">
            <X className="h-4 w-4" />
            Cancelar
          </Button>
        )}
      </div>

      {editando && <input type="hidden" name="id" value={editando.id} />}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="nombre">Nombre del premio</Label>
        <Input
          id="nombre"
          name="nombre"
          placeholder="Ej: Lavado GRATIS"
          defaultValue={editando?.nombre ?? ''}
          maxLength={60}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tipo">Tipo</Label>
        <Select name="tipo" value={tipo} onValueChange={(v) => setTipo(v as 'PROMOCION' | 'NADA')}>
          <SelectTrigger id="tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PROMOCION">Entrega una promoción</SelectItem>
            <SelectItem value="NADA">Sigue participando (sin premio)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {tipo === 'PROMOCION' && (
        <div className="space-y-1.5">
          <Label htmlFor="promocionId">Promoción que se entrega</Label>
          <Select name="promocionId" defaultValue={editando?.promocionId ?? ''}>
            <SelectTrigger id="promocionId">
              <SelectValue placeholder="Elige una promoción" />
            </SelectTrigger>
            <SelectContent>
              {promociones.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.titulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Al ganar, se entrega a la wallet del cliente con su QR.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="probabilidad">Probabilidad (peso)</Label>
          <Input
            id="probabilidad"
            name="probabilidad"
            type="number"
            min={1}
            defaultValue={editando?.probabilidad ?? 1}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="color">Color</Label>
          <Input
            id="color"
            name="color"
            type="color"
            defaultValue={editando?.color ?? '#6366f1'}
          />
        </div>
      </div>

      <input type="hidden" name="orden" value={editando?.orden ?? 0} />

      <Button type="submit" disabled={pending} className="w-full gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {editando ? 'Guardar cambios' : 'Agregar premio'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Mayor peso = más probable de salir. Ej: peso 3 sale el triple que peso 1.
      </p>
    </form>
  )
}

function PremioItem({ premio, onEditar }: { premio: PremioRow; onEditar: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const toggle = () =>
    start(async () => {
      const res = await cambiarActivoRuletaPremio(premio.id, !premio.activo)
      if (res.ok) {
        toast.success(premio.activo ? 'Premio pausado.' : 'Premio activado.')
        router.refresh()
      } else toast.error('No se pudo cambiar el estado.')
    })

  const borrar = () => {
    if (!confirm('¿Eliminar este premio?')) return
    start(async () => {
      const res = await eliminarRuletaPremio(premio.id)
      if (res.ok) {
        toast.success('Premio eliminado.')
        router.refresh()
      } else toast.error('No se pudo eliminar.')
    })
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3">
      <span
        className="h-8 w-8 shrink-0 rounded-lg"
        style={{ backgroundColor: premio.color || '#6366f1' }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{premio.nombre}</p>
          {!premio.activo && <Badge variant="secondary">Pausado</Badge>}
          <Badge variant="outline">peso {premio.probabilidad}</Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {premio.tipo === 'PROMOCION'
            ? premio.promocion?.titulo ?? 'Promoción no vinculada'
            : 'Sigue participando'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onEditar} disabled={pending} className="gap-1">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={toggle} disabled={pending} className="gap-1">
          {premio.activo ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={borrar}
          disabled={pending}
          className="gap-1 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  )
}
