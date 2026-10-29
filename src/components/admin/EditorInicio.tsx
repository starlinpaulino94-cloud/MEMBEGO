'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CloudUpload,
  GripVertical,
  ImagePlus,
  Lock,
  MapPin,
  Plus,
  Save,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'
import { fechaEditorialIso } from '@/modules/home/editor-contrato'
import {
  COLORES_PANEL,
  COLORES_PANEL_INFO,
  FORMATOS_A_MEDIDA,
  FORMATOS_BANNER_INFO,
  FORMATO_BANNER_NUEVO,
  COLOR_PANEL_POR_DEFECTO,
  formatoAdmitePie,
  formatoRequiereTexto,
  type ColorPanel,
  type FormatoBanner,
} from '@/modules/home/banner-formatos'
import { subirImagenBanner } from '@/modules/home/imagen-banner-accion'
import { MAX_ITEMS_BANNER } from '@/modules/home/coleccion'
import { FORMATOS } from '@/lib/imagen/formatos'
import { useEditorDeImagen } from '@/components/imagen/useEditorDeImagen'
import { PieBanner, TarjetaBanner, llevaPie } from '@/components/cliente/inicio/TarjetaBanner'
import type { HeroInicio } from '@/modules/home/vista'
import {
  archivarRevision,
  guardarBorrador,
  pausarPublicacion,
  publicarEdicion,
  reanudarPublicacion,
} from '@/modules/home/acciones'

export const TIPOS_BLOQUE = [
  'CABECERA',
  'CATEGORIAS',
  'HERO',
  'DESTACADAS',
  'MEMBRESIAS',
  'BANNER_QR',
  'EXPERIENCIAS',
] as const

export type TipoBloque = (typeof TIPOS_BLOQUE)[number]

const ETIQUETAS: Record<TipoBloque, string> = {
  CABECERA: 'Cabecera de Búsqueda & Geolocalización',
  HERO: 'Carrusel Hero Promocional',
  CATEGORIAS: 'Categorías Rápidas',
  DESTACADAS: 'Empresas Destacadas (Cerca de Ti)',
  MEMBRESIAS: 'Membresías Recomendadas',
  BANNER_QR: 'Banner Interactivo Mi QR',
  EXPERIENCIAS: 'Experiencias y Excursiones',
}

/** El chip de cada bloque describe su TIPO, como en el diseño. */
const CHIPS: Record<TipoBloque, string> = {
  CABECERA: 'SISTEMA',
  HERO: 'EN EDICIÓN',
  CATEGORIAS: 'PÍLDORAS',
  DESTACADAS: 'GEO',
  MEMBRESIAS: 'MONETIZACIÓN',
  BANNER_QR: 'CANJE INMEDIATO',
  EXPERIENCIAS: 'CATÁLOGO',
}

export interface SlideEstado {
  titulo: string
  subtitulo: string
  imagenUrl: string
  ctaTexto: string
  ctaTipo: 'promocion' | 'empresa' | 'plan' | 'excursion' | 'catalogo'
  ctaId: string
  /** Solo destino «Productos y servicios»: los ítems de la colección, en orden. */
  itemIds: string[]
  /** Cómo va el texto sobre la imagen (ver `banner-formatos.ts`). */
  formato: FormatoBanner
  colorPanel: ColorPanel
  mostrarPie: boolean
}

export interface OpcionEntidad {
  id: string
  titulo: string
}

export interface BloqueEstado {
  tipo: TipoBloque
  activo: boolean
}

export interface BorradorInicial {
  id: string
  estado: string
  programadaPara: string | null
  territorio: string | null
  bloques: BloqueEstado[]
  slides: SlideEstado[]
  segmentacion: { membresia: 'SIN_PLAN' | 'CUALQUIERA'; radioKm: number; hasta: string }
}

function bloquePorDefecto(): BloqueEstado[] {
  return TIPOS_BLOQUE.map((tipo) => ({ tipo, activo: true }))
}

function slideVacio(companyId: string): SlideEstado {
  return {
    titulo: '',
    subtitulo: '',
    imagenUrl: '',
    ctaTexto: 'Ver oferta',
    ctaTipo: 'empresa',
    ctaId: companyId,
    itemIds: [],
    // Banner nuevo: la imagen manda; el texto solo si el negocio lo pide.
    formato: FORMATO_BANNER_NUEVO,
    colorPanel: COLOR_PANEL_POR_DEFECTO,
    mostrarPie: true,
  }
}

/** El banner del editor como lo recibe la tarjeta del cliente: la MISMA tarjeta, no una imitación. */
function heroDeSlide(s: SlideEstado, empresa: string): HeroInicio {
  return {
    titulo: s.titulo || 'Titular del banner',
    subtitulo: s.subtitulo,
    empresa,
    ciudad: null,
    imagen: s.imagenUrl || null,
    href: '#',
    cta: s.ctaTexto || 'Ver oferta',
    planDesde: null,
    color: null,
    valoracion: null,
    etiqueta: 'Novedad destacada',
    formato: s.formato,
    colorPanel: s.colorPanel,
    mostrarPie: s.mostrarPie,
  }
}

/** «Sincronizado hace 12 min» — del `updatedAt` real de la publicada. */
function haceCuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

const CAMPO =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20'

/**
 * EL EDITOR DE INICIO (contrato Stitch · `editor_de_inicio_de_la_app`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * La lógica no cambió con el rediseño: mismas acciones, mismas validaciones,
 * mismos ids (los usa la verificación E2E). Lo que cambió es que la pantalla
 * ahora dice lo que el diseño dice:
 *
 *  · Cada bloque del feed es una fila con su número, su chip de tipo, un
 *    resumen hecho DE DATOS REALES (los banners que hay, las categorías que
 *    existen, los planes con su precio) y un interruptor — no un icono de ojo.
 *  · El hero se configura UNA diapositiva a la vez, con su arte delante y
 *    «Banner N de M» para moverse, como en el diseño; no tres formularios
 *    apilados.
 *  · La segmentación son tres tarjetas con el valor grande, porque eso es lo
 *    que un administrador comprueba de un vistazo antes de publicar.
 *  · La vista previa vive dentro de un teléfono con bisel: es la señal de que
 *    ESO es lo que la clientela ve, y no otra tarjeta del panel.
 *
 * Métricas que el diseño enseña y aquí no existen (impresiones, CTR) no se
 * pintan: un número inventado en un panel de administración es peor que
 * ninguno.
 */
export function EditorInicio({
  companyId,
  companyName,
  territorioSugerido,
  trabajo,
  bannerInicial = 1,
  publicada,
  media,
  promociones,
  planes,
  excursiones,
  catalogo,
  previewEmpresas,
  previewPlanes,
  previewCategorias,
}: {
  companyId: string
  companyName: string
  territorioSugerido: string
  trabajo: BorradorInicial | null
  /** Banner (desde 1) con el que abre el editor; viene de «Editar» en la lista del carrusel. */
  bannerInicial?: number
  publicada: { id: string; updatedAt: string; territorio: string | null } | null
  media: string[]
  promociones: OpcionEntidad[]
  planes: OpcionEntidad[]
  excursiones: OpcionEntidad[]
  /** Productos y servicios ACTIVOS de la empresa: lo que un banner puede enganchar. */
  catalogo: OpcionEntidad[]
  previewEmpresas: { name: string }[]
  previewPlanes: { nombre: string; precio: number }[]
  previewCategorias: string[]
}) {
  const router = useRouter()
  const [territorio, setTerritorio] = useState(trabajo?.territorio ?? territorioSugerido)
  const [bloques, setBloques] = useState<BloqueEstado[]>(trabajo?.bloques ?? bloquePorDefecto())
  const [slides, setSlides] = useState<SlideEstado[]>(trabajo?.slides ?? [slideVacio(companyId)])
  const [segmentacion, setSegmentacion] = useState(
    trabajo?.segmentacion ?? { membresia: 'CUALQUIERA' as const, radioKm: 15, hasta: '' }
  )
  const [revisionId, setRevisionId] = useState<string | null>(trabajo && trabajo.estado !== 'PUBLICADA' ? trabajo.id : null)
  const [programarPara, setProgramarPara] = useState('')
  const [slideActual, setSlideActual] = useState(Math.max(0, bannerInicial - 1))
  const [perfilPreview, setPerfilPreview] = useState<'visitante' | 'socio'>('visitante')
  const [ocupado, setOcupado] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)

  const opcionesSegunTipo = (tipo: SlideEstado['ctaTipo']) =>
    tipo === 'promocion'
      ? promociones
      : tipo === 'plan'
        ? planes
        : tipo === 'excursion'
          ? excursiones
          : tipo === 'catalogo'
            ? catalogo
            : [{ id: companyId, titulo: companyName }]

  function armarEntrada() {
    return {
      territorio,
      bloques: bloques.map((b) => ({
        tipo: b.tipo,
        activo: b.tipo === 'CABECERA' ? true : b.activo,
        titulo: null,
        config:
          b.tipo === 'HERO'
            ? {
                slides: slides.map((s) => ({
                  titulo: s.titulo,
                  subtitulo: s.subtitulo,
                  empresaId: companyId,
                  imagenUrl: s.imagenUrl || null,
                  ctaTexto: s.ctaTexto,
                  // Con «Productos y servicios» el destino es el primero de la colección.
                  ctaDestino: { tipo: s.ctaTipo, id: s.ctaTipo === 'catalogo' ? (s.itemIds[0] ?? '') : s.ctaId },
                  itemIds: s.ctaTipo === 'catalogo' ? s.itemIds : [],
                  formato: s.formato,
                  colorPanel: s.colorPanel,
                  mostrarPie: s.mostrarPie,
                })),
              }
            : {},
      })),
      segmentacion: {
        membresia: segmentacion.membresia,
        radioKm: segmentacion.radioKm,
        hasta: fechaEditorialIso(segmentacion.hasta),
      },
    }
  }

  async function correr(
    accion: () => Promise<{ error?: string; ok?: boolean; revisionId?: string }>
  ) {
    setOcupado(true)
    setMensaje(null)
    try {
      const r = await accion()
      if (r.error) {
        setMensaje({ ok: false, texto: r.error })
      } else {
        if (r.revisionId) setRevisionId(r.revisionId)
        router.refresh()
      }
    } catch (error) {
      console.error('[home:editor] No se pudo completar la operación:', error)
      setMensaje({
        ok: false,
        texto: 'No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.',
      })
    } finally {
      setOcupado(false)
    }
  }

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir
    if (bloques[i]?.tipo === 'CABECERA' || bloques[j]?.tipo === 'CABECERA') return
    if (j < 1 || j >= bloques.length) return
    const copia = [...bloques]
    const [b] = copia.splice(i, 1)
    copia.splice(j, 0, b)
    setBloques(copia)
  }

  function actualizaSlide(i: number, parche: Partial<SlideEstado>) {
    setSlides((prev) => prev.map((s, k) => (k === i ? { ...s, ...parche } : s)))
  }

  async function subirArchivo(indice: number, archivo: File | undefined) {
    if (!archivo) return
    setSubiendo(true)
    setMensaje(null)
    try {
      const datos = new FormData()
      datos.set('archivo', archivo)
      const r = await subirImagenBanner(datos)
      if ('error' in r) setMensaje({ ok: false, texto: r.error })
      else actualizaSlide(indice, { imagenUrl: r.url })
    } catch (error) {
      console.error('[home:editor] No se pudo subir la imagen:', error)
      setMensaje({ ok: false, texto: 'No se pudo subir la imagen. Inténtalo de nuevo.' })
    } finally {
      setSubiendo(false)
    }
  }

  const i = Math.min(slideActual, Math.max(0, slides.length - 1))
  const slide = slides[i]
  const requiereTexto = slide ? formatoRequiereTexto(slide.formato) : true

  // La imagen del banner pasa por el editor de encuadre del sistema, al formato
  // de SU sección (4:5): lo que se encuadra es lo que se ve en el inicio.
  const { elegir: elegirImagen, dialogo: dialogoImagen } = useEditorDeImagen({
    formato: FORMATOS.bannerInicio,
    alAplicar: (archivo) => subirArchivo(i, archivo),
  })
  const activos = bloques.filter((b) => b.activo).length

  /** El resumen de cada fila sale de los datos que esta pantalla ya cargó. */
  function resumenDe(tipo: TipoBloque): string {
    switch (tipo) {
      case 'CABECERA':
        return `Gradiente Membego + buscador y ubicación${territorio ? ` · ${territorio}` : ''}`
      case 'HERO':
        return `${slides.length} ${slides.length === 1 ? 'banner' : 'banners'} con destino real`
      case 'CATEGORIAS':
        return previewCategorias.length > 0
          ? `${previewCategorias.length} ${previewCategorias.length === 1 ? 'acceso' : 'accesos'}: ${previewCategorias.slice(0, 4).join(', ')}${previewCategorias.length > 4 ? '…' : ''}`
          : 'Sin categorías publicadas todavía'
      case 'DESTACADAS':
        return previewEmpresas.length > 0
          ? previewEmpresas.slice(0, 2).map((e) => e.name).join(' & ')
          : 'Sin empresas destacadas todavía'
      case 'MEMBRESIAS':
        return previewPlanes.length > 0
          ? previewPlanes
              .slice(0, 2)
              .map((p) => `${p.nombre} ${formatPrice(p.precio)}/mes`)
              .join(' + ')
          : 'Sin planes activos todavía'
      case 'BANNER_QR':
        return '«¿Vas a un comercio asociado hoy?» · Toca para escanear en caja'
      case 'EXPERIENCIAS':
        return excursiones.length > 0
          ? excursiones.slice(0, 2).map((e) => e.titulo).join(' & ')
          : 'Sin excursiones en el catálogo todavía'
    }
  }

  function chipDe(tipo: TipoBloque): string {
    if (tipo === 'DESTACADAS') return `GEO ${segmentacion.radioKm} KM`
    return CHIPS[tipo]
  }

  return (
    <div className="space-y-5">
      {trabajo?.estado === 'PUBLICADA' ? (
        <p className="rounded-lg bg-brand-primary-soft px-4 py-2.5 text-small text-foreground">
          Estás viendo lo que tus clientes ven hoy. Cambia lo que quieras y pulsa «Publicar»: hasta entonces el inicio no cambia.
        </p>
      ) : null}
      {/* ── Territorio + estado + acciones ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 rounded-lg bg-brand-primary-soft px-4 py-2.5">
          <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <label
              htmlFor="ed-territorio"
              className="block text-label-sm uppercase tracking-wide text-muted-foreground"
            >
              Territorio / Segmento
            </label>
            <input
              id="ed-territorio"
              value={territorio}
              onChange={(e) => setTerritorio(e.target.value)}
              placeholder="Higüey · Todos los clientes"
              maxLength={80}
              className="w-64 max-w-full bg-transparent text-h4 text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        <p className="flex items-center gap-2 text-small">
          <span
            aria-hidden
            className={cn(
              'size-2 rounded-full',
              publicada ? 'bg-success' : 'bg-muted-foreground/40'
            )}
          />
          <span className="font-semibold text-foreground">
            {publicada ? 'Producción en Vivo' : 'Sin publicación'}
          </span>
          {publicada ? (
            <span className="text-muted-foreground">
              Sincronizado {haceCuanto(publicada.updatedAt)}
            </span>
          ) : null}
        </p>
      </div>

      {mensaje && (
        <p
          role="alert"
          className={cn(
            'rounded-lg border p-3 text-sm',
            mensaje.ok
              ? 'border-success/30 bg-success-soft'
              : 'border-destructive/30 bg-danger-soft text-danger-ink'
          )}
        >
          {mensaje.texto}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          className="rounded-full"
          disabled={ocupado}
          onClick={() => correr(() => guardarBorrador(armarEntrada()))}
        >
          <Save className="size-4" aria-hidden /> Borrador
        </Button>
        <div className="flex items-center gap-1 rounded-full bg-secondary p-1 pl-3">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
          <label htmlFor="ed-programar" className="sr-only">
            Fecha y hora de publicación
          </label>
          <input
            id="ed-programar"
            type="datetime-local"
            value={programarPara}
            onChange={(e) => setProgramarPara(e.target.value)}
            className="bg-transparent px-1 text-sm text-foreground outline-none"
          />
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            disabled={ocupado || !programarPara}
            onClick={() => correr(() => publicarEdicion(armarEntrada(), new Date(programarPara)))}
          >
            Programar
          </Button>
        </div>
        <Button
          className="rounded-full bg-retail-deep text-white hover:opacity-95"
          disabled={ocupado}
          onClick={() => correr(() => publicarEdicion(armarEntrada()))}
        >
          <CloudUpload className="size-4" aria-hidden /> Publicar en App
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={ocupado || !publicada}
          onClick={() => publicada && correr(() => pausarPublicacion(publicada.id))}
        >
          Pausar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {/* ── Arquitectura del feed ───────────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-5 elevation-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-label-sm uppercase tracking-[0.12em] text-muted-foreground">
                  Estructura dinámica
                </p>
                <h2 className="text-h2 text-foreground">Arquitectura del Feed Móvil</h2>
              </div>
              <span className="rounded-full bg-brand-primary-soft px-3 py-1 text-label-md font-semibold text-primary">
                {activos} {activos === 1 ? 'Bloque Activo' : 'Bloques Activos'}
              </span>
            </div>

            <ul className="mt-4 space-y-2">
              {bloques.map((b, k) => {
                const fijo = b.tipo === 'CABECERA'
                const enEdicion = b.tipo === 'HERO'
                return (
                  <li
                    key={b.tipo}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg bg-muted/60 p-3',
                      enEdicion && 'border-l-4 border-primary bg-brand-primary-soft/60'
                    )}
                  >
                    {fijo ? (
                      <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <GripVertical
                        className="size-4 shrink-0 text-muted-foreground/60"
                        aria-hidden
                      />
                    )}
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-label-lg text-primary-foreground">
                      {k + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-label-lg text-foreground">
                          {ETIQUETAS[b.tipo]}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-label-sm font-semibold uppercase',
                            enEdicion
                              ? 'bg-retail-cyan/15 text-retail-deep'
                              : 'bg-card text-muted-foreground'
                          )}
                        >
                          {chipDe(b.tipo)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-caption">
                        {resumenDe(b.tipo)}
                      </span>
                    </span>

                    {fijo ? (
                      <span className="shrink-0 text-label-sm font-semibold uppercase text-muted-foreground">
                        Fijo
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1">
                        {b.tipo === 'HERO' ? (
                          <span className="mr-1 hidden text-label-md text-muted-foreground sm:block">
                            {slides.length} {slides.length === 1 ? 'Banner' : 'Banners'}
                          </span>
                        ) : null}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Subir ${ETIQUETAS[b.tipo]}`}
                          disabled={ocupado}
                          onClick={() => mover(k, -1)}
                        >
                          <ArrowUp className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Bajar ${ETIQUETAS[b.tipo]}`}
                          disabled={ocupado}
                          onClick={() => mover(k, 1)}
                        >
                          <ArrowDown className="size-3.5" aria-hidden />
                        </Button>
                        <Switch
                          checked={b.activo}
                          aria-label={
                            b.activo ? `Apagar ${ETIQUETAS[b.tipo]}` : `Encender ${ETIQUETAS[b.tipo]}`
                          }
                          onCheckedChange={() =>
                            setBloques((prev) =>
                              prev.map((x, j) => (j === k ? { ...x, activo: !x.activo } : x))
                            )
                          }
                        />
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          {/* ── Configurar carrusel hero ────────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-5 elevation-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
                  <ImagePlus className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-h3 text-foreground">Configurar Carrusel Promocional Hero</h2>
                  <p className="text-caption">
                    Personaliza diapositivas prioritarias para clientes
                    {territorio ? ` en ${territorio}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-label-md text-muted-foreground">
                  Banner {i + 1} de {slides.length}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8 rounded-full"
                  aria-label="Banner anterior"
                  disabled={i === 0}
                  onClick={() => setSlideActual((v) => Math.max(0, v - 1))}
                >
                  <ArrowLeft className="size-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8 rounded-full"
                  aria-label="Banner siguiente"
                  disabled={i >= slides.length - 1}
                  onClick={() => setSlideActual((v) => Math.min(slides.length - 1, v + 1))}
                >
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>

            {slide ? (
              <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
                <div>
                  <p className="mb-1.5 text-label-md text-muted-foreground">1 · Imagen del banner</p>
                  <div className="relative aspect-[4/5] max-w-[220px] overflow-hidden rounded-lg bg-muted">
                    {slide.imagenUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slide.imagenUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center px-3 text-center text-caption">
                        Automática: usa la imagen del destino
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 max-w-[220px] text-label-sm text-muted-foreground">
                    Se encuadra a 4:5 (1080×1350) · JPG, PNG o WebP · hasta 5 MB.
                  </p>
                  <input
                    id={`ed-file-${i}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      elegirImagen(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                  <div className="mt-2 flex max-w-[220px] flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      disabled={subiendo || ocupado}
                      onClick={() => document.getElementById(`ed-file-${i}`)?.click()}
                    >
                      <Upload className="size-4" aria-hidden /> {subiendo ? 'Subiendo…' : 'Subir imagen'}
                    </Button>
                    <label htmlFor={`ed-img-${i}`} className="sr-only">
                      O elegir una que ya tienes
                    </label>
                    <select
                      id={`ed-img-${i}`}
                      value={slide.imagenUrl}
                      onChange={(e) => actualizaSlide(i, { imagenUrl: e.target.value })}
                      className={cn(CAMPO, 'h-9 text-caption')}
                    >
                      <option value="">Automática · la del destino</option>
                      {slide.imagenUrl && !media.includes(slide.imagenUrl) ? (
                        <option value={slide.imagenUrl}>Imagen subida</option>
                      ) : null}
                      {media.map((m) => (
                        <option key={m} value={m}>
                          {m.split('/').slice(-1)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid content-start gap-3">
                  <fieldset>
                    <legend className="mb-1 text-label-md text-muted-foreground">2 · ¿Cómo va el texto?</legend>
                    <p className="mb-2 text-label-sm text-muted-foreground">
                      Si la imagen ya trae su texto, elige «Solo imagen»: así nada se pisa.
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {FORMATOS_A_MEDIDA.map((f) => (
                        <Button
                          key={f}
                          type="button"
                          variant="outline"
                          aria-pressed={slide.formato === f}
                          onClick={() => actualizaSlide(i, { formato: f })}
                          className={cn(
                            'h-auto flex-col items-start justify-start gap-0.5 whitespace-normal p-2.5 text-left',
                            slide.formato === f && 'border-primary ring-2 ring-primary/15'
                          )}
                        >
                          <span className="block text-label-md font-bold text-foreground">
                            {FORMATOS_BANNER_INFO[f].nombre}
                          </span>
                          <span className="block text-label-sm font-normal text-muted-foreground">
                            {FORMATOS_BANNER_INFO[f].descripcion}
                          </span>
                        </Button>
                      ))}
                    </div>
                    {slide.formato === 'SOLO_IMAGEN' && !slide.imagenUrl ? (
                      <p className="mt-2 text-label-sm text-warning-ink">
                        Con «Solo imagen» la tarjeta ES la imagen: sube una o elige una. Si dejas «Automática», se usa la del destino.
                      </p>
                    ) : null}
                  </fieldset>
                  <div>
                    <label className="mb-1 block text-label-md text-muted-foreground" htmlFor={`ed-tit-${i}`}>
                      Titular Comercial {requiereTexto ? '' : '· no aplica con «Solo imagen»'}
                    </label>
                    <input
                      id={`ed-tit-${i}`}
                      value={slide.titulo}
                      maxLength={80}
                      disabled={!requiereTexto}
                      onChange={(e) => actualizaSlide(i, { titulo: e.target.value })}
                      className={cn(CAMPO, !requiereTexto && 'opacity-50')}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-label-md text-muted-foreground" htmlFor={`ed-sub-${i}`}>
                      Subtítulo / Bajada
                    </label>
                    <input
                      id={`ed-sub-${i}`}
                      value={slide.subtitulo}
                      maxLength={140}
                      disabled={!requiereTexto}
                      onChange={(e) => actualizaSlide(i, { subtitulo: e.target.value })}
                      className={cn(CAMPO, !requiereTexto && 'opacity-50')}
                    />
                  </div>
                  {slide.formato === 'TITULAR_ARRIBA' ? (
                    <fieldset>
                      <legend className="mb-1 text-label-md text-muted-foreground">Color del panel</legend>
                      <div className="flex gap-2">
                        {COLORES_PANEL.map((c) => (
                          <Button
                            key={c}
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={COLORES_PANEL_INFO[c].nombre}
                            aria-pressed={slide.colorPanel === c}
                            onClick={() => actualizaSlide(i, { colorPanel: c })}
                            className={cn(
                              'size-9 rounded-full',
                              COLORES_PANEL_INFO[c].clase,
                              slide.colorPanel === c && 'border-[3px] border-primary'
                            )}
                          />
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                  {formatoAdmitePie(slide.formato) ? (
                    <label className="flex cursor-pointer items-center gap-2 text-small text-foreground">
                      <input
                        type="checkbox"
                        checked={slide.mostrarPie}
                        onChange={(e) => actualizaSlide(i, { mostrarPie: e.target.checked })}
                        className="size-4"
                      />
                      Mostrar debajo de la tarjeta el nombre del negocio y «{slide.ctaTexto || 'Ver oferta'}»
                    </label>
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-label-md text-muted-foreground" htmlFor={`ed-tipo-${i}`}>
                        Destino
                      </label>
                      <select
                        id={`ed-tipo-${i}`}
                        value={slide.ctaTipo}
                        onChange={(e) => {
                          const tipo = e.target.value as SlideEstado['ctaTipo']
                          actualizaSlide(i, {
                            ctaTipo: tipo,
                            ctaId: tipo === 'empresa' ? companyId : (opcionesSegunTipo(tipo)[0]?.id ?? ''),
                            itemIds: tipo === 'catalogo' ? slide.itemIds : [],
                          })
                        }}
                        className={CAMPO}
                      >
                        <option value="promocion">Promoción</option>
                        <option value="empresa">Empresa</option>
                        <option value="plan">Plan</option>
                        <option value="excursion">Excursión</option>
                        <option value="catalogo">Productos y servicios</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-label-md text-muted-foreground" htmlFor={`ed-cta-${i}`}>
                        Texto CTA
                      </label>
                      <input
                        id={`ed-cta-${i}`}
                        value={slide.ctaTexto}
                        maxLength={40}
                        onChange={(e) => actualizaSlide(i, { ctaTexto: e.target.value })}
                        className={CAMPO}
                      />
                    </div>
                  </div>
                  {slide.ctaTipo === 'catalogo' && (
                    <fieldset>
                      <legend className="mb-1 text-label-md text-muted-foreground">
                        Productos y servicios del banner · {slide.itemIds.length} de {MAX_ITEMS_BANNER}
                      </legend>
                      <p className="mb-2 text-label-sm text-muted-foreground">
                        Al tocar el banner se abre un catálogo con estos como principales y, debajo, lo que venden
                        negocios relacionados. El orden en que los marques es el orden en que salen.
                      </p>
                      {catalogo.length === 0 ? (
                        <p className="text-label-sm text-warning-ink">
                          No tienes productos ni servicios activos. Publica alguno en Catálogo y vuelve aquí.
                        </p>
                      ) : (
                        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                          {catalogo.map((o) => {
                            const marcado = slide.itemIds.includes(o.id)
                            const lleno = !marcado && slide.itemIds.length >= MAX_ITEMS_BANNER
                            return (
                              <li key={o.id}>
                                <label className={cn('flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-small hover:bg-muted', lleno && 'cursor-not-allowed opacity-50')}>
                                  <input
                                    type="checkbox"
                                    className="size-4"
                                    checked={marcado}
                                    disabled={lleno}
                                    onChange={(e) =>
                                      actualizaSlide(i, {
                                        itemIds: e.target.checked
                                          ? [...slide.itemIds, o.id]
                                          : slide.itemIds.filter((id) => id !== o.id),
                                      })
                                    }
                                  />
                                  <span className="min-w-0 flex-1 truncate">{o.titulo}</span>
                                  {marcado ? (
                                    <span className="text-label-sm tabular-nums text-muted-foreground">#{slide.itemIds.indexOf(o.id) + 1}</span>
                                  ) : null}
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </fieldset>
                  )}
                  {slide.ctaTipo !== 'empresa' && slide.ctaTipo !== 'catalogo' && (
                    <div>
                      <label className="mb-1 block text-label-md text-muted-foreground" htmlFor={`ed-dest-${i}`}>
                        Elemento destino
                      </label>
                      <select
                        id={`ed-dest-${i}`}
                        value={slide.ctaId}
                        onChange={(e) => actualizaSlide(i, { ctaId: e.target.value })}
                        className={CAMPO}
                      >
                        {opcionesSegunTipo(slide.ctaTipo).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.titulo}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {slides.length < 3 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        disabled={ocupado}
                        onClick={() => {
                          setSlides((prev) => [...prev, slideVacio(companyId)])
                          setSlideActual(slides.length)
                        }}
                      >
                        <Plus className="size-4" aria-hidden /> Añadir banner
                      </Button>
                    )}
                    {slides.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-full text-destructive hover:text-destructive"
                        disabled={ocupado}
                        onClick={() => {
                          setSlides((prev) => prev.filter((_, k) => k !== i))
                          setSlideActual(0)
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden /> Quitar banner
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── Reglas de segmentación ──────────────────────────────── */}
            <div className="mt-6 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-h4 text-foreground">
                  <SlidersHorizontal className="size-4 text-primary" aria-hidden />
                  Reglas de Segmentación Inteligente
                </h3>
                {/* Cierto de verdad: publicar, pausar y archivar escriben en
                    la bitácora (COMPOSICION_*). */}
                <span className="text-label-md text-muted-foreground">Cambios auditados</span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-muted/60 p-3">
                  <label
                    className="block text-label-md text-muted-foreground"
                    htmlFor="ed-seg-mem"
                  >
                    Condición de Membresía
                  </label>
                  <select
                    id="ed-seg-mem"
                    value={segmentacion.membresia}
                    onChange={(e) =>
                      setSegmentacion((s) => ({
                        ...s,
                        membresia: e.target.value as 'SIN_PLAN' | 'CUALQUIERA',
                      }))
                    }
                    className="mt-1 w-full bg-transparent text-h4 text-foreground outline-none"
                  >
                    <option value="CUALQUIERA">Todos los visitantes</option>
                    <option value="SIN_PLAN">Sin Plan Activo</option>
                  </select>
                  <p className="mt-1 text-label-sm text-muted-foreground">
                    {segmentacion.membresia === 'SIN_PLAN'
                      ? 'Empuje de primera suscripción'
                      : 'La composición se enseña a toda la clientela'}
                  </p>
                </div>

                <div className="rounded-lg bg-muted/60 p-3">
                  <label
                    className="block text-label-md text-muted-foreground"
                    htmlFor="ed-seg-radio"
                  >
                    Perímetro Geográfico
                  </label>
                  <span className="mt-1 flex items-baseline gap-1 text-h4 text-foreground">
                    {territorio || 'Zona'} ±
                    <input
                      id="ed-seg-radio"
                      type="number"
                      min={1}
                      max={100}
                      value={segmentacion.radioKm}
                      onChange={(e) =>
                        setSegmentacion((s) => ({ ...s, radioKm: Number(e.target.value) || 15 }))
                      }
                      className="w-14 bg-transparent text-h4 text-foreground outline-none"
                    />
                    KM
                  </span>
                  <p className="mt-1 text-label-sm text-muted-foreground">
                    Con la ubicación que la persona compartió
                  </p>
                </div>

                <div className="rounded-lg bg-muted/60 p-3">
                  <label
                    className="block text-label-md text-muted-foreground"
                    htmlFor="ed-seg-hasta"
                  >
                    Vigencia Temporal
                  </label>
                  <input
                    id="ed-seg-hasta"
                    type="datetime-local"
                    value={segmentacion.hasta}
                    onChange={(e) => setSegmentacion((s) => ({ ...s, hasta: e.target.value }))}
                    className="mt-1 w-full bg-transparent text-h4 text-foreground outline-none"
                  />
                  <p className="mt-1 text-label-sm text-muted-foreground">
                    {segmentacion.hasta
                      ? 'La composición caduca sola al vencer'
                      : 'Sin fecha: publicada hasta que la pauses'}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ── Vista previa 1:1 ──────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-xl border border-border bg-card p-4 elevation-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-h4 text-foreground">
                <Smartphone className="size-4" aria-hidden /> Vista Previa 1:1
              </h2>
              <div
                className="flex gap-1 rounded-full bg-muted p-0.5"
                role="group"
                aria-label="Segmento de vista previa"
              >
                {(['visitante', 'socio'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={perfilPreview === p}
                    onClick={() => setPerfilPreview(p)}
                    className={cn(
                      'rounded-full px-3 py-1 text-label-md font-semibold transition',
                      perfilPreview === p
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {p === 'visitante' ? 'Visitante' : 'Socio Silver'}
                  </button>
                ))}
              </div>
            </div>

            {/* El bisel: la señal de que ESTO es lo que ve la clientela. */}
            <div className="mx-auto mt-4 max-w-[300px] rounded-2xl border-[7px] border-foreground/85 bg-foreground/85 shadow-lg">
              <div className="overflow-hidden rounded-xl bg-card">
                <div className="flex justify-center bg-foreground/85 pb-1.5">
                  <span className="h-1.5 w-16 rounded-full bg-background/25" aria-hidden />
                </div>
                <div className="retail-header px-3 py-2 text-label-md font-semibold text-white">
                  {territorio || territorioSugerido || 'Higüey'} · Radio {segmentacion.radioKm} km
                </div>
                {slide ? (
                  <div className="p-3">
                    {slide.formato === 'SOLO_IMAGEN' && !slide.imagenUrl ? (
                      <div className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl border border-dashed border-border px-4 text-center text-label-sm text-muted-foreground">
                        Con «Solo imagen» se enseña la imagen del destino. Sube una para verla aquí.
                      </div>
                    ) : (
                      <>
                        <TarjetaBanner
                          hero={heroDeSlide(slide, companyName)}
                          className="aspect-[4/5] w-full"
                          sinOptimizar
                          compacta
                        />
                        {llevaPie(heroDeSlide(slide, companyName)) ? (
                          <PieBanner hero={heroDeSlide(slide, companyName)} compacta />
                        ) : null}
                      </>
                    )}
                    <div className="mt-2 flex justify-center gap-1" aria-hidden>
                      {slides.map((_, k) => (
                        <button
                          key={k}
                          type="button"
                          tabIndex={-1}
                          onClick={() => setSlideActual(k)}
                          className={cn(
                            'h-1.5 rounded-full',
                            k === i ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                          )}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="p-3 text-label-sm text-muted-foreground">Sin banners.</p>
                )}
                <div className="border-t border-border p-3">
                  <p className="text-label-md font-bold text-foreground">
                    Empresas en {territorio || territorioSugerido || 'la zona'}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {previewEmpresas.slice(0, 2).map((e) => (
                      <li key={e.name} className="truncate text-label-sm text-muted-foreground">
                        {e.name}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-label-md font-bold text-foreground">
                    Planes recomendados
                  </p>
                  <ul className="mt-1 space-y-1">
                    {previewPlanes.slice(0, 2).map((p) => (
                      <li key={p.nombre} className="truncate text-label-sm text-muted-foreground">
                        {p.nombre} · {formatPrice(p.precio)}/m
                      </li>
                    ))}
                  </ul>
                  {perfilPreview === 'socio' && (
                    <p className="mt-2 rounded bg-brand-primary-soft p-2 text-label-sm text-primary">
                      Vista de socio: resalta beneficios propios y QR.
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-around border-t border-border py-2 text-label-sm text-muted-foreground">
                  <span className="font-semibold text-primary">Inicio</span>
                  <span>Cuenta</span>
                  <span>Mi QR</span>
                  <span>Menú</span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={ocupado || !revisionId}
                onClick={() => revisionId && correr(() => reanudarPublicacion(revisionId))}
              >
                Reanudar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={ocupado || !revisionId}
                onClick={() => revisionId && correr(() => archivarRevision(revisionId))}
              >
                Archivar
              </Button>
            </div>
          </section>
        </div>
      </div>
      {dialogoImagen}
    </div>
  )
}
