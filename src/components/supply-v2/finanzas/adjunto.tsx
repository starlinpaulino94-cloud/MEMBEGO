'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { BUCKET_COMPROBANTES } from '@/modules/storage/tipos'
import { pedirSubidaComprobante } from '@/modules/storage/comprobantes'
import { Button } from '@/components/ui/button'
import { adjuntarArchivoAction } from '@/modules/supply-v2/actions-finanzas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

/**
 * MEMBEGO SUPPLY · adjuntar la factura (PDF/imagen) o el comprobante de
 * un pago (§42). Misma mecánica que los comprobantes existentes: el servidor
 * firma una ruta para ESTA entidad en el bucket privado, el navegador sube
 * directo y la action guarda la ruta. No hay storage propio de Supply.
 */
export function AdjuntoSupplyV2({ entidad, id, etiqueta }: { entidad: 'factura' | 'pago'; id: string; etiqueta: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(adjuntarArchivoAction, {})
  const [ruta, setRuta] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
    }
  }, [estado, router])

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
      const permiso = await pedirSubidaComprobante('supply-v2', id, ext)
      if (permiso.error || !permiso.subida) {
        toast.error(permiso.error ?? 'No se pudo preparar la subida.')
        return
      }
      const { error } = await createClient().storage.from(BUCKET_COMPROBANTES).uploadToSignedUrl(permiso.subida.path, permiso.subida.token, file)
      if (error) throw error
      setRuta(permiso.subida.path)
      toast.success('Archivo subido. Pulsa «Guardar».')
    } catch (err) {
      console.error('[supply-v2] subida de adjunto:', err)
      toast.error('No se pudo subir el archivo.')
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="entidad" value={entidad} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="path" value={ruta} />
      <input ref={ref} type="file" accept="image/*,.pdf" onChange={subir} aria-label={etiqueta} className="text-caption" disabled={subiendo} />
      <Button type="submit" size="sm" variant="secondary" disabled={pendiente || subiendo || !ruta}>
        {subiendo ? 'Subiendo…' : pendiente ? 'Guardando…' : 'Guardar'}
      </Button>
      {estado.error && <span className="text-caption text-destructive">{estado.error}</span>}
    </form>
  )
}
