'use client'

/**
 * Fase E5 · Comprobante de transferencia de una COMPRA de promoción.
 * Mismo patrón que el comprobante de membresía: sube el archivo al bucket
 * `comprobantes` y envía la URL + método + fecha/hora declarada + nota.
 */

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Loader2, SendHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { pedirSubidaComprobante } from '@/modules/storage/comprobantes'
import { enviarComprobanteCompra, type CompraState } from '@/modules/promociones/compraActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_MB = 5

interface MetodoPagoOption {
  id: string
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
}

const init: CompraState = {}

export function ComprobanteCompraForm({
  compraId,
  metodosPago,
}: {
  compraId: string
  metodosPago: MetodoPagoOption[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(enviarComprobanteCompra, init)
  const [comprobanteUrl, setComprobanteUrl] = useState('')
  const [metodoPagoId, setMetodoPagoId] = useState(metodosPago[0]?.id ?? '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')

  useEffect(() => {
    if (state.success) {
      toast.success('Comprobante enviado. Te avisaremos cuando el pago sea validado.')
      router.refresh()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, router])

  async function handleFile(file: File) {
    if (!ALLOWED.includes(file.type)) {
      toast.error('Formato no permitido. Usa JPG, PNG, WebP o PDF.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`El archivo no puede superar ${MAX_MB} MB.`)
      return
    }
    setUploading(true)
    try {
      // Ruta y permiso los decide el servidor (auditoría · C-01): el token
      // recibido solo sirve para esa ruta, así que no hay forma de escribir
      // encima del comprobante de otra persona.
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const permiso = await pedirSubidaComprobante('compra', compraId, ext)
      if (permiso.error || !permiso.subida) {
        toast.error(permiso.error ?? 'No se pudo preparar la subida.')
        return
      }
      const supabase = createClient()
      const { error } = await supabase.storage
        .from('comprobantes')
        .uploadToSignedUrl(permiso.subida.path, permiso.subida.token, file)
      if (error) throw error
      // Se guarda la RUTA: el bucket es privado y cada lectura se firma.
      setComprobanteUrl(permiso.subida.path)
      setFileName(file.name)
      toast.success('Comprobante adjuntado.')
    } catch (e) {
      console.error('[compra-comprobante] upload:', e)
      toast.error('No se pudo subir el archivo. Intenta de nuevo.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="compraId" value={compraId} />
      <input type="hidden" name="comprobanteUrl" value={comprobanteUrl} />
      <input type="hidden" name="metodoPagoId" value={metodoPagoId} />

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {metodosPago.length > 1 && (
        <div className="space-y-2">
          <Label>Cuenta a la que transferiste</Label>
          <div className="space-y-1.5">
            {metodosPago.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="_metodo"
                  checked={metodoPagoId === m.id}
                  onChange={() => setMetodoPagoId(m.id)}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="font-medium text-foreground">{m.nombre}</span>
                  {m.numeroCuenta && (
                    <span className="block text-muted-foreground">
                      {m.numeroCuenta}
                      {m.tipoCuenta ? ` (${m.tipoCuenta})` : ''}
                      {m.titular ? ` · ${m.titular}` : ''}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="transferenciaFecha">Fecha y hora de la transferencia</Label>
        <Input id="transferenciaFecha" name="transferenciaFecha" type="datetime-local" />
      </div>

      <div className="space-y-2">
        <Label>Comprobante *</Label>
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
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {fileName || 'Adjuntar comprobante (JPG, PNG, WebP o PDF)'}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nota">Observaciones (opcional)</Label>
        <Textarea id="nota" name="nota" rows={2} placeholder="Ej. transferencia desde cuenta de un familiar…" />
      </div>

      <Button type="submit" disabled={pending || uploading || !comprobanteUrl} className="w-full gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        Enviar comprobante
      </Button>
    </form>
  )
}
