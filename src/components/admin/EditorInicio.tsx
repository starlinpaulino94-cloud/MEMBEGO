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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { fechaEditorialIso } from '@/modules/home/editor-contrato'
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
  ctaTipo: 'promocion' | 'empresa' | 'plan' | 'excursion'
  ctaId: string
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
  publicada,
  media,
  promociones,
  planes,
  excursiones,
  previewEmpresas,
  previewPlanes,
  previewCategorias,
}: {
  companyId: string
  companyName: string
  territorioSugerido: string
  trabajo: BorradorInicial | null
  publicada: { id: string; updatedAt: string; territorio: string | null } | null
  media: string[]
  promociones: OpcionEntidad[]
  planes: OpcionEntidad[]
  excursiones: OpcionEntidad[]
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
  const [revisionId, setRevisionId] = useState<string | null>(trabajo?.id ?? null)
  const [programarPara, setProgramarPara] = useState('')
  const [slideActual, setSlideActual] = useState(0)
  const [perfilPreview, setPerfilPreview] = useState<'visitante' | 'socio'>('visitante')
  const [ocupado, setOcupado] = useState(false)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)

  const opcionesSegunTipo = (tipo: SlideEstado['ctaTipo']) =>
    tipo === 'promocion'
      ? promociones
      : tipo === 'plan'
        ? planes
        : tipo === 'excursion'
          ? excursiones
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
                  ctaDestino: { tipo: s.ctaTipo, id: s.ctaId },
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

  const i = Math.min(slideActual, Math.max(0, slides.length - 1))
  const slide = slides[i]
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
              .map((p) => `${p.nombre} RD$${p.precio.toLocaleString('es-DO')}/mes`)
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
              ? 'border-success/30 bg-success/10'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
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
              <div className="mt-4 grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
                <div>
                  <p className="mb-1.5 text-label-md text-muted-foreground">
                    Creatividad del Banner
                  </p>
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                    {slide.imagenUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slide.imagenUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center px-3 text-center text-caption">
                        Automática: usa la imagen de la entidad destino
                      </span>
                    )}
                    <span className="absolute bottom-2 left-2 rounded bg-foreground/80 px-2 py-0.5 text-label-sm font-semibold text-background">
                      {companyName}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor={`ed-img-${i}`} className="sr-only">
                      Cambiar arte del banner
                    </label>
                    <select
                      id={`ed-img-${i}`}
                      value={slide.imagenUrl}
                      onChange={(e) => actualizaSlide(i, { imagenUrl: e.target.value })}
                      className={cn(CAMPO, 'h-9 flex-1 text-caption')}
                    >
                      <option value="">Cambiar arte · automática</option>
                      {media.map((m) => (
                        <option key={m} value={m}>
                          {m.split('/').slice(-1)}
                        </option>
                      ))}
                    </select>
                    <span className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-label-sm text-muted-foreground">
                      16:9
                    </span>
                  </div>
                </div>

                <div className="grid content-start gap-3">
                  <div>
                    <label className="mb-1 block text-label-md text-muted-foreground" htmlFor={`ed-tit-${i}`}>
                      Titular Comercial
                    </label>
                    <input
                      id={`ed-tit-${i}`}
                      value={slide.titulo}
                      maxLength={80}
                      onChange={(e) => actualizaSlide(i, { titulo: e.target.value })}
                      className={CAMPO}
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
                      onChange={(e) => actualizaSlide(i, { subtitulo: e.target.value })}
                      className={CAMPO}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-label-md text-muted-foreground" htmlFor={`ed-tipo-${i}`}>
                        Destino
                      </label>
                      <select
                        id={`ed-tipo-${i}`}
                        value={slide.ctaTipo}
                        onChange={(e) =>
                          actualizaSlide(i, {
                            ctaTipo: e.target.value as SlideEstado['ctaTipo'],
                            ctaId:
                              e.target.value === 'empresa'
                                ? companyId
                                : (opcionesSegunTipo(e.target.value as SlideEstado['ctaTipo'])[0]?.id ?? ''),
                          })
                        }
                        className={CAMPO}
                      >
                        <option value="promocion">Promoción</option>
                        <option value="empresa">Empresa</option>
                        <option value="plan">Plan</option>
                        <option value="excursion">Excursión</option>
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
                  {slide.ctaTipo !== 'empresa' && (
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

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
                    {slide.imagenUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={slide.imagenUrl}
                        alt=""
                        className="aspect-video w-full rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted px-3 text-center text-label-sm text-muted-foreground">
                        Sin arte (usa la imagen de la entidad destino)
                      </div>
                    )}
                    <p className="mt-2 text-label-lg text-foreground">
                      {slide.titulo || 'Titular del banner'}
                    </p>
                    {slide.subtitulo && <p className="text-caption">{slide.subtitulo}</p>}
                    <span className="mt-2 inline-block rounded-full bg-primary px-3 py-1.5 text-label-md font-bold text-primary-foreground">
                      {slide.ctaTexto || 'Ver oferta'}
                    </span>
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
                        {p.nombre} · RD$ {p.precio.toLocaleString('es-DO')}/m
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
    </div>
  )
}
