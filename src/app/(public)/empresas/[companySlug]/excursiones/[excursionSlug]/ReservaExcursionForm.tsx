'use client'

import { useState, useEffect, useRef, useActionState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CalendarDays,
  Users,
  Minus,
  Plus,
  Loader2,
  AlertCircle,
  X,
  ShoppingCart,
  CreditCard,
  Banknote,
  ShieldCheck,
  Sparkles,
  Wand2,
  Clock,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { reservarExcursion } from '@/modules/excursiones/reservas/cliente-actions'
import { toggleSeguirEmpresa } from '@/modules/social/actions'
import { formatMoney } from '@/lib/format'
import { useExcursionCart } from '@/components/excursiones/ExcursionCarritoContext'
import { PasarelaSimuladaModal } from '@/components/excursiones/PasarelaSimuladaModal'
import {
  autoResolverItinerarioCombo,
  optimizarItinerarioCombo,
  validarItinerarioCombo,
  generarCombinacionesCombo,
  type CombinacionItinerarioCombo,
  formatoMinutosAHora,
  minutosDesdeMedianoche,
} from '@/modules/excursiones/reservas/nucleo'
import type { ReservaClienteState } from '@/modules/excursiones/reservas/cliente-actions'
import type { SalidaDisponible } from '@/modules/excursiones/catalogo/public-queries'

interface Variante {
  id: string
  nombre: string
  precioAdulto: number
  precioNino: number | null
}

interface Horario {
  id: string
  horaSalida: string
  diasSemana: number[]
}

export interface ComboItemActividadPublica {
  horaSalida?: string | null
  actividad: {
    id: string
    nombre: string
    slug: string
    portadaUrl: string | null
    duracionMin: number | null
    horaSalida: string | null
    horaRegreso: string | null
    categoria: string | null
    horarios?: {
      id: string
      horaSalida: string
      diasSemana: number[]
      cupo: number | null
    }[]
  }
}

interface ReservaExcursionFormProps {
  companyId: string
  companySlug: string
  excursionId: string
  nombreExcursion: string
  portadaUrl?: string | null
  moneda: string
  variantes: Variante[]
  horarios: Horario[]
  precioDesde: number | null
  isAuthenticated: boolean
  isFollowing: boolean
  proximasSalidas: SalidaDisponible[]
  agotadaGlobal: boolean
  todasFechasPasadas: boolean
  capacidad: number | null
  tipoItem?: string
  comboItems?: ComboItemActividadPublica[]
}

const initial: ReservaClienteState = {}

export function ReservaExcursionForm({
  companyId,
  companySlug,
  excursionId,
  nombreExcursion,
  portadaUrl,
  moneda,
  variantes,
  precioDesde,
  isAuthenticated,
  isFollowing: initialFollowing,
  proximasSalidas,
  agotadaGlobal,
  tipoItem,
  comboItems = [],
}: ReservaExcursionFormProps) {
  const router = useRouter()
  const [state, action, pending] = useActionState(reservarExcursion, initial)
  const cart = useExcursionCart()
  const followedRef = useRef(initialFollowing)
  const formRef = useRef<HTMLFormElement>(null)
  const [varianteId, setVarianteId] = useState(variantes[0]?.id ?? '')
  const [metodoPago, setMetodoPago] = useState<'DESTINO' | 'ONLINE_SIMULADO'>('DESTINO')
  const [isModalPagoOpen, setIsModalPagoOpen] = useState(false)
  // Lo que el usuario ELIGIÓ; la fecha efectiva se deriva más abajo.
  const [fechaElegida, setFechaElegida] = useState('')
  // Lo que el usuario ELIGIÓ. La hora efectiva (`hora`) se deriva de esto más
  // los horarios disponibles: ver abajo.
  const [horaElegida, setHoraElegida] = useState('')
  const [adultos, setAdultos] = useState(1)
  const [ninos, setNinos] = useState(0)
  const [notas, setNotas] = useState('')
  const [followingPending, setFollowingPending] = useState(false)

  // Combinaciones válidas completas de horarios para el paquete combo
  const combinacionesDisponibles = useMemo(() => {
    if (tipoItem !== 'COMBO' || !comboItems || comboItems.length === 0) return []
    const acts = comboItems.map((ci) => ({
      id: ci.actividad.id,
      nombre: ci.actividad.nombre,
      duracionMin: ci.actividad.duracionMin || 120,
      horaSalida: ci.horaSalida || ci.actividad.horaSalida || '09:00',
      horaRegreso: ci.actividad.horaRegreso,
      horarios: ci.actividad.horarios || [],
    }))
    return generarCombinacionesCombo(acts)
  }, [tipoItem, comboItems])

  // Horarios seleccionados por actividad si es un combo
  const [comboHorarios, setComboHorarios] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    if (comboItems && comboItems.length > 0) {
      for (const item of comboItems) {
        if (item.actividad) {
          init[item.actividad.id] = (
            item.horaSalida ||
            item.actividad.horaSalida ||
            '09:00'
          ).trim().slice(0, 5)
        }
      }

      // Validar si la combinación inicial guardada es válida sin solapamiento
      const actsConInit = comboItems.map((ci) => ({
        id: ci.actividad.id,
        nombre: ci.actividad.nombre,
        duracionMin: ci.actividad.duracionMin || 120,
        horaSalida: init[ci.actividad.id] || '09:00',
        horaRegreso: ci.actividad.horaRegreso,
        horarios: ci.actividad.horarios || [],
      }))
      const v = validarItinerarioCombo(actsConInit)
      if (v.ok) {
        return init
      }

      // Si hubiese conflicto (ej: datos legacy), auto-resolver con combinaciones válidas
      const combs = generarCombinacionesCombo(actsConInit)
      if (combs.length > 0) {
        return combs[0].horariosAsignados
      }
    }
    return init
  })

  // Actividades del combo con sus horarios elegidos
  const comboActividadesConHorario = useMemo(() => {
    if (tipoItem !== 'COMBO' || !comboItems || comboItems.length === 0) return []
    return comboItems.map((ci) => ({
      id: ci.actividad.id,
      nombre: ci.actividad.nombre,
      duracionMin: ci.actividad.duracionMin || 120,
      horaSalida:
        comboHorarios[ci.actividad.id] ||
        ci.horaSalida ||
        ci.actividad.horaSalida ||
        (ci.actividad.horarios && ci.actividad.horarios.length > 0
          ? ci.actividad.horarios[0].horaSalida
          : '09:00'),
      horaRegreso: ci.actividad.horaRegreso,
      horarios: ci.actividad.horarios || [],
    }))
  }, [tipoItem, comboItems, comboHorarios])

  const itinerarioComboRes = useMemo(() => {
    if (tipoItem !== 'COMBO' || comboActividadesConHorario.length === 0) {
      return { ok: true as const, itinerario: [] }
    }
    return validarItinerarioCombo(comboActividadesConHorario)
  }, [tipoItem, comboActividadesConHorario])

  const cambiarTurnoCombo = (actId: string, nuevaHora: string) => {
    const updated = { ...comboHorarios, [actId]: nuevaHora.trim().slice(0, 5) }
    const acts = comboActividadesConHorario.map((a) => ({
      ...a,
      horaSalida: updated[a.id] || a.horaSalida,
    }))
    const valid = validarItinerarioCombo(acts)
    if (valid.ok) {
      setComboHorarios(updated)
    } else {
      const res = autoResolverItinerarioCombo(acts, actId)
      if (res.ok) {
        setComboHorarios(res.horariosAsignados)
      } else {
        setComboHorarios(updated)
      }
    }
  }

  const sugerirHorarioOptimo = () => {
    const opt = optimizarItinerarioCombo(comboActividadesConHorario)
    if (opt.ok) {
      setComboHorarios(opt.horariosAsignados)
    }
  }

  // Filtrar salidas futuras con cupo disponible
  const salidasDisponibles = useMemo(() => {
    const ahora = new Date()
    ahora.setHours(0, 0, 0, 0)
    return proximasSalidas.filter((s) => new Date(s.fecha) >= ahora && s.cupoDisponible > 0 && !s.fechaPasada)
  }, [proximasSalidas])

  // Fechas únicas disponibles
  const fechasDisponibles = useMemo(() => {
    const fechas = new Set(salidasDisponibles.map((s) => s.fecha))
    return Array.from(fechas).sort()
  }, [salidasDisponibles])

  /**
   * La fecha efectiva también se DERIVA, igual que la hora.
   */
  const fecha = fechaElegida && fechasDisponibles.includes(fechaElegida)
    ? fechaElegida
    : (fechasDisponibles[0] ?? '')

  // Horarios disponibles para la fecha seleccionada
  const horariosDisponibles = useMemo(() => {
    if (!fecha) return []
    return salidasDisponibles
      .filter((s) => s.fecha === fecha)
      .sort((a, b) => a.horaSalida.localeCompare(b.horaSalida))
  }, [fecha, salidasDisponibles])

  /**
   * La hora efectiva se DERIVA. Para combos, toma la hora de la primera actividad del itinerario.
   */
  const hora = useMemo(() => {
    if (tipoItem === 'COMBO' && itinerarioComboRes.itinerario.length > 0) {
      return itinerarioComboRes.itinerario[0].inicio
    }
    return horariosDisponibles.some((h) => h.horaSalida === horaElegida)
      ? horaElegida
      : ((horariosDisponibles.find((h) => !h.agotada) ?? horariosDisponibles[0])?.horaSalida ?? '')
  }, [tipoItem, itinerarioComboRes, horariosDisponibles, horaElegida])

  const formato12h = (h24: string) => {
    if (!h24 || !h24.includes(':')) return h24
    const [hStr, mStr] = h24.split(':')
    const h = parseInt(hStr, 10)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${mStr} ${ampm}`
  }

  const varianteActual = variantes.find((v) => v.id === varianteId) ?? variantes[0]
  const precioAdulto = varianteActual?.precioAdulto ?? 0
  const precioNino = varianteActual?.precioNino ?? precioAdulto
  const subtotal = adultos * precioAdulto + ninos * precioNino

  // Redirect on success — in useEffect to avoid setState-during-render
  useEffect(() => {
    if (state.success && state.reservaId) {
      router.push(`/cliente/mis-excursiones/${state.reservaId}`)
    }
  }, [state.success, state.reservaId, router])

  // Auto-follow on first submit attempt if not following
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!isAuthenticated || pending) return
    // Ensure the user follows this company before reserving
    if (!followedRef.current) {
      e.preventDefault()
      setFollowingPending(true)
      const result = await toggleSeguirEmpresa(companyId)
      setFollowingPending(false)
      if (result.error) {
        // If follow fails, still try to reserve — the action handles missing profile
        ;(e.target as HTMLFormElement).requestSubmit()
        return
      }
      followedRef.current = true
      // Now submit the form
      ;(e.target as HTMLFormElement).requestSubmit()
      return
    }
    // Already following — let the form action proceed
  }

  // Not authenticated — show CTA
  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
        <h3 className="text-h3 font-bold">Reservar</h3>
        {precioDesde != null && (
          <p className="mt-2 text-sm text-muted-foreground">
            Desde {formatMoney(precioDesde, { moneda })}
          </p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          Inicia sesión o crea una cuenta para reservar esta excursión.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/login?redirect=${encodeURIComponent(`/empresas/${companySlug}/excursiones/${excursionId}`)}`}
            className="flex-1 rounded-lg border bg-card py-3 text-center text-sm font-semibold transition hover:bg-muted"
          >
            Iniciar sesión
          </Link>
          <Link
            href={`/registro/${companySlug}?next=${encodeURIComponent(`/empresas/${companySlug}/excursiones/${excursionId}`)}`}
            className="flex-1 rounded-lg bg-primary py-3 text-center text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Crear cuenta
          </Link>
        </div>
      </div>
    )
  }

// Agotada global — show out of stock
  if (agotadaGlobal) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h3 className="text-h3 font-bold text-destructive">Sin disponibilidad</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta excursión no tiene plazas disponibles en las próximas fechas.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vuelve a consultar más adelante por si hay cancelaciones.
          </p>
        </div>
      </div>
    )
  }

  // No hay fechas disponibles (pero no agotada globalmente)
  if (fechasDisponibles.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="text-center">
          <X className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h3 className="text-h3 font-bold">Sin fechas disponibles</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            No hay salidas con plazas disponibles en los próximos 90 días.
          </p>
        </div>
      </div>
)
}

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="mb-1 text-h3 font-bold">Reservar</h3>
      {precioDesde != null && (
        <p className="mb-5 text-sm text-muted-foreground">
          Desde {formatMoney(precioDesde, { moneda })}
        </p>
      )}

      <form ref={formRef} action={action} onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="excursionId" value={excursionId} />
        <input type="hidden" name="metodoPago" value={metodoPago} />

        {/* Variante */}
        {variantes.length > 1 && (
          <div>
            <label htmlFor="reserva-variante" className="mb-1.5 block text-sm font-medium">
              Tipo de experiencia
            </label>
            <select
              id="reserva-variante"
              name="varianteId"
              value={varianteId}
              onChange={(e) => setVarianteId(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {variantes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre} — {formatMoney(v.precioAdulto, { moneda })}
                </option>
              ))}
            </select>
          </div>
        )}
        {variantes.length === 1 && (
          <input type="hidden" name="varianteId" value={varianteId} />
        )}

        {/* Fecha Interactiva */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="reserva-fecha" className="block text-sm font-semibold text-foreground">
              <CalendarDays className="mr-1.5 inline h-4 w-4 text-primary" />
              Fecha de la experiencia *
            </label>
            {fecha && (
              <span className="text-caption font-medium text-muted-foreground">
                Seleccionada: <strong className="text-foreground">{fecha}</strong>
              </span>
            )}
          </div>

          {/* Píldoras de fechas rápidas */}
          {fechasDisponibles.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {fechasDisponibles.slice(0, 5).map((f) => {
                const salida = salidasDisponibles.find((s) => s.fecha === f)
                const cupo = salida?.cupoDisponible ?? 0
                const esActiva = fecha === f
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFechaElegida(f)}
                    disabled={cupo <= 0}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      esActiva
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : cupo > 0
                        ? 'border border-border/80 bg-muted/40 hover:bg-muted text-foreground'
                        : 'border border-border/40 bg-muted/20 text-muted-foreground/50 cursor-not-allowed'
                    }`}
                  >
                    {f} {cupo > 0 ? `(${cupo} cupos)` : '• Lleno'}
                  </button>
                )
              })}
            </div>
          )}

          <select
            id="reserva-fecha"
            name="fecha"
            value={fecha}
            onChange={(e) => setFechaElegida(e.target.value)}
            required
            disabled={fechasDisponibles.length === 0}
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">-- Elige una fecha del calendario --</option>
            {fechasDisponibles.map((f) => {
              const salida = salidasDisponibles.find((s) => s.fecha === f)
              const cupo = salida?.cupoDisponible ?? 0
              return (
                <option key={f} value={f} disabled={cupo <= 0}>
                  {f} {cupo > 0 ? `(${cupo} cupos disponibles)` : '— Completa'}
                </option>
              )
            })}
          </select>
          {fechasDisponibles.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">No hay fechas con plazas disponibles</p>
          )}
        </div>

        {/* Horario o Itinerario de Combo */}
        <input type="hidden" name="hora" value={hora} />
        {tipoItem === 'COMBO' && comboItems && comboItems.length > 0 ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-3">
            <input
              type="hidden"
              name="itinerarioComboJson"
              value={JSON.stringify(comboHorarios)}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/15 pb-2">
              <div>
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Turnos del Paquete
                </span>
                <p className="text-[11px] text-muted-foreground">
                  Elige la opción de horarios que mejor se adapte a tu día.
                </p>
              </div>

              {combinacionesDisponibles.length > 0 && (
                <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {combinacionesDisponibles.length} opción(es) coordinada(s)
                </span>
              )}
            </div>

            {/* Selector 1-Click de Opciones de Turno del Paquete */}
            {combinacionesDisponibles.length > 0 ? (
              <div className="space-y-2">
                {combinacionesDisponibles.map((comb, cIdx) => {
                  const isSelected =
                    hora === comb.horaInicio ||
                    Object.entries(comb.horariosAsignados).every(([id, h]) => comboHorarios[id] === h)

                  return (
                    <button
                      key={comb.id || cIdx}
                      type="button"
                      onClick={() => {
                        setComboHorarios(comb.horariosAsignados)
                        setHoraElegida(comb.horaInicio)
                      }}
                      className={`w-full text-left rounded-xl p-3 border transition-all ${
                        isSelected
                          ? 'border-primary bg-background shadow-xs ring-1.5 ring-primary'
                          : 'border-border/80 bg-background/60 hover:border-border hover:bg-background'
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-1 mb-1">
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/40 bg-muted/40'
                            }`}
                          >
                            {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                          </div>
                          <span className="font-bold text-foreground text-xs">{comb.nombre}</span>
                        </div>
                        <span className="font-mono text-xs font-bold text-primary">
                          {formato12h(comb.horaInicio)} → {formato12h(comb.horaFin)}
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">
                            ({(comb.duracionTotalMin / 60).toFixed(1)}h total)
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap pl-6 text-[11px] text-muted-foreground">
                        {comb.itinerario.map((bloque, bIdx) => (
                          <span key={bloque.id || bIdx} className="inline-flex items-center gap-1">
                            {bIdx > 0 && <span className="text-muted-foreground/50 font-bold">→</span>}
                            <span className="font-medium text-foreground">{bloque.nombre}</span>
                            <span className="font-mono text-[10px] text-primary font-semibold bg-muted/60 px-1.5 py-0.5 rounded">
                              {formato12h(bloque.inicio)} - {formato12h(bloque.fin)}
                            </span>
                          </span>
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              /* Fallback si no hay slots múltiples definidos */
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={sugerirHorarioOptimo}
                  className="flex items-center gap-1 rounded-lg border border-primary/30 bg-background px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/10 transition shadow-2xs"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Sugerir Horario Óptimo
                </button>
              </div>
            )}

            {/* Resumen visual del itinerario del combo */}
            <div className="rounded-lg border border-border/70 bg-background/80 p-2.5 text-xs space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Itinerario Confirmado para tu Reserva:
              </span>

              {itinerarioComboRes.ok ? (
                <div className="space-y-1">
                  {itinerarioComboRes.itinerario.map((bloque, idx) => (
                    <div
                      key={bloque.id || idx}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                          {idx + 1}
                        </span>
                        <span className="font-medium text-foreground">{bloque.nombre}</span>
                      </div>
                      <span className="font-mono text-muted-foreground font-semibold">
                        {formato12h(bloque.inicio)} → {formato12h(bloque.fin)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-start gap-1.5 text-destructive text-[11px] font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{itinerarioComboRes.error}</span>
                </div>
              )}
            </div>
          </div>
        ) : horariosDisponibles.length > 0 ? (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Hora de salida</label>
            <div className="flex flex-wrap gap-2">
              {horariosDisponibles.map((h) => {
                const [hStr, mStr] = h.horaSalida.split(':')
                const hNum = parseInt(hStr || '0', 10)
                const ampm = hNum >= 12 ? 'PM' : 'AM'
                const h12 = hNum % 12 || 12
                const horaLabel = `${h12}:${mStr} ${ampm}`

                return (
                  <label
                    key={h.id}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                      hora === h.horaSalida
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : h.agotada
                        ? 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    <input
                      type="radio"
                      name="hora_radio"
                      value={h.horaSalida}
                      checked={hora === h.horaSalida}
                      onChange={() => setHoraElegida(h.horaSalida)}
                      disabled={h.agotada}
                      className="sr-only"
                    />
                    {horaLabel}
                    {h.cupoDisponible > 0 && (
                      <span className="ml-1.5 text-xs opacity-80">
                        ({h.cupoDisponible})
                      </span>
                    )}
                    {h.agotada && <X className="ml-1.5 h-3 w-3 inline" />}
                  </label>
                )
              })}
            </div>
            {horariosDisponibles.length > 0 && horariosDisponibles.every((h) => h.agotada) && (
              <p className="mt-1 text-xs text-destructive font-semibold">Todos los horarios están completos para esta fecha</p>
            )}
          </div>
        ) : null}

        {/* Pasajeros */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            <Users className="mr-1 inline h-4 w-4" />
            Pasajeros
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Adultos</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAdultos(Math.max(1, adultos - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-full border bg-background hover:bg-muted"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-sm font-medium">{adultos}</span>
                <button
                  type="button"
                  onClick={() => setAdultos(adultos + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border bg-background hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <input type="hidden" name="adultos" value={adultos} />

            <div className="flex items-center justify-between">
              <span className="text-sm">Niños</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNinos(Math.max(0, ninos - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-full border bg-background hover:bg-muted"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-sm font-medium">{ninos}</span>
                <button
                  type="button"
                  onClick={() => setNinos(ninos + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border bg-background hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <input type="hidden" name="ninos" value={ninos} />
          </div>
        </div>

        {/* Selector de Modalidad de Pago */}
        <div className="space-y-2 pt-1">
          <label className="block text-sm font-medium">¿Cómo deseas pagar?</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMetodoPago('DESTINO')}
              className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition ${
                metodoPago === 'DESTINO'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>Pagar el día del tour</span>
              </div>
              <span className="text-[11px] text-muted-foreground leading-tight">
                Pagas en el punto de encuentro al momento de abordar.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMetodoPago('ONLINE_SIMULADO')}
              className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition relative ${
                metodoPago === 'ONLINE_SIMULADO'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <CreditCard className="h-4 w-4 text-primary" />
                <span>Pagar ahora en línea</span>
                <span className="text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.2 rounded-full font-bold">
                  Prueba
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground leading-tight">
                Tarjeta crédito/débito • Acceso y boleto de inmediato.
              </span>
            </button>
          </div>
        </div>

        {/* Notas */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Notas (opcional)</label>
          <textarea
            name="notas"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            placeholder="Alguna solicitud especial..."
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm"
          />
        </div>

        {/* Resumen de Precio Interactivo */}
        <div className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground pb-2 border-b border-border/60">
            <span>Desglose de tarifa</span>
            <span className="font-semibold text-foreground">{varianteActual.nombre}</span>
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>
                {adultos} Adulto(s) × {formatMoney(precioAdulto, { moneda })}
              </span>
              <span className="font-medium text-foreground">
                {formatMoney(adultos * precioAdulto, { moneda })}
              </span>
            </div>
            {ninos > 0 && (
              <div className="flex justify-between">
                <span>
                  {ninos} Niño(s) × {formatMoney(precioNino, { moneda })}
                </span>
                <span className="font-medium text-foreground">
                  {formatMoney(ninos * precioNino, { moneda })}
                </span>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-border/60 flex items-baseline justify-between">
            <span className="text-sm font-bold text-foreground">Total a pagar</span>
            <div className="text-right">
              <span className="text-xl font-black text-primary font-mono">
                {formatMoney(subtotal, { moneda })}
              </span>
              <p className="text-[10px] text-muted-foreground">
                {metodoPago === 'ONLINE_SIMULADO' ? 'Pago inmediato online' : 'Pago presencial al abordar'}
              </p>
            </div>
          </div>
        </div>

        {/* Error */}
        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}

        {/* Acciones */}
        <div className="flex flex-col gap-2 mt-2">
          <button
            type="button"
            onClick={() => {
              if (!fecha || !hora) return
              cart.addItem({
                excursionId,
                companyId,
                nombreExcursion,
                portadaUrl: portadaUrl ?? null,
                varianteId,
                varianteNombre: varianteActual.nombre,
                fecha,
                hora,
                adultos,
                ninos,
                precioAdulto,
                precioNino,
                moneda,
              })
            }}
            disabled={pending || followingPending || !fecha || !hora || horariosDisponibles.every((h) => h.agotada)}
            className="flex items-center justify-center gap-2 w-full rounded-lg border-2 border-primary bg-background py-3 text-sm font-semibold text-primary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShoppingCart className="h-4 w-4" />
            Agregar al carrito
          </button>

          <button
            type={metodoPago === 'ONLINE_SIMULADO' ? 'button' : 'submit'}
            onClick={() => {
              if (metodoPago === 'ONLINE_SIMULADO') {
                if (!fecha || !hora) return
                setIsModalPagoOpen(true)
              }
            }}
            disabled={pending || followingPending || !fecha || !hora || horariosDisponibles.every((h) => h.agotada)}
            className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {followingPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparando...
              </span>
            ) : pending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Reservando...
              </span>
            ) : metodoPago === 'ONLINE_SIMULADO' ? (
              <span className="flex items-center justify-center gap-2">
                <CreditCard className="h-4 w-4" />
                Pagar y Reservar ahora
              </span>
            ) : (
              'Reservar (Pagar en destino)'
            )}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {metodoPago === 'ONLINE_SIMULADO'
            ? 'Transacción simulada en entorno de pruebas. Emisión inmediata de QR.'
            : 'Tu reserva quedará agendada para pago en persona el día del tour.'}
        </p>
      </form>

      {/* Modal de Pago Online Simulado */}
      <PasarelaSimuladaModal
        isOpen={isModalPagoOpen}
        onClose={() => setIsModalPagoOpen(false)}
        onConfirmPayment={async () => {
          setIsModalPagoOpen(false)
          formRef.current?.requestSubmit()
        }}
        montoTotal={subtotal}
        moneda={moneda}
        tituloConcepto={nombreExcursion}
        detallesItems={[
          {
            nombre: `${adultos} Adulto(s)${ninos > 0 ? ` + ${ninos} Niño(s)` : ''} (${varianteActual.nombre})`,
            cantidad: 1,
            subtotal,
          },
        ]}
      />
    </div>
  )
}