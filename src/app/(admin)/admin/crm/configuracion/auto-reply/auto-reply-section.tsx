'use client'

import { useState, useTransition } from 'react'
import { MessageSquare, Plus, Trash2, Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import {
  createAutoReplyConfig,
  updateAutoReplyConfig,
  deleteAutoReplyConfig,
} from '@/modules/connect/autoReply-actions'
import type { AutoReplyConfig } from '@prisma/client'

interface AutoReplySectionProps {
  companyId: string
  initialConfigs: AutoReplyConfig[]
}

type FormData = {
  nombre: string
  keywords: string
  esBienvenida: boolean
  tipoRespuesta: string
  contenido: string
  catalogoPath: string
  activa: boolean
  orden: number
}

const emptyForm: FormData = {
  nombre: '',
  keywords: '',
  esBienvenida: false,
  tipoRespuesta: 'TEXTO',
  contenido: '',
  catalogoPath: '',
  activa: true,
  orden: 0,
}

export function AutoReplySection({ companyId, initialConfigs }: AutoReplySectionProps) {
  const [configs, setConfigs] = useState<AutoReplyConfig[]>(initialConfigs)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const save = async (action: () => Promise<void>) => {
    startTransition(async () => {
      await action()
    })
  }

  const handleCreate = () => {
    if (!form.nombre.trim() || !form.contenido.trim()) {
      toast.error('Nombre y contenido son requeridos')
      return
    }

    save(async () => {
      const result = await createAutoReplyConfig(companyId, {
        nombre: form.nombre.trim(),
        keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
        esBienvenida: form.esBienvenida,
        tipoRespuesta: form.tipoRespuesta,
        contenido: form.contenido.trim(),
        catalogoPath: form.catalogoPath.trim() || null,
        activa: form.activa,
        orden: form.orden,
      })

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      const newConfig = result.data as AutoReplyConfig
      setConfigs((prev) => [...prev, newConfig])
      setForm(emptyForm)
      setDialogOpen(false)
      toast.success('Configuración creada')
    })
  }

  const handleEdit = () => {
    if (!editingId || !form.nombre.trim() || !form.contenido.trim()) {
      toast.error('Nombre y contenido son requeridos')
      return
    }

    save(async () => {
      const result = await updateAutoReplyConfig(editingId, companyId, {
        nombre: form.nombre.trim(),
        keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
        esBienvenida: form.esBienvenida,
        tipoRespuesta: form.tipoRespuesta,
        contenido: form.contenido.trim(),
        catalogoPath: form.catalogoPath.trim() || null,
        activa: form.activa,
        orden: form.orden,
      })

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      const updated = result.data as AutoReplyConfig
      setConfigs((prev) => prev.map((c) => (c.id === editingId ? updated : c)))
      setEditingId(null)
      setForm(emptyForm)
      setDialogOpen(false)
      toast.success('Configuración actualizada')
    })
  }

  const handleToggle = (id: string, activa: boolean) => {
    save(async () => {
      const result = await updateAutoReplyConfig(id, companyId, { activa })

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, activa } : c)))
      toast.success(activa ? 'Activada' : 'Desactivada')
    })
  }

  const handleDelete = (id: string) => {
    save(async () => {
      const result = await deleteAutoReplyConfig(id, companyId)

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      setConfigs((prev) => prev.filter((c) => c.id !== id))
      toast.success('Configuración eliminada')
    })
  }

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
    setDialogOpen(false)
  }

  const openEditDialog = (config: AutoReplyConfig) => {
    setEditingId(config.id)
    setForm({
      nombre: config.nombre,
      keywords: config.keywords.join(', '),
      esBienvenida: config.esBienvenida,
      tipoRespuesta: config.tipoRespuesta,
      contenido: config.contenido,
      catalogoPath: config.catalogoPath ?? '',
      activa: config.activa,
      orden: config.orden,
    })
    setDialogOpen(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-h4">
          <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
          Auto-Reply (Respuestas Automáticas)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {configs.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No hay configuraciones de auto-reply creadas.
          </p>
        )}

        {configs.map((config) => (
          <div
            key={config.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-small font-medium text-foreground">{config.nombre}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="secondary" className="text-caption">{config.tipoRespuesta}</Badge>
                {config.esBienvenida && (
                  <Badge variant="outline" className="text-caption">Bienvenida</Badge>
                )}
                {config.keywords.length > 0 && (
                  <span className="text-caption text-muted-foreground">
                    {config.keywords.length} keyword{config.keywords.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {config.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {config.keywords.slice(0, 3).map((kw) => (
                    <Badge key={kw} variant="outline" className="text-caption">{kw}</Badge>
                  ))}
                  {config.keywords.length > 3 && (
                    <Badge variant="outline" className="text-caption">
                      +{config.keywords.length - 3}
                    </Badge>
                  )}
                </div>
              )}
              <p className="text-caption text-muted-foreground mt-1 line-clamp-1">
                {config.contenido}
              </p>
              {config.catalogoPath && (
                <p className="text-caption text-muted-foreground mt-0.5">
                  Catálogo: {config.catalogoPath}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Switch
                checked={config.activa}
                onCheckedChange={(val) => handleToggle(config.id, val)}
                disabled={isPending}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openEditDialog(config)}
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
                    <AlertDialogTitle>¿Eliminar configuración?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se eliminará <span className="font-medium text-foreground">{config.nombre}</span>. Esta acción no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDelete(config.id)}>Eliminar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}

        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open) }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => { setForm(emptyForm); setEditingId(null) }}>
              <Plus className="h-4 w-4" />
              Crear nuevo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Editar configuración' : 'Nueva configuración de auto-reply'}</DialogTitle>
              <DialogDescription>
                {editingId
                  ? 'Modifica los campos de la configuración seleccionada.'
                  : 'Define las reglas para respuestas automáticas a mensajes entrantes.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label htmlFor="nombre" className="text-small font-medium">Nombre *</label>
                <Input
                  id="nombre"
                  placeholder="Ej: Saludo bienvenida"
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="keywords" className="text-small font-medium">Keywords (separadas por coma)</label>
                <Input
                  id="keywords"
                  placeholder="Ej: hola, saludo, bienvenido"
                  value={form.keywords}
                  onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="esBienvenida"
                  checked={form.esBienvenida}
                  onCheckedChange={(val) => setForm((f) => ({ ...f, esBienvenida: val }))}
                />
                <label htmlFor="esBienvenida" className="text-small font-medium cursor-pointer">
                  Mensaje de bienvenida (primer contacto)
                </label>
              </div>
              <div className="space-y-2">
                <label htmlFor="tipo" className="text-small font-medium">Tipo de respuesta</label>
                <Select
                  value={form.tipoRespuesta}
                  onValueChange={(val) => setForm((f) => ({ ...f, tipoRespuesta: val }))}
                >
                  <SelectTrigger id="tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TEXTO">Texto</SelectItem>
                    <SelectItem value="IMAGEN">Imagen</SelectItem>
                    <SelectItem value="DOCUMENTO">Documento</SelectItem>
                    <SelectItem value="CATALOGO">Catálogo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.tipoRespuesta === 'CATALOGO' && (
                <div className="space-y-2">
                  <label htmlFor="catalogoPath" className="text-small font-medium">Ruta del catálogo</label>
                  <Input
                    id="catalogoPath"
                    placeholder="URL del catálogo o ruta, ej. /excursiones"
                    value={form.catalogoPath}
                    onChange={(e) => setForm((f) => ({ ...f, catalogoPath: e.target.value }))}
                  />
                </div>
              )}
              <div className="space-y-2">
                <label htmlFor="contenido" className="text-small font-medium">Contenido *</label>
                <Input
                  id="contenido"
                  placeholder="Texto de la respuesta automática"
                  value={form.contenido}
                  onChange={(e) => setForm((f) => ({ ...f, contenido: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="orden" className="text-small font-medium">Orden de prioridad</label>
                <Input
                  id="orden"
                  type="number"
                  min={0}
                  value={form.orden}
                  onChange={(e) => setForm((f) => ({ ...f, orden: Number(e.target.value) }))}
                  className="w-24"
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" onClick={resetForm}>Cancelar</Button>
              </DialogClose>
              <Button onClick={editingId ? handleEdit : handleCreate} disabled={isPending}>
                {isPending ? 'Guardando...' : editingId ? 'Guardar' : 'Crear'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
