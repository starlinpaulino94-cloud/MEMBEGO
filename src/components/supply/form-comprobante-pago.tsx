'use client'

import { useActionState, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { BUCKET_COMPROBANTES } from '@/modules/storage/tipos'
import { pedirSubidaComprobante } from '@/modules/storage/comprobantes'
import { Button } from '@/components/ui/button'
import { adjuntarComprobantePagoAction, type EstadoAccion } from '@/modules/supply/actions-lotes'

/**
 * Adjunta el comprobante de un pago DE MEMBEGO a un proveedor. Misma mecánica
 * que el comprobante del cliente: el servidor firma una ruta para ESTE pago,
 * el navegador sube directo al bucket privado y la action guarda la ruta.
 */
export function FormComprobantePago({ pagoId, compacto = false }: { pagoId: string; compacto?: boolean }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(adjuntarComprobantePagoAction, {})
  const [ruta, setRuta] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El archivo pasa de 5 MB.')
      return
    }
    setSubiendo(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const permiso = await pedirSubidaComprobante('pago', pagoId, ext)
      if (permiso.error || !permiso.subida) {
        toast.error(permiso.error ?? 'No se pudo preparar la subida.')
        return
      }
      const { error } = await createClient().storage.from(BUCKET_COMPROBANTES).uploadToSignedUrl(permiso.subida.path, permiso.subida.token, file)
      if (error) throw error
      setRuta(permiso.subida.path)
      toast.success('Archivo subido. Pulsa «Guardar comprobante».')
    } catch (err) {
      console.error('[supply-pago] subida de comprobante:', err)
      toast.error('No se pudo subir el archivo.')
    } finally {
      setSubiendo(false)
    }
  }

  if (estado.success) return <span className="text-caption text-success">{estado.success}</span>

  return (
    <form action={enviar} className={compacto ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}>
      <input type="hidden" name="pagoId" value={pagoId} />
      <input type="hidden" name="comprobantePath" value={ruta} />
      <input ref={ref} type="file" accept="image/*,.pdf" onChange={subir} aria-label="Comprobante del pago" className="text-caption" disabled={subiendo} />
      <Button type="submit" size="sm" variant="secondary" disabled={pendiente || subiendo || !ruta}>
        {subiendo ? 'Subiendo…' : pendiente ? 'Guardando…' : 'Guardar comprobante'}
      </Button>
      {estado.error && <span className="text-caption text-destructive">{estado.error}</span>}
    </form>
  )
}
