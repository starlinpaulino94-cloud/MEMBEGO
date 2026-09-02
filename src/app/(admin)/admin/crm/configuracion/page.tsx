'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Settings, Workflow, Zap, Plus, Pencil, Trash2, ChevronUp, ChevronDown, GripVertical, X, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { toast } from 'sonner'

// ── Types ───────────────────────────────────────────────────────────────────

interface Stage {
  id: string
  nombre: string
  color: string
}

interface CampoPersonalizado {
  key: string
  label: string
  tipo: 'text' | 'select' | 'number' | 'date'
  opciones: string[]
}

// ── Constants ───────────────────────────────────────────────────────────────

const STAGE_COLORS = [
  'bg-blue-500', 'bg-yellow-500', 'bg-orange-500', 'bg-purple-500', 'bg-green-500',
  'bg-pink-500', 'bg-cyan-500', 'bg-red-500', 'bg-indigo-500', 'bg-teal-500',
]

const DEFAULT_STAGES: Stage[] = [
  { id: 's1', nombre: 'Nuevo', color: 'bg-blue-500' },
  { id: 's2', nombre: 'Contactado', color: 'bg-yellow-500' },
  { id: 's3', nombre: 'Cotización', color: 'bg-orange-500' },
  { id: 's4', nombre: 'Negociación', color: 'bg-purple-500' },
  { id: 's5', nombre: 'Cerrado', color: 'bg-green-500' },
]

const DEFAULT_CAMPOS: CampoPersonalizado[] = [
  { key: 'fuente', label: 'Fuente del lead', tipo: 'select', opciones: ['WhatsApp', 'Instagram', 'Teléfono', 'Referido', 'Facebook', 'Walk-in'] },
  { key: 'presupuesto', label: 'Presupuesto estimado', tipo: 'number', opciones: [] },
  { key: 'tipoVehiculo', label: 'Tipo de vehículo', tipo: 'select', opciones: ['Sedán', 'SUV', 'Pickup', 'Van'] },
  { key: 'frecuencia', label: 'Frecuencia deseada', tipo: 'select', opciones: ['Semanal', 'Quincenal', 'Mensual', 'Ocasional'] },
]

let nextStageId = 10
let nextCampoId = 100

// ── Page ────────────────────────────────────────────────────────────────────

export default function ConfiguracionPage() {
  // ── Pipeline stages ──────────────────────────────────────────────────────
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES)
  const [newStageName, setNewStageName] = useState('')
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editingStageName, setEditingStageName] = useState('')

  const addStage = () => {
    if (!newStageName.trim()) return
    const color = STAGE_COLORS[stages.length % STAGE_COLORS.length]
    setStages((prev) => [...prev, { id: `s${nextStageId++}`, nombre: newStageName.trim(), color }])
    setNewStageName('')
    toast.success('Etapa agregada')
  }

  const deleteStage = (id: string) => {
    setStages((prev) => prev.filter((s) => s.id !== id))
    toast.success('Etapa eliminada')
  }

  const renameStage = (id: string) => {
    if (!editingStageName.trim()) return
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, nombre: editingStageName.trim() } : s)))
    setEditingStageId(null)
    toast.success('Etapa renombrada')
  }

  const moveStage = (id: string, dir: -1 | 1) => {
    setStages((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx === -1) return prev
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]]
      return copy
    })
  }

  // ── Custom fields ────────────────────────────────────────────────────────
  const [campos, setCampos] = useState<CampoPersonalizado[]>(DEFAULT_CAMPOS)
  const [newCampoLabel, setNewCampoLabel] = useState('')
  const [newCampoTipo, setNewCampoTipo] = useState<'text' | 'select' | 'number' | 'date'>('text')
  const [newCampoOpciones, setNewCampoOpciones] = useState('')
  const [editingCampoKey, setEditingCampoKey] = useState<string | null>(null)
  const [editingCampoLabel, setEditingCampoLabel] = useState('')

  const addCampo = () => {
    if (!newCampoLabel.trim()) return
    const key = newCampoLabel.trim().toLowerCase().replace(/\s+/g, '_')
    const opciones = newCampoTipo === 'select'
      ? newCampoOpciones.split(',').map((o) => o.trim()).filter(Boolean)
      : []
    setCampos((prev) => [...prev, { key, label: newCampoLabel.trim(), tipo: newCampoTipo, opciones }])
    setNewCampoLabel('')
    setNewCampoOpciones('')
    toast.success('Campo agregado')
  }

  const deleteCampo = (key: string) => {
    setCampos((prev) => prev.filter((c) => c.key !== key))
    toast.success('Campo eliminado')
  }

  const renameCampo = (key: string) => {
    if (!editingCampoLabel.trim()) return
    setCampos((prev) => prev.map((c) => (c.key === key ? { ...c, label: editingCampoLabel.trim() } : c)))
    setEditingCampoKey(null)
    toast.success('Campo actualizado')
  }

  // ── Automations ──────────────────────────────────────────────────────────
  const [autoBienvenida, setAutoBienvenida] = useState(true)
  const [autoRecordatorio, setAutoRecordatorio] = useState(true)
  const [autoRecordatorioDias, setAutoRecordatorioDias] = useState(3)
  const [autoCierre, setAutoCierre] = useState(false)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Pipeline Stages ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <Workflow className="h-4 w-4 text-muted-foreground" aria-hidden />
            Etapas del Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {stages.map((stage, i) => (
            <div
              key={stage.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />

              {/* Color dot */}
              <span className={cn('h-3 w-3 shrink-0 rounded-full', stage.color)} />

              {/* Name (editable) */}
              {editingStageId === stage.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    value={editingStageName}
                    onChange={(e) => setEditingStageName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') renameStage(stage.id); if (e.key === 'Escape') setEditingStageId(null) }}
                    className="h-8"
                    autoFocus
                  />
                  <Button size="icon-sm" variant="ghost" onClick={() => renameStage(stage.id)}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setEditingStageId(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <span className="text-small font-medium text-foreground flex-1">{stage.nombre}</span>
              )}

              {/* Order number */}
              <Badge variant="secondary" className="tabular-nums shrink-0">
                {i + 1}
              </Badge>

              {/* Reorder buttons */}
              <div className="flex flex-col shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6"
                  disabled={i === 0}
                  onClick={() => moveStage(stage.id, -1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6"
                  disabled={i === stages.length - 1}
                  onClick={() => moveStage(stage.id, 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Edit */}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => { setEditingStageId(stage.id); setEditingStageName(stage.nombre) }}
              >
                <Pencil className="h-4 w-4" />
              </Button>

              {/* Delete */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar etapa?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se eliminará <span className="font-medium text-foreground">{stage.nombre}</span>. Los leads en esta etapa se perderán.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteStage(stage.id)}>Eliminar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}

          {/* Add stage */}
          <div className="flex gap-2">
            <Input
              placeholder="Nombre de la nueva etapa"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addStage() }}
            />
            <Button onClick={addStage} disabled={!newStageName.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Custom Fields ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <Settings className="h-4 w-4 text-muted-foreground" aria-hidden />
            Campos Personalizados
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {campos.map((campo) => (
            <div
              key={campo.key}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                {editingCampoKey === campo.key ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editingCampoLabel}
                      onChange={(e) => setEditingCampoLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') renameCampo(campo.key); if (e.key === 'Escape') setEditingCampoKey(null) }}
                      className="h-8"
                      autoFocus
                    />
                    <Button size="icon-sm" variant="ghost" onClick={() => renameCampo(campo.key)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditingCampoKey(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-small font-medium text-foreground">{campo.label}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px]">{campo.tipo}</Badge>
                      <span className="text-caption text-muted-foreground">key: {campo.key}</span>
                    </div>
                    {campo.tipo === 'select' && campo.opciones.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {campo.opciones.map((op) => (
                          <Badge key={op} variant="outline" className="text-[10px]">{op}</Badge>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => { setEditingCampoKey(campo.key); setEditingCampoLabel(campo.label) }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar campo?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se eliminará el campo <span className="font-medium text-foreground">{campo.label}</span>. Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteCampo(campo.key)}>Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}

          {/* Add field */}
          <div className="rounded-xl border border-border p-3 space-y-3">
            <p className="text-small font-medium text-foreground">Agregar campo</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Nombre del campo"
                value={newCampoLabel}
                onChange={(e) => setNewCampoLabel(e.target.value)}
              />
              <Select value={newCampoTipo} onValueChange={(v) => setNewCampoTipo(v as typeof newCampoTipo)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="select">Selección</SelectItem>
                  <SelectItem value="number">Número</SelectItem>
                  <SelectItem value="date">Fecha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newCampoTipo === 'select' && (
              <Input
                placeholder="Opciones separadas por coma"
                value={newCampoOpciones}
                onChange={(e) => setNewCampoOpciones(e.target.value)}
              />
            )}
            <Button onClick={addCampo} disabled={!newCampoLabel.trim()} size="sm">
              <Plus className="h-4 w-4" />
              Agregar campo
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Automatizaciones ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
            Automatizaciones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Bienvenida */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <div className="min-w-0">
              <p className="text-small font-medium text-foreground">Mensaje de bienvenida</p>
              <p className="text-caption text-muted-foreground">Envía un saludo cuando un lead entra al pipeline</p>
            </div>
            <Switch checked={autoBienvenida} onCheckedChange={setAutoBienvenida} />
          </div>

          {/* Recordatorio */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <div className="min-w-0 flex-1">
              <p className="text-small font-medium text-foreground">Recordatorio de seguimiento</p>
              <p className="text-caption text-muted-foreground">Avisa si un lead lleva días sin contacto</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {autoRecordatorio && (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={autoRecordatorioDias}
                    onChange={(e) => setAutoRecordatorioDias(Number(e.target.value) || 3)}
                    className="h-8 w-16 text-center tabular-nums"
                  />
                  <span className="text-caption text-muted-foreground">días</span>
                </div>
              )}
              <Switch checked={autoRecordatorio} onCheckedChange={setAutoRecordatorio} />
            </div>
          </div>

          {/* Cierre */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <div className="min-w-0">
              <p className="text-small font-medium text-foreground">Confirmación de cierre</p>
              <p className="text-caption text-muted-foreground">Notifica cuando un lead se marca como cerrado</p>
            </div>
            <Switch checked={autoCierre} onCheckedChange={setAutoCierre} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


