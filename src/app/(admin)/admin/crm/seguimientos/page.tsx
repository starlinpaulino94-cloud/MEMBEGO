'use client'

import { useState, useMemo } from 'react'
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
import {
  Phone,
  Mail,
  MessageCircle,
  MapPin,
  Calendar,
  Clock,
  CheckCircle2,
  Plus,
  Search,
} from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────────

interface Actividad {
  id: string
  lead: string
  tipo: string
  descripcion: string
  fecha: string
  estado: 'pendiente' | 'completada'
  resultado: string
}

// ── Constants ───────────────────────────────────────────────────────────────

const TIPO_ICON: Record<string, typeof Phone> = {
  Llamada: Phone,
  Email: Mail,
  WhatsApp: MessageCircle,
  Visita: MapPin,
  Reunión: Calendar,
}

const TIPO_COLORS: Record<string, string> = {
  Llamada: 'bg-blue-100 text-blue-700',
  Email: 'bg-purple-100 text-purple-700',
  WhatsApp: 'bg-green-100 text-green-700',
  Visita: 'bg-orange-100 text-orange-700',
  Reunión: 'bg-cyan-100 text-cyan-700',
}

const RESULTADO_BADGE: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'info' }> = {
  contactado: { label: 'Contactado', variant: 'info' },
  interesado: { label: 'Interesado', variant: 'success' },
  rechazado: { label: 'Rechazado', variant: 'destructive' },
  'sin respuesta': { label: 'Sin respuesta', variant: 'warning' },
}

const MOCK_LEADS = [
  'María García', 'Carlos Rodríguez', 'Ana Martínez', 'Pedro López',
  'Laura Sánchez', 'Roberto Díaz', 'Sofía Hernández', 'Miguel Fernández',
  'Valeria Torres', 'Juan Castillo',
]

const INITIAL_ACTIVIDADES: Actividad[] = [
  { id: '1', lead: 'María García', tipo: 'Llamada', descripcion: 'Llamada inicial de presentación', fecha: '2026-09-02 10:00', estado: 'pendiente', resultado: '' },
  { id: '2', lead: 'Carlos Rodríguez', tipo: 'Email', descripcion: 'Envío de catálogo de servicios', fecha: '2026-09-01 15:30', estado: 'completada', resultado: 'interesado' },
  { id: '3', lead: 'Ana Martínez', tipo: 'WhatsApp', descripcion: 'Seguimiento post-visita', fecha: '2026-09-01 09:00', estado: 'pendiente', resultado: '' },
  { id: '4', lead: 'Pedro López', tipo: 'Llamada', descripcion: 'Confirmación de cita', fecha: '2026-08-30 14:00', estado: 'completada', resultado: 'contactado' },
  { id: '5', lead: 'Laura Sánchez', tipo: 'Visita', descripcion: 'Visita a local para demo', fecha: '2026-08-29 11:00', estado: 'completada', resultado: 'interesado' },
  { id: '6', lead: 'Roberto Díaz', tipo: 'Reunión', descripcion: 'Reunión de negociación', fecha: '2026-09-03 09:00', estado: 'pendiente', resultado: '' },
  { id: '7', lead: 'Sofía Hernández', tipo: 'WhatsApp', descripcion: 'Envío de propuesta comercial', fecha: '2026-08-28 16:00', estado: 'completada', resultado: 'interesado' },
  { id: '8', lead: 'Miguel Fernández', tipo: 'Email', descripcion: 'Contrato para revisión', fecha: '2026-08-27 10:00', estado: 'completada', resultado: 'interesado' },
  { id: '9', lead: 'Valeria Torres', tipo: 'Llamada', descripcion: 'Primer contacto por referido', fecha: '2026-09-01 11:30', estado: 'completada', resultado: 'contactado' },
  { id: '10', lead: 'Juan Castillo', tipo: 'Visita', descripcion: 'Inspección de local para-instalación', fecha: '2026-09-04 10:00', estado: 'pendiente', resultado: '' },
]

let nextId = 11

// ── Page ────────────────────────────────────────────────────────────────────

export default function SeguimientosPage() {
  const [actividades, setActividades] = useState<Actividad[]>(INITIAL_ACTIVIDADES)
  const [search, setSearch] = useState('')
  const [tipoFilter, setTipoFilter] = useState('todas')
  const [estadoFilter, setEstadoFilter] = useState('todas')

  // New activity dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    lead: '',
    tipo: 'Llamada',
    descripcion: '',
    fecha: '',
    resultado: '',
  })

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return actividades.filter((a) => {
      if (q && !a.lead.toLowerCase().includes(q) && !a.descripcion.toLowerCase().includes(q)) return false
      if (tipoFilter !== 'todas' && a.tipo !== tipoFilter) return false
      if (estadoFilter === 'pendiente' && a.estado !== 'pendiente') return false
      if (estadoFilter === 'completada' && a.estado !== 'completada') return false
      return true
    })
  }, [actividades, search, tipoFilter, estadoFilter])

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleEstado = (id: string) => {
    setActividades((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, estado: a.estado === 'pendiente' ? 'completada' : 'pendiente' } : a,
      ),
    )
    toast.success('Estado actualizado')
  }

  const addActividad = () => {
    if (!form.lead || !form.descripcion.trim()) {
      toast.error('Lead y descripción son obligatorios')
      return
    }
    const nueva: Actividad = {
      id: String(nextId++),
      lead: form.lead,
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      fecha: form.fecha || new Date().toISOString().slice(0, 16).replace('T', ' '),
      estado: 'pendiente',
      resultado: form.resultado,
    }
    setActividades((prev) => [nueva, ...prev])
    setForm({ lead: '', tipo: 'Llamada', descripcion: '', fecha: '', resultado: '' })
    setDialogOpen(false)
    toast.success('Actividad creada')
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
            <SelectItem value="Llamada">Llamada</SelectItem>
            <SelectItem value="Email">Email</SelectItem>
            <SelectItem value="WhatsApp">WhatsApp</SelectItem>
            <SelectItem value="Visita">Visita</SelectItem>
            <SelectItem value="Reunión">Reunión</SelectItem>
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
            const resultadoMeta = act.resultado ? RESULTADO_BADGE[act.resultado] : null
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
                      <p className="text-small font-medium text-foreground">{act.lead}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {act.tipo}
                      </Badge>
                    </div>
                    <p className="text-small text-muted-foreground mt-0.5">{act.descripcion}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="text-caption text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {act.fecha}
                      </span>
                      {resultadoMeta && (
                        <Badge variant={resultadoMeta.variant} className="text-[10px]">
                          {resultadoMeta.label}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Status + action */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge variant={act.estado === 'completada' ? 'success' : 'warning'}>
                      {act.estado === 'completada' ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Clock className="h-3 w-3" />
                      )}
                      {act.estado === 'completada' ? 'Completada' : 'Pendiente'}
                    </Badge>
                    {act.estado === 'pendiente' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleEstado(act.id)}
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
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Lead *</Label>
              <Select value={form.lead} onValueChange={(v) => setForm((p) => ({ ...p, lead: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar lead" />
                </SelectTrigger>
                <SelectContent>
                  {MOCK_LEADS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Tipo *</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((p) => ({ ...p, tipo: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Llamada">Llamada</SelectItem>
                  <SelectItem value="Email">Email</SelectItem>
                  <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                  <SelectItem value="Visita">Visita</SelectItem>
                  <SelectItem value="Reunión">Reunión</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Descripción *</Label>
              <Textarea
                value={form.descripcion}
                onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))}
                placeholder="Describe la actividad..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label>Fecha programada</Label>
              <Input
                type="datetime-local"
                value={form.fecha}
                onChange={(e) => setForm((p) => ({ ...p, fecha: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Resultado (opcional)</Label>
              <Select value={form.resultado} onValueChange={(v) => setForm((p) => ({ ...p, resultado: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sin resultado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin resultado</SelectItem>
                  <SelectItem value="contactado">Contactado</SelectItem>
                  <SelectItem value="sin respuesta">Sin respuesta</SelectItem>
                  <SelectItem value="interesado">Interesado</SelectItem>
                  <SelectItem value="rechazado">Rechazado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={addActividad}>Crear actividad</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
