'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useFormStatus } from 'react-dom'
import { Loader2, Send, Upload, X, FileText, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { pedirSubidaComprobante } from '@/modules/storage/comprobantes'
import { crearTicket, type ActionState } from '@/modules/soporte/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TICKET_CATEGORIAS, categoriaLabel } from '@/lib/soporte'

const init: ActionState = {}
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_MB = 5

function SubmitBtn({ uploading }: { uploading: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || uploading}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
      Enviar reporte
    </Button>
  )
}

export function ReportarProblemaForm() {
  const [state, action] = useActionState(crearTicket, init)
  const formRef = useRef<HTMLFormElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [adjuntoUrl, setAdjuntoUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)
  const [uploading, setUploading] = useState(false)

  function clearAdjunto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setAdjuntoUrl('')
    setFileName('')
    setIsPdf(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  useEffect(() => {
    if (state.success) toast.success(state.message ?? 'Reporte enviado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error, state.message])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // Al enviarse, mostramos confirmación en vez de resetear el estado dentro del
  // efecto (evita setState-in-effect). "Reportar otro" recarga con formulario
  // limpio y con el nuevo ticket ya visible en la lista.
  if (state.success) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-success/10 p-6 text-center">
        <CheckCircle2 className="h-8 w-8 text-success" />
        <div>
          <p className="font-medium text-success">Reporte enviado</p>
          <p className="text-sm text-success">
            Te avisaremos cuando el equipo responda. Puedes ver su estado en “Mis
            reportes”.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          Reportar otro problema
        </Button>
      </div>
    )
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!ALLOWED.includes(file.type)) {
      toast.error('Solo se aceptan imágenes (JPG, PNG) o PDF.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`El archivo no puede superar ${MAX_MB} MB.`)
      return
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const pdf = file.type === 'application/pdf'
    setIsPdf(pdf)
    setPreviewUrl(pdf ? null : URL.createObjectURL(file))

    setUploading(true)
    try {
      // El adjunto de soporte va al mismo bucket privado y sigue la misma
      // regla (auditoría · C-01): la ruta la genera el servidor y queda atada
      // a quien reporta. El ticket todavía no existe en este punto, así que la
      // entidad es la propia persona.
      const ext = file.name.split('.').pop() ?? 'jpg'
      const permiso = await pedirSubidaComprobante('soporte', 'yo', ext)
      if (permiso.error || !permiso.subida) {
        toast.error(permiso.error ?? 'No se pudo preparar la subida.')
        clearAdjunto()
        return
      }
      const supabase = createClient()
      const { error } = await supabase.storage
        .from('comprobantes')
        .uploadToSignedUrl(permiso.subida.path, permiso.subida.token, file)
      if (error) throw error
      setAdjuntoUrl(permiso.subida.path)
      setFileName(file.name)
      toast.success('Archivo adjuntado.')
    } catch {
      toast.error('No se pudo subir el archivo. Intenta de nuevo.')
      clearAdjunto()
    } finally {
      setUploading(false)
    }
  }

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="adjuntoUrl" value={adjuntoUrl} />

      <div className="space-y-1.5">
        <Label htmlFor="asunto">Asunto</Label>
        <Input id="asunto" name="asunto" placeholder="Resumen breve del problema" required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="categoria">Categoría</Label>
        <Select name="categoria" defaultValue="OTRO">
          <SelectTrigger id="categoria">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TICKET_CATEGORIAS.map((c) => (
              <SelectItem key={c} value={c}>
                {categoriaLabel(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="descripcion">Descripción</Label>
        <Textarea
          id="descripcion"
          name="descripcion"
          rows={4}
          placeholder="Cuéntanos qué ocurrió con el mayor detalle posible…"
          required
        />
      </div>

      {/* Adjunto: subida directa */}
      <div className="space-y-1.5">
        <Label>Adjuntar captura (opcional)</Label>
        {previewUrl ? (
          <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
            <Image
              src={previewUrl}
              alt="Vista previa del adjunto"
              width={600}
              height={400}
              className="max-h-56 w-full object-contain"
            />
            <button
              type="button"
              onClick={clearAdjunto}
              className="absolute right-2 top-2 rounded-full bg-white/90 p-1 shadow hover:bg-card"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        ) : isPdf && adjuntoUrl ? (
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="h-4 w-4" /> {fileName}
            </span>
            <button type="button" onClick={clearAdjunto} className="text-xs text-primary hover:underline">
              Quitar
            </button>
          </div>
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted p-6 text-muted-foreground transition hover:border-info/40 hover:bg-info/10"
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <>
                <Upload className="h-6 w-6" />
                <p className="text-sm">Toca para subir una imagen o PDF</p>
                <p className="text-xs">JPG, PNG o PDF · máx {MAX_MB} MB</p>
              </>
            )}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      <SubmitBtn uploading={uploading} />
    </form>
  )
}
