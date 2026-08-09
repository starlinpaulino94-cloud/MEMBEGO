'use client'

import Image from 'next/image'
import { useActionState, useEffect, useRef, useState } from 'react'
import { Loader2, Upload, Camera, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { pedirSubidaComprobante } from '@/modules/storage/comprobantes'
import {
  enviarComprobante,
  type ComprobanteState,
} from '@/modules/membresia/actions'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface MetodoPagoOption {
  id: string
  nombre: string
}

interface Props {
  membershipId: string
  metodosPago: MetodoPagoOption[]
}

const initial: ComprobanteState = {}

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_MB = 5

export function ComprobanteForm({ membershipId, metodosPago }: Props) {
  const [state, formAction, pending] = useActionState(enviarComprobante, initial)
  const [metodoPagoId, setMetodoPagoId] = useState(metodosPago[0]?.id ?? '')
  const [uploading, setUploading] = useState(false)
  const [comprobanteUrl, setComprobanteUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success) toast.success('Comprobante enviado. Esperando validación.')
  }, [state.success])

  // Clean up object URL to avoid memory leaks
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

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

    // Build preview for images
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (file.type !== 'application/pdf') {
      setPreviewUrl(URL.createObjectURL(file))
      setIsPdf(false)
    } else {
      setPreviewUrl(null)
      setIsPdf(true)
    }

    setUploading(true)
    try {
      // La ruta y el permiso los decide el SERVIDOR (auditoría · C-01). El
      // navegador solo dice qué extensión trae y recibe un token que sirve
      // para esa ruta y para ninguna otra.
      const ext = file.name.split('.').pop() ?? 'jpg'
      const permiso = await pedirSubidaComprobante('membresia', membershipId, ext)
      if (permiso.error || !permiso.subida) {
        toast.error(permiso.error ?? 'No se pudo preparar la subida.')
        setPreviewUrl(null)
        return
      }

      const supabase = createClient()
      const { error } = await supabase.storage
        .from('comprobantes')
        .uploadToSignedUrl(permiso.subida.path, permiso.subida.token, file)
      if (error) throw error

      // Se guarda la RUTA, no una URL pública: el bucket es privado y cada
      // lectura se firma en el momento, previa comprobación de permiso.
      setComprobanteUrl(permiso.subida.path)
      setFileName(file.name)
      toast.success('Archivo cargado. Revísalo antes de enviar.')
    } catch {
      toast.error('No se pudo cargar el archivo. Intenta de nuevo.')
      setPreviewUrl(null)
    } finally {
      setUploading(false)
    }
  }

  function clearFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setComprobanteUrl('')
    setFileName('')
    setIsPdf(false)
    if (fileRef.current) fileRef.current.value = ''
    if (cameraRef.current) cameraRef.current.value = ''
  }

  if (state.success) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-success/10 p-4 text-success">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        <p className="text-sm font-medium">
          Comprobante enviado. El equipo lo revisará pronto.
        </p>
      </div>
    )
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="comprobanteUrl" value={comprobanteUrl} />
      {metodoPagoId && (
        <input type="hidden" name="metodoPagoId" value={metodoPagoId} />
      )}

      {state.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label>Comprobante de pago *</Label>

        {/* Preview area */}
        {previewUrl ? (
          <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
            <Image
              src={previewUrl}
              alt="Vista previa del comprobante"
              width={600}
              height={400}
              className="max-h-64 w-full object-contain"
            />
            <button
              type="button"
              onClick={clearFile}
              className="absolute right-2 top-2 rounded-full bg-white/90 p-1 shadow hover:bg-card"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {fileName} · <button type="button" onClick={clearFile} className="text-primary hover:underline">Cambiar</button>
            </p>
          </div>
        ) : isPdf ? (
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3">
            <p className="text-sm font-medium text-foreground">{fileName}</p>
            <button type="button" onClick={clearFile} className="text-xs text-primary hover:underline">
              Cambiar
            </button>
          </div>
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted p-8 text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10"
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <>
                <Upload className="h-8 w-8" />
                <p className="text-sm">Toca para seleccionar un archivo</p>
                <p className="text-xs">JPG, PNG o PDF · máx {MAX_MB} MB</p>
              </>
            )}
          </div>
        )}

        {/* Hidden file inputs */}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {/* Action buttons */}
        {!previewUrl && !isPdf && !uploading && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Seleccionar archivo
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="h-4 w-4" />
              Tomar foto
            </Button>
          </div>
        )}
      </div>

      {/* Selector de método de pago (solo visible si hay más de uno) */}
      {metodosPago.length > 1 && (
        <div className="space-y-2">
          <Label>¿Con qué método pagaste? *</Label>
          <div className="flex flex-col gap-2">
            {metodosPago.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5 text-sm transition ${
                  metodoPagoId === m.id
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border hover:border-border'
                }`}
              >
                <input
                  type="radio"
                  className="accent-sky-500"
                  checked={metodoPagoId === m.id}
                  onChange={() => setMetodoPagoId(m.id)}
                />
                {m.nombre}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="nota">Nota (opcional)</Label>
        <Textarea
          id="nota"
          name="nota"
          placeholder="Ej: Transferencia enviada el 30/06 desde cuenta BHD..."
          rows={2}
        />
      </div>

      <Button
        type="submit"
        disabled={!comprobanteUrl || uploading || pending}
        className="w-full bg-primary hover:bg-primary/90"
      >
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Enviar comprobante
      </Button>
    </form>
  )
}
