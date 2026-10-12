'use client'

/**
 * EDITOR DE ENCUADRE DE IMÁGENES.
 *
 * Se abre al elegir una foto (y al «reencuadrar» una ya subida). La persona
 * mueve y acerca la foto dentro de un marco que tiene la proporción del
 * formato; ve en vivo cómo quedará en cada pantalla y qué parte se pierde al
 * compartir. NO recorta nada en el navegador: devuelve el rectángulo elegido
 * (en píxeles del original) y el servidor genera las versiones desde el
 * original. Por eso reencuadrar después no degrada la foto.
 *
 * Toda la cuenta del encuadre sale de `@/lib/imagen/formatos`, la misma que
 * valida el servidor: lo que se ve aquí es lo que se genera allá.
 */

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Crop, Loader2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import {
  ASPECTO_COMPARTIR,
  ZOOM_MAXIMO,
  centroDe,
  estiloDeVista,
  evaluarResolucion,
  franjaCompartir,
  recorteDesde,
  zonaVisibleApaisada,
  zoomDe,
  type FormatoImagen,
  type Recorte,
} from '@/lib/imagen/formatos'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** URL de la imagen: un `blob:` del archivo recién elegido, o la URL pública del original ya subido. */
  fuente: string
  formato: FormatoImagen
  /** Encuadre guardado de una foto ya subida; sin él se empieza centrado y al máximo. */
  recorteInicial?: Recorte | null
  /** Aviso cuando la foto no tiene encuadre guardado (anterior al editor). */
  avisoInicial?: string
  textoConfirmar?: string
  procesando?: boolean
  onConfirmar: (recorte: Recorte) => void
}

interface Estado {
  ancho: number
  alto: number
  zoom: number
  cx: number
  cy: number
}

/** El estado se mantiene siempre DENTRO de lo válido: el centro que se guarda es el del recorte ya limitado. */
function normalizar(e: Estado, aspecto: number): Estado {
  const r = recorteDesde(e.ancho, e.alto, aspecto, e.zoom, e.cx, e.cy)
  const { cx, cy } = centroDe(r, e.ancho, e.alto)
  return { ...e, cx, cy }
}

export function EditorDeImagen({
  open,
  onOpenChange,
  fuente,
  formato,
  recorteInicial,
  avisoInicial,
  textoConfirmar = 'Aplicar y subir',
  procesando = false,
  onConfirmar,
}: Props) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [fallo, setFallo] = useState(false)
  const [mostrarZona, setMostrarZona] = useState(true)
  const [arrastrando, setArrastrando] = useState(false)
  const marcoRef = useRef<HTMLDivElement>(null)
  const arrastre = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  const aspecto = formato.aspecto
  const recorte = estado ? recorteDesde(estado.ancho, estado.alto, aspecto, estado.zoom, estado.cx, estado.cy) : null
  const evaluacion = recorte ? evaluarResolucion(recorte, formato) : null

  function alCargar(img: HTMLImageElement) {
    const ancho = img.naturalWidth
    const alto = img.naturalHeight
    if (!ancho || !alto) {
      setFallo(true)
      return
    }
    if (recorteInicial && recorteInicial.w > 0 && recorteInicial.h > 0) {
      const { cx, cy } = centroDe(recorteInicial, ancho, alto)
      setEstado(normalizar({ ancho, alto, zoom: zoomDe(recorteInicial, ancho, alto, aspecto), cx, cy }, aspecto))
    } else {
      setEstado({ ancho, alto, zoom: 1, cx: 0.5, cy: 0.5 })
    }
  }

  function mover(dxPantalla: number, dyPantalla: number, base: { cx: number; cy: number }) {
    const marco = marcoRef.current
    if (!estado || !recorte || !marco) return
    // Píxeles del original que cubre cada píxel de pantalla del marco.
    const porPx = recorte.w / marco.clientWidth
    setEstado(
      normalizar(
        { ...estado, cx: base.cx - (dxPantalla * porPx) / estado.ancho, cy: base.cy - (dyPantalla * porPx) / estado.alto },
        aspecto
      )
    )
  }

  function cambiarZoom(zoom: number) {
    if (!estado) return
    setEstado(normalizar({ ...estado, zoom: Math.min(ZOOM_MAXIMO, Math.max(1, zoom)) }, aspecto))
  }

  function alTeclear(e: React.KeyboardEvent) {
    if (!estado || !recorte) return
    const paso = 0.03 // 3 % del recorte por pulsación
    const mapa: Record<string, [number, number]> = {
      ArrowLeft: [-paso, 0],
      ArrowRight: [paso, 0],
      ArrowUp: [0, -paso],
      ArrowDown: [0, paso],
    }
    if (mapa[e.key]) {
      e.preventDefault()
      const [dx, dy] = mapa[e.key]
      setEstado(normalizar({ ...estado, cx: estado.cx + (dx * recorte.w) / estado.ancho, cy: estado.cy + (dy * recorte.h) / estado.alto }, aspecto))
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      cambiarZoom(estado.zoom + 0.2)
    } else if (e.key === '-') {
      e.preventDefault()
      cambiarZoom(estado.zoom - 0.2)
    }
  }

  const zona = zonaVisibleApaisada(aspecto, ASPECTO_COMPARTIR)
  const franja = recorte ? franjaCompartir(recorte) : null

  return (
    <Dialog open={open} onOpenChange={(abierto) => !procesando && onOpenChange(abierto)}>
      <DialogContent className="max-h-[92vh] gap-0 space-y-4 overflow-y-auto p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Crop className="h-5 w-5 text-primary" aria-hidden />
            Encuadra tu foto
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Arrastra la foto y acércala hasta que se vea como quieres. Formato: {formato.etiqueta.toLowerCase()} cuadrada (1:1).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
          {/* Marco de encuadre */}
          <div className="space-y-3">
            <div
              ref={marcoRef}
              role="application"
              tabIndex={0}
              aria-label="Marco de encuadre. Flechas para mover la foto, más y menos para acercar."
              onKeyDown={alTeclear}
              onPointerDown={(e) => {
                if (!estado) return
                e.preventDefault()
                setArrastrando(true)
                arrastre.current = { x: e.clientX, y: e.clientY, cx: estado.cx, cy: estado.cy }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!arrastrando || !arrastre.current) return
                mover(e.clientX - arrastre.current.x, e.clientY - arrastre.current.y, arrastre.current)
              }}
              onPointerUp={() => {
                setArrastrando(false)
                arrastre.current = null
              }}
              onPointerCancel={() => {
                setArrastrando(false)
                arrastre.current = null
              }}
              style={{ aspectRatio: aspecto }}
              className={`relative mx-auto w-full max-w-md touch-none select-none overflow-hidden rounded-xl border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                arrastrando ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fuente}
                alt="Foto que estás encuadrando"
                draggable={false}
                onLoad={(e) => alCargar(e.currentTarget)}
                onError={() => setFallo(true)}
                className="pointer-events-none absolute max-w-none"
                style={estado && recorte ? estiloDeVista(recorte, estado.ancho, estado.alto) : { opacity: 0, width: '100%' }}
              />

              {/* Zona que se ve al compartir: lo de fuera se oscurece */}
              {estado && mostrarZona && (
                <div className="pointer-events-none absolute inset-0" aria-hidden>
                  <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: `${zona.y * 100}%` }} />
                  <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${(1 - zona.y - zona.h) * 100}%` }} />
                  <div className="absolute inset-x-0 border-y border-dashed border-white/80" style={{ top: `${zona.y * 100}%`, height: `${zona.h * 100}%` }}>
                    <span className="absolute left-2 top-1 rounded bg-black/60 px-1.5 py-0.5 text-label-sm text-white">Se ve al compartir</span>
                  </div>
                </div>
              )}

              {!estado && !fallo && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" aria-label="Cargando la foto" />
                </div>
              )}
              {fallo && (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-destructive">
                  No se pudo abrir la foto. Prueba con otro archivo.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
              <button
                type="button"
                onClick={() => estado && cambiarZoom(estado.zoom - 0.2)}
                disabled={!estado || estado.zoom <= 1}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Alejar"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <input
                type="range"
                min={1}
                max={ZOOM_MAXIMO}
                step={0.05}
                value={estado?.zoom ?? 1}
                disabled={!estado}
                onChange={(e) => cambiarZoom(Number(e.target.value))}
                className="h-1.5 min-w-[8rem] flex-1 cursor-pointer accent-primary"
                aria-label="Nivel de zoom"
              />
              <button
                type="button"
                onClick={() => estado && cambiarZoom(estado.zoom + 0.2)}
                disabled={!estado || estado.zoom >= ZOOM_MAXIMO}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Acercar"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={!estado}
                onClick={() => estado && setEstado({ ...estado, zoom: 1, cx: 0.5, cy: 0.5 })}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Centrar
              </Button>
            </div>

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={mostrarZona} onChange={(e) => setMostrarZona(e.target.checked)} className="accent-primary" />
              Marcar la zona que se ve al compartir por WhatsApp o redes
            </label>
          </div>

          {/* Así se verá */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Así se verá</p>
            <div className="space-y-1">
              <div className="relative mx-auto aspect-square w-28 overflow-hidden rounded-lg border border-border bg-muted md:mx-0">
                {estado && recorte && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fuente} alt="" draggable={false} className="absolute max-w-none" style={estiloDeVista(recorte, estado.ancho, estado.alto)} />
                )}
              </div>
              <p className="text-caption">Tarjeta, ficha y perfil de la empresa</p>
            </div>
            <div className="space-y-1">
              <div
                className="relative mx-auto w-full max-w-[13rem] overflow-hidden rounded-lg border border-border bg-muted md:mx-0"
                style={{ aspectRatio: ASPECTO_COMPARTIR }}
              >
                {estado && franja && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fuente} alt="" draggable={false} className="absolute max-w-none" style={estiloDeVista(franja, estado.ancho, estado.alto)} />
                )}
              </div>
              <p className="text-caption">Al compartir el enlace (apaisada)</p>
            </div>
          </div>
        </div>

        {/* Calidad */}
        {estado && recorte && evaluacion && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
              evaluacion.nivel === 'ok'
                ? 'border-success/30 bg-success/5 text-foreground'
                : evaluacion.nivel === 'justa'
                  ? 'border-warning/40 bg-warning/5 text-foreground'
                  : 'border-destructive/40 bg-destructive/5 text-foreground'
            }`}
          >
            {evaluacion.nivel === 'ok' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : (
              <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${evaluacion.nivel === 'justa' ? 'text-warning' : 'text-destructive'}`} aria-hidden />
            )}
            <div className="space-y-0.5">
              <p>
                {evaluacion.nivel === 'ok'
                  ? `Resolución óptima: la zona elegida mide ${Math.round(recorte.w)}×${Math.round(recorte.h)} px.`
                  : evaluacion.mensaje}
              </p>
              <p className="text-caption">
                Foto original: {estado.ancho}×{estado.alto} px. {avisoInicial}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={procesando} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" size="sm" className="gap-1.5" disabled={!estado || !recorte || procesando} onClick={() => recorte && onConfirmar(recorte)}>
            {procesando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
