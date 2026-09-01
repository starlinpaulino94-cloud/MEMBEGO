'use client'

import { useState, useCallback } from 'react'
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import {
  Plus,
  Search,
  GripVertical,
  Mail,
  Phone,
  Building2,
  CalendarDays,
  Pencil,
  Trash2,
  ArrowRight,
  MessageSquare,
  Clock,
  CheckCircle2,
  Circle,
  FileText,
} from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────────

type Priority = 'alta' | 'media' | 'baja'
type Etapa = 'nuevo' | 'contactado' | 'cotizacion' | 'negociacion' | 'cerrado'

interface Lead {
  id: string
  nombre: string
  email: string
  telefono: string
  empresa: string
  prioridad: Priority
  notas: string
  fecha: string
  etapa: Etapa
}

interface Nota {
  id: string
  autor: string
  fecha: string
  texto: string
}

interface Actividad {
  id: string
  tipo: string
  descripcion: string
  fecha: string
  completada: boolean
}

interface Oferta {
  id: string
  plan: string
  monto: string
  estado: 'pendiente' | 'aceptada' | 'rechazada'
}

// ── Constants ───────────────────────────────────────────────────────────────

const COLUMN_META: { key: Etapa; label: string; badgeClass: string }[] = [
  { key: 'nuevo', label: 'Nuevo', badgeClass: 'bg-blue-100 text-blue-800' },
  { key: 'contactado', label: 'Contactado', badgeClass: 'bg-yellow-100 text-yellow-800' },
  { key: 'cotizacion', label: 'Cotización', badgeClass: 'bg-orange-100 text-orange-800' },
  { key: 'negociacion', label: 'Negociación', badgeClass: 'bg-purple-100 text-purple-800' },
  { key: 'cerrado', label: 'Cerrado', badgeClass: 'bg-green-100 text-green-800' },
]

const PRIORITY_DOT: Record<Priority, string> = {
  alta: 'bg-red-500',
  media: 'bg-yellow-400',
  baja: 'bg-green-500',
}

const PRIORITY_LABEL: Record<Priority, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

const ACTIVIDAD_ICONS: Record<string, typeof Clock> = {
  llamada: Phone,
  whatsapp: MessageSquare,
  email: Mail,
}

const OFERTA_ESTADO: Record<string, { label: string; variant: 'warning' | 'success' | 'destructive' }> = {
  pendiente: { label: 'Pendiente', variant: 'warning' },
  aceptada: { label: 'Aceptada', variant: 'success' },
  rechazada: { label: 'Rechazada', variant: 'destructive' },
}

const INITIAL_LEADS: Lead[] = [
  { id: '1', nombre: 'María García', email: 'maria@autolavado.com', telefono: '809-555-1234', empresa: 'AutoLavado Express', prioridad: 'alta', notas: 'Busca sistema de membresías para 3 sucursales.', fecha: '2024-01-15', etapa: 'nuevo' },
  { id: '2', nombre: 'Carlos Rodríguez', email: 'carlos@lavadorapido.com', telefono: '809-555-5678', empresa: 'Lavado Rápido', prioridad: 'media', notas: 'Interesado en plan premium.', fecha: '2024-01-14', etapa: 'nuevo' },
  { id: '3', nombre: 'Ana Martínez', email: 'ana@premiumcw.com', telefono: '809-555-9012', empresa: 'Premium Car Wash', prioridad: 'baja', notas: 'Cotización enviada, esperando respuesta.', fecha: '2024-01-13', etapa: 'contactado' },
  { id: '4', nombre: 'Pedro López', email: 'pedro@elbrillo.com', telefono: '', empresa: 'El Brillo', prioridad: 'alta', notas: 'Decisión esta semana.', fecha: '2024-01-12', etapa: 'contactado' },
  { id: '5', nombre: 'Laura Sánchez', email: 'laura@superclean.com', telefono: '809-555-3456', empresa: 'SuperClean', prioridad: 'media', notas: 'Comparando con competencia.', fecha: '2024-01-11', etapa: 'cotizacion' },
  { id: '6', nombre: 'Roberto Díaz', email: 'roberto@carspa.com', telefono: '809-555-7890', empresa: 'CarSpa', prioridad: 'alta', notas: 'Reunión programada para viernes.', fecha: '2024-01-10', etapa: 'negociacion' },
  { id: '7', nombre: 'Sofía Hernández', email: 'sofia@lavadoservice.com', telefono: '809-555-2345', empresa: 'LavadoTotal', prioridad: 'baja', notas: 'Pendiente de contrato.', fecha: '2024-01-09', etapa: 'negociacion' },
  { id: '8', nombre: 'Miguel Fernández', email: 'miguel@quickwash.com', telefono: '809-555-6789', empresa: 'QuickWash', prioridad: 'media', notas: 'Contrato firmado. Onboarding pendiente.', fecha: '2024-01-08', etapa: 'cerrado' },
  { id: '9', nombre: 'Valeria Torres', email: 'valeria@shinepro.com', telefono: '809-555-0123', empresa: 'ShinePro', prioridad: 'baja', notas: 'Referido por María García.', fecha: '2024-01-16', etapa: 'nuevo' },
  { id: '10', nombre: 'Juan Castillo', email: 'juan@expresswash.com', telefono: '', empresa: 'ExpressWash', prioridad: 'alta', notas: 'Proyecto grande, 5 locales.', fecha: '2024-01-07', etapa: 'cerrado' },
]

const DEFAULT_NOTAS: Record<string, Nota[]> = {
  '1': [
    { id: 'n1', autor: 'María', fecha: '2026-09-01', texto: 'Llamé, interesado en plan mensual.' },
    { id: 'n2', autor: 'Pedro', fecha: '2026-08-30', texto: 'Envié precios por WhatsApp.' },
  ],
}

const DEFAULT_ACTIVIDADES: Record<string, Actividad[]> = {
  '1': [
    { id: 'a1', tipo: 'llamada', descripcion: 'Llamada inicial de contacto', fecha: '2026-09-01 15:30', completada: true },
    { id: 'a2', tipo: 'whatsapp', descripcion: 'Seguimiento - enviar precios', fecha: '2026-09-02 10:00', completada: false },
    { id: 'a3', tipo: 'email', descripcion: 'Envío de cotización formal', fecha: '2026-08-28 09:00', completada: true },
  ],
}

const DEFAULT_OFERTAS: Record<string, Oferta[]> = {
  '1': [
    { id: 'o1', plan: 'Plan Premium', monto: 'RD$1,500/mes', estado: 'pendiente' },
    { id: 'o2', plan: 'Plan Básico', monto: 'RD$800/mes', estado: 'rechazada' },
  ],
}

const fmtFecha = (f: string) =>
  new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' }).format(new Date(f))

let nextId = 11
let nextNotaId = 100
let nextActividadId = 100
let nextOfertaId = 100

// ── Sub-components ──────────────────────────────────────────────────────────

function LeadCard({
  lead,
  onDragStart,
  onClick,
}: {
  lead: Lead
  onDragStart: (id: string) => void
  onClick: () => void
}) {
  return (
    <Card
      draggable
      onDragStart={() => onDragStart(lead.id)}
      onClick={onClick}
      className="cursor-grab select-none transition-shadow hover:shadow-md active:cursor-grabbing"
    >
      <CardContent className="flex items-start gap-2 p-3">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', PRIORITY_DOT[lead.prioridad])} />
            <p className="text-small font-medium truncate">{lead.nombre}</p>
          </div>
          <p className="text-caption text-muted-foreground mt-0.5 truncate">{lead.empresa}</p>
          {lead.email && (
            <p className="text-caption text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
              <Mail className="h-3 w-3 shrink-0" />{lead.email}
            </p>
          )}
          {lead.telefono && (
            <p className="text-caption text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
              <Phone className="h-3 w-3 shrink-0" />{lead.telefono}
            </p>
          )}
          <p className="text-caption text-muted-foreground mt-1">{fmtFecha(lead.fecha)}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function LeadForm({
  defaultValues,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  defaultValues: { nombre: string; email: string; telefono: string; empresa: string; notas: string; prioridad: Priority }
  onSubmit: (values: typeof defaultValues) => void
  onCancel: () => void
  submitLabel: string
}) {
  const [form, setForm] = useState(defaultValues)

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!form.nombre.trim() || !form.empresa.trim()) {
          toast.error('Nombre y Empresa son obligatorios')
          return
        }
        onSubmit(form)
      }}
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="f-nombre">Nombre *</Label>
        <Input id="f-nombre" value={form.nombre} onChange={set('nombre')} placeholder="Nombre del lead" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="f-email">Email</Label>
        <Input id="f-email" type="email" value={form.email} onChange={set('email')} placeholder="email@ejemplo.com" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="f-telefono">Teléfono</Label>
        <Input id="f-telefono" value={form.telefono} onChange={set('telefono')} placeholder="809-555-0000" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="f-empresa">Empresa *</Label>
        <Input id="f-empresa" value={form.empresa} onChange={set('empresa')} placeholder="Nombre de la empresa" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="f-prioridad">Prioridad</Label>
        <Select value={form.prioridad} onValueChange={(v) => setForm((p) => ({ ...p, prioridad: v as Priority }))}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="media">Media</SelectItem>
            <SelectItem value="baja">Baja</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="f-notas">Notas</Label>
        <Textarea id="f-notas" value={form.notas} onChange={set('notas')} placeholder="Notas adicionales..." rows={3} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit">{submitLabel}</Button>
      </DialogFooter>
    </form>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [leads, setLeads] = useState<Lead[]>(INITIAL_LEADS)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('todas')

  // DnD
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)

  // New lead dialog
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [newLeadStage, setNewLeadStage] = useState<Etapa>('nuevo')

  // Detail sheet
  const [detailLead, setDetailLead] = useState<Lead | null>(null)
  const [editing, setEditing] = useState(false)

  // Sheet sub-data
  const [notas, setNotas] = useState<Record<string, Nota[]>>(DEFAULT_NOTAS)
  const [actividades, setActividades] = useState<Record<string, Actividad[]>>(DEFAULT_ACTIVIDADES)
  const [ofertas, setOfertas] = useState<Record<string, Oferta[]>>(DEFAULT_OFERTAS)
  const [newNotaText, setNewNotaText] = useState('')
  const [newOfertaPlan, setNewOfertaPlan] = useState('')
  const [newOfertaMonto, setNewOfertaMonto] = useState('')
  const [newActividadOpen, setNewActividadOpen] = useState(false)
  const [newActividadTipo, setNewActividadTipo] = useState('llamada')
  const [newActividadDesc, setNewActividadDesc] = useState('')
  const [newActividadFecha, setNewActividadFecha] = useState('')

  // ── Derived data ──────────────────────────────────────────────────────────
  const q = search.toLowerCase()

  const filteredByStage = stageFilter === 'todas' ? COLUMN_META : COLUMN_META.filter((c) => c.key === stageFilter)

  const leadsByCol = useCallback(
    (col: Etapa): Lead[] =>
      leads.filter((l) => {
        if (l.etapa !== col) return false
        if (q && !l.nombre.toLowerCase().includes(q) && !l.email.toLowerCase().includes(q)) return false
        return true
      }),
    [leads, q],
  )

  const leadId = detailLead?.id ?? ''
  const leadNotas = notas[leadId] ?? []
  const leadActividades = actividades[leadId] ?? []
  const leadOfertas = ofertas[leadId] ?? []

  // ── Actions ───────────────────────────────────────────────────────────────
  const addLead = useCallback(
    (values: { nombre: string; email: string; telefono: string; empresa: string; notas: string; prioridad: Priority }) => {
      const id = String(nextId++)
      const now = new Date().toISOString().slice(0, 10)
      const lead: Lead = { id, ...values, fecha: now, etapa: newLeadStage }
      setLeads((prev) => [...prev, lead])
      setNewLeadOpen(false)
      toast.success(`Lead "${values.nombre}" creado`)
    },
    [newLeadStage],
  )

  const updateLead = useCallback((id: string, patch: Partial<Lead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    setEditing(false)
    toast.success('Lead actualizado')
  }, [])

  const deleteLead = useCallback(
    (id: string) => {
      setLeads((prev) => prev.filter((l) => l.id !== id))
      setDetailLead(null)
      toast.success('Lead eliminado')
    },
    [],
  )

  const moveLead = useCallback((id: string, to: Etapa) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, etapa: to } : l)))
  }, [])

  // ── Notas actions ────────────────────────────────────────────────────────
  const addNota = useCallback(() => {
    if (!newNotaText.trim() || !leadId) return
    const nota: Nota = {
      id: `n${nextNotaId++}`,
      autor: 'Tú',
      fecha: new Date().toISOString().slice(0, 10),
      texto: newNotaText.trim(),
    }
    setNotas((prev) => ({ ...prev, [leadId]: [...(prev[leadId] ?? []), nota] }))
    setNewNotaText('')
    toast.success('Nota agregada')
  }, [newNotaText, leadId])

  const deleteNota = useCallback(
    (notaId: string) => {
      if (!leadId) return
      setNotas((prev) => ({ ...prev, [leadId]: (prev[leadId] ?? []).filter((n) => n.id !== notaId) }))
      toast.success('Nota eliminada')
    },
    [leadId],
  )

  // ── Actividades actions ──────────────────────────────────────────────────
  const addActividad = useCallback(() => {
    if (!newActividadDesc.trim() || !leadId) return
    const act: Actividad = {
      id: `a${nextActividadId++}`,
      tipo: newActividadTipo,
      descripcion: newActividadDesc.trim(),
      fecha: newActividadFecha || new Date().toISOString().slice(0, 16).replace('T', ' '),
      completada: false,
    }
    setActividades((prev) => ({ ...prev, [leadId]: [...(prev[leadId] ?? []), act] }))
    setNewActividadDesc('')
    setNewActividadFecha('')
    setNewActividadOpen(false)
    toast.success('Actividad creada')
  }, [newActividadDesc, newActividadFecha, newActividadTipo, leadId])

  const toggleActividad = useCallback(
    (actId: string) => {
      if (!leadId) return
      setActividades((prev) => ({
        ...prev,
        [leadId]: (prev[leadId] ?? []).map((a) =>
          a.id === actId ? { ...a, completada: !a.completada } : a,
        ),
      }))
    },
    [leadId],
  )

  // ── Ofertas actions ──────────────────────────────────────────────────────
  const addOferta = useCallback(() => {
    if (!newOfertaPlan.trim() || !leadId) return
    const oferta: Oferta = {
      id: `o${nextOfertaId++}`,
      plan: newOfertaPlan.trim(),
      monto: newOfertaMonto.trim() || 'Sin especificar',
      estado: 'pendiente',
    }
    setOfertas((prev) => ({ ...prev, [leadId]: [...(prev[leadId] ?? []), oferta] }))
    setNewOfertaPlan('')
    setNewOfertaMonto('')
    toast.success('Oferta creada')
  }, [newOfertaPlan, newOfertaMonto, leadId])

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onDragStart = useCallback((id: string) => {
    setDraggedId(id)
  }, [])

  const onDragOver = useCallback(
    (e: React.DragEvent, col: string) => {
      e.preventDefault()
      setOverColumn(col)
    },
    [],
  )

  const onDragLeave = useCallback(() => setOverColumn(null), [])

  const onDrop = useCallback(
    (col: Etapa) => {
      if (draggedId) {
        moveLead(draggedId, col)
        toast.success(`Lead movido a "${COLUMN_META.find((c) => c.key === col)?.label}"`)
      }
      setDraggedId(null)
      setOverColumn(null)
    },
    [draggedId, moveLead],
  )

  const onDragEnd = useCallback(() => {
    setDraggedId(null)
    setOverColumn(null)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Actions bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Gestiona tus prospectos en el pipeline de ventas.</p>
        <Button onClick={() => { setNewLeadStage('nuevo'); setNewLeadOpen(true) }}>
          <Plus className="mr-1.5 h-4 w-4" />
          Nuevo Lead
        </Button>
      </div>

      {/* Search + stage filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Filtrar etapa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las etapas</SelectItem>
            {COLUMN_META.map((c) => (
              <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Kanban columns */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {filteredByStage.map((col) => {
          const colLeads = leadsByCol(col.key)
          const isOver = overColumn === col.key
          return (
            <div key={col.key} className="min-w-[280px] flex-1">
              <div
                className={cn(
                  'rounded-xl border bg-card p-4 transition-colors',
                  isOver ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                )}
                onDragOver={(e) => onDragOver(e, col.key)}
                onDragLeave={onDragLeave}
                onDrop={() => onDrop(col.key)}
              >
                {/* Column header */}
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-small font-medium">{col.label}</h3>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', col.badgeClass)}>
                      {colLeads.length}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => { setNewLeadStage(col.key); setNewLeadOpen(true) }}
                    aria-label={`Agregar lead a ${col.label}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Cards */}
                <div className="space-y-3">
                  {colLeads.length > 0 ? (
                    colLeads.map((lead) => (
                      <div key={lead.id} className={cn(draggedId === lead.id && 'opacity-50')}>
                        <LeadCard
                          lead={lead}
                          onDragStart={onDragStart}
                          onClick={() => { setDetailLead(lead); setEditing(false) }}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/60 py-8 text-center">
                      <p className="text-caption text-muted-foreground">
                        {q ? 'Sin resultados' : 'Arrastra un lead aquí'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── New Lead Dialog ──────────────────────────────────────────────── */}
      <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo Lead</DialogTitle>
            <DialogDescription>
              Agregar lead a <span className="font-medium text-foreground">{COLUMN_META.find((c) => c.key === newLeadStage)?.label}</span>
            </DialogDescription>
          </DialogHeader>
          <LeadForm
            defaultValues={{ nombre: '', email: '', telefono: '', empresa: '', notas: '', prioridad: 'media' as Priority }}
            onSubmit={addLead}
            onCancel={() => setNewLeadOpen(false)}
            submitLabel="Crear Lead"
          />
        </DialogContent>
      </Dialog>

      {/* ── Detail Sheet ─────────────────────────────────────────────────── */}
      <Sheet open={!!detailLead} onOpenChange={(open) => { if (!open) { setDetailLead(null); setEditing(false) } }}>
        <SheetContent className="sm:max-w-lg">
          {detailLead && (
            <>
              {editing ? (
                /* ── Edit mode ── */
                <>
                  <SheetHeader>
                    <SheetTitle>Editar Lead</SheetTitle>
                    <SheetDescription>Modifica la información del lead.</SheetDescription>
                  </SheetHeader>
                  <div className="px-6 pb-6 pt-2">
                    <LeadForm
                      defaultValues={{
                        nombre: detailLead.nombre,
                        email: detailLead.email,
                        telefono: detailLead.telefono,
                        empresa: detailLead.empresa,
                        notas: detailLead.notas,
                        prioridad: detailLead.prioridad,
                      }}
                      onSubmit={(values) => updateLead(detailLead.id, values)}
                      onCancel={() => setEditing(false)}
                      submitLabel="Guardar Cambios"
                    />

                    {/* Move to column */}
                    <div className="mt-4 grid gap-2">
                      <Label>Mover a etapa</Label>
                      <Select
                        value={detailLead.etapa}
                        onValueChange={(v) => moveLead(detailLead.id, v as Etapa)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COLUMN_META.map((c) => (
                            <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              ) : (
                /* ── View mode with tabs ── */
                <>
                  <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                      <span className={cn('h-3 w-3 rounded-full', PRIORITY_DOT[detailLead.prioridad])} />
                      {detailLead.nombre}
                    </SheetTitle>
                    <SheetDescription>{detailLead.empresa}</SheetDescription>
                  </SheetHeader>

                  <Tabs defaultValue="info" className="flex-1 overflow-hidden">
                    <div className="px-6">
                      <TabsList className="w-full">
                        <TabsTrigger value="info">Info</TabsTrigger>
                        <TabsTrigger value="notas">Notas</TabsTrigger>
                        <TabsTrigger value="actividades">Actividades</TabsTrigger>
                        <TabsTrigger value="ofertas">Ofertas</TabsTrigger>
                      </TabsList>
                    </div>

                    {/* ── Tab: Info ── */}
                    <TabsContent value="info" className="mt-0 px-6 pb-2">
                      <Badge variant={detailLead.prioridad === 'alta' ? 'destructive' : detailLead.prioridad === 'media' ? 'warning' : 'success'}>
                        Prioridad {PRIORITY_LABEL[detailLead.prioridad]}
                      </Badge>

                      <div className="mt-4 space-y-3">
                        {detailLead.email && (
                          <div className="flex items-center gap-3 text-sm">
                            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="text-foreground">{detailLead.email}</span>
                          </div>
                        )}
                        {detailLead.telefono && (
                          <div className="flex items-center gap-3 text-sm">
                            <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="text-foreground">{detailLead.telefono}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-sm">
                          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="text-foreground">{detailLead.empresa}</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="text-foreground">{fmtFecha(detailLead.fecha)}</span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="text-caption text-muted-foreground mb-1">Etapa</p>
                        <Badge variant="outline">{COLUMN_META.find((c) => c.key === detailLead.etapa)?.label}</Badge>
                      </div>

                      {detailLead.notas && (
                        <div className="mt-4">
                          <p className="text-caption text-muted-foreground mb-1">Notas</p>
                          <p className="text-small text-foreground whitespace-pre-wrap">{detailLead.notas}</p>
                        </div>
                      )}

                      <SheetFooter className="mt-6 flex-row gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                          <Pencil className="h-4 w-4" />
                          Editar
                        </Button>

                        <Select value={detailLead.etapa} onValueChange={(v) => { moveLead(detailLead.id, v as Etapa); setDetailLead((p) => p ? { ...p, etapa: v as Etapa } : p); toast.success(`Movido a "${COLUMN_META.find((c) => c.key === v)?.label}"`) }}>
                          <SelectTrigger className="h-9 w-auto">
                            <ArrowRight className="mr-1 h-4 w-4" />
                            <SelectValue placeholder="Mover a..." />
                          </SelectTrigger>
                          <SelectContent>
                            {COLUMN_META.filter((c) => c.key !== detailLead.etapa).map((c) => (
                              <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" className="ml-auto">
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Eliminar lead?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Se eliminará permanentemente <span className="font-medium text-foreground">{detailLead.nombre}</span> del pipeline. Esta acción no se puede deshacer.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteLead(detailLead.id)}>
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </SheetFooter>
                    </TabsContent>

                    {/* ── Tab: Notas ── */}
                    <TabsContent value="notas" className="mt-0 px-6 pb-2">
                      <div className="space-y-3">
                        {leadNotas.length === 0 ? (
                          <p className="text-caption text-muted-foreground text-center py-4">Sin notas aún</p>
                        ) : (
                          leadNotas.map((nota) => (
                            <div key={nota.id} className="rounded-lg border border-border p-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-small font-medium text-foreground">{nota.autor}</span>
                                  <span className="text-caption text-muted-foreground">{nota.fecha}</span>
                                </div>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" className="h-7 w-7">
                                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>¿Eliminar nota?</AlertDialogTitle>
                                      <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteNota(nota.id)}>Eliminar</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                              <p className="mt-1 text-small text-foreground">{nota.texto}</p>
                            </div>
                          ))
                        )}

                        {/* Add nota */}
                        <div className="flex gap-2">
                          <Input
                            placeholder="Agregar nota..."
                            value={newNotaText}
                            onChange={(e) => setNewNotaText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') addNota() }}
                          />
                          <Button size="sm" onClick={addNota} disabled={!newNotaText.trim()}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </TabsContent>

                    {/* ── Tab: Actividades ── */}
                    <TabsContent value="actividades" className="mt-0 px-6 pb-2">
                      <div className="space-y-3">
                        {leadActividades.length === 0 ? (
                          <p className="text-caption text-muted-foreground text-center py-4">Sin actividades</p>
                        ) : (
                          leadActividades.map((act) => {
                            const Icon = ACTIVIDAD_ICONS[act.tipo] ?? Clock
                            return (
                              <div key={act.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                                <button
                                  type="button"
                                  onClick={() => toggleActividad(act.id)}
                                  className="mt-0.5 shrink-0"
                                >
                                  {act.completada ? (
                                    <CheckCircle2 className="h-5 w-5 text-success" />
                                  ) : (
                                    <Circle className="h-5 w-5 text-muted-foreground" />
                                  )}
                                </button>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className={cn('text-small font-medium', act.completada && 'line-through text-muted-foreground')}>
                                      {act.descripcion}
                                    </span>
                                  </div>
                                  <p className="text-caption text-muted-foreground mt-0.5">{act.fecha}</p>
                                </div>
                                <Badge variant={act.completada ? 'success' : 'secondary'} className="shrink-0">
                                  {act.completada ? 'Hecho' : 'Pendiente'}
                                </Badge>
                              </div>
                            )
                          })
                        )}

                        <Button variant="outline" size="sm" className="w-full" onClick={() => setNewActividadOpen(true)}>
                          <Plus className="h-4 w-4" />
                          Nueva actividad
                        </Button>
                      </div>

                      {/* New activity dialog */}
                      <Dialog open={newActividadOpen} onOpenChange={setNewActividadOpen}>
                        <DialogContent className="sm:max-w-sm">
                          <DialogHeader>
                            <DialogTitle>Nueva Actividad</DialogTitle>
                          </DialogHeader>
                          <div className="grid gap-4">
                            <div className="grid gap-2">
                              <Label>Tipo</Label>
                              <Select value={newActividadTipo} onValueChange={setNewActividadTipo}>
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="llamada">Llamada</SelectItem>
                                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                  <SelectItem value="email">Email</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-2">
                              <Label>Descripción</Label>
                              <Input value={newActividadDesc} onChange={(e) => setNewActividadDesc(e.target.value)} placeholder="Descripción de la actividad" />
                            </div>
                            <div className="grid gap-2">
                              <Label>Fecha</Label>
                              <Input type="datetime-local" value={newActividadFecha} onChange={(e) => setNewActividadFecha(e.target.value)} />
                            </div>
                            <DialogFooter>
                              <Button variant="ghost" onClick={() => setNewActividadOpen(false)}>Cancelar</Button>
                              <Button onClick={addActividad} disabled={!newActividadDesc.trim()}>Crear</Button>
                            </DialogFooter>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TabsContent>

                    {/* ── Tab: Ofertas ── */}
                    <TabsContent value="ofertas" className="mt-0 px-6 pb-2">
                      <div className="space-y-3">
                        {leadOfertas.length === 0 ? (
                          <p className="text-caption text-muted-foreground text-center py-4">Sin ofertas</p>
                        ) : (
                          leadOfertas.map((oferta) => {
                            const estadoMeta = OFERTA_ESTADO[oferta.estado]
                            return (
                              <div key={oferta.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-small font-medium text-foreground">{oferta.plan}</span>
                                  </div>
                                  <p className="text-caption text-muted-foreground mt-0.5">{oferta.monto}</p>
                                </div>
                                <Badge variant={estadoMeta.variant}>{estadoMeta.label}</Badge>
                              </div>
                            )
                          })
                        )}

                        {/* Add oferta */}
                        <div className="grid gap-2 rounded-lg border border-border p-3">
                          <Input
                            placeholder="Nombre del plan"
                            value={newOfertaPlan}
                            onChange={(e) => setNewOfertaPlan(e.target.value)}
                          />
                          <Input
                            placeholder="Monto (ej: RD$1,500/mes)"
                            value={newOfertaMonto}
                            onChange={(e) => setNewOfertaMonto(e.target.value)}
                          />
                          <Button size="sm" onClick={addOferta} disabled={!newOfertaPlan.trim()}>
                            <Plus className="h-4 w-4" />
                            Nueva oferta
                          </Button>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
