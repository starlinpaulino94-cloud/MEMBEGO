'use client'

import { useState, useCallback, useActionState } from 'react'
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
import { ETAPA_CHIP, PRIORIDAD_PUNTO } from './paleta'
import { toast } from 'sonner'
import {
  Plus,
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
import {
  createLead,
  updateLead,
  deleteLead,
  moveToStage,
  fetchLeadDetails,
  type LeadActionState,
} from '@/modules/crm/lead-actions'
import {
  createNota,
  deleteNota,
  type NotaActionState,
} from '@/modules/crm/nota-actions'
import type {
  Lead,
  LeadEtapa,
  LeadPrioridad,
  CrmStats,
  NotaSeguimiento,
} from '@/modules/crm/types'

type LeadDetalle = Lead & { notasSeguimiento: NotaSeguimiento[] }

type Filters = {
  q: string
  etapa?: LeadEtapa
  prioridad?: LeadPrioridad
  estado?: string
  fuente?: string
  canal?: string
}

type ColumnMetaItem = { key: LeadEtapa; label: string }

const PRIORITY_DOT: Record<string, string> = PRIORIDAD_PUNTO
const PRIORITY_LABEL: Record<string, string> = {
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
  URGENTE: 'Urgente',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}
const ETAPA_LABEL: Record<string, string> = {
  NUEVO: 'Nuevo',
  CONTACTADO: 'Contactado',
  INTERESADO: 'Interesado',
  PROPUESTA: 'Propuesta',
  NEGOCIACION: 'Negociación',
  GANADO: 'Ganado',
  PERDIDO: 'Perdido',
}

const ACTIVIDAD_ICONS: Record<string, typeof Clock> = {
  LLAMADA: Phone,
  WHATSAPP: MessageSquare,
  EMAIL: Mail,
}

const fmtFecha = (f: string | Date) =>
  new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(f))

function LeadCard({
  lead,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  lead: Lead
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onClick: () => void
}) {
  return (
    <Card
      draggable
      onDragStart={() => onDragStart(lead.id)}
      onDragEnd={onDragEnd}
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
          <p className="text-caption text-muted-foreground mt-1">{fmtFecha(lead.createdAt)}</p>
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
  defaultValues: { nombre: string; email: string; telefono: string; notas: string; prioridad: string }
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
        if (!form.nombre.trim()) {
          toast.error('El nombre es obligatorio')
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
        <Label htmlFor="f-prioridad">Prioridad</Label>
        <Select value={form.prioridad} onValueChange={(v) => setForm((p) => ({ ...p, prioridad: v }))}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BAJA">Baja</SelectItem>
            <SelectItem value="MEDIA">Media</SelectItem>
            <SelectItem value="ALTA">Alta</SelectItem>
            <SelectItem value="URGENTE">Urgente</SelectItem>
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

export function PipelineBoard({
  leads,
  stats,
  total,
  pagina,
  totalPaginas,
  filters,
  columnMeta,
}: {
  leads: Lead[]
  stats: CrmStats
  total: number
  pagina: number
  totalPaginas: number
  filters: Filters
  columnMeta: readonly ColumnMetaItem[]
}) {
  const router = useRouter()

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [newLeadStage, setNewLeadStage] = useState<LeadEtapa>('NUEVO')
  const [detailLead, setDetailLead] = useState<LeadDetalle | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)

  const [notaText, setNotaText] = useState('')
  const [notaState, createNotaAction] = useActionState(createNota, {} as NotaActionState)
  const [delNotaState, deleteNotaAction] = useActionState(deleteNota, {} as NotaActionState)

  const [leadState, createLeadAction] = useActionState(createLead, {} as LeadActionState)
  const [updState, updateLeadAction] = useActionState(updateLead, {} as LeadActionState)
  const [delState, deleteLeadAction] = useActionState(deleteLead, {} as LeadActionState)
  const [moveState, moveToStageAction] = useActionState(moveToStage, {} as LeadActionState)

  const leadsByCol = useCallback(
    (col: LeadEtapa): Lead[] => {
      const q = filters.q.toLowerCase()
      return leads.filter((l) => {
        if (l.etapa !== col) return false
        if (q && !l.nombre.toLowerCase().includes(q) && !(l.email ?? '').toLowerCase().includes(q)) return false
        return true
      })
    },
    [leads, filters.q],
  )

  const onDragStart = useCallback((id: string) => setDraggedId(id), [])
  const onDragEnd = useCallback(() => { setDraggedId(null); setOverColumn(null) }, [])
  const onDragOver = useCallback((e: React.DragEvent, col: string) => { e.preventDefault(); setOverColumn(col) }, [])
  const onDragLeave = useCallback(() => setOverColumn(null), [])

  const onDrop = useCallback(
    async (col: LeadEtapa) => {
      if (draggedId) {
        const fd = new FormData()
        fd.set('leadId', draggedId)
        fd.set('etapa', col)
        await moveToStageAction(fd)
        toast.success(`Lead movido a "${ETAPA_LABEL[col] ?? col}"`)
        router.refresh()
      }
      setDraggedId(null)
      setOverColumn(null)
    },
    [draggedId, moveToStageAction, router],
  )

  const handleCreateLead = useCallback(
    async (values: { nombre: string; email: string; telefono: string; notas: string; prioridad: string }) => {
      const fd = new FormData()
      fd.set('nombre', values.nombre)
      fd.set('email', values.email)
      fd.set('telefono', values.telefono)
      fd.set('notas', values.notas)
      fd.set('prioridad', values.prioridad)
      await createLeadAction(fd)
      setNewLeadOpen(false)
      toast.success(`Lead "${values.nombre}" creado`)
      router.refresh()
    },
    [createLeadAction, router],
  )

  const handleUpdateLead = useCallback(
    async (lead: Lead, values: { nombre: string; email: string; telefono: string; notas: string; prioridad: string }) => {
      const fd = new FormData()
      fd.set('leadId', lead.id)
      fd.set('nombre', values.nombre)
      fd.set('email', values.email)
      fd.set('telefono', values.telefono)
      fd.set('notas', values.notas)
      fd.set('prioridad', values.prioridad)
      await updateLeadAction(fd)
      setEditing(false)
      toast.success('Lead actualizado')
      router.refresh()
    },
    [updateLeadAction, router],
  )

  const handleDeleteLead = useCallback(
    async (id: string) => {
      const fd = new FormData()
      fd.set('leadId', id)
      await deleteLeadAction(fd)
      setDetailLead(null)
      toast.success('Lead eliminado')
      router.refresh()
    },
    [deleteLeadAction, router],
  )

  const handleMoveLead = useCallback(
    async (id: string, etapa: LeadEtapa) => {
      const fd = new FormData()
      fd.set('leadId', id)
      fd.set('etapa', etapa)
      await moveToStageAction(fd)
      toast.success(`Movido a "${ETAPA_LABEL[etapa] ?? etapa}"`)
      router.refresh()
    },
    [moveToStageAction, router],
  )

  const handleAddNota = useCallback(async () => {
    if (!notaText.trim() || !detailLead) return
    const fd = new FormData()
    fd.set('leadId', detailLead.id)
    fd.set('contenido', notaText.trim())
    await createNotaAction(fd)
    setNotaText('')
    toast.success('Nota agregada')
    router.refresh()
  }, [notaText, detailLead, createNotaAction, router])

  const handleDeleteNota = useCallback(
    async (notaId: string) => {
      const fd = new FormData()
      fd.set('notaId', notaId)
      await deleteNotaAction(fd)
      toast.success('Nota eliminada')
      router.refresh()
    },
    [deleteNotaAction, router],
  )

  return (
    <>
      {/* Stats summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-caption text-muted-foreground">Total Leads</p>
            <p className="text-2xl font-bold">{stats.totalLeads}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-caption text-muted-foreground">Nuevos Hoy</p>
            <p className="text-2xl font-bold">{stats.leadsNuevosHoy}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-caption text-muted-foreground">Seguimientos Pendientes</p>
            <p className="text-2xl font-bold">{stats.seguimientosPendientes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-caption text-muted-foreground">En Pipeline</p>
            <p className="text-2xl font-bold">
              {stats.totalLeads - (stats.leadsPorEstado?.DESCARTADO ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Kanban columns */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columnMeta.map((col) => {
          const colLeads = leadsByCol(col.key)
          const isOver = overColumn === col.key
          const chipClass = (ETAPA_CHIP as Record<string, string>)[col.key] ?? 'bg-muted text-muted-foreground'
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
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-small font-medium">{col.label}</h3>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', chipClass)}>
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

                <div className="space-y-3">
                  {colLeads.length > 0 ? (
                    colLeads.map((lead) => (
                      <div key={lead.id} className={cn(draggedId === lead.id && 'opacity-50')}>
                        <LeadCard
                          lead={lead}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onClick={async () => {
                            setDetailLoading(true)
                            setEditing(false)
                            const full = await fetchLeadDetails(lead.id)
                            if (full) {
                              setDetailLead(full as LeadDetalle)
                            } else {
                              setDetailLead({ ...lead, notasSeguimiento: [] } as LeadDetalle)
                            }
                            setDetailLoading(false)
                          }}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/60 py-8 text-center">
                      <p className="text-caption text-muted-foreground">
                        {filters.q ? 'Sin resultados' : 'Arrastra un lead aquí'}
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
              Agregar lead a <span className="font-medium text-foreground">{ETAPA_LABEL[newLeadStage] ?? newLeadStage}</span>
            </DialogDescription>
          </DialogHeader>
          <LeadForm
            defaultValues={{ nombre: '', email: '', telefono: '', notas: '', prioridad: 'MEDIA' }}
            onSubmit={handleCreateLead}
            onCancel={() => setNewLeadOpen(false)}
            submitLabel="Crear Lead"
          />
        </DialogContent>
      </Dialog>

      {/* ── Detail Sheet ─────────────────────────────────────────────────── */}
      <Sheet open={!!detailLead || detailLoading} onOpenChange={(open) => { if (!open) { setDetailLead(null); setEditing(false); setDetailLoading(false) } }}>
        <SheetContent className="sm:max-w-lg">
          {detailLoading && !detailLead ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">Cargando...</p>
            </div>
          ) : detailLead && (
            <>
              {editing ? (
                <>
                  <SheetHeader>
                    <SheetTitle>Editar Lead</SheetTitle>
                    <SheetDescription>Modifica la información del lead.</SheetDescription>
                  </SheetHeader>
                  <div className="px-6 pb-6 pt-2">
                    <LeadForm
                      defaultValues={{
                        nombre: detailLead.nombre,
                        email: detailLead.email ?? '',
                        telefono: detailLead.telefono ?? '',
                        notas: detailLead.notas ?? '',
                        prioridad: detailLead.prioridad,
                      }}
                      onSubmit={(values) => handleUpdateLead(detailLead, values)}
                      onCancel={() => setEditing(false)}
                      submitLabel="Guardar Cambios"
                    />

                    <div className="mt-4 grid gap-2">
                      <Label>Mover a etapa</Label>
                      <Select
                        value={detailLead.etapa}
                        onValueChange={(v) => handleMoveLead(detailLead.id, v as LeadEtapa)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {columnMeta.map((c) => (
                            <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                      <span className={cn('h-3 w-3 rounded-full', PRIORITY_DOT[detailLead.prioridad])} />
                      {detailLead.nombre}
                    </SheetTitle>
                    <SheetDescription>{ETAPA_LABEL[detailLead.etapa] ?? detailLead.etapa}</SheetDescription>
                  </SheetHeader>

                  <Tabs defaultValue="info" className="flex-1 overflow-hidden">
                    <div className="px-6">
                      <TabsList className="w-full">
                        <TabsTrigger value="info">Info</TabsTrigger>
                        <TabsTrigger value="notas">Notas</TabsTrigger>
                      </TabsList>
                    </div>

                    {/* Tab: Info */}
                    <TabsContent value="info" className="mt-0 px-6 pb-2">
                      <Badge variant={detailLead.prioridad === 'ALTA' || detailLead.prioridad === 'URGENTE' ? 'destructive' : detailLead.prioridad === 'MEDIA' ? 'warning' : 'success'}>
                        Prioridad {PRIORITY_LABEL[detailLead.prioridad] ?? detailLead.prioridad}
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
                          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="text-foreground">{fmtFecha(detailLead.createdAt)}</span>
                        </div>
                        {detailLead.fuente && (
                          <div className="flex items-center gap-3 text-sm">
                            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="text-foreground">Fuente: {detailLead.fuente}</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-4">
                        <p className="text-caption text-muted-foreground mb-1">Etapa</p>
                        <Badge variant="outline">{ETAPA_LABEL[detailLead.etapa] ?? detailLead.etapa}</Badge>
                      </div>

                      {detailLead.notas && (
                        <div className="mt-4">
                          <p className="text-caption text-muted-foreground mb-1">Notas</p>
                          <p className="text-small text-foreground whitespace-pre-wrap">{detailLead.notas}</p>
                        </div>
                      )}

                      {detailLead.tags.length > 0 && (
                        <div className="mt-4">
                          <p className="text-caption text-muted-foreground mb-1">Tags</p>
                          <div className="flex flex-wrap gap-1">
                            {detailLead.tags.map((tag) => (
                              <Badge key={tag} variant="secondary">{tag}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      <SheetFooter className="mt-6 flex-row gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                          <Pencil className="h-4 w-4" />
                          Editar
                        </Button>

                        <Select value={detailLead.etapa} onValueChange={(v) => handleMoveLead(detailLead.id, v as LeadEtapa)}>
                          <SelectTrigger className="h-9 w-auto">
                            <ArrowRight className="mr-1 h-4 w-4" />
                            <SelectValue placeholder="Mover a..." />
                          </SelectTrigger>
                          <SelectContent>
                            {columnMeta.filter((c) => c.key !== detailLead.etapa).map((c) => (
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
                              <AlertDialogAction onClick={() => handleDeleteLead(detailLead.id)}>
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </SheetFooter>
                    </TabsContent>

                    {/* Tab: Notas */}
                    <TabsContent value="notas" className="mt-0 px-6 pb-2">
                      <div className="space-y-3">
                        {detailLead.notasSeguimiento?.length === 0 || !detailLead.notasSeguimiento ? (
                          <p className="text-caption text-muted-foreground text-center py-4">Sin notas aún</p>
                        ) : (
                          detailLead.notasSeguimiento.map((nota) => (
                            <div key={nota.id} className="rounded-lg border border-border p-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-small font-medium text-foreground">{nota.tipo}</span>
                                  <span className="text-caption text-muted-foreground">{fmtFecha(nota.createdAt)}</span>
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
                                      <AlertDialogAction onClick={() => handleDeleteNota(nota.id)}>Eliminar</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                              <p className="mt-1 text-small text-foreground">{nota.contenido}</p>
                            </div>
                          ))
                        )}

                        <div className="flex gap-2">
                          <Input
                            aria-label="Agregar nota"
                            placeholder="Agregar nota..."
                            value={notaText}
                            onChange={(e) => setNotaText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddNota() }}
                          />
                          <Button size="sm" onClick={handleAddNota} disabled={!notaText.trim()}>
                            <Plus className="h-4 w-4" />
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
    </>
  )
}
