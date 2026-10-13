'use client'

/**
 * Conecta el editor de encuadre con un componente de subida que ya existe.
 *
 *   const { elegir, encuadrar, dialogo } = useEditorDeImagen({ formato: FORMATOS.plan, alAplicar: handleFile })
 *
 *   <input type="file" onChange={(e) => elegir(e.target.files?.[0])} />
 *   <Button onClick={() => encuadrar(urlActual)}>Encuadrar</Button>
 *   {dialogo}
 *
 * `elegir` NO sube nada: abre el editor. Al confirmar, la imagen se pinta en un
 * lienzo al tamaño ÚNICO de la sección (`formato.salida`) y se entrega a
 * `alAplicar` como un archivo WebP: el mismo `handleFile` que el componente ya
 * tenía, con sus validaciones y su subida. Así cada sección pasa por el editor
 * con tres líneas y sin reescribir cómo sube a Storage.
 */

import { useCallback, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { MAX_ORIGINAL_MB, type Encuadre, type FormatoImagen } from '@/lib/imagen/formatos'
import { exportarEncuadre } from '@/lib/imagen/exportar'
import { EditorDeImagen, type FotoCargada } from './EditorDeImagen'

const ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp']

interface Abierto {
  url: string
  /** blob: del archivo recién elegido (hay que liberarlo) o URL de una imagen ya subida. */
  esBlob: boolean
}

export function useEditorDeImagen({
  formato,
  alAplicar,
  textoConfirmar = 'Aplicar y subir',
}: {
  formato: FormatoImagen
  /** Recibe la imagen final (WebP, del tamaño único de la sección). */
  alAplicar: (archivo: File) => void | Promise<void>
  textoConfirmar?: string
}): { elegir: (archivo: File | null | undefined) => void; encuadrar: (url: string) => void; dialogo: ReactNode } {
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [procesando, setProcesando] = useState(false)

  const cerrar = useCallback(() => {
    setAbierto((a) => {
      if (a?.esBlob) URL.revokeObjectURL(a.url)
      return null
    })
  }, [])

  const elegir = useCallback((archivo: File | null | undefined) => {
    if (!archivo) return
    if (!ACEPTADOS.includes(archivo.type)) return void toast.error('Formato no permitido. Usa JPG, PNG o WebP.')
    if (archivo.size > MAX_ORIGINAL_MB * 1024 * 1024) return void toast.error(`La imagen no puede superar ${MAX_ORIGINAL_MB} MB.`)
    setAbierto({ url: URL.createObjectURL(archivo), esBlob: true })
  }, [])

  /** Reabre una imagen ya subida para cambiar su encuadre (parte de la imagen guardada, no de un original). */
  const encuadrar = useCallback((url: string) => setAbierto({ url, esBlob: false }), [])

  async function confirmar(enc: Encuadre, foto: FotoCargada) {
    setProcesando(true)
    try {
      const archivo = await exportarEncuadre(foto.img, enc, { salida: formato.salida })
      cerrar()
      await alAplicar(archivo)
    } catch (e) {
      console.error('[editor-imagen] exportar:', e)
      toast.error('No se pudo preparar la imagen. Prueba con otro archivo.')
    } finally {
      setProcesando(false)
    }
  }

  const dialogo = abierto ? (
    <EditorDeImagen
      key={abierto.url}
      open
      onOpenChange={(v) => {
        if (!v) cerrar()
      }}
      fuente={abierto.url}
      formato={formato}
      exportaEnNavegador
      textoConfirmar={textoConfirmar}
      procesando={procesando}
      onConfirmar={(enc, foto) => void confirmar(enc, foto)}
    />
  ) : null

  return { elegir, encuadrar, dialogo }
}
