'use client'

import { useState, useEffect, useRef, useActionState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, Users, Minus, Plus, Loader2, AlertCircle, X, ShoppingCart } from 'lucide-react'
import { reservarExcursion } from '@/modules/excursiones/reservas/cliente-actions'
import { toggleSeguirEmpresa } from '@/modules/social/actions'
import { formatMoney } from '@/lib/format'
import { useExcursionCart } from '@/components/excursiones/ExcursionCarritoContext'
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
  horarios,
  precioDesde,
  isAuthenticated,
  isFollowing: initialFollowing,
  proximasSalidas,
  agotadaGlobal,
  todasFechasPasadas,
  capacidad,
}: ReservaExcursionFormProps) {
  const router = useRouter()
  const [state, action, pending] = useActionState(reservarExcursion, initial)
  const cart = useExcursionCart()
  const followedRef = useRef(initialFollowing)
  const [isFollowing, setIsFollowing] = useState(initialFollowing)

  const [varianteId, setVarianteId] = useState(variantes[0]?.id ?? '')
  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')
  const [adultos, setAdultos] = useState(1)
  const [ninos, setNinos] = useState(0)
  const [notas, setNotas] = useState('')
  const [followingPending, setFollowingPending] = useState(false)

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

  // Auto-seleccionar primera fecha disponible al cargar
  useEffect(() => {
    if (!fecha && fechasDisponibles.length > 0) {
      setFecha(fechasDisponibles[0])
    }
  }, [fecha, fechasDisponibles])

  // Horarios disponibles para la fecha seleccionada
  const horariosDisponibles = useMemo(() => {
    if (!fecha) return []
    return salidasDisponibles
      .filter((s) => s.fecha === fecha)
      .sort((a, b) => a.horaSalida.localeCompare(b.horaSalida))
  }, [fecha, salidasDisponibles])

  // Reset hora when fecha changes
  useEffect(() => {
    if (horariosDisponibles.length > 0) {
      const primerDisponible = horariosDisponibles.find((h) => !h.agotada) || horariosDisponibles[0]
      if (primerDisponible) {
        setHora(primerDisponible.horaSalida)
      }
    }
  }, [fecha, horariosDisponibles])

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
      setIsFollowing(true)
      // Now submit the form
      ;(e.target as HTMLFormElement).requestSubmit()
      return
    }
    // Already following — let the form action proceed
  }

  const hoy = new Date().toISOString().split('T')[0]

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

      <form action={action} onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="excursionId" value={excursionId} />

        {/* Variante */}
        {variantes.length > 1 && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Tipo de experiencia</label>
            <select
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

        {/* Fecha */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            <CalendarDays className="mr-1 inline h-4 w-4" />
            Fecha
          </label>
          <select
            name="fecha"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
            disabled={fechasDisponibles.length === 0}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="">Selecciona una fecha</option>
            {fechasDisponibles.map((f) => {
              const salida = salidasDisponibles.find((s) => s.fecha === f)
              const cupo = salida?.cupoDisponible ?? 0
              return (
                <option key={f} value={f} disabled={cupo <= 0}>
                  {f} {cupo > 0 ? `(${cupo} plazas)` : '— Completa'}
                </option>
              )
            })}
          </select>
          {fechasDisponibles.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">No hay fechas con plazas disponibles</p>
          )}
        </div>

        {/* Horario */}
        <input type="hidden" name="hora" value={hora} />
        {horariosDisponibles.length > 0 && (
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
                      onChange={() => setHora(h.horaSalida)}
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
        )}

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

        {/* Resumen */}
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span>{formatMoney(subtotal, { moneda })}</span>
          </div>
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold">
            <span>Total</span>
            <span>{formatMoney(subtotal, { moneda })}</span>
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
            type="submit"
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
          ) : (
            'Reservar ahora'
          )}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Tu reserva quedará pendiente de pago. Puedes gestionarlo desde tu cuenta.
        </p>
      </form>
    </div>
  )
}