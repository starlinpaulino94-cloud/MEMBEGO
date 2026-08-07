'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Plus, Search, X } from 'lucide-react'
import {
  listarPaisesOperativos,
  listarRegionesDePais,
  listarCiudadesDeRegion,
  listarSectoresDeCiudad,
} from '@/modules/geo/catalogo/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MapaConfirmarVivienda, type CoordsConfirmadas, type FuenteCoordenadas } from './MapaConfirmarVivienda'
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
}: {
  value: UbicacionSeleccionada
  onChange: (v: UbicacionSeleccionada) => void
  onDone: () => void
  /** Estilo del asistente de registro (fondo oscuro); por defecto claro. */
  oscuro?: boolean
}) {
  const [mini, setMini] = useState<MiniPaso>('pais')
  const [d, setD] = useState<UbicacionSeleccionada>(value)

  const [paises, setPaises] = useState<Opcion[]>([])
  const [regiones, setRegiones] = useState<Opcion[]>([])
  const [ciudades, setCiudades] = useState<Opcion[]>([])
  const [sectores, setSectores] = useState<Opcion[]>([])
  const [regionLabel, setRegionLabel] = useState('Provincia')
  const [cargando, setCargando] = useState(false)

  const [busqueda, setBusqueda] = useState('')
  const [manual, setManual] = useState(false)
  const [manualText, setManualText] = useState('')
  const [selId, setSelId] = useState('')
  const [fuente, setFuente] = useState<FuenteCoordenadas>('MAP_SELECTION')
  // Centro del mapa: el punto de referencia del sector elegido.
  const [refCoords, setRefCoords] = useState<{ lat: number; lng: number } | null>(null)

  // ── Datos del catálogo por mini-paso ──────────────────────────────────────
  useEffect(() => {
    if (mini !== 'pais') return
    let activo = true
    setCargando(true)
    listarPaisesOperativos()
      .then((rs) => activo && setPaises(rs.map((r) => ({ ...r }))))
      .catch(() => {})
      .finally(() => activo && setCargando(false))
    return () => {
      activo = false
    }
  }, [mini])

  useEffect(() => {
    if (mini !== 'region' || !d.countryId) return
    let activo = true
    setCargando(true)
    listarRegionesDePais(d.countryId)
      .then((rs) => activo && setRegiones(rs))
      .catch(() => {})
      .finally(() => activo && setCargando(false))
    return () => {
      activo = false
    }
  }, [mini, d.countryId])

  useEffect(() => {
    if (mini !== 'ciudad') return
    let activo = true
    setCargando(true)
    if (d.regionId) {
      listarCiudadesDeRegion(d.regionId)
        .then((cs) => activo && setCiudades(cs))
        .catch(() => {})
        .finally(() => activo && setCargando(false))
    } else {
      setCiudades([])
      setCargando(false)
    }
    return () => {
      activo = false
    }
  }, [mini, d.regionId])

  useEffect(() => {
    if (mini !== 'sector') return
    let activo = true
    setCargando(true)
    if (d.cityId) {
      listarSectoresDeCiudad(d.cityId)
        .then((ss) => activo && setSectores(ss))
        .catch(() => {})
        .finally(() => activo && setCargando(false))
    } else {
      setSectores([])
      setCargando(false)
    }
    return () => {
      activo = false
    }
  }, [mini, d.cityId])

  // Etiqueta del 2º nivel según el país (Provincia/Estado/Departamento…).
  useEffect(() => {
    const pais = paises.find((p) => p.id === d.countryId)
    if (pais?.regionLabel) setRegionLabel(pais.regionLabel)
  }, [paises, d.countryId])

  const opciones = useMemo(() => {
    const lista =
      mini === 'pais' ? paises : mini === 'region' ? regiones : mini === 'ciudad' ? ciudades : sectores
    const q = busqueda.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((o) => o.name.toLowerCase().includes(q))
  }, [mini, paises, regiones, ciudades, sectores, busqueda])

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
    setRegionLabel(op.regionLabel ?? 'Provincia')
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

      <p className={cn('text-xs', oscuro ? 'text-white/50' : 'text-muted-foreground')}>
        La usamos para mostrarte ofertas cercanas. Siempre puedes omitirla.
      </p>

      <div>
        <h2 className={cn('text-lg font-bold tracking-tight', oscuro ? 'text-white' : 'text-foreground')}>
          {mini === 'pais' ? '¿Dónde vives?' : `¿${etiqueta2} de tu vivienda?`}
        </h2>
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
                    Sin resultados. Puedes escribirla manualmente.
                  </li>
                )}
              </ul>

              {cargando && (
                <p className={cn('flex items-center gap-1.5 text-xs', oscuro ? 'text-white/50' : 'text-muted-foreground')}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
                </p>
              )}

              {(mini === 'ciudad' || mini === 'sector') && (
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
