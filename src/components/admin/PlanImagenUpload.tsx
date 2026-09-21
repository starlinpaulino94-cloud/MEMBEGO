'use client'

/**
 * IMAGEN DEL PLAN, DESDE EL DISPOSITIVO.
 *
 * Se sube al bucket `promociones` bajo `<companyId>/planes/<planId|nueva>/`.
 * No estrena bucket: la política de ese solo comprueba que el primer segmento
 * sea una empresa del usuario, así que esta ruta ya está cubierta y no hace
 * falta SQL de Storage que alguien tenga que acordarse de aplicar.
 *
 * La URL viaja al servidor en el hidden `imagenUrl`. El botón «Quitar» vacía
 * ese campo: el objeto se queda en el bucket. Es deliberado — borrarlo desde
 * el navegador significaría dar permiso de borrado a la sesión del cliente
 * para acertar en un archivo que quizá otra fila sigue usando, y el precio de
 * un huérfano en un bucket público es mucho menor que el de esa puerta.
 *
 * A DIFERENCIA DE LA IMAGEN DE PROMOCIÓN, no se exige una proporción. La de
 * promoción alimenta la tarjeta que se comparte en redes, donde una imagen
 * fuera de medida sale recortada o directamente no sale. Ésta se pinta dentro
 * de una caja con `object-cover` en el panel y en las pantallas del cliente:
 * cualquier foto razonable se ve bien, y rechazar la que el dueño del negocio
 * acaba de tomar con el celular sería una regla sin motivo.
 */

import { useRef, useState } from 'react'
import { ImageIcon, Loader2, Trash2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { uniqueFileName } from '@/lib/storage'
import { rutaPlan } from '@/lib/storage-rutas'
import { Button } from '@/components/ui/button'

const PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5

export function PlanImagenUpload({
  companyId,
  planId,
  currentUrl,
}: {
  /**
   * Empresa dueña. Va SIEMPRE en el primer segmento: es lo único que la
   * política comprueba. Sin ella no se sube — una ruta sin prefijo dejaría el
   * archivo fuera del alcance de cualquier comprobación de propiedad.
   */
  companyId: string | null
  /** Id del plan, o `null` si todavía no se ha guardado. */
  planId: string | null
  currentUrl: string | null
}) {
  const [url, setUrl] = useState(currentUrl ?? '')
  const [subiendo, setSubiendo] = useState(false)
  const archivoRef = useRef<HTMLInputElement>(null)

  async function manejarArchivo(archivo: File) {
    if (!companyId) {
      toast.error('Selecciona una empresa activa antes de subir la imagen.')
      return
    }
    if (!PERMITIDOS.includes(archivo.type)) {
      toast.error('Formato no permitido. Usa JPG, PNG o WebP.')
      return
    }
    if (archivo.size > MAX_MB * 1024 * 1024) {
      toast.error(`La imagen no puede superar ${MAX_MB} MB.`)
      return
    }
    // Que el navegador sepa decodificarla. Una extensión correcta con el
    // contenido roto se sube igual y el cliente ve un hueco en la tarjeta.
    try {
      const bmp = await createImageBitmap(archivo)
      bmp.close()
    } catch {
      toast.error('No se pudo leer la imagen. Prueba con otro archivo.')
      if (archivoRef.current) archivoRef.current.value = ''
      return
    }

    setSubiendo(true)
    try {
      const supabase = createClient()
      const ext = archivo.name.split('.').pop()?.toLowerCase() || 'jpg'
      const ruta = rutaPlan(companyId, planId, uniqueFileName(ext))
      const { error } = await supabase.storage
        .from('promociones')
        .upload(ruta, archivo, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('promociones').getPublicUrl(ruta)
      setUrl(data.publicUrl)
      toast.success('Imagen lista. Guarda el plan para que los clientes la vean.')
    } catch (e) {
      console.error('[plan-imagen] subida:', e)
      toast.error('No se pudo subir la imagen. Intenta de nuevo.')
    } finally {
      setSubiendo(false)
      if (archivoRef.current) archivoRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="imagenUrl" value={url} />
      <input
        ref={archivoRef}
        type="file"
        accept={PERMITIDOS.join(',')}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void manejarArchivo(f)
        }}
      />

      {url ? (
        <div className="overflow-hidden rounded-xl border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Imagen del plan" className="h-40 w-full object-cover" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => archivoRef.current?.click()}
          disabled={subiendo}
          className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {subiendo ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <ImageIcon className="h-6 w-6" />
          )}
          <span className="text-sm">Subir imagen desde tu dispositivo</span>
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
            disabled={subiendo}
            onClick={() => archivoRef.current?.click()}
          >
            {subiendo ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UploadCloud className="h-3.5 w-3.5" />
            )}
            Cambiar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            disabled={subiendo}
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
