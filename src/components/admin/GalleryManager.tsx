'use client'

import { useRef, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { FORMATOS } from '@/lib/imagen/formatos'
import { useEditorDeImagen } from '@/components/imagen/useEditorDeImagen'

const MAX_IMAGES = 8

interface GalleryManagerProps {
  companyId: string
  initialImages: string[]
}

/**
 * Gestor de galería del perfil público. Cada imagen queda como un
 * <input type="hidden" name="galleryImages"> para viajar en el FormData
 * del formulario padre (formData.getAll('galleryImages')).
 */
export function GalleryManager({ companyId, initialImages }: GalleryManagerProps) {
  const [images, setImages] = useState<string[]>(initialImages)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /** La foto ya encuadrada (cuadrada, 1000×1000): es la que se sube. */
  async function subirArchivo(file: File) {
    if (images.length >= MAX_IMAGES) {
      toast.error(`Máximo ${MAX_IMAGES} imágenes en la galería.`)
      return
    }
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
      const path = `gallery/${companyId}/${Date.now()}.${ext}`

      const { error } = await supabase.storage
        .from('logos')
        .upload(path, file, { upsert: true })
      if (error) throw error

      const { data } = supabase.storage.from('logos').getPublicUrl(path)
      setImages((prev) => [...prev, data.publicUrl])
      toast.success('Imagen agregada a la galería.')
    } catch (err) {
      console.error('[gallery-upload]', err)
      toast.error('No se pudo subir la imagen. Intenta de nuevo.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const { elegir, dialogo } = useEditorDeImagen({ formato: FORMATOS.galeria, alAplicar: subirArchivo })

  function handleRemove(url: string) {
    setImages((prev) => prev.filter((i) => i !== url))
  }

  return (
    <div className="space-y-3">
      {/* Valores que viajan en el submit del formulario padre */}
      {images.map((url) => (
        <input key={url} type="hidden" name="galleryImages" value={url} />
      ))}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {images.map((url) => (
          <div
            key={url}
            className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => handleRemove(url)}
              className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white transition hover:bg-black/80"
              aria-label="Quitar imagen"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {images.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted text-muted-foreground transition hover:border-primary/40 hover:text-primary"
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Hasta {MAX_IMAGES} fotos del negocio · JPG, PNG o WEBP · Máx 5 MB c/u.
        Recuerda guardar los cambios al terminar.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          if (images.length >= MAX_IMAGES) return void toast.error(`Máximo ${MAX_IMAGES} imágenes en la galería.`)
          elegir(e.target.files?.[0])
        }}
      />
      {dialogo}
    </div>
  )
}
