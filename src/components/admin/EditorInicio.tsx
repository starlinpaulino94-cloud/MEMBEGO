'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Smartphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  'HERO',
  'CATEGORIAS',
  'DESTACADAS',
  'MEMBRESIAS',
  'BANNER_QR',
  'EXPERIENCIAS',
] as const

export type TipoBloque = (typeof TIPOS_BLOQUE)[number]

const ETIQUETAS: Record<TipoBloque, { titulo: string; ayuda: string }> = {
  CABECERA: { titulo: 'Cabecera de búsqueda y ubicación', ayuda: 'Sistema · Fijo' },
  HERO: { titulo: 'Carrusel hero promocional', ayuda: 'Banners con destino real' },
  CATEGORIAS: { titulo: 'Categorías rápidas', ayuda: 'Píldoras' },
  DESTACADAS: { titulo: 'Empresas destacadas', ayuda: 'Cerca de ti' },
  MEMBRESIAS: { titulo: 'Membresías recomendadas', ayuda: 'Monetización' },
  BANNER_QR: { titulo: 'Banner interactivo Mi QR', ayuda: 'Canje inmediato' },
  EXPERIENCIAS: { titulo: 'Experiencias y excursiones', ayuda: 'Catálogo' },
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
}) {
  const router = useRouter()
  const [territorio, setTerritorio] = useState(trabajo?.territorio ?? territorioSugerido)
  const [bloques, setBloques] = useState<BloqueEstado[]>(trabajo?.bloques ?? bloquePorDefecto())
  const [slides, setSlides] = useState<SlideEstado[]>(
    trabajo?.slides ?? [slideVacio(companyId)]
  )
  const [segmentacion, setSegmentacion] = useState(
    trabajo?.segmentacion ?? { membresia: 'CUALQUIERA' as const, radioKm: 15, hasta: '' }
  )
  const [revisionId, setRevisionId] = useState<string | null>(trabajo?.id ?? null)
  const [programarPara, setProgramarPara] = useState('')
  const [slidePreview, setSlidePreview] = useState(0)
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
      setMensaje({ ok: false, texto: 'No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.' })
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

  const slide = slides[Math.min(slidePreview, Math.max(0, slides.length - 1))]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
            publicada ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
          )}
        >
          {publicada ? 'Producción en Vivo' : 'Sin publicación'}
        </span>
        {trabajo && (
          <span className="text-xs text-muted-foreground">
            Editando {trabajo.estado}
            {trabajo.programadaPara ? ` · ${trabajo.programadaPara}` : ''}
          </span>
        )}
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

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-h4">Territorio y estado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label htmlFor="ed-territorio" className="mb-1 block text-sm font-medium">
                  Territorio / Segmento
                </label>
                <Input
                  id="ed-territorio"
                  value={territorio}
                  onChange={(e) => setTerritorio(e.target.value)}
                  placeholder="Higüey · Todos los clientes"
                  maxLength={80}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={ocupado} onClick={() => correr(() => guardarBorrador(armarEntrada()))}>
                  Guardar borrador
                </Button>
                <Button
                  disabled={ocupado}
                  onClick={() => correr(() => publicarEdicion(armarEntrada()))}
                >
                  Publicar en App
                </Button>
                <Button
                  disabled={ocupado || !publicada}
                  variant="outline"
                  onClick={() => publicada && correr(() => pausarPublicacion(publicada.id))}
                >
                  Pausar
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="ed-programar" className="mb-1 block text-sm font-medium">
                    Programar publicación
                  </label>
                  <Input
                    id="ed-programar"
                    type="datetime-local"
                    value={programarPara}
                    onChange={(e) => setProgramarPara(e.target.value)}
                  />
                </div>
                <Button
                  disabled={ocupado || !programarPara}
                  variant="outline"
                  onClick={() =>
                    correr(() => publicarEdicion(armarEntrada(), new Date(programarPara)))
                  }
                >
                  Programar
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-h4">Arquitectura del feed móvil</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {bloques.map((b, i) => (
                  <li
                    key={b.tipo}
                    className="flex items-center gap-2 rounded-lg border border-border p-3"
                  >
                    <span className="w-6 shrink-0 text-center text-sm font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {ETIQUETAS[b.tipo].titulo}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {ETIQUETAS[b.tipo].ayuda}
                      </span>
                    </span>
                    {b.tipo !== 'CABECERA' && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Subir ${ETIQUETAS[b.tipo].titulo}`}
                          disabled={ocupado}
                          onClick={() => mover(i, -1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Bajar ${ETIQUETAS[b.tipo].titulo}`}
                          disabled={ocupado}
                          onClick={() => mover(i, 1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={
                            b.activo
                              ? `Apagar ${ETIQUETAS[b.tipo].titulo}`
                              : `Encender ${ETIQUETAS[b.tipo].titulo}`
                          }
                          onClick={() =>
                            setBloques((prev) =>
                              prev.map((x, k) => (k === i ? { ...x, activo: !x.activo } : x))
                            )
                          }
                        >
                          {b.activo ? (
                            <Eye className="h-4 w-4 text-primary" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-h4">Carrusel hero promocional</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {slides.map((s, i) => (
                <fieldset key={i} className="space-y-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-semibold">Banner {i + 1} de {slides.length}</legend>
                  <div>
                    <label className="mb-1 block text-sm font-medium" htmlFor={`ed-tit-${i}`}>
                      Titular comercial
                    </label>
                    <Input
                      id={`ed-tit-${i}`}
                      value={s.titulo}
                      maxLength={80}
                      onChange={(e) => actualizaSlide(i, { titulo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" htmlFor={`ed-sub-${i}`}>
                      Subtítulo / Bajada
                    </label>
                    <Input
                      id={`ed-sub-${i}`}
                      value={s.subtitulo}
                      maxLength={140}
                      onChange={(e) => actualizaSlide(i, { subtitulo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium" htmlFor={`ed-img-${i}`}>
                      Creatividad del banner
                    </label>
                    <select
                      id={`ed-img-${i}`}
                      value={s.imagenUrl}
                      onChange={(e) => actualizaSlide(i, { imagenUrl: e.target.value })}
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Automática (imagen de la entidad destino)</option>
                      {media.map((m) => (
                        <option key={m} value={m}>
                          {m.split('/').slice(-1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium" htmlFor={`ed-cta-${i}`}>
                        Texto CTA
                      </label>
                      <Input
                        id={`ed-cta-${i}`}
                        value={s.ctaTexto}
                        maxLength={40}
                        onChange={(e) => actualizaSlide(i, { ctaTexto: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium" htmlFor={`ed-tipo-${i}`}>
                        Destino
                      </label>
                      <select
                        id={`ed-tipo-${i}`}
                        value={s.ctaTipo}
                        onChange={(e) =>
                          actualizaSlide(i, {
                            ctaTipo: e.target.value as SlideEstado['ctaTipo'],
                            ctaId:
                              e.target.value === 'empresa'
                                ? companyId
                                : (opcionesSegunTipo(
                                    e.target.value as SlideEstado['ctaTipo']
                                  )[0]?.id ?? ''),
                          })
                        }
                        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      >
                        <option value="promocion">Promoción</option>
                        <option value="empresa">Empresa</option>
                        <option value="plan">Plan</option>
                        <option value="excursion">Excursión</option>
                      </select>
                    </div>
                  </div>
                  {s.ctaTipo !== 'empresa' && (
                    <div>
                      <label className="mb-1 block text-sm font-medium" htmlFor={`ed-dest-${i}`}>
                        Elemento destino
                      </label>
                      <select
                        id={`ed-dest-${i}`}
                        value={s.ctaId}
                        onChange={(e) => actualizaSlide(i, { ctaId: e.target.value })}
                        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      >
                        {opcionesSegunTipo(s.ctaTipo).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.titulo}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {slides.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={ocupado}
                      onClick={() => {
                        setSlides((prev) => prev.filter((_, k) => k !== i))
                        setSlidePreview(0)
                      }}
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Quitar banner
                    </Button>
                  )}
                </fieldset>
              ))}
              {slides.length < 3 && (
                <Button
                  variant="outline"
                  disabled={ocupado}
                  onClick={() => setSlides((prev) => [...prev, slideVacio(companyId)])}
                >
                  <Plus className="mr-1 h-4 w-4" /> Añadir banner
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-h4">Segmentación inteligente</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="ed-seg-mem">
                  Condición de membresía
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
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="CUALQUIERA">Todos los visitantes</option>
                  <option value="SIN_PLAN">Sin plan activo</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="ed-seg-radio">
                  Perímetro geográfico (km)
                </label>
                <Input
                  id="ed-seg-radio"
                  type="number"
                  min={1}
                  max={100}
                  value={segmentacion.radioKm}
                  onChange={(e) =>
                    setSegmentacion((s) => ({ ...s, radioKm: Number(e.target.value) || 15 }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="ed-seg-hasta">
                  Vigencia temporal
                </label>
                <Input
                  id="ed-seg-hasta"
                  type="datetime-local"
                  value={segmentacion.hasta}
                  onChange={(e) => setSegmentacion((s) => ({ ...s, hasta: e.target.value }))}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-h4">
                <Smartphone className="h-4 w-4" /> Vista previa 1:1
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2" role="group" aria-label="Segmento de vista previa">
                {(['visitante', 'socio'] as const).map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={perfilPreview === p ? 'default' : 'outline'}
                    onClick={() => setPerfilPreview(p)}
                  >
                    {p === 'visitante' ? 'Visitante' : 'Socio Silver'}
                  </Button>
                ))}
              </div>
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="retail-header px-3 py-2 text-xs font-semibold text-primary-foreground">
                  {territorio || territorioSugerido || 'Higüey'} · Radio {segmentacion.radioKm} km
                </div>
                {slide ? (
                  <div className="p-3">
                    {slide.imagenUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slide.imagenUrl} alt="" className="aspect-video w-full rounded-lg object-cover" />
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                        Sin arte (usa la imagen de la entidad destino)
                      </div>
                    )}
                    <p className="mt-2 text-sm font-bold text-foreground">
                      {slide.titulo || 'Titular del banner'}
                    </p>
                    {slide.subtitulo && (
                      <p className="text-xs text-muted-foreground">{slide.subtitulo}</p>
                    )}
                    <span className="mt-2 inline-block rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
                      {slide.ctaTexto || 'Ver oferta'}
                    </span>
                    <div className="mt-2 flex justify-center gap-1" aria-hidden>
                      {slides.map((_, k) => (
                        <button
                          key={k}
                          type="button"
                          tabIndex={-1}
                          onClick={() => setSlidePreview(k)}
                          className={cn(
                            'h-1.5 rounded-full',
                            k === Math.min(slidePreview, slides.length - 1)
                              ? 'w-4 bg-primary'
                              : 'w-1.5 bg-muted-foreground/30'
                          )}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="p-3 text-xs text-muted-foreground">Sin banners.</p>
                )}
                <div className="border-t border-border p-3">
                  <p className="text-xs font-bold text-foreground">
                    Empresas en {territorio || territorioSugerido || 'la zona'}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {previewEmpresas.slice(0, 2).map((e) => (
                      <li key={e.name} className="text-xs text-muted-foreground">
                        {e.name}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs font-bold text-foreground">Planes recomendados</p>
                  <ul className="mt-1 space-y-1">
                    {previewPlanes.slice(0, 2).map((p) => (
                      <li key={p.nombre} className="text-xs text-muted-foreground">
                        {p.nombre} · RD$ {p.precio.toLocaleString('es-DO')}/m
                      </li>
                    ))}
                  </ul>
                  {perfilPreview === 'socio' && (
                    <p className="mt-2 rounded bg-primary/10 p-2 text-xs text-primary">
                      Vista de socio: resalta beneficios propios y QR.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ocupado || !revisionId}
                  onClick={() => revisionId && correr(() => reanudarPublicacion(revisionId))}
                >
                  Reanudar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ocupado || !revisionId}
                  onClick={() => revisionId && correr(() => archivarRevision(revisionId))}
                >
                  Archivar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
