'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Camera, Loader2, UploadCloud } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { uniqueFileName } from '@/lib/storage'
import { guardarEvidencia } from '@/modules/carwash/evidencias-actions'
import {
  EVIDENCIA_MOMENTOS,
  EVIDENCIA_MOMENTO_LABELS,
} from '@/modules/carwash/evidencias'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 8
const BUCKET = 'evidencias'

/**
 * App Car Wash · E5 — subir una foto de evidencia. La imagen va directo del
 * navegador al bucket `evidencias` de Supabase Storage (crearlo público);
 * la acción del servidor solo registra la URL con su contexto.
 */
export function EvidenciaForm({
  colaId,
  placaInicial,
}: {
  /** Entrada de la cola a la que se liga la foto (opcional). */
  colaId?: string
  placaInicial?: string
}) {
  const [pending, startTransition] = useTransition()
  const [url, setUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function action(formData: FormData) {
    startTransition(async () => {
      const res = await guardarEvidencia({}, formData)
      if (res.success) {
        toast.success(res.success)
        formRef.current?.reset()
        setUrl('')
      }
      if (res.error) toast.error(res.error)
    })
  }

  async function handleFile(file: File) {
    if (!ALLOWED.includes(file.type)) {
      toast.error('Formato no permitido. Usa JPG, PNG o WebP.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`La foto no puede superar ${MAX_MB} MB.`)
      return
    }
    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${colaId || 'sueltas'}/${uniqueFileName(ext)}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      setUrl(data.publicUrl)
      toast.success('Foto subida. Completa los datos y guarda.')
    } catch (e) {
      console.error('[evidencias] upload:', e)
      toast.error(
        'No se pudo subir la foto. Verifica que exista el bucket público «evidencias» en Supabase Storage.'
      )
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-3 rounded-2xl border border-border/70 bg-card p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        <Camera className="h-4 w-4" /> Nueva foto
      </h2>
      <input type="hidden" name="url" value={url} />
      {colaId && <input type="hidden" name="colaId" value={colaId} />}
      <input
        ref={fileRef}
        type="file"
        accept={ALLOWED.join(',')}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />

      {url ? (
        <div className="overflow-hidden rounded-xl border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Foto de evidencia" className="h-44 w-full object-cover" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <UploadCloud className="h-6 w-6" />
          )}
          <span className="text-sm">Tomar o subir foto</span>
          <span className="text-xs">JPG, PNG o WebP · máx. {MAX_MB} MB</span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          name="momento"
          defaultValue="ANTES"
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground"
        >
          {EVIDENCIA_MOMENTOS.map((m) => (
            <option key={m} value={m}>
              {EVIDENCIA_MOMENTO_LABELS[m]}
            </option>
          ))}
        </select>
        <Input
          name="placa"
          defaultValue={placaInicial ?? ''}
          placeholder="Placa"
          className="w-32 uppercase"
          maxLength={20}
          autoComplete="off"
        />
        <Input name="nota" placeholder="Nota (ej. rayón puerta derecha)" maxLength={300} className="min-w-48 flex-1" />
        <Button type="submit" disabled={pending || uploading || !url} className="gap-1.5">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar foto
        </Button>
      </div>
    </form>
  )
}
