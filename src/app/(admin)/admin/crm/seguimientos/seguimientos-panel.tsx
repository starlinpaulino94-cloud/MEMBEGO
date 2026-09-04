'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { ACTIVIDAD_CHIP } from '../paleta'
import { createActividad, updateActividadEstado } from '@/modules/crm/seguimiento-actions'
import type { NotaActionState } from '@/modules/crm/nota-actions'
import {
  Phone,
  Mail,
  MessageCircle,
  StickyNote,
  Calendar,
  Clock,
  CheckCircle2,
  Plus,
  Search,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

interface ActividadData {
  id: string
  lead: { id: string; nombre: string }
  contenido: string
  tipo: string
  estado: string
  fechaProxima: Date | null
  createdAt: Date
}

interface LeadSelect {
  id: string
  nombre: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const TIPO_LABEL: Record<string, string> = {
  LLAMADA: 'Llamada',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  NOTA: 'Nota',
  REUNION: 'Reunión',
}

const TIPO_ICON: Record<string, typeof Phone> = {
  LLAMADA: Phone,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  NOTA: StickyNote,
  REUNION: Calendar,
}

const TIPO_COLORS: Record<string, string> = {
  LLAMADA: ACTIVIDAD_CHIP.Llamada,
  EMAIL: ACTIVIDAD_CHIP.Email,
  WHATSAPP: ACTIVIDAD_CHIP.WhatsApp,
  NOTA: 'bg-muted text-muted-foreground',
  REUNION: ACTIVIDAD_CHIP['Reunión'],
}

const RESULTADO_BADGE: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'info' }> = {
  contactado: { label: 'Contactado', variant: 'info' },
  interesado: { label: 'Interesado', variant: 'success' },
  rechazado: { label: 'Rechazado', variant: 'destructive' },
  'sin respuesta': { label: 'Sin respuesta', variant: 'warning' },
}

function fmtFecha(d: string | Date) {
  return new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(d))
}

// ── Component ──────────────────────────────────────────────────────────────

export function SeguimientosPanel({
  actividadesIniciales,
  leads,
}: {
  actividadesIniciales: ActividadData[]
  leads: LeadSelect[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [createState, setCreateState] = useState<NotaActionState>({} as NotaActionState)
  const [pending, startTransition] = useTransition()

  const [search, setSearch] = useState('')
  const [tipoFilter, setTipoFilter] = useState('todas')
  const [estadoFilter, setEstadoFilter] = useState('todas')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    lead: '',
    tipo: 'LLAMADA',
    descripcion: '',
    fecha: '',
    resultado: '',
  })

  // ── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (createState.success) {
      toast.success('Actividad creada')
      setDialogOpen(false)
      formRef.current?.reset()
      setForm({ lead: '', tipo: 'LLAMADA', descripcion: '', fecha: '', resultado: '' })
      router.refresh()
    }
    if (createState.error) toast.error(createState.error)
  }, [createState, router])

  // ── Derived ─────────────────────────────────────────────────────────────
  const filtered = actividadesIniciales.filter((a) => {
    const q = search.toLowerCase()
    if (q && !a.lead.nombre.toLowerCase().includes(q) && !a.contenido.toLowerCase().includes(q)) return false
    if (tipoFilter !== 'todas' && a.tipo !== tipoFilter) return false
    if (estadoFilter === 'pendiente' && a.estado !== 'PENDIENTE') return false
    if (estadoFilter === 'completada' && a.estado !== 'COMPLETADA') return false
    return true
  })

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleCreate = (formData: FormData) => {
    startTransition(async () => {
      const res = await createActividad({} as NotaActionState, formData)
      setCreateState(res)
    })
  }

  const toggleEstado = (notaId: string, estadoActual: string) => {
    const fd = new FormData()
    fd.set('notaId', notaId)
    fd.set('estado', estadoActual === 'PENDIENTE' ? 'COMPLETADA' : 'PENDIENTE')
    startTransition(async () => {
      const res = await updateActividadEstado({} as NotaActionState, fd)
      if (res?.success) {
        toast.success('Estado actualizado')
        router.refresh()
      } else if (res?.error) {
        toast.error(res.error)
      }
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Actions bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Registra y da seguimiento a las actividades con tus prospectos.</p>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Nueva actividad
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar por lead o descripción"
            placeholder="Buscar por lead o descripción..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={tipoFilter} onValueChange={setTipoFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="LLAMADA">Llamada</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
            <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
            <SelectItem value="NOTA">Nota</SelectItem>
            <SelectItem value="REUNION">Reunión</SelectItem>
          </SelectContent>
        </Select>
        <Select value={estadoFilter} onValueChange={setEstadoFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="completada">Completada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Activity list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-small text-muted-foreground">No hay actividades que coincidan</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((act) => {
            const Icon = TIPO_ICON[act.tipo] ?? Clock
            const tipoLabel = TIPO_LABEL[act.tipo] ?? act.tipo
            return (
              <Card key={act.id} className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-start gap-4 p-4">
                  {/* Type icon */}
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                      TIPO_COLORS[act.tipo] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-small font-medium text-foreground">{act.lead.nombre}</p>
                      <Badge variant="outline" className="text-caption">
                        {tipoLabel}
                      </Badge>
                    </div>
                    <p className="text-small text-muted-foreground mt-0.5">{act.contenido}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="text-caption text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {fmtFecha(act.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Status + action */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge variant={act.estado === 'COMPLETADA' ? 'success' : 'warning'}>
                      {act.estado === 'COMPLETADA' ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Clock className="h-3 w-3" />
                      )}
                      {act.estado === 'COMPLETADA' ? 'Completada' : 'Pendiente'}
                    </Badge>
                    {act.estado === 'PENDIENTE' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => toggleEstado(act.id, act.estado)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Marcar completada
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* ── New Activity Dialog ───────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Actividad</DialogTitle>
            <DialogDescription>Programa un seguimiento con un lead.</DialogDescription>
          </DialogHeader>
          <form ref={formRef} action={handleCreate} className="grid gap-4">
            <div className="grid gap-2">
              <Label>Lead *</Label>
              <Select name="leadId" value={form.lead} onValueChange={(v) => setForm((p) => ({ ...p, lead: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar lead" />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Tipo *</Label>
              <Select name="tipo" value={form.tipo} onValueChange={(v) => setForm((p) => ({ ...p, tipo: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LLAMADA">Llamada</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                  <SelectItem value="NOTA">Nota</SelectItem>
                  <SelectItem value="REUNION">Reunión</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="seg-descripcion">Descripción *</Label>
              <Textarea
                id="seg-descripcion"
                name="contenido"
                value={form.descripcion}
                onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))}
                placeholder="Describe la actividad..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="seg-fecha">Fecha programada</Label>
              <Input
                id="seg-fecha"
                name="fechaProxima"
                type="datetime-local"
                value={form.fecha}
                onChange={(e) => setForm((p) => ({ ...p, fecha: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending}>Crear actividad</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
