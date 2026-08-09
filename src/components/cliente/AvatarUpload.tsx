'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import { Loader2, Camera, User } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

interface Props {
  clienteId: string
  currentUrl: string | null
  nombre: string
  onUploaded: (url: string) => void
}

export function AvatarUpload({ clienteId, currentUrl, nombre, onUploaded }: Props) {
  const [preview, setPreview] = useState<string | null>(currentUrl)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Solo se aceptan imágenes JPG, PNG o WEBP.')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('La imagen no puede superar 3 MB.')
      return
    }

    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const path = `avatars/${clienteId}.${ext}`

      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })
      if (error) throw error

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      // Add cache-bust so the browser refreshes the image
      const url = `${data.publicUrl}?t=${Date.now()}`
      setPreview(url)
      onUploaded(data.publicUrl)
      toast.success('Foto actualizada.')
    } catch (err) {
      console.error('[avatar-upload]', err)
      toast.error('No se pudo subir la imagen. Intenta de nuevo.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const initials = nombre
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group relative h-24 w-24 overflow-hidden rounded-full ring-4 ring-white shadow-md transition hover:ring-primary/20"
      >
        {preview ? (
          <Image
            src={preview}
            alt={nombre}
            fill
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sky-400 to-indigo-500 text-2xl font-bold text-white">
            {initials || <User className="h-8 w-8" />}
          </div>
        )}

        {/* Overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/40">
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-white opacity-0 group-hover:opacity-100" />
          ) : (
            <Camera className="h-6 w-6 text-white opacity-0 transition group-hover:opacity-100" />
          )}
        </div>
      </button>

      <p className="text-xs text-muted-foreground">
        {uploading ? 'Subiendo...' : 'Toca para cambiar foto'}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}
