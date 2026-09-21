'use client'

import Image from 'next/image'
import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload, Camera, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { pedirSubidaComprobante } from '@/modules/storage/comprobantes'
import type { TipoComprobante } from '@/modules/storage/tipos'
import { enviarComprobante } from '@/modules/membresia/actions'
import { enviarComprobanteCompra } from '@/modules/promociones/compraActions'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/**
 * ÚNICO formulario de comprobante del cliente (membresía y promoción).
 *
 * Antes había dos implementaciones que pedían cosas distintas para el mismo
 * trámite: la de membresía mostraba transferencia o efectivo en sucursal,
 * enseñaba los datos bancarios y NO pedía fecha/hora; la de promoción pedía
 * cuenta destino + fecha/hora y no ofrecía sucursal. Aquí vive el conjunto
 * completo de campos, y cada superficie recibe solo los que su acción admite.
 *
 * ── MATRIZ DE CAMPOS (lo que cada server action acepta / exige) ─────────────
 *
 *  campo               | `enviarComprobante` (membresía) | `enviarComprobanteCompra` (promoción)
 *  --------------------|---------------------------------|-----------------------------------
 *  membershipId        | EXIGIDO (identifica el pago)    | — (no lo lee)
 *  compraId            | — (no lo lee)                   | EXIGIDO (identifica el pago)
 *  comprobanteUrl      | EXIGIDO (ruta en el bucket)     | EXIGIDO (ruta en el bucket)
 *  metodoPagoId        | opcional (cuenta destino)       | opcional (cuenta destino, validada)
 *  transferenciaFecha  | NO lo acepta — se omite         | opcional (fecha/hora declarada)
 *  nota                | opcional                        | opcional
 *
 *  La transferencia, el efectivo en sucursal y los datos bancarios no viven
 *  aquí: los provee el selector de método (`OpcionesPago`), que monta este
 *  formulario solo en la pestaña de transferencia.
 *
 * ── POR QUÉ UNA PROP DISCRIMINADA Y NO BOOLEANOS ────────────────────────────
 *
 *  `objetivo` es `{ membershipId } | { compraId }`. La superficie (y por tanto
 *  la acción que se llama, el campo oculto del id y si se pide fecha/hora) se
 *  deriva de cuál de las dos llaves viene, no de un puñado de banderas
 *  (`esMembresia` + `pideFecha` + `accion`…) que puedan contradecirse.
 */

export interface CuentaDestino {
  id: string
  nombre: string
  titular?: string | null
  numeroCuenta?: string | null
  tipoCuenta?: string | null
  instrucciones?: string | null
}

export type ObjetivoComprobante = { membershipId: string } | { compraId: string }

interface Props {
  objetivo: ObjetivoComprobante
  /** Cuentas de transferencia de la empresa; si hay una sola no se pregunta. */
  metodosPago: CuentaDestino[]
}

type ComprobanteState = { error?: string; success?: boolean }

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_MB = 5

export function ComprobantePagoForm({ objetivo, metodosPago }: Props) {
  const router = useRouter()
  const esMembresia = 'membershipId' in objetivo
  const objetivoId = esMembresia ? objetivo.membershipId : objetivo.compraId
  const tipo: TipoComprobante = esMembresia ? 'membresia' : 'compra'

  // Ambas acciones comparten firma `(estado, FormData) => estado`, así que la
  // superficie elige cuál se invoca sin cambiar ninguna de las dos.
  const accion: (prev: ComprobanteState, fd: FormData) => Promise<ComprobanteState> = esMembresia
    ? enviarComprobante
    : enviarComprobanteCompra
  const [state, formAction, pending] = useActionState(accion, {})

  const [metodoPagoId, setMetodoPagoId] = useState(metodosPago[0]?.id ?? '')
  const [comprobanteUrl, setComprobanteUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [fileName, setFileName] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.success) {
      toast.success('Comprobante enviado. Te avisaremos cuando el pago sea validado.')
      router.refresh()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, router])

  // Libera el object URL de la vista previa al desmontar.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!ALLOWED.includes(file.type)) {
      toast.error('Formato no permitido. Usa JPG, PNG, WebP o PDF.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`El archivo no puede superar ${MAX_MB} MB.`)
      return
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (file.type === 'application/pdf') {
      setPreviewUrl(null)
      setIsPdf(true)
    } else {
      setPreviewUrl(URL.createObjectURL(file))
      setIsPdf(false)
    }

    setUploading(true)
    try {
      // La ruta y el permiso los decide el SERVIDOR (auditoría · C-01): el
      // navegador solo dice qué extensión trae y recibe un token que sirve
      // para esa ruta y para ninguna otra.
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const permiso = await pedirSubidaComprobante(tipo, objetivoId, ext)
      if (permiso.error || !permiso.subida) {
        toast.error(permiso.error ?? 'No se pudo preparar la subida.')
        setPreviewUrl(null)
        setIsPdf(false)
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
      toast.success('Comprobante adjuntado.')
    } catch (e) {
      console.error('[comprobante-pago] upload:', e)
      toast.error('No se pudo subir el archivo. Intenta de nuevo.')
      setPreviewUrl(null)
      setIsPdf(false)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  function clearFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setIsPdf(false)
    setComprobanteUrl('')
    setFileName('')
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
    <form action={formAction} className="space-y-4">
      {/* El id viaja con el nombre que exige la acción de cada superficie. */}
      {esMembresia ? (
        <input type="hidden" name="membershipId" value={objetivoId} />
      ) : (
        <input type="hidden" name="compraId" value={objetivoId} />
      )}
      <input type="hidden" name="comprobanteUrl" value={comprobanteUrl} />
      {metodoPagoId && <input type="hidden" name="metodoPagoId" value={metodoPagoId} />}

      {state.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label>Comprobante *</Label>

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
              aria-label="Quitar el comprobante adjunto"
              className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-card/90 shadow hover:bg-card"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {fileName} ·{' '}
              <button type="button" onClick={clearFile} className="text-primary hover:underline">
                Cambiar
              </button>
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

        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED.join(',')}
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />

        {!previewUrl && !isPdf && !uploading && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Seleccionar archivo
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 gap-2"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="h-4 w-4" />
              Tomar foto
            </Button>
          </div>
        )}
      </div>

      {/* Cuenta destino: solo se pregunta si la empresa tiene más de una. */}
      {metodosPago.length > 1 && (
        <div className="space-y-2">
          <Label>Cuenta a la que transferiste</Label>
          <div className="space-y-1.5">
            {metodosPago.map((m) => (
              <label
                key={m.id}
                className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
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

      {/* Fecha/hora: solo la acción de promoción la acepta. */}
      {!esMembresia && (
        <div className="space-y-2">
          <Label htmlFor="transferenciaFecha">Fecha y hora de la transferencia</Label>
          <Input
            id="transferenciaFecha"
            name="transferenciaFecha"
            type="datetime-local"
            className="min-h-11"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="nota">Nota (opcional)</Label>
        <Textarea
          id="nota"
          name="nota"
          rows={2}
          placeholder="Ej: Transferencia enviada el 30/06 desde cuenta BHD…"
        />
      </div>

      <Button
        type="submit"
        disabled={!comprobanteUrl || uploading || pending}
        className="min-h-11 w-full gap-2"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Enviar comprobante
      </Button>
    </form>
  )
}
