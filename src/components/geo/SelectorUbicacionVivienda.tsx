'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Search, X } from 'lucide-react'
import {
  listarPaisesOperativos,
  listarRegionesDePais,
  listarCiudadesDeRegion,
  listarSectoresDeCiudad,
} from '@/modules/geo/catalogo/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MapaConfirmarVivienda, type FuenteCoordenadas } from './MapaConfirmarVivienda'
import { cn } from '@/lib/utils'

/**
 * Selector de vivienda en pasos cortos (docs/GEOLOCALIZACION.md §4 y §8.1):
 *
 *   País → Provincia/Estado → Ciudad → Sector → [Mapa opcional]
 *
 * Cada paso es una sola pregunta con búsqueda, permite "escribir otra" cuando
 * el catálogo no tiene el valor y se puede OMITIR en cualquier momento (la
 * ubicación nunca es obligatoria, §2). El mapa de confirmación es opcional y
 * explica que la ubicación servirá para mostrar ofertas cercanas.
 *
 * Emite el resultado por `onChange` mientras se avanza y llama `onDone` cuando
 * el usuario completa (o omite) el flujo. Se usa en el asistente de registro
 * y en el perfil.
 */

export interface UbicacionSeleccionada {
  countryId: string
  regionId: string
  regionNameRaw: string
  cityId: string
  cityNameRaw: string
  sectorId: string
  sectorNameRaw: string
  latitud: string
  longitud: string
  geoSource: string // '' | 'MAP_SELECTION' | 'DEVICE_LOCATION'
  consentHome: boolean
}

export const UBICACION_SELECCIONADA_VACIA: UbicacionSeleccionada = {
  countryId: '',
  regionId: '',
  regionNameRaw: '',
  cityId: '',
  cityNameRaw: '',
  sectorId: '',
  sectorNameRaw: '',
  latitud: '',
  longitud: '',
  geoSource: '',
  consentHome: true,
}

interface Opcion {
  id: string
  name: string
  regionLabel?: string
  isoCode?: string
  latitud?: number | null
  longitud?: number | null
}

type MiniPaso = 'pais' | 'region' | 'ciudad' | 'sector' | 'mapa'

const ORDEN_MINIPASOS: MiniPaso[] = ['pais', 'region', 'ciudad', 'sector', 'mapa']
const ETIQUETAS: Record<MiniPaso, string> = {
  pais: 'País',
  region: 'Provincia',
  ciudad: 'Ciudad',
  sector: 'Sector',
  mapa: 'Ubicación aproximada',
}

export function SelectorUbicacionVivienda({
  value,
  onChange,
  onDone,
  oscuro = false,
  sinEncabezado = false,
}: {
  value: UbicacionSeleccionada
  onChange: (v: UbicacionSeleccionada) => void
  onDone: () => void
  /** Estilo del asistente de registro (fondo oscuro); por defecto claro. */
  oscuro?: boolean
  /**
   * El contenedor ya pone su propio título y su nota de "es opcional" (así lo
   * hace el asistente de registro). Con esto no se repiten: en la pantalla de
   * país se veía "¿Dónde vives?" dos veces seguidas.
   */
  sinEncabezado?: boolean
}) {
  const [mini, setMini] = useState<MiniPaso>('pais')
  const [d, setD] = useState<UbicacionSeleccionada>(value)

  /**
   * Listas del catálogo cacheadas por clave (`pais`, `region:<countryId>`, …).
   * Un solo efecto las pide; `cargando`, `opciones` y `regionLabel` se DERIVAN
   * de esta caché en vez de escribirse desde el efecto. Dos razones: el
   * indicador de carga ya no provoca un render en cascada, y volver atrás en
   * los mini-pasos no vuelve a pedir lo que ya se pidió.
   *
   * `'error'` se guarda aparte de la lista vacía A PROPÓSITO: "el catálogo no
   * tiene tu ciudad" y "no pudimos hablar con el servidor" piden cosas
   * distintas de la persona (escribirla a mano vs. reintentar). Meterlos en el
   * mismo saco dejaba al usuario mirando "Sin resultados" sin salida.
   */
  type EstadoLista = Opcion[] | 'error'
  const [listas, setListas] = useState<Record<string, EstadoLista>>({})

  const [busqueda, setBusqueda] = useState('')
  const [manual, setManual] = useState(false)
  const [manualText, setManualText] = useState('')
  const [selId, setSelId] = useState('')
  const [fuente, setFuente] = useState<FuenteCoordenadas>('MAP_SELECTION')
  // Centro del mapa: el punto de referencia del sector elegido.
  const [refCoords, setRefCoords] = useState<{ lat: number; lng: number } | null>(null)

  // ── Datos del catálogo por mini-paso ──────────────────────────────────────

  /**
   * Clave de la lista que toca en este mini-paso. `null` = el paso no consulta
   * el catálogo (el mapa) o le falta el padre del que colgaría, porque el
   * usuario omitió provincia o ciudad: entonces no hay nada que pedir y la
   * lista se muestra vacía con la opción de escribirla a mano.
   */
  const claveLista = useMemo<string | null>(() => {
    if (mini === 'pais') return 'pais'
    if (mini === 'region') return d.countryId ? `region:${d.countryId}` : null
    if (mini === 'ciudad') return d.regionId ? `ciudad:${d.regionId}` : null
    if (mini === 'sector') return d.cityId ? `sector:${d.cityId}` : null
    return null
  }, [mini, d.countryId, d.regionId, d.cityId])

  useEffect(() => {
    if (!claveLista || listas[claveLista]) return
    let activo = true
    const idPadre = claveLista.slice(claveLista.indexOf(':') + 1)
    const pedir = claveLista.startsWith('region:')
      ? listarRegionesDePais(idPadre)
      : claveLista.startsWith('ciudad:')
        ? listarCiudadesDeRegion(idPadre)
        : claveLista.startsWith('sector:')
          ? listarSectoresDeCiudad(idPadre)
          : listarPaisesOperativos()
    const guardar = (rs: EstadoLista) => {
      if (activo) setListas((prev) => ({ ...prev, [claveLista]: rs }))
    }
    pedir.then(guardar).catch(() => guardar('error'))
    return () => {
      activo = false
    }
  }, [claveLista, listas])

  const estado = claveLista ? listas[claveLista] : undefined
  /** Cargando = el paso pide catálogo y su lista todavía no llegó. */
  const cargando = claveLista !== null && estado === undefined
  const fallo = estado === 'error'

  /** Vuelve a pedir la lista de este paso (olvida lo cacheado). */
  function reintentar() {
    if (!claveLista) return
    setListas((prev) => {
      const siguiente = { ...prev }
      delete siguiente[claveLista]
      return siguiente
    })
  }

  // Etiqueta del 2º nivel según el país (Provincia/Estado/Departamento…).
  const paises = Array.isArray(listas.pais) ? listas.pais : []
  const regionLabel = paises.find((p) => p.id === d.countryId)?.regionLabel ?? 'Provincia'

  const opciones = useMemo(() => {
    const lista = Array.isArray(estado) ? estado : []
    const q = busqueda.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((o) => o.name.toLowerCase().includes(q))
  }, [estado, busqueda])

  function irA(p: MiniPaso) {
    setMini(p)
    setBusqueda('')
    setSelId('')
    setManual(false)
    setManualText('')
  }

  function actualizarDatos(parcial: Partial<UbicacionSeleccionada>) {
    setD((prev) => {
      const next = { ...prev, ...parcial }
      onChange(next)
      return next
    })
  }

  // ── Acciones por mini-paso ────────────────────────────────────────────────
  function elegirPais(op: Opcion) {
    actualizarDatos({
      countryId: op.id,
      regionId: '',
      regionNameRaw: '',
      cityId: '',
      cityNameRaw: '',
      sectorId: '',
      sectorNameRaw: '',
      latitud: '',
      longitud: '',
      geoSource: '',
    })
    // `regionLabel` se deriva de `d.countryId` — no hace falta fijarla aquí.
    setRefCoords(null)
    irA('region')
  }

  function elegirRegion(op: Opcion) {
    actualizarDatos({ regionId: op.id, regionNameRaw: op.name, cityId: '', cityNameRaw: '', sectorId: '', sectorNameRaw: '' })
    setRefCoords(null)
    irA('ciudad')
  }

  function elegirCiudad(op: Opcion) {
    actualizarDatos({ cityId: op.id, cityNameRaw: op.name, sectorId: '', sectorNameRaw: '' })
    setRefCoords(null)
    irA('sector')
  }

  function elegirSector(op: Opcion) {
    actualizarDatos({ sectorId: op.id, sectorNameRaw: op.name })
    setRefCoords(op.latitud != null && op.longitud != null ? { lat: op.latitud, lng: op.longitud } : null)
    irA('mapa')
  }

  function confirmarManual() {
    if (!manualText.trim()) return
    if (mini === 'ciudad') {
      actualizarDatos({ cityId: '', cityNameRaw: manualText.trim(), sectorId: '', sectorNameRaw: '' })
      irA('sector')
    } else if (mini === 'sector') {
      actualizarDatos({ sectorId: '', sectorNameRaw: manualText.trim() })
      irA('mapa')
    }
  }

  function omitirPaso() {
    if (mini === 'pais') {
      // Omitir todo: ubicación vacía (nunca se guarda, §20).
      onChange(UBICACION_SELECCIONADA_VACIA)
      onDone()
      return
    }
    if (mini === 'region') {
      actualizarDatos({ regionId: '', regionNameRaw: '' })
      irA('ciudad')
      return
    }
    if (mini === 'ciudad') {
      actualizarDatos({ cityId: '', cityNameRaw: '' })
      irA('sector')
      return
    }
    if (mini === 'sector') {
      irA('mapa')
      return
    }
    if (mini === 'mapa') {
      finalizar()
    }
  }

  function finalizar() {
    onChange({ ...d, geoSource: d.latitud ? fuente : '', consentHome: d.consentHome })
    onDone()
  }

  const etiqueta2 = mini === 'region' ? regionLabel : ETIQUETAS[mini]
  const pasoIdx = ORDEN_MINIPASOS.indexOf(mini)
  /** País y provincia salen de la división oficial: no se escriben a mano. */
  const puedeEscribirAMano = mini === 'ciudad' || mini === 'sector'

  const btnClase = oscuro
    ? 'border-white/15 bg-white/5 text-white hover:bg-white/10'
    : 'border-border/70 bg-card text-foreground hover:bg-muted'
  const btnActivo = oscuro
    ? 'border-primary bg-primary/15 ring-2 ring-primary'
    : 'border-primary bg-primary/10 ring-2 ring-primary/40'

  return (
    <div className="space-y-4">
      {/* Indicador de mini-pasos */}
      <div className="flex items-center gap-1" aria-label="Progreso de la ubicación">
        {ORDEN_MINIPASOS.map((p, i) => (
          <div
            key={p}
            title={ETIQUETAS[p]}
            className={cn(
              'h-1 flex-1 rounded-full transition',
              i < pasoIdx
                ? 'bg-primary'
                : i === pasoIdx
                  ? oscuro
                    ? 'bg-white/40'
                    : 'bg-muted-foreground/40'
                  : oscuro
                    ? 'bg-white/10'
                    : 'bg-muted'
            )}
          />
        ))}
      </div>

      {!sinEncabezado && (
        <p className={cn('text-xs', oscuro ? 'text-white/50' : 'text-muted-foreground')}>
          La usamos para mostrarte ofertas cercanas. Siempre puedes omitirla.
        </p>
      )}

      <div>
        {/* En país el título repetiría el del contenedor; los demás mini-pasos
            sí necesitan su propia pregunta ("¿Provincia de tu vivienda?"). */}
        {!(sinEncabezado && mini === 'pais') && (
          <h2 className={cn('text-lg font-bold tracking-tight', oscuro ? 'text-white' : 'text-foreground')}>
            {mini === 'pais' ? '¿Dónde vives?' : `¿${etiqueta2} de tu vivienda?`}
          </h2>
        )}
        {mini === 'region' && (
          <p className={cn('mt-1 text-sm', oscuro ? 'text-white/60' : 'text-muted-foreground')}>
            Elige tu {regionLabel.toLowerCase()}.
          </p>
        )}
        {mini === 'ciudad' && (
          <p className={cn('mt-1 text-sm', oscuro ? 'text-white/60' : 'text-muted-foreground')}>
            Tu municipio o ciudad. Puedes escribirla si no aparece.
          </p>
        )}
        {mini === 'sector' && (
          <p className={cn('mt-1 text-sm', oscuro ? 'text-white/60' : 'text-muted-foreground')}>
            Tu barrio, sector o zona. También puedes escribirla.
          </p>
        )}
        {mini === 'mapa' && (
          <p className={cn('mt-1 text-sm', oscuro ? 'text-white/60' : 'text-muted-foreground')}>
            Marca una zona aproximada (opcional). No es obligatorio y no pedimos tu GPS.
          </p>
        )}
      </div>

      {mini === 'mapa' ? (
        <div className="space-y-3">
          <MapaConfirmarVivienda
            lat={refCoords?.lat ?? (d.latitud ? Number(d.latitud) : null)}
            lng={refCoords?.lng ?? (d.longitud ? Number(d.longitud) : null)}
            onChange={(coords, f) => {
              setFuente(f)
              actualizarDatos(
                coords
                  ? { latitud: String(coords.lat), longitud: String(coords.lng), geoSource: f }
                  : { latitud: '', longitud: '', geoSource: '' }
              )
            }}
          />

          <label className={cn('flex items-start gap-2 text-sm', oscuro ? 'text-white/70' : 'text-foreground/80')}>
            <input
              type="checkbox"
              checked={d.consentHome}
              onChange={(e) => actualizarDatos({ consentHome: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span>Guardar mi ubicación en mi perfil para encontrar negocios cerca de mí.</span>
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          {manual ? (
            <div className="space-y-2">
              <Input
                autoFocus
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), confirmarManual())}
                placeholder={mini === 'ciudad' ? 'Escribe tu ciudad o municipio' : 'Escribe tu sector o zona'}
                className={cn(
                  'h-11',
                  oscuro && 'bg-white/10 text-white placeholder:text-white/40'
                )}
              />
              <button
                type="button"
                onClick={() => setManual(false)}
                className={cn('inline-flex items-center gap-1 text-xs underline', oscuro ? 'text-white/50' : 'text-muted-foreground')}
              >
                <X className="h-3 w-3" /> Elegir de la lista
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder={mini === 'pais' ? 'Buscar país' : `Buscar ${etiqueta2.toLowerCase()}`}
                  className={cn(
                    'h-11 pl-9',
                    oscuro && 'bg-white/10 text-white placeholder:text-white/40'
                  )}
                />
              </div>

              <ul
                role="listbox"
                aria-label={`${etiqueta2} de la vivienda`}
                className="max-h-64 space-y-1 overflow-y-auto pr-1"
              >
                {opciones.map((op) => (
                  <li key={op.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selId === op.id}
                      onClick={() => {
                        setSelId(op.id)
                        if (mini === 'pais') elegirPais(op)
                        if (mini === 'region') elegirRegion(op)
                        if (mini === 'ciudad') elegirCiudad(op)
                        if (mini === 'sector') elegirSector(op)
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition',
                        btnClase,
                        selId === op.id && btnActivo
                      )}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {op.name}
                        {op.isoCode ? ` (${op.isoCode})` : ''}
                      </span>
                      {selId === op.id && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                    </button>
                  </li>
                ))}
                {opciones.length === 0 && !cargando && (
                  <li className={cn('px-1 py-2 text-sm', oscuro ? 'text-white/50' : 'text-muted-foreground')}>
                    {fallo ? (
                      <span className="flex flex-wrap items-center gap-2">
                        No pudimos cargar la lista.
                        <button
                          type="button"
                          onClick={reintentar}
                          className="underline underline-offset-2 hover:opacity-80"
                        >
                          Reintentar
                        </button>
                      </span>
                    ) : puedeEscribirAMano ? (
                      // Solo se ofrece escribir a mano en ciudad y sector; decirlo
                      // en país o provincia dejaba al usuario buscando un botón
                      // que no existe.
                      'Sin resultados. Puedes escribirla manualmente.'
                    ) : mini === 'pais' ? (
                      'Todavía no hay países disponibles. Puedes omitir este paso y añadir tu ubicación más tarde desde tu perfil.'
                    ) : (
                      `Sin ${etiqueta2.toLowerCase()}s para elegir. Puedes omitir este paso.`
                    )}
                  </li>
                )}
              </ul>

              {cargando && (
                <p className={cn('flex items-center gap-1.5 text-xs', oscuro ? 'text-white/50' : 'text-muted-foreground')}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
                </p>
              )}

              {puedeEscribirAMano && (
                <button
                  type="button"
                  onClick={() => setManual(true)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-sm transition',
                    btnClase
                  )}
                >
                  <Plus className="h-4 w-4" />
                  {mini === 'ciudad' ? 'Escribir otra ciudad' : 'Escribir otro sector'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Navegación propia del selector */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (mini === 'pais' ? onDone() : irA(ORDEN_MINIPASOS[stepAtras()]))}
          className={oscuro ? 'text-white/70 hover:text-white' : undefined}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={omitirPaso}
            className={oscuro ? 'text-white/60 hover:text-white' : undefined}
          >
            {mini === 'mapa' ? 'Solo ciudad y sector' : 'Omitir'}
          </Button>

          {mini === 'mapa' && (
            <Button type="button" onClick={finalizar} className="h-10 px-5">
              Confirmar <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}

          {manual && (
            <Button type="button" onClick={confirmarManual} disabled={!manualText.trim()} className="h-10 px-5">
              Continuar <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  function stepAtras(): number {
    return Math.max(0, ORDEN_MINIPASOS.indexOf(mini) - 1)
  }
}
