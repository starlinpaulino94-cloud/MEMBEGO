'use client'

import { useRef, useState } from 'react'
import { ImageIcon, Loader2, UploadCloud, X, Plus, Crop } from 'lucide-react'
import { toast } from 'sonner'
import { subirImagenExcursion } from '@/modules/excursiones/catalogo/imageActions'
import { Button } from '@/components/ui/button'
import { ModalRecortePortada } from './ModalRecortePortada'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5

export function ExcursionImagenUpload({
  companyId,
  excursionId,
  currentPortadaUrl,
  currentGaleria,
}: {
  companyId: string | null
  excursionId: string | null
  currentPortadaUrl: string | null
  currentGaleria: string[] | null
}) {
  const [portadaUrl, setPortadaUrl] = useState(currentPortadaUrl ?? '')
  const [galeriaUrls, setGaleriaUrls] = useState<string[]>(currentGaleria ?? [])
  const [uploadingPortada, setUploadingPortada] = useState(false)
  const [uploadingGaleria, setUploadingGaleria] = useState(false)
  const [archivoParaRecortar, setArchivoParaRecortar] = useState<{ file?: File; url: string } | null>(null)
  
  const portadaRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)

  async function handleUpload(
    file: File,
    tipo: 'portada' | 'galeria'
  ) {
    if (!companyId) {
      toast.error('Selecciona una empresa activa antes de subir imágenes.')
      return
    }
    if (!ALLOWED.includes(file.type)) {
      toast.error('Formato no permitido. Usa JPG, PNG o WebP.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`La imagen no puede superar ${MAX_MB} MB.`)
      return
    }

    const setUploading = tipo === 'portada' ? setUploadingPortada : setUploadingGaleria
    setUploading(true)
    
    try {
      const result = await subirImagenExcursion(companyId, excursionId, file)
      if ('error' in result) throw new Error(result.error)
      
      if (tipo === 'portada') {
        setPortadaUrl(result.url)
      } else {
        setGaleriaUrls(prev => [...prev, result.url])
      }
      toast.success('Imagen subida correctamente.')
    } catch (e) {
      console.error('[excursion-imagen] upload:', e)
      toast.error('No se pudo subir la imagen. Intenta de nuevo.')
    } finally {
      setUploading(false)
      if (tipo === 'portada' && portadaRef.current) portadaRef.current.value = ''
      if (tipo === 'galeria' && galeriaRef.current) galeriaRef.current.value = ''
    }
  }

  function eliminarImagenGaleria(index: number) {
    setGaleriaUrls(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6">
      {/* Inputs ocultos para FormData */}
      <input type="hidden" name="portadaUrl" value={portadaUrl} />
      <input type="hidden" name="galeriaJson" value={JSON.stringify(galeriaUrls)} />
      
      {/* Portada */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Foto de Portada</h3>
          <p className="text-xs text-muted-foreground">La imagen principal que verán los clientes al explorar el catálogo.</p>
        </div>
        
        <input
          ref={portadaRef}
          type="file"
          accept={ALLOWED.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) {
              if (!ALLOWED.includes(f.type)) {
                toast.error('Formato no permitido. Usa JPG, PNG o WebP.')
                return
              }
              if (f.size > MAX_MB * 1024 * 1024) {
                toast.error(`La imagen no puede superar ${MAX_MB} MB.`)
                return
              }
              const objUrl = URL.createObjectURL(f)
              setArchivoParaRecortar({ file: f, url: objUrl })
            }
          }}
        />

        {portadaUrl ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={portadaUrl} alt="Portada de la excursión" className="h-48 w-full object-cover" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={uploadingPortada}
                onClick={() => portadaRef.current?.click()}
              >
                {uploadingPortada ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                Cambiar portada
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={uploadingPortada}
                onClick={() => setArchivoParaRecortar({ url: portadaUrl })}
              >
                <Crop className="h-3.5 w-3.5" /> Reajustar encuadre
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="gap-1.5"
                disabled={uploadingPortada}
                onClick={() => setPortadaUrl('')}
              >
                <X className="h-3.5 w-3.5" /> Quitar
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => portadaRef.current?.click()}
            disabled={uploadingPortada}
            className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground bg-muted/20"
          >
            {uploadingPortada ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <ImageIcon className="h-6 w-6" />
            )}
            <span className="text-sm">Subir portada desde tu dispositivo</span>
            <span className="text-xs opacity-80">JPG, PNG o WebP · máx. {MAX_MB} MB</span>
          </button>
        )}
      </div>

      {/* Galería */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Galería de Imágenes (Opcional)</h3>
            <p className="text-xs text-muted-foreground">Fotos adicionales para mostrar la experiencia.</p>
          </div>
        </div>

        <input
          ref={galeriaRef}
          type="file"
          accept={ALLOWED.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleUpload(f, 'galeria')
          }}
        />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {galeriaUrls.map((gUrl, i) => (
            <div key={i} className="group relative aspect-square overflow-hidden rounded-xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={gUrl} alt={`Galería ${i + 1}`} className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="h-8 w-8 rounded-full shadow-md"
                  onClick={() => eliminarImagenGaleria(i)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => galeriaRef.current?.click()}
            disabled={uploadingGaleria}
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground bg-muted/20"
          >
            {uploadingGaleria ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
            <span className="text-xs font-medium">{galeriaUrls.length > 0 ? 'Añadir más' : 'Añadir fotos'}</span>
          </button>
        </div>
      </div>

      {archivoParaRecortar && (
        <ModalRecortePortada
          open={Boolean(archivoParaRecortar)}
          onOpenChange={(abierto) => {
            if (!abierto) {
              if (archivoParaRecortar.file && archivoParaRecortar.url.startsWith('blob:')) {
                URL.revokeObjectURL(archivoParaRecortar.url)
              }
              setArchivoParaRecortar(null)
              if (portadaRef.current) portadaRef.current.value = ''
            }
          }}
          imagenSrc={archivoParaRecortar.url}
          onConfirmar={(archivoRecortado) => {
            if (archivoParaRecortar.file && archivoParaRecortar.url.startsWith('blob:')) {
              URL.revokeObjectURL(archivoParaRecortar.url)
            }
            setArchivoParaRecortar(null)
            void handleUpload(archivoRecortado, 'portada')
          }}
        />
      )}
    </div>
  )
}
