'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { FORMATOS } from '@/lib/imagen/formatos'
import { useEditorDeImagen } from '@/components/imagen/useEditorDeImagen'

interface Props {
  companyId: string
  currentUrl: string | null
  companyName: string
  onUploaded: (url: string) => void
}

export function LogoUpload({ companyId, currentUrl, companyName, onUploaded }: Props) {
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /** El logo ya encuadrado (cuadrado, 512×512), o un SVG tal cual: es lo que se sube. */
  async function subirArchivo(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      toast.error('Solo se aceptan imágenes JPG, PNG, WEBP o SVG.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El logo no puede superar 5 MB.')
      return
    }

    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const path = `logos/${companyId}.${ext}`

      const { error } = await supabase.storage
        .from('logos')
        .upload(path, file, { upsert: true })
      if (error) throw error

      const { data } = supabase.storage.from('logos').getPublicUrl(path)
      const url = `${data.publicUrl}?t=${Date.now()}`
      setPreview(url)
      onUploaded(data.publicUrl)
      toast.success('Logo actualizado.')
    } catch (err) {
      console.error('[logo-upload]', err)
      toast.error('No se pudo subir el logo. Intenta de nuevo.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const { elegir, dialogo } = useEditorDeImagen({ formato: FORMATOS.logo, alAplicar: subirArchivo })

  function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Un SVG es vectorial: pasarlo por un lienzo lo volvería píxeles. Se sube tal cual.
    if (file.type === 'image/svg+xml') void subirArchivo(file)
    else elegir(file)
  }

  function handleRemove() {
    setPreview(null)
    onUploaded('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {preview ? (
          <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded border border-border bg-muted">
            <Image
              src={preview}
              alt={companyName}
              fill
              className="object-contain p-1"
            />
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading}
              className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 rounded-full bg-destructive p-1 text-white hover:bg-destructive/80"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="h-20 w-20 flex-shrink-0 rounded border-2 border-dashed border-border bg-muted flex items-center justify-center">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Subiendo...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                {preview ? 'Cambiar logo' : 'Subir logo'}
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            JPG, PNG, WEBP o SVG · Máximo 5 MB
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        className="hidden"
        onChange={alElegir}
      />
      {dialogo}
    </div>
  )
}
