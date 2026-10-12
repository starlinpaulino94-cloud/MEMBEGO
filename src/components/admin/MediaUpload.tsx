'use client'

import { useRef, useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { FORMATOS } from '@/lib/imagen/formatos'
import { useEditorDeImagen } from '@/components/imagen/useEditorDeImagen'

interface MediaUploadProps {
  /** Ruta dentro del bucket `logos`, ej. `banners/abc123`. Sin extensión. */
  storagePath: string
  currentUrl: string | null
  label: string
  /** Relación de aspecto del preview: 'wide' (banner) o 'square'. */
  aspect?: 'wide' | 'square'
  onUploaded: (url: string) => void
}

/**
 * Subida genérica de imagen a Supabase Storage (bucket `logos`, ya existente
 * en producción — se reutiliza para banners y galería con rutas distintas).
 */
export function MediaUpload({
  storagePath,
  currentUrl,
  label,
  aspect = 'wide',
  onUploaded,
}: MediaUploadProps) {
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /** La imagen ya encuadrada, en el tamaño único de su formato: es la que se sube. */
  async function subirArchivo(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Solo se aceptan imágenes JPG, PNG o WEBP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('La imagen no puede superar 5 MB.')
      return
    }

    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const path = `${storagePath}.${ext}`

      const { error } = await supabase.storage
        .from('logos')
        .upload(path, file, { upsert: true })
      if (error) throw error

      const { data } = supabase.storage.from('logos').getPublicUrl(path)
      setPreview(`${data.publicUrl}?t=${Date.now()}`)
      onUploaded(data.publicUrl)
      toast.success(`${label} actualizado.`)
    } catch (err) {
      console.error('[media-upload]', err)
      toast.error('No se pudo subir la imagen. Intenta de nuevo.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const { elegir, dialogo } = useEditorDeImagen({
    formato: aspect === 'wide' ? FORMATOS.banner : FORMATOS.logo,
    alAplicar: subirArchivo,
  })

  function handleRemove() {
    setPreview(null)
    onUploaded('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-3">
      {preview ? (
        <div
          className={`relative overflow-hidden rounded-xl border border-border bg-muted ${
            aspect === 'wide' ? 'aspect-[3/1] w-full' : 'h-24 w-24'
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={label} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={handleRemove}
            disabled={uploading}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white transition hover:bg-black/80"
            aria-label={`Quitar ${label.toLowerCase()}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          className={`flex items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted ${
            aspect === 'wide' ? 'aspect-[3/1] w-full' : 'h-24 w-24'
          }`}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Subiendo...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              {preview ? `Cambiar ${label.toLowerCase()}` : `Subir ${label.toLowerCase()}`}
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">JPG, PNG o WEBP · Máx 5 MB</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => elegir(e.target.files?.[0])}
      />
      {dialogo}
    </div>
  )
}
