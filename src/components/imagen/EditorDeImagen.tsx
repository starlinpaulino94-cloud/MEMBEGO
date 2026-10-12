'use client'

/**
 * EDITOR DE ENCUADRE DE IMÁGENES.
 *
 * Se abre al elegir una foto (y al «encuadrar» una ya subida). La persona la
 * mueve donde quiere que se vea más, la acerca, la aleja hasta verla entera
 * (con un color de fondo en lo que sobra) y la gira, dentro de un marco con la
 * proporción del formato de SU sección. Ve en vivo cómo quedará y, si la
 * imagen se recorta distinto en alguna pantalla (el banner en móvil y en
 * escritorio), qué parte se ve en cada una.
 *
 * El editor NO produce la imagen: devuelve el encuadre (rectángulo + giro +
 * fondo) y la foto cargada. Quien lo usa decide qué hacer: el catálogo manda el
 * encuadre al servidor, que genera las versiones desde el original; las demás
 * secciones lo pintan en un lienzo (`exportarEncuadre`) y suben esa imagen.
 *
 * Toda la cuenta sale de `@/lib/imagen/formatos`, la misma que valida el
 * servidor: lo que se ve aquí es lo que se genera allá.
 */

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Crop, Loader2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import {
  FONDOS,
  FONDO_TRANSPARENTE,
  ZOOM_MAXIMO,
  centroDe,
  dimensionesGiradas,
  estiloDeImagenGirada,
  estiloDeVista,
  evaluarResolucion,
  fondoInicial,
  recorteDesde,
  siguienteGiro,
  zonaVisible,
  zoomDe,
  zoomMinimo,
  type Encuadre,
  type FormatoImagen,
  type Giro,
} from '@/lib/imagen/formatos'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** La foto cargada, para quien quiera pintarla en un lienzo. */
export interface FotoCargada {
  img: HTMLImageElement
  /** Dimensiones de la foto ya orientada y SIN girar. */
  ancho: number
  alto: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** URL de la imagen: un `blob:` del archivo recién elegido, o la URL pública de una ya subida. */
  fuente: string
  formato: FormatoImagen
  /** Encuadre guardado de una foto ya subida; sin él se empieza centrado y al máximo. */
  encuadreInicial?: Encuadre | null
  /** Aviso extra bajo la calidad (p. ej. que la foto es anterior al editor). */
  avisoInicial?: string
  textoConfirmar?: string
  procesando?: boolean
  /** true si quien llama va a pintar la foto en un lienzo: pide la imagen con CORS para poder exportarla. */
  exportaEnNavegador?: boolean
  onConfirmar: (encuadre: Encuadre, foto: FotoCargada) => void
}

interface Estado {
  ancho: number
  alto: number
  giro: Giro
  zoom: number
  cx: number
  cy: number
  fondo: string
}

/** Clases COMPLETAS: Tailwind no genera nombres armados con variables. */
const CLASES_NIVEL: Record<'ok' | 'justa' | 'baja', string> = {
  ok: 'border-success/30 bg-success/5',
  justa: 'border-warning/40 bg-warning/5',
  baja: 'border-destructive/40 bg-destructive/5',
}

/** Velos que oscurecen lo que no se ve: negro con transparencia, sin escribir un color a mano. */
const VELO_LEVE = 'color-mix(in srgb, black 38%, transparent)'
const VELO_FUERTE = 'color-mix(in srgb, black 50%, transparent)'

/** El fondo se pinta tal cual; «sin fondo» se enseña como un tablero para que se note. */
function estiloDeFondo(fondo: string | undefined): React.CSSProperties {
  if (fondo === FONDO_TRANSPARENTE) {
    // Tablero con los tokens del tema (no un color a mano): se ve bien en claro y en oscuro.
    return { background: 'conic-gradient(var(--color-muted) 25%, var(--color-background) 0 50%, var(--color-muted) 0 75%, var(--color-background) 0) 0 0 / 16px 16px' }
  }
  return { backgroundColor: fondo ?? 'var(--color-muted)' }
}

const dimsDe = (e: Pick<Estado, 'ancho' | 'alto' | 'giro'>) => dimensionesGiradas(e.ancho, e.alto, e.giro)

/** El estado se mantiene siempre DENTRO de lo válido: el centro que se guarda es el del recorte ya limitado. */
function normalizar(e: Estado, aspecto: number): Estado {
  const d = dimsDe(e)
  const zoom = Math.min(ZOOM_MAXIMO, Math.max(zoomMinimo(d.ancho, d.alto, aspecto), e.zoom))
  const r = recorteDesde(d.ancho, d.alto, aspecto, zoom, e.cx, e.cy)
  const { cx, cy } = centroDe(r, d.ancho, d.alto)
  return { ...e, zoom, cx, cy }
}

export function EditorDeImagen({
  open,
  onOpenChange,
  fuente,
  formato,
  encuadreInicial,
  avisoInicial,
  textoConfirmar = 'Aplicar y subir',
  procesando = false,
  exportaEnNavegador = false,
  onConfirmar,
}: Props) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [fallo, setFallo] = useState(false)
  const [mostrarZonas, setMostrarZonas] = useState(true)
  const [arrastrando, setArrastrando] = useState(false)
  const marcoRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const arrastre = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  const aspecto = formato.aspecto
  const dims = estado ? dimsDe(estado) : null
  const recorte = estado && dims ? recorteDesde(dims.ancho, dims.alto, aspecto, estado.zoom, estado.cx, estado.cy) : null
  const evaluacion = recorte ? evaluarResolucion(recorte, formato) : null
  const minimo = dims ? zoomMinimo(dims.ancho, dims.alto, aspecto) : 1
  // ¿Hay fondo a la vista? (la foto no cubre todo el marco)
  const hayRelleno = !!(recorte && dims && (recorte.x < -0.5 || recorte.y < -0.5 || recorte.x + recorte.w > dims.ancho + 0.5 || recorte.y + recorte.h > dims.alto + 0.5))

  function alCargar(img: HTMLImageElement) {
    const ancho = img.naturalWidth
    const alto = img.naturalHeight
    if (!ancho || !alto) {
      setFallo(true)
      return
    }
    if (encuadreInicial && encuadreInicial.w > 0 && encuadreInicial.h > 0) {
      const d = dimensionesGiradas(ancho, alto, encuadreInicial.giro)
      const { cx, cy } = centroDe(encuadreInicial, d.ancho, d.alto)
      setEstado(
        normalizar({ ancho, alto, giro: encuadreInicial.giro, zoom: zoomDe(encuadreInicial, d.ancho, d.alto, aspecto), cx, cy, fondo: encuadreInicial.fondo }, aspecto)
      )
    } else {
      setEstado({ ancho, alto, giro: 0, zoom: 1, cx: 0.5, cy: 0.5, fondo: fondoInicial(formato) })
    }
  }

  function mover(dxPantalla: number, dyPantalla: number, base: { cx: number; cy: number }) {
    const marco = marcoRef.current
    if (!estado || !recorte || !dims || !marco) return
    // Píxeles de la foto que cubre cada píxel de pantalla del marco.
    const porPx = recorte.w / marco.clientWidth
    setEstado(normalizar({ ...estado, cx: base.cx - (dxPantalla * porPx) / dims.ancho, cy: base.cy - (dyPantalla * porPx) / dims.alto }, aspecto))
  }

  function cambiarZoom(zoom: number) {
    if (!estado) return
    setEstado(normalizar({ ...estado, zoom }, aspecto))
  }

  function girar(sentido: 1 | -1) {
    if (!estado) return
    // Al girar cambian el alto y el ancho de la foto: se vuelve a empezar centrado y a ajuste completo.
    setEstado(normalizar({ ...estado, giro: siguienteGiro(estado.giro, sentido), zoom: 1, cx: 0.5, cy: 0.5 }, aspecto))
  }

  function alTeclear(e: React.KeyboardEvent) {
    if (!estado || !recorte || !dims) return
    const paso = 0.03 // 3 % del marco por pulsación
    const mapa: Record<string, [number, number]> = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }
    if (mapa[e.key]) {
      e.preventDefault()
      const [dx, dy] = mapa[e.key]
      setEstado(normalizar({ ...estado, cx: estado.cx + (dx * recorte.w) / dims.ancho, cy: estado.cy + (dy * recorte.h) / dims.alto }, aspecto))
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      cambiarZoom(estado.zoom + 0.2)
    } else if (e.key === '-') {
      e.preventDefault()
      cambiarZoom(estado.zoom - 0.2)
    }
  }

  function confirmar() {
    if (!estado || !recorte || !imgRef.current) return
    onConfirmar(
      { x: recorte.x, y: recorte.y, w: recorte.w, h: recorte.h, giro: estado.giro, fondo: estado.fondo },
      { img: imgRef.current, ancho: estado.ancho, alto: estado.alto }
    )
  }

  /** La foto pintada dentro de una caja de la proporción del formato: el marco y las vistas previas usan lo mismo. */
  const fotoEnCaja = estado && recorte && dims && (
    <div className="absolute max-w-none" style={estiloDeVista(recorte, dims.ancho, dims.alto)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fuente}
        alt=""
        draggable={false}
        crossOrigin={exportaEnNavegador ? 'anonymous' : undefined}
        style={estiloDeImagenGirada(estado.giro, estado.ancho, estado.alto)}
      />
    </div>
  )

  // Zonas por pantalla: el borde de cada una y, fuera de la que se ve en TODAS, un velo.
  const zonas = (formato.zonas ?? []).map((z) => ({ ...z, caja: zonaVisible(aspecto, z.aspecto) }))
  const comun = zonas.length
    ? zonas.reduce(
        (a, z) => {
          const x = Math.max(a.x, z.caja.x)
          const y = Math.max(a.y, z.caja.y)
          return { x, y, w: Math.min(a.x + a.w, z.caja.x + z.caja.w) - x, h: Math.min(a.y + a.h, z.caja.y + z.caja.h) - y }
        },
        { x: 0, y: 0, w: 1, h: 1 }
      )
    : null
  const circular = formato.forma === 'circulo'

  return (
    <Dialog open={open} onOpenChange={(abierto) => !procesando && onOpenChange(abierto)}>
      <DialogContent className="max-h-[92vh] gap-0 space-y-4 overflow-y-auto p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Crop className="h-5 w-5 text-primary" aria-hidden />
            Encuadra tu foto
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Arrastra la foto hasta el lugar que quieres que se vea más.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
          {/* Marco de encuadre */}
          <div className="space-y-3">
            <div
              ref={marcoRef}
              role="application"
              tabIndex={0}
              aria-label="Marco de encuadre. Flechas para mover la foto, más y menos para acercar o alejar."
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
              // El marco no pasa de ~46 % del alto de la pantalla: así los botones de abajo no quedan fuera de vista.
              style={{ aspectRatio: aspecto, width: `min(100%, 28rem, calc(46vh * ${aspecto}))`, ...estiloDeFondo(estado?.fondo) }}
              className={`relative mx-auto touch-none select-none overflow-hidden rounded-xl border border-border outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                arrastrando ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              {/* Imagen oculta que SIEMPRE está montada: de ella salen las dimensiones al cargar y el lienzo al exportar. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={fuente}
                alt=""
                crossOrigin={exportaEnNavegador ? 'anonymous' : undefined}
                onLoad={(e) => alCargar(e.currentTarget)}
                onError={() => setFallo(true)}
                className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0"
              />
              {fotoEnCaja}

              {/* Velo y borde de las pantallas que recortan distinto */}
              {estado && mostrarZonas && comun && (
                <div className="pointer-events-none absolute inset-0" aria-hidden>
                  <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 0 0 transparent' }}>
                    <div
                      className="absolute"
                      style={{
                        left: `${comun.x * 100}%`,
                        top: `${comun.y * 100}%`,
                        width: `${comun.w * 100}%`,
                        height: `${comun.h * 100}%`,
                        boxShadow: `0 0 0 9999px ${VELO_LEVE}`,
                      }}
                    />
                  </div>
                  {zonas.map((z) => (
                    <div
                      key={z.etiqueta}
                      className="absolute border border-dashed border-white/90"
                      style={{ left: `${z.caja.x * 100}%`, top: `${z.caja.y * 100}%`, width: `${z.caja.w * 100}%`, height: `${z.caja.h * 100}%` }}
                    >
                      <span className="absolute left-1 top-0.5 rounded bg-black/65 px-1.5 py-0.5 text-label-sm text-white">{z.etiqueta}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Avatares: lo que queda fuera del círculo se oscurece */}
              {estado && circular && (
                <div className="pointer-events-none absolute inset-0" aria-hidden>
                  <div className="absolute inset-[4%] rounded-full border-2 border-white/90" style={{ boxShadow: `0 0 0 9999px ${VELO_FUERTE}` }} />
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
                disabled={!estado || estado.zoom <= minimo}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Alejar"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <input
                type="range"
                min={minimo}
                max={ZOOM_MAXIMO}
                step="any"
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
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={!estado} onClick={() => girar(-1)} aria-label="Girar a la izquierda">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={!estado} onClick={() => girar(1)} aria-label="Girar a la derecha">
                  <RotateCw className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!estado}
                  onClick={() => estado && setEstado(normalizar({ ...estado, zoom: 1, cx: 0.5, cy: 0.5 }, aspecto))}
                >
                  Centrar
                </Button>
              </div>
              <p className="w-full text-caption">Aleja la foto con el control de zoom para verla entera; gírala con las flechas.</p>
            </div>

            {hayRelleno && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="group" aria-label="Color de fondo">
                <span>Fondo en lo que la foto no cubre:</span>
                {[...FONDOS, ...(formato.permiteTransparente ? [{ valor: FONDO_TRANSPARENTE, etiqueta: 'Sin fondo' }] : [])].map((f) => (
                  <button
                    key={f.valor}
                    type="button"
                    aria-label={f.etiqueta}
                    aria-pressed={estado?.fondo === f.valor}
                    title={f.etiqueta}
                    onClick={() => estado && setEstado({ ...estado, fondo: f.valor })}
                    style={estiloDeFondo(f.valor)}
                    className={`h-6 w-6 rounded-full border ${estado?.fondo === f.valor ? 'ring-2 ring-primary ring-offset-1' : 'border-border'}`}
                  />
                ))}
              </div>
            )}

            {comun && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={mostrarZonas} onChange={(e) => setMostrarZonas(e.target.checked)} className="accent-primary" />
                Marcar lo que se ve en cada pantalla
              </label>
            )}
          </div>

          {/* Así se verá */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Así se verá</p>
            <div
              className={`relative mx-auto w-full max-w-[13rem] overflow-hidden border border-border md:mx-0 ${circular ? 'rounded-full' : 'rounded-lg'}`}
              style={{ aspectRatio: aspecto, ...estiloDeFondo(estado?.fondo) }}
            >
              {fotoEnCaja}
            </div>
            <p className="text-caption">
              {formato.etiqueta} · {formato.salida.ancho}×{formato.salida.alto} px
            </p>
          </div>
        </div>

        {/* Calidad */}
        {estado && recorte && evaluacion && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-lg border p-3 text-sm text-foreground ${CLASES_NIVEL[evaluacion.nivel]}`}
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
          <Button type="button" size="sm" className="gap-1.5" disabled={!estado || !recorte || procesando} onClick={confirmar}>
            {procesando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
