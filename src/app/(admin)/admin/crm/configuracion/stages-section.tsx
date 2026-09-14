'use client'

import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Workflow, Plus, Pencil, Trash2, ChevronUp, ChevronDown, GripVertical, X, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { COLORES_ETAPA } from '../paleta'
import { updateStages } from '@/modules/crm/config-actions'
import type { StageConfig } from '@/modules/crm/queries'
import type { ConfigActionState } from '@/modules/crm/config-actions'

const STAGE_COLORS = COLORES_ETAPA

interface StagesSectionProps {
  companyId: string
  initialStages: StageConfig[]
}

export function StagesSection({ companyId, initialStages }: StagesSectionProps) {
  const [stages, setStages] = useState<StageConfig[]>(initialStages)
  const [newStageName, setNewStageName] = useState('')
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editingStageName, setEditingStageName] = useState('')
  const nextIdRef = useRef(initialStages.length + 1)

  const saveStages = async (updated: StageConfig[]) => {
    const fd = new FormData()
    fd.append('companyId', companyId)
    fd.append('stages', JSON.stringify(updated))
    await updateStages({} as ConfigActionState, fd)
  }

  const addStage = () => {
    if (!newStageName.trim()) return
    const color = STAGE_COLORS[stages.length % STAGE_COLORS.length]
    const newStage: StageConfig = { id: `s${nextIdRef.current++}`, nombre: newStageName.trim(), color }
    const updated = [...stages, newStage]
    setStages(updated)
    setNewStageName('')
    saveStages(updated)
    toast.success('Etapa agregada')
  }

  const deleteStage = (id: string) => {
    const updated = stages.filter((s) => s.id !== id)
    setStages(updated)
    saveStages(updated)
    toast.success('Etapa eliminada')
  }

  const renameStage = (id: string) => {
    if (!editingStageName.trim()) return
    const updated = stages.map((s) => (s.id === id ? { ...s, nombre: editingStageName.trim() } : s))
    setStages(updated)
    setEditingStageId(null)
    saveStages(updated)
    toast.success('Etapa renombrada')
  }

  const moveStage = (id: string, dir: -1 | 1) => {
    const idx = stages.findIndex((s) => s.id === id)
    if (idx === -1) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= stages.length) return
    const updated = [...stages]
    ;[updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]]
    setStages(updated)
    saveStages(updated)
  }

  return (
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

            <span className={cn('h-3 w-3 shrink-0 rounded-full', stage.color)} />

            {editingStageId === stage.id ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  aria-label={`Nuevo nombre de la etapa ${stage.nombre}`}
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

            <Badge variant="secondary" className="tabular-nums shrink-0">
              {i + 1}
            </Badge>

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

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => { setEditingStageId(stage.id); setEditingStageName(stage.nombre) }}
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

        <div className="flex gap-2">
          <Input
            aria-label="Nombre de la nueva etapa"
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
  )
}
