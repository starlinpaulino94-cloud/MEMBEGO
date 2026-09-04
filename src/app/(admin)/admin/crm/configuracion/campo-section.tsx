'use client'

import { useState } from 'react'
import { Settings, Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { updateCampos } from '@/modules/crm/config-actions'
import type { CampoConfig } from '@/modules/crm/queries'
import type { ConfigActionState } from '@/modules/crm/config-actions'

interface CampoSectionProps {
  companyId: string
  initialCampos: CampoConfig[]
}

export function CampoSection({ companyId, initialCampos }: CampoSectionProps) {
  const [campos, setCampos] = useState<CampoConfig[]>(initialCampos)
  const [newCampoLabel, setNewCampoLabel] = useState('')
  const [newCampoTipo, setNewCampoTipo] = useState<'text' | 'select' | 'number' | 'date'>('text')
  const [newCampoOpciones, setNewCampoOpciones] = useState('')
  const [editingCampoKey, setEditingCampoKey] = useState<string | null>(null)
  const [editingCampoLabel, setEditingCampoLabel] = useState('')

  const saveCampos = async (updated: CampoConfig[]) => {
    const fd = new FormData()
    fd.append('companyId', companyId)
    fd.append('campos', JSON.stringify(updated))
    await updateCampos({} as ConfigActionState, fd)
  }

  const addCampo = () => {
    if (!newCampoLabel.trim()) return
    const key = newCampoLabel.trim().toLowerCase().replace(/\s+/g, '_')
    const opciones = newCampoTipo === 'select'
      ? newCampoOpciones.split(',').map((o) => o.trim()).filter(Boolean)
      : []
    const newCampo: CampoConfig = { key, label: newCampoLabel.trim(), tipo: newCampoTipo, opciones, obligatorio: false }
    const updated = [...campos, newCampo]
    setCampos(updated)
    setNewCampoLabel('')
    setNewCampoOpciones('')
    saveCampos(updated)
    toast.success('Campo agregado')
  }

  const deleteCampo = (key: string) => {
    const updated = campos.filter((c) => c.key !== key)
    setCampos(updated)
    saveCampos(updated)
    toast.success('Campo eliminado')
  }

  const renameCampo = (key: string) => {
    if (!editingCampoLabel.trim()) return
    const updated = campos.map((c) => (c.key === key ? { ...c, label: editingCampoLabel.trim() } : c))
    setCampos(updated)
    setEditingCampoKey(null)
    saveCampos(updated)
    toast.success('Campo actualizado')
  }

  return (
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
                    aria-label={`Nuevo nombre del campo ${campo.label}`}
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
                    <Badge variant="secondary" className="text-caption">{campo.tipo}</Badge>
                    <span className="text-caption text-muted-foreground">key: {campo.key}</span>
                  </div>
                  {campo.tipo === 'select' && campo.opciones.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {campo.opciones.map((op) => (
                        <Badge key={op} variant="outline" className="text-caption">{op}</Badge>
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

        <div className="rounded-xl border border-border p-3 space-y-3">
          <p className="text-small font-medium text-foreground">Agregar campo</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              aria-label="Nombre del campo"
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
              aria-label="Opciones del campo, separadas por coma"
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
  )
}
