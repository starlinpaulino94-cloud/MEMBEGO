'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Crop, Loader2, Star, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import {
  prepararSubidaImagenCatalogo,
  confirmarImagenCatalogo,
  reencuadrarImagenCatalogo,
  ponerPortadaCatalogo,
  eliminarImagenCatalogo,
} from '@/modules/catalog/actions'
import { FORMATOS, type Encuadre } from '@/lib/imagen/formatos'
import { EditorDeImagen } from '@/components/imagen/EditorDeImagen'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeStorage } from '@/lib/storage-errores'
import { Button } from '@/components/ui/button'
import { DeleteButton } from '@/components/ui/delete-button'

const ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5
const BUCKET = 'promociones'

export interface ImagenVista {
  id: string
  /** Versión de tarjeta (o el original en las fotos anteriores al editor). */
  url: string | null
  /** El original, para poder reencuadrar. */
  originalUrl: string | null
  /** Encuadre guardado; null en las fotos anteriores al editor. */
  crop: Encuadre | null
}

type Editor = { tipo: 'nueva'; archivo: File; url: string } | { tipo: 'reencuadre'; imagen: ImagenVista }

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
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pending, start] = useTransition()

  /** Elegir un archivo NO lo sube: abre el editor para encuadrarlo primero. */
  function elegir(file: File) {
    if (!ACEPTADOS.includes(file.type)) return void toast.error('Formato no permitido. Usa JPG, PNG o WebP.')
    if (file.size > MAX_MB * 1024 * 1024) return void toast.error(`La imagen no puede superar ${MAX_MB} MB.`)
    setEditor({ tipo: 'nueva', archivo: file, url: URL.createObjectURL(file) })
  }

  function cerrarEditor() {
    if (editor?.tipo === 'nueva') URL.revokeObjectURL(editor.url)
    setEditor(null)
    if (ref.current) ref.current.value = ''
  }

  async function reencuadrar(imagen: ImagenVista, encuadre: Encuadre) {
    setSubiendo(true)
    try {
      const r = await reencuadrarImagenCatalogo(imagen.id, encuadre)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Encuadre guardado.')
      cerrarEditor()
      router.refresh()
    } catch (e) {
      console.error('[catalogo-imagen] reencuadre:', e)
      toast.error(mensajeDeStorage(e, { maxMb: MAX_MB }))
    } finally {
      setSubiendo(false)
    }
  }

  /**
   * Tres pasos (ver `prepararSubidaImagenCatalogo`): el servidor decide la ruta
   * y firma una URL de un solo uso; el archivo va DIRECTO a Storage desde aquí,
   * sin pasar por la Server Action (y sin su límite de cuerpo); el servidor
   * comprueba el archivo subido, genera las versiones con el encuadre elegido
   * y registra la fila.
   */
  async function subir(file: File, encuadre: Encuadre) {
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

      const r = await confirmarImagenCatalogo(itemId, permiso.path, encuadre)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Imagen subida.')
      cerrarEditor()
      router.refresh()
    } catch (e) {
      console.error('[catalogo-imagen]', e)
      toast.error(mensajeDeStorage(e, { maxMb: MAX_MB }))
    } finally {
      setSubiendo(false)
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
                <div className="flex flex-wrap items-center gap-1">
                  {img.originalUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || subiendo}
                      onClick={() => setEditor({ tipo: 'reencuadre', imagen: img })}
                    >
                      <Crop className="mr-1 h-3.5 w-3.5" aria-hidden /> Encuadrar
                    </Button>
                  )}
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
              if (f) elegir(f)
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={subiendo} onClick={() => ref.current?.click()}>
            {subiendo ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="mr-2 h-3.5 w-3.5" />}
            Subir imagen
          </Button>
        </>
      )}

      {editor && (
        <EditorDeImagen
          key={editor.tipo === 'nueva' ? editor.url : editor.imagen.id}
          open
          onOpenChange={(abierto) => {
            if (!abierto) cerrarEditor()
          }}
          fuente={editor.tipo === 'nueva' ? editor.url : (editor.imagen.originalUrl ?? '')}
          formato={FORMATOS.catalogo}
          encuadreInicial={editor.tipo === 'reencuadre' ? editor.imagen.crop : null}
          avisoInicial={
            editor.tipo === 'reencuadre' && !editor.imagen.crop
              ? 'Esta foto se subió antes del editor: al guardar se generan sus versiones nuevas.'
              : undefined
          }
          textoConfirmar={editor.tipo === 'nueva' ? 'Subir foto' : 'Guardar encuadre'}
          procesando={subiendo}
          onConfirmar={(encuadre) => (editor.tipo === 'nueva' ? void subir(editor.archivo, encuadre) : void reencuadrar(editor.imagen, encuadre))}
        />
      )}
    </div>
  )
}
