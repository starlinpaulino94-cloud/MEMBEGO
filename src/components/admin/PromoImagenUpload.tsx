'use client'

/**
 * Fase E5 · Imagen de la promoción por ARCHIVO (no URL): subir, cambiar y
 * quitar desde el dispositivo. Bucket dedicado `promociones` (público) del
 * storage del proyecto. La URL resultante viaja en el hidden `imagenUrl`;
 * el modelo ya soporta galería futura (Promocion.imagenes[]).
 */

import { useRef, useState } from 'react'
import { ImageIcon, Loader2, Trash2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { OG_MAX_MB, OG_RECOMENDACION } from '@/lib/share/og-tamano'
import { uniqueFileName } from '@/lib/storage'
import { Button } from '@/components/ui/button'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
// El tope sale del generador de la tarjeta compartida, no de un número aquí:
// si la subida admitiera más de lo que la tarjeta acepta, el enlace se
// compartiría sin imagen y nadie se enteraría. Ver `og-tamano.ts`.
const MAX_MB = OG_MAX_MB
const BUCKET = 'promociones'

export function PromoImagenUpload({
  folder,
  currentUrl,
}: {
  /** Carpeta dentro del bucket (id de la promo o 'nueva'). */
  folder: string
  currentUrl: string | null
}) {
  const [url, setUrl] = useState(currentUrl ?? '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!ALLOWED.includes(file.type)) {
      toast.error('Formato no permitido. Usa JPG, PNG o WebP.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`La imagen no puede superar ${MAX_MB} MB.`)
      return
    }
    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${folder}/${uniqueFileName(ext)}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      setUrl(data.publicUrl)
      toast.success('Imagen subida.')
    } catch (e) {
      console.error('[promo-imagen] upload:', e)
      toast.error('No se pudo subir la imagen. Intenta de nuevo.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="imagenUrl" value={url} />
      <input
        ref={fileRef}
        type="file"
        accept={ALLOWED.join(',')}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />

      {url ? (
        <div className="overflow-hidden rounded-xl border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Imagen de la promoción" className="h-40 w-full object-cover" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <ImageIcon className="h-6 w-6" />
          )}
          <span className="text-sm">Subir imagen desde tu dispositivo</span>
          <span className="text-xs">JPG, PNG o WebP · máx. {MAX_MB} MB</span>
          <span className="text-xs opacity-80">Ideal {OG_RECOMENDACION} (horizontal)</span>
        </button>
      )}

      {url && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
            Cambiar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            disabled={uploading}
            onClick={() => setUrl('')}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Quitar
          </Button>
        </div>
      )}
    </div>
  )
}
