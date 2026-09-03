'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ZoomIn, ZoomOut, RotateCcw, Check, Crop, Loader2 } from 'lucide-react'

interface ModalRecortePortadaProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imagenSrc: string
  onConfirmar: (file: File) => void
}

export function ModalRecortePortada({
  open,
  onOpenChange,
  imagenSrc,
  onConfirmar,
}: ModalRecortePortadaProps) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [procesando, setProcesando] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Restablecer valores cuando se abre una nueva imagen
  useEffect(() => {
    if (open) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      setProcesando(false)
      setIsDragging(false)
    }
  }, [open, imagenSrc])

  // Calcular límites de paneo para que la imagen siempre cubra el viewport 16:9
  const clampPan = useCallback((newX: number, newY: number, currentZoom: number) => {
    const viewport = viewportRef.current
    const img = imgRef.current
    if (!viewport || !img || !img.naturalWidth || !img.naturalHeight) {
      return { x: newX, y: newY }
    }

    const Vw = viewport.clientWidth
    const Vh = viewport.clientHeight
    const Nw = img.naturalWidth
    const Nh = img.naturalHeight

    const baseScale = Math.max(Vw / Nw, Vh / Nh)
    const Rw = Nw * baseScale * currentZoom
    const Rh = Nh * baseScale * currentZoom

    const maxPanX = Math.max(0, (Rw - Vw) / 2)
    const maxPanY = Math.max(0, (Rh - Vh) / 2)

    return {
      x: Math.min(maxPanX, Math.max(-maxPanX, newX)),
      y: Math.min(maxPanY, Math.max(-maxPanY, newY)),
    }
  }, [])

  // Manejo de puntero (ratón o táctil)
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    // Capturar puntero para que no se pierda el arrastre al salir del contenedor
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    const clamped = clampPan(dragStartRef.current.panX + dx, dragStartRef.current.panY + dy, zoom)
    setPan(clamped)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false)
      dragStartRef.current = null
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // Ignorar si el puntero ya no está capturado
      }
    }
  }

  const handleZoomChange = (nuevoZoom: number) => {
    setZoom(nuevoZoom)
    setPan((prev) => clampPan(prev.x, prev.y, nuevoZoom))
  }

  const handleReset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleConfirmar = async () => {
    const viewport = viewportRef.current
    const img = imgRef.current
    if (!viewport || !img || !img.naturalWidth || !img.naturalHeight) return

    setProcesando(true)

    try {
      const Vw = viewport.clientWidth
      const Vh = viewport.clientHeight
      const Nw = img.naturalWidth
      const Nh = img.naturalHeight

      const baseScale = Math.max(Vw / Nw, Vh / Nh)
      const totalScale = baseScale * zoom
      const Rw = Nw * totalScale
      const Rh = Nh * totalScale

      // Coordenadas en la imagen recortada
      const xStartRendered = (Rw - Vw) / 2 - pan.x
      const yStartRendered = (Rh - Vh) / 2 - pan.y

      const sx = Math.max(0, xStartRendered / totalScale)
      const sy = Math.max(0, yStartRendered / totalScale)
      const sw = Math.min(Nw - sx, Vw / totalScale)
      const sh = Math.min(Nh - sy, Vh / totalScale)

      // Dimensiones objetivo en resolución HD 16:9
      const targetWidth = 1280
      const targetHeight = 720

      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No se pudo inicializar el contexto de imagen.')

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)

      // Exportar en WebP con fallback a JPEG
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.9)
      })

      if (!blob) throw new Error('No se pudo generar el archivo de imagen recortada.')

      const archivoFinal = new File([blob], 'portada-16-9.webp', { type: 'image/webp' })
      onConfirmar(archivoFinal)
      onOpenChange(false)
    } catch (e) {
      console.error('[ModalRecortePortada] error al recortar:', e)
    } finally {
      setProcesando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-4 sm:p-6 space-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Crop className="h-5 w-5 text-primary" />
            Encuadre y Recorte de Portada (16:9)
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            Arrastra la imagen y ajusta el zoom para lograr el encuadre perfecto para el catálogo.
          </DialogDescription>
        </DialogHeader>

        {/* Viewport 16:9 con imagen arrastrable */}
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black border border-border select-none touch-none">
          <div
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`relative h-full w-full flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imagenSrc}
              alt="Vista previa para recorte"
              crossOrigin="anonymous"
              draggable={false}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                maxWidth: 'none',
                maxHeight: 'none',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                pointerEvents: 'none',
              }}
              onLoad={() => {
                setPan((prev) => clampPan(prev.x, prev.y, zoom))
              }}
            />

            {/* Guías de composición (regla de los tercios) */}
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 border border-white/20">
              <div className="border-r border-b border-white/15" />
              <div className="border-r border-b border-white/15" />
              <div className="border-b border-white/15" />
              <div className="border-r border-b border-white/15" />
              <div className="border-r border-b border-white/15" />
              <div className="border-b border-white/15" />
              <div className="border-r border-white/15" />
              <div className="border-r border-white/15" />
              <div />
            </div>

            {/* Insignia 16:9 */}
            <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-lg bg-black/70 px-2 py-0.5 text-caption font-bold text-white backdrop-blur">
              16:9
            </span>
          </div>
        </div>

        {/* Barra de Controles: Zoom y Reset */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3 rounded-xl border border-border">
          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
            <button
              type="button"
              onClick={() => handleZoomChange(Math.max(1, zoom - 0.2))}
              disabled={zoom <= 1}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-1"
              title="Reducir zoom"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => handleZoomChange(Number(e.target.value))}
              className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              aria-label="Nivel de zoom"
            />
            <button
              type="button"
              onClick={() => handleZoomChange(Math.min(3, zoom + 0.2))}
              disabled={zoom >= 3}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-1"
              title="Aumentar zoom"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <span className="font-mono text-xs text-muted-foreground w-10 text-right">
              {zoom.toFixed(1)}x
            </span>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="gap-1.5 text-xs h-8"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Centrar
          </Button>
        </div>

        <DialogFooter className="flex-row items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={procesando}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={procesando}
            onClick={handleConfirmar}
            className="gap-1.5"
          >
            {procesando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Aplicar y Subir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
