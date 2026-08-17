'use client'

/**
 * Imagen/banner de campaña por ARCHIVO (no URL), mismo patrón que
 * PromoImagenUpload: bucket público `promociones`, carpeta `invitaciones/`.
 * La URL resultante viaja en el hidden `name` que indique el formulario.
 */

import { useRef, useState } from 'react'
import { ImageIcon, Loader2, Trash2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { uniqueFileName } from '@/lib/storage'
import { rutaCampana } from '@/lib/storage-rutas'
import { Button } from '@/components/ui/button'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5
const BUCKET = 'promociones'

export function CampanaImagenUpload({
  name,
  companyId,
  campanaId,
  currentUrl,
  label,
}: {
  /** Nombre del hidden input (imagenUrl | bannerUrl). */
  name: string
  /**
   * Empresa dueña. Va SIEMPRE en el primer segmento de la ruta: es lo único
   * que la política de RLS comprueba. Si llega `null` la subida se deshabilita.
   */
  companyId: string | null
  /** Id de la campaña, o `null` si todavía no se ha guardado. */
  campanaId: string | null
  currentUrl: string | null
  label: string
}) {
  const [url, setUrl] = useState(currentUrl ?? '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    // Sin empresa no hay ruta con dueño posible: mejor cortar y decirlo que
    // subir a una carpeta que ninguna política puede comprobar.
    if (!companyId) {
      toast.error('Selecciona una empresa activa antes de subir imágenes.')
      return
    }
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
      const path = rutaCampana(companyId, campanaId, uniqueFileName(ext))
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      setUrl(data.publicUrl)
      toast.success('Imagen subida.')
    } catch (e) {
      console.error('[campana-imagen] upload:', e)
      toast.error('No se pudo subir la imagen. Intenta de nuevo.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={url} />
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
          <img src={url} alt={label} className="h-32 w-full object-cover" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <ImageIcon className="h-6 w-6" />
          )}
          <span className="text-sm">{label}</span>
          <span className="text-xs">JPG, PNG o WebP · máx. {MAX_MB} MB</span>
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
