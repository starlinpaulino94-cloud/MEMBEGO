'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Star, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { prepararSubidaImagenCatalogo, confirmarImagenCatalogo, ponerPortadaCatalogo, eliminarImagenCatalogo } from '@/modules/catalog/actions'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeStorage } from '@/lib/storage-errores'
import { Button } from '@/components/ui/button'
import { DeleteButton } from '@/components/ui/delete-button'

const ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5
const BUCKET = 'promociones'

export interface ImagenVista {
  id: string
  url: string | null
}

/**
 * Fotos del ítem. La primera es la portada. El navegador solo hace una
 * comprobación de cortesía (tipo y tamaño); la que vale la hace el servidor,
 * que decide el tipo real por la firma del archivo.
 */
export function ImagenesPanel({
  itemId,
  imagenes,
  editable,
}: {
  itemId: string
  imagenes: ImagenVista[]
  editable: boolean
}) {
  const router = useRouter()
  const ref = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [pending, start] = useTransition()

  /**
   * Tres pasos (ver `prepararSubidaImagenCatalogo`): el servidor decide la ruta
   * y firma una URL de un solo uso; el archivo va DIRECTO a Storage desde aquí,
   * sin pasar por la Server Action (y sin su límite de cuerpo); el servidor
   * comprueba el archivo subido y registra la fila.
   */
  async function subir(file: File) {
    if (!ACEPTADOS.includes(file.type)) return void toast.error('Formato no permitido. Usa JPG, PNG o WebP.')
    if (file.size > MAX_MB * 1024 * 1024) return void toast.error(`La imagen no puede superar ${MAX_MB} MB.`)
    setSubiendo(true)
    try {
      const permiso = await prepararSubidaImagenCatalogo(itemId, file.type)
      if (!permiso.ok) return void toast.error(permiso.error)

      const { error } = await createClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(permiso.path, permiso.token, file, { contentType: file.type, upsert: false })
      if (error) {
        console.error('[catalogo-imagen] uploadToSignedUrl:', error.message)
        return void toast.error(mensajeDeStorage(error, { maxMb: MAX_MB }))
      }

      const r = await confirmarImagenCatalogo(itemId, permiso.path)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Imagen subida.')
      router.refresh()
    } catch (e) {
      console.error('[catalogo-imagen]', e)
      toast.error(mensajeDeStorage(e, { maxMb: MAX_MB }))
    } finally {
      setSubiendo(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      {imagenes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no tiene fotos.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {imagenes.map((img, i) => (
            <li key={img.id} className="space-y-2">
              <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">Sin vista previa</div>
                )}
                {i === 0 && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                    <Star className="h-3 w-3" /> Portada
                  </span>
                )}
              </div>
              {editable && (
                <div className="flex items-center gap-1">
                  {i > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await ponerPortadaCatalogo(img.id)
                          if (!r.ok) toast.error(r.error)
                          else router.refresh()
                        })
                      }
                    >
                      Hacer portada
                    </Button>
                  )}
                  <DeleteButton
                    label="Quitar la imagen"
                    title="¿Quitar esta imagen?"
                    successMessage="Imagen quitada."
                    action={async () => {
                      const r = await eliminarImagenCatalogo(img.id)
                      if (r.ok) router.refresh()
                      return r.ok ? undefined : { error: r.error }
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <>
          <input
            ref={ref}
            type="file"
            accept={ACEPTADOS.join(',')}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void subir(f)
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={subiendo} onClick={() => ref.current?.click()}>
            {subiendo ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="mr-2 h-3.5 w-3.5" />}
            Subir imagen
          </Button>
        </>
      )}
    </div>
  )
}
