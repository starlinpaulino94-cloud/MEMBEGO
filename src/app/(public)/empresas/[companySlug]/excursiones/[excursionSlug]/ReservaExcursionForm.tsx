'use client'

import { useState, useEffect, useRef, useActionState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Users,
  Minus,
  Plus,
  Loader2,
  AlertCircle,
  X,
  ShoppingCart,
<<<<<<< HEAD
  ShieldCheck,
=======
  CreditCard,
  Banknote,
>>>>>>> origin/main
  Sparkles,
  Wand2,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { format, parseISO, addMonths, subMonths, getDaysInMonth, isSameMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { reservarExcursion } from '@/modules/excursiones/reservas/cliente-actions'
import { toggleSeguirEmpresa } from '@/modules/social/actions'
import { formatMoney } from '@/lib/format'
import { useExcursionCart } from '@/components/excursiones/ExcursionCarritoContext'
import {
  autoResolverItinerarioCombo,
  optimizarItinerarioCombo,
  validarItinerarioCombo,
  generarCombinacionesCombo,
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
  permitirSolapamiento?: boolean
  horarioFijo?: unknown
  actividad: {
    id: string
    nombre: string
    slug: string
    tipoItem?: string | null
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
  excursionSlug: string
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
  esEmpresaDemo?: boolean
}

function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getTodayString(): string {
  return getLocalDateString(new Date())
}

function addDaysToString(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return getLocalDateString(d)
}

const initial: ReservaClienteState = {}

export function ReservaExcursionForm({
  companyId,
  companySlug,
  excursionId,
  excursionSlug,
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
  tipoItem,
  comboItems = [],
  esEmpresaDemo,
}: ReservaExcursionFormProps) {
  const router = useRouter()
  const [state, action, pending] = useActionState(reservarExcursion, initial)
  const cart = useExcursionCart()
  const followedRef = useRef(initialFollowing)
  const formRef = useRef<HTMLFormElement>(null)
  const [varianteId, setVarianteId] = useState(variantes[0]?.id ?? '')
  // Lo que el usuario ELIGIÓ; la fecha efectiva se deriva más abajo.
  const [fechaElegida, setFechaElegida] = useState('')
  // Lo que el usuario ELIGIÓ. La hora efectiva (`hora`) se deriva de esto más
  // los horarios disponibles: ver abajo.
  const [horaElegida, setHoraElegida] = useState('')
  const [usarHoraPersonalizada, setUsarHoraPersonalizada] = useState(false)
  const [horaPersonalizada, setHoraPersonalizada] = useState('')
  const [adultos, setAdultos] = useState(1)
  const [ninos, setNinos] = useState(0)
  const [notas, setNotas] = useState('')
  const [followingPending, setFollowingPending] = useState(false)

  // Modo de programación de combo: Mismo Día o Días Separados
  const [modoComboFechas, setModoComboFechas] = useState<'MISMO_DIA' | 'DIAS_DIFERENTES'>('MISMO_DIA')
  const [itinerarioMultiFecha, setItinerarioMultiFecha] = useState<Record<string, { fecha: string; hora: string }>>({})

  // Daypasses y actividades con horario dentro del combo
  const pasesDiaEnCombo = useMemo(() => {
    if (tipoItem !== 'COMBO' || !comboItems) return []
    return comboItems.filter((ci) => ci.actividad?.tipoItem === 'PASE_DIA')
  }, [tipoItem, comboItems])

  const actividadesConHorarioEnCombo = useMemo(() => {
    if (tipoItem !== 'COMBO' || !comboItems) return []
    return comboItems.filter((ci) => ci.actividad?.tipoItem !== 'PASE_DIA')
  }, [tipoItem, comboItems])

  // Combinaciones válidas completas de horarios para el paquete combo
  const combinacionesDisponibles = useMemo(() => {
    if (tipoItem !== 'COMBO' || !comboItems || comboItems.length === 0) return []
    const acts = comboItems.map((ci) => ({
      id: ci.actividad.id,
      nombre: ci.actividad.nombre,
      tipoItem: ci.actividad.tipoItem,
      duracionMin: ci.actividad.duracionMin || 120,
      horaSalida: ci.horaSalida || ci.actividad.horaSalida || '09:00',
      horaRegreso: ci.actividad.horaRegreso,
      horarios: ci.actividad.horarios || [],
      permitirSolapamiento: !!ci.permitirSolapamiento,
      horarioFijo: Array.isArray(ci.horarioFijo) ? (ci.horarioFijo as string[]) : null,
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
        tipoItem: ci.actividad.tipoItem,
        duracionMin: ci.actividad.duracionMin || 120,
        horaSalida: init[ci.actividad.id] || '09:00',
        horaRegreso: ci.actividad.horaRegreso,
        horarios: ci.actividad.horarios || [],
        permitirSolapamiento: !!ci.permitirSolapamiento,
        horarioFijo: Array.isArray(ci.horarioFijo) ? (ci.horarioFijo as string[]) : null,
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

  // Horarios válidos por actividad:哪些 horas forman parte de al menos 1 combinación válida
  const horariosValidosPorActividad = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const comb of combinacionesDisponibles) {
      for (const [actId, hora] of Object.entries(comb.horariosAsignados)) {
        if (!map[actId]) map[actId] = new Set()
        map[actId].add(hora)
      }
    }
    return map
  }, [combinacionesDisponibles])

  // Actividades del combo con sus horarios elegidos
  const comboActividadesConHorario = useMemo(() => {
    if (tipoItem !== 'COMBO' || !comboItems || comboItems.length === 0) return []
    return comboItems.map((ci) => ({
      id: ci.actividad.id,
      nombre: ci.actividad.nombre,
      tipoItem: ci.actividad.tipoItem,
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
      permitirSolapamiento: !!ci.permitirSolapamiento,
      horarioFijo: Array.isArray(ci.horarioFijo) ? (ci.horarioFijo as string[]) : null,
    }))
  }, [tipoItem, comboItems, comboHorarios])

  // Filtrar salidas futuras con cupo disponible (comparación local sin desfasar hoy)
  const hoyStr = getTodayString()
  const salidasDisponibles = useMemo(() => {
    return proximasSalidas.filter((s) => s.fecha >= hoyStr && s.cupoDisponible > 0 && !s.fechaPasada)
  }, [proximasSalidas, hoyStr])

  // Fechas únicas disponibles
  const fechasDisponibles = useMemo(() => {
    const fechas = new Set(salidasDisponibles.map((s) => s.fecha))
    return Array.from(fechas).sort()
  }, [salidasDisponibles])

  // Mapa fecha → cantidad de horarios disponibles (para tooltip en hover)
  const horariosPorFecha = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of salidasDisponibles) {
      map.set(s.fecha, (map.get(s.fecha) ?? 0) + 1)
    }
    return map
  }, [salidasDisponibles])

  /**
   * La fecha efectiva también se DERIVA, igual que la hora.
   */
  const fecha = fechaElegida && fechasDisponibles.includes(fechaElegida)
    ? fechaElegida
    : (fechasDisponibles[0] ?? '')

  // Estado para el mes visualizado en el calendario
  const [mesActual, setMesActual] = useState<Date>(() => {
    if (fecha) {
      try {
        return parseISO(fecha)
      } catch { }
    }
    if (fechasDisponibles[0]) {
      try {
        return parseISO(fechasDisponibles[0])
      } catch { }
    }
    return new Date()
  })

  /**
   * El mes que enseña el calendario sigue a la fecha elegida.
   *
   * Iba en un `useEffect`, y eso significaba un render con el mes viejo y otro
   * con el bueno: al elegir una fecha rápida de otro mes se veía saltar el
   * calendario. Ajustar el estado DURANTE el render es el patrón que React
   * documenta para esto, y no hay parpadeo porque el render intermedio nunca
   * llega a pintarse.
   *
   * Converge porque `fechaSincronizada` se iguala a `fecha` en el mismo paso.
   */
  const [fechaSincronizada, setFechaSincronizada] = useState(fecha)
  if (fecha !== fechaSincronizada) {
    setFechaSincronizada(fecha)
    if (fecha) {
      try {
        const d = parseISO(fecha)
<<<<<<< HEAD
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMesActual((prev) => (isSameMonth(prev, d) ? prev : d))
=======
        if (!isSameMonth(mesActual, d)) setMesActual(d)
>>>>>>> origin/main
      } catch { }
    }
  }

  const irMesAnterior = () => setMesActual((prev) => subMonths(prev, 1))
  const irMesSiguiente = () => setMesActual((prev) => addMonths(prev, 1))

  // Generación de la cuadrícula limpia de días del mes
  const diasMes = useMemo(() => {
    const anio = mesActual.getFullYear()
    const mes = mesActual.getMonth()
    const primerDiaMes = new Date(anio, mes, 1)
    const totalDias = getDaysInMonth(mesActual)

    // Offset para que el lunes sea 0 y domingo sea 6
    const offset = (primerDiaMes.getDay() + 6) % 7

    const lista: { dateStr: string; diaNum: number; isCurrentMonth: boolean }[] = []

    // Días de relleno del mes anterior
    const diasMesAnterior = getDaysInMonth(new Date(anio, mes - 1, 1))
    for (let i = offset - 1; i >= 0; i--) {
      const diaNum = diasMesAnterior - i
      const d = new Date(anio, mes - 1, diaNum)
      lista.push({
        dateStr: format(d, 'yyyy-MM-dd'),
        diaNum,
        isCurrentMonth: false,
      })
    }

    // Días del mes actual
    for (let d = 1; d <= totalDias; d++) {
      const fechaObj = new Date(anio, mes, d)
      lista.push({
        dateStr: format(fechaObj, 'yyyy-MM-dd'),
        diaNum: d,
        isCurrentMonth: true,
      })
    }

    // Días de relleno del mes siguiente para completar la última fila de 7
    const remaining = (7 - (lista.length % 7)) % 7
    for (let d = 1; d <= remaining; d++) {
      const fechaObj = new Date(anio, mes + 1, d)
      lista.push({
        dateStr: format(fechaObj, 'yyyy-MM-dd'),
        diaNum: d,
        isCurrentMonth: false,
      })
    }

    return lista
  }, [mesActual])

  const comboItinerarioJson = useMemo(() => {
    if (tipoItem !== 'COMBO' || !comboItems || comboItems.length === 0) return ''
    if (modoComboFechas === 'DIAS_DIFERENTES') {
      return JSON.stringify(
        comboItems.map((ci) => ({
          actividadId: ci.actividad.id,
          fecha: itinerarioMultiFecha[ci.actividad.id]?.fecha || fecha,
          hora: ci.actividad.tipoItem === 'PASE_DIA' ? null : itinerarioMultiFecha[ci.actividad.id]?.hora || ci.horaSalida || '09:00',
        }))
      )
    } else {
      return JSON.stringify(
        comboItems.map((ci) => ({
          actividadId: ci.actividad.id,
          fecha,
          hora: ci.actividad.tipoItem === 'PASE_DIA' ? null : comboHorarios[ci.actividad.id] || ci.horaSalida || '09:00',
        }))
      )
    }
  }, [tipoItem, comboItems, modoComboFechas, itinerarioMultiFecha, fecha, comboHorarios])

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

  /**
   * El itinerario de un combo se arma cuando cambia la fecha o el combo.
   *
   * Antes era un efecto que dependía de `comboItems`, y `comboItems` es un
   * array que llega por props: cualquier render que trajera una referencia
   * nueva volvía a armar el itinerario entero y BORRABA lo que el cliente
   * hubiera elegido para cada día. Con una clave por identidad —los ids de las
   * actividades y la fecha— solo se rearma cuando de verdad cambió algo, y el
   * ajuste ocurre en el render en vez de en un efecto.
   */
  const claveItinerario =
    tipoItem === 'COMBO' && comboItems && comboItems.length > 0
      ? `${fecha}|${comboItems.map((i) => i.actividad?.id ?? '').join(',')}`
      : null
  const [itinerarioArmadoPara, setItinerarioArmadoPara] = useState<string | null>(null)
  if (claveItinerario && claveItinerario !== itinerarioArmadoPara) {
    setItinerarioArmadoPara(claveItinerario)
    const init: Record<string, { fecha: string; hora: string }> = {}
    for (const item of comboItems!) {
      if (item.actividad) {
        init[item.actividad.id] = {
          fecha: itinerarioMultiFecha[item.actividad.id]?.fecha || fecha,
          hora: item.actividad.tipoItem === 'PASE_DIA' ? '' : comboHorarios[item.actividad.id] || item.horaSalida || item.actividad.horaSalida || '09:00',
        }
      }
<<<<<<< HEAD
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItinerarioMultiFecha(init)
=======
>>>>>>> origin/main
    }
    setItinerarioMultiFecha(init)
  }

  // Horarios disponibles para la fecha seleccionada
  const horariosDisponibles = useMemo(() => {
    if (!fecha) return []
    return salidasDisponibles
      .filter((s) => s.fecha === fecha)
      .sort((a, b) => a.horaSalida.localeCompare(b.horaSalida))
  }, [fecha, salidasDisponibles])

  /**
   * La hora efectiva se DERIVA. Para combos, toma la hora de la primera actividad del itinerario. Para pases de día, no aplica.
   */
  const hora = useMemo(() => {
    if (tipoItem === 'PASE_DIA') {
      return ''
    }
    if (tipoItem === 'COMBO' && itinerarioComboRes.itinerario.length > 0) {
      return itinerarioComboRes.itinerario[0].inicio
    }
    // Soporte para hora personalizada del usuario
    if (usarHoraPersonalizada && horaPersonalizada) {
      return horaPersonalizada
    }
    return horariosDisponibles.some((h) => h.horaSalida === horaElegida)
      ? horaElegida
      : ((horariosDisponibles.find((h) => !h.agotada) ?? horariosDisponibles[0])?.horaSalida ?? '')
  }, [tipoItem, itinerarioComboRes, horariosDisponibles, horaElegida, usarHoraPersonalizada, horaPersonalizada])

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
        ; (e.target as HTMLFormElement).requestSubmit()
        return
      }
      // `followedRef` es lo único que se consulta (línea 145). El estado que
      // acompañaba a esta llamada desapareció en una mezcla y nadie leía su
      // valor: se quita la llamada en vez de resucitar un estado muerto.
      followedRef.current = true
      // Now submit the form
      ;(e.target as HTMLFormElement).requestSubmit()
      return
    }
    // Already following — let the form action proceed
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

        {/* Fecha Interactiva — Calendario */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-semibold text-foreground">
              <CalendarDays className="mr-1.5 inline h-4 w-4 text-primary" />
              Fecha de la experiencia *
            </label>
            {fecha && (
              <span className="text-caption font-medium text-muted-foreground">
                Seleccionada: <strong className="text-foreground">{fecha}</strong>
              </span>
            )}
          </div>

          <input type="hidden" name="fecha" value={fecha} required />
          <input type="hidden" name="hora" value={hora} />
          {comboItinerarioJson && (
            <input type="hidden" name="comboItinerarioJson" value={comboItinerarioJson} />
          )}

          {fechasDisponibles.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay fechas con plazas disponibles</p>
          ) : (
            <div className="rounded-xl border border-border bg-background p-2.5 space-y-2">
              {/* Botones de selección rápida */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-2">
                <span className="text-xs font-semibold text-muted-foreground mr-1">Rápido:</span>
                {fechasDisponibles.includes(hoyStr) && (
                  <button
                    type="button"
                    onClick={() => setFechaElegida(hoyStr)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${fecha === hoyStr
                      ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                      : 'border border-border/80 bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                  >
                    Hoy
                  </button>
                )}
                {fechasDisponibles.includes(addDaysToString(1)) && (
                  <button
                    type="button"
                    onClick={() => setFechaElegida(addDaysToString(1))}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${fecha === addDaysToString(1)
                      ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                      : 'border border-border/80 bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                  >
                    Mañana
                  </button>
                )}
                {fechasDisponibles.length > 0 && fecha !== fechasDisponibles[0] && (
                  <button
                    type="button"
                    onClick={() => setFechaElegida(fechasDisponibles[0])}
                    className="rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15 transition cursor-pointer"
                  >
                    Próxima disponible ({format(parseISO(fechasDisponibles[0]), 'd MMM', { locale: es })})
                  </button>
                )}
              </div>

              {/* Header del mes con botones prev/next */}
              <div className="flex items-center justify-between px-1 pt-1">
                <h4 className="text-xs sm:text-sm font-bold text-foreground capitalize flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {format(mesActual, 'MMMM yyyy', { locale: es })}
                </h4>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={irMesAnterior}
                    title="Mes anterior"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={irMesSiguiente}
                    title="Mes siguiente"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Cabecera de días de la semana */}
              <div className="grid grid-cols-7 gap-1 text-center text-xs sm:text-xs font-bold text-muted-foreground uppercase py-1 border-b border-border/40">
                <span>Lun</span>
                <span>Mar</span>
                <span>Mié</span>
                <span>Jue</span>
                <span>Vie</span>
                <span>Sáb</span>
                <span>Dom</span>
              </div>

              {/* Grilla de días */}
              <div className="grid grid-cols-7 gap-1">
                {diasMes.map(({ dateStr, diaNum, isCurrentMonth }) => {
                  const isAvailable = fechasDisponibles.includes(dateStr)
                  const isSelected = fecha === dateStr
                  const isToday = dateStr === hoyStr
                  const turnosCount = horariosPorFecha.get(dateStr) ?? 0

                  if (!isCurrentMonth) {
                    return (
                      <div
                        key={dateStr}
                        className="flex h-8 sm:h-9 items-center justify-center text-xs text-muted-foreground/20 font-normal select-none"
                      >
                        {diaNum}
                      </div>
                    )
                  }

                  return (
                    <button
                      key={dateStr}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => isAvailable && setFechaElegida(dateStr)}
                      className={`group relative flex h-8 sm:h-9 flex-col items-center justify-center rounded-xl text-xs font-semibold transition ${isSelected
                        ? 'bg-primary text-primary-foreground font-bold shadow-xs scale-102 ring-2 ring-primary/40 cursor-pointer'
                        : isAvailable
                          ? 'bg-primary/10 text-primary hover:bg-primary/20 hover:scale-102 active:scale-95 cursor-pointer font-bold border border-primary/20'
                          : 'text-muted-foreground/30 font-normal cursor-not-allowed bg-transparent'
                        }`}
                    >
                      <span>{diaNum}</span>
                      {isAvailable && !isSelected && turnosCount > 0 && (
                        <span className="h-1 w-1 rounded-full bg-primary/70 mt-0.5" />
                      )}
                      {isToday && !isSelected && (
                        <span className="absolute bottom-0.5 h-0.5 w-2.5 bg-primary rounded-full" />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Leyenda */}
              <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-lg bg-primary/20 border border-primary/40" />
                  Disponible
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-lg bg-primary" />
                  Seleccionada
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-lg bg-muted/40 border border-border/50" />
                  No disponible
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Horario o Itinerario de Combo */}
        <input type="hidden" name="hora" value={hora} />
        <input type="hidden" name="comboItinerarioJson" value={comboItinerarioJson} />

        {tipoItem === 'COMBO' && comboItems && comboItems.length > 0 ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-3">
            <input
              type="hidden"
              name="itinerarioComboJson"
              value={JSON.stringify(comboHorarios)}
            />

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-primary/15 pb-2">
              <div>
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Programación del Paquete
                </span>
                <p className="text-xs text-muted-foreground">
                  Elige si deseas realizar todo el mismo día o programar en fechas separadas.
                </p>
              </div>

              <div className="inline-flex rounded-lg border bg-background/80 p-0.5 text-xs font-semibold self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setModoComboFechas('MISMO_DIA')}
                  className={`rounded-lg px-2.5 py-1 transition text-xs ${modoComboFechas === 'MISMO_DIA'
                    ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  Mismo Día
                </button>
                <button
                  type="button"
                  onClick={() => setModoComboFechas('DIAS_DIFERENTES')}
                  className={`rounded-lg px-2.5 py-1 transition text-xs ${modoComboFechas === 'DIAS_DIFERENTES'
                    ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  Días Separados
                </button>
              </div>
            </div>

            {modoComboFechas === 'MISMO_DIA' ? (
              <div className="space-y-3">
<<<<<<< HEAD
                {/* Botones de horarios por actividad — solo si hay más de 1 combinación */}
                {combinacionesDisponibles.length > 1 && actividadesConHorarioEnCombo.length > 0 && (
=======
                {/* Pestañas de modo de selección de horario */}
                {combinacionesDisponibles.length > 0 && actividadesConHorarioEnCombo.length > 0 && (
                  <div className="flex items-center gap-1.5 border-b border-primary/15 pb-2">
                    <button
                      type="button"
                      onClick={() => setModoHorarioCombo('RECOMENDADOS')}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer ${modoHorarioCombo === 'RECOMENDADOS'
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Turnos Recomendados ({combinacionesDisponibles.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setModoHorarioCombo('PERSONALIZADO')}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer ${modoHorarioCombo === 'PERSONALIZADO'
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                    >
                      <Clock className="h-3.5 w-3.5" />
                      Personalizar por Actividad
                    </button>
                  </div>
                )}

                {modoHorarioCombo === 'RECOMENDADOS' && combinacionesDisponibles.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Selecciona una combinación de turnos coordinados para tu paquete:
                    </p>
                    <div className="space-y-2">
                      {combinacionesDisponibles.map((comb, idx) => {
                        const isSelected = idx === combinacionSeleccionadaIdx
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setComboHorarios(comb.horariosAsignados)}
                            className={`w-full text-left rounded-xl border p-3 transition flex flex-col gap-1.5 cursor-pointer ${isSelected
                              ? 'border-primary bg-primary/10 ring-2 ring-primary/60 shadow-xs'
                              : 'border-border/80 bg-background/90 hover:bg-muted/60'
                              }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-xs font-bold ${isSelected ? 'text-primary font-extrabold' : 'text-foreground'
                                    }`}
                                >
                                  {comb.nombre || `Opción ${idx + 1}`}
                                </span>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                {idx === 0 && (
                                  <span className="text-xs font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                                    Recomendado
                                  </span>
                                )}
                                <div className="flex items-center gap-1 text-xs font-mono font-semibold text-primary">
                                  <Clock className="h-3 w-3" />
                                  {formato12h(comb.horaInicio)} → {formato12h(comb.horaFin)} ({(comb.duracionTotalMin / 60).toFixed(1)}h)
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground font-medium">
                              {comb.resumenTexto}
                            </p>
                          </button>
                        )
                      })}
                    </div>

                    {pasesDiaEnCombo.length > 0 && (
                      <div className="rounded-lg border border-success/20 bg-success/5 p-2.5 text-xs text-success flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-success shrink-0" />
                        <span>
                          Incluye acceso libre todo el día para:{' '}
                          <strong>{pasesDiaEnCombo.map((p) => p.actividad.nombre).join(', ')}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
>>>>>>> origin/main
                  <div className="space-y-2.5">
                    <p className="text-[11px] text-muted-foreground">
                      Selecciona los turnos de cada actividad:
                    </p>
                    {comboItems.map((ci, actIdx) => {
                      const act = ci.actividad
                      const actId = act.id
                      const esPd = act.tipoItem === 'PASE_DIA'
                      const esHorarioFijo = Array.isArray(ci.horarioFijo) && ci.horarioFijo.length > 0
                      if (esPd) return null

                      const horariosAct = act.horarios || []
                      const slotsUnicos = esHorarioFijo
                        ? (ci.horarioFijo as string[]).map((h) => h.trim().slice(0, 5))
                        : Array.from(
                            new Set(horariosAct.map((h) => h.horaSalida.trim().slice(0, 5)))
                          ).sort((a, b) => minutosDesdeMedianoche(a) - minutosDesdeMedianoche(b))

                      const slots = slotsUnicos.length > 0
                        ? slotsUnicos
                        : [act.horaSalida || '09:00']

                      const validSet = horariosValidosPorActividad[actId]
                      const tieneOpciones = slots.length > 1 && !esHorarioFijo

                      return (
                        <div
                          key={actId}
                          className="rounded-lg border border-border/70 bg-background/80 p-2.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                                {actIdx + 1}
                              </span>
                              <span className="text-xs font-bold text-foreground">{act.nombre}</span>
                            </div>
<<<<<<< HEAD
                            <span className="font-mono text-[11px] font-semibold text-primary">
                              {formato12h(comboHorarios[actId] || act.horaSalida || '09:00')}
                              {act.duracionMin && (
                                <span className="text-[10px] font-normal text-muted-foreground ml-1">
                                  ({act.duracionMin}min)
                                </span>
=======
                            <span className="font-mono text-xs font-semibold text-primary">
                              {esPd ? (
                                <span className="text-success bg-success/10 px-2 py-0.5 rounded-full text-xs font-bold">
                                  Pase de Día (Acceso Libre)
                                </span>
                              ) : (
                                <>
                                  {formato12h(comboHorarios[actId] || act.horaSalida || '09:00')}
                                  {act.duracionMin && (
                                    <span className="text-xs font-normal text-muted-foreground ml-1">
                                      ({act.duracionMin}min)
                                    </span>
                                  )}
                                </>
>>>>>>> origin/main
                              )}
                            </span>
                          </div>

                          {tieneOpciones && (
                            <div className="flex flex-wrap gap-1.5 pl-7">
                              {slots.map((slot) => {
                                const isSelected = comboHorarios[actId] === slot
                                const esValido = !validSet || validSet.has(slot)
                                return (
                                  <button
                                    key={slot}
                                    type="button"
<<<<<<< HEAD
                                    disabled={!esValido}
                                    onClick={() => esValido && cambiarTurnoCombo(actId, slot)}
                                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${isSelected
                                      ? 'bg-primary text-primary-foreground shadow-xs cursor-pointer'
                                      : esValido
                                        ? 'border border-border/80 bg-muted/30 hover:bg-muted text-foreground cursor-pointer'
                                        : 'border border-border/40 bg-muted/10 text-muted-foreground/40 cursor-not-allowed line-through'
=======
                                    onClick={() => cambiarTurnoCombo(actId, slot)}
                                    className={`rounded-lg px-2 py-1 text-xs font-semibold transition cursor-pointer ${isSelected
                                      ? 'bg-primary text-primary-foreground shadow-xs'
                                      : 'border border-border/80 bg-muted/30 hover:bg-muted text-foreground'
>>>>>>> origin/main
                                      }`}
                                  >
                                    {formato12h(slot)}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {pasesDiaEnCombo.length > 0 && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs text-emerald-800 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span>
                          Incluye acceso libre todo el día para:{' '}
                          <strong>{pasesDiaEnCombo.map((p) => p.actividad.nombre).join(', ')}</strong>
                        </span>
                      </div>
                    )}

                    {/* Acciones rápidas */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={sugerirHorarioOptimo}
                        className="flex items-center gap-1 rounded-lg border border-primary/30 bg-background px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/10 transition shadow-2xs cursor-pointer"
                      >
                        <Wand2 className="h-3 w-3" />
                        Horario Óptimo
                      </button>
                    </div>
                  </div>
                )}

                {/* Sin combinaciones o solo 1: mostrar info del turno único */}
                {combinacionesDisponibles.length <= 1 && actividadesConHorarioEnCombo.length > 0 && (
                  <div className="space-y-2.5">
                    {combinacionesDisponibles.length === 1 && (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs text-primary flex items-center gap-2">
                        <Clock className="h-4 w-4 shrink-0" />
                        <span>
                          Turno único: <strong>{combinacionesDisponibles[0].resumenTexto}</strong>
                          {' '}({formato12h(combinacionesDisponibles[0].horaInicio)} → {formato12h(combinacionesDisponibles[0].horaFin)})
                        </span>
                      </div>
                    )}
                    {combinacionesDisponibles.length === 0 && (
                      <div className="space-y-2.5">
                        {comboItems.map((ci, actIdx) => {
                          const act = ci.actividad
                          const actId = act.id
                          const esPd = act.tipoItem === 'PASE_DIA'
                          const esHorarioFijo = Array.isArray(ci.horarioFijo) && ci.horarioFijo.length > 0
                          if (esPd) return null

                          return (
                            <div
                              key={actId}
                              className="rounded-lg border border-border/70 bg-background/80 p-2.5"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                                    {actIdx + 1}
                                  </span>
                                  <span className="text-xs font-bold text-foreground">{act.nombre}</span>
                                </div>
                                <span className="font-mono text-[11px] font-semibold text-primary">
                                  {formato12h(comboHorarios[actId] || act.horaSalida || '09:00')}
                                  {act.duracionMin && (
                                    <span className="text-[10px] font-normal text-muted-foreground ml-1">
                                      ({act.duracionMin}min)
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-xs text-muted-foreground">
                  Selecciona la fecha y turno independiente para cada actividad:
                </p>
                {comboItems.map((ci, actIdx) => {
                  const act = ci.actividad
                  const actId = act.id
                  const esPd = act.tipoItem === 'PASE_DIA'
                  const itemConfig = itinerarioMultiFecha[actId] || {
                    fecha: fecha || getTodayString(),
                    hora: act.horaSalida || '09:00',
                  }
                  const slots = act.horarios && act.horarios.length > 0
                    ? Array.from(new Set(act.horarios.map((h) => h.horaSalida.trim().slice(0, 5))))
                    : [act.horaSalida || '09:00']

                  return (
                    <div
                      key={actId}
                      className="rounded-lg border border-border/70 bg-background/80 p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                            {actIdx + 1}
                          </span>
                          <span className="text-xs font-bold text-foreground">{act.nombre}</span>
                        </div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${esPd ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                          }`}>
                          {esPd ? 'Daypass' : 'Actividad'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-7">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground block mb-0.5">Fecha</label>
                          <input
                            type="date"
                            /* La etiqueta de arriba no está atada a nada: es un
                               <label> suelto, y hay uno igual por cada actividad
                               del itinerario. Quien navega con lector de pantalla
                               oía «cuadro de edición» tantas veces como
                               actividades hubiera, sin saber cuál era cuál. */
                            aria-label={`Fecha de ${act.nombre}`}
                            min={getTodayString()}
                            value={itemConfig.fecha}
                            onChange={(e) => {
                              const val = e.target.value
                              setItinerarioMultiFecha((prev) => ({
                                ...prev,
                                [actId]: { ...prev[actId], fecha: val },
                              }))
                            }}
                            className="h-8 w-full rounded border bg-background px-2 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground block mb-0.5">Turno</label>
                          {esPd ? (
                            <div className="h-8 rounded border border-dashed border-success/30 bg-success/5 px-2 flex items-center text-xs text-success">
                              Acceso libre todo el día
                            </div>
                          ) : (
                            <select
                              aria-label={`Turno de ${act.nombre}`}
                              value={itemConfig.hora}
                              onChange={(e) => {
                                const val = e.target.value
                                setItinerarioMultiFecha((prev) => ({
                                  ...prev,
                                  [actId]: { ...prev[actId], hora: val },
                                }))
                              }}
                              className="h-8 w-full rounded border bg-background px-2 text-xs"
                            >
                              {slots.map((s) => (
                                <option key={s} value={s}>
                                  {formato12h(s)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Resumen visual del itinerario del combo */}
            <div className="rounded-lg border border-border/70 bg-background/80 p-2.5 text-xs space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Itinerario Confirmado para tu Reserva:
              </span>

              {itinerarioComboRes.ok ? (
                <div className="space-y-1">
                  {itinerarioComboRes.itinerario.map((bloque, idx) => (
                    <div
                      key={bloque.id || idx}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
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
                <div className="flex items-start gap-1.5 text-destructive text-xs font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{itinerarioComboRes.error}</span>
                </div>
              )}
            </div>
          </div>
        ) : tipoItem === 'PASE_DIA' ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <span>Pase de Día — Acceso libre válido durante toda la fecha reservada (sin horario fijo).</span>
          </div>
        ) : horariosDisponibles.length > 0 || horarios.length > 0 ? (
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-foreground">
              <Clock className="mr-1.5 inline h-4 w-4 text-primary" />
              Hora de salida
            </label>

            {/* Horarios configurados del catálogo */}
            {horarios.length > 0 && (
              <div className="mb-2">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Horarios disponibles
                </p>
                <div className="flex flex-wrap gap-2">
                  {horarios.map((h) => {
                    const horaVal = h.horaSalida.trim().slice(0, 5)
                    // Check if this horario has availability on the selected date
                    const salida = horariosDisponibles.find((s) => s.horaSalida === horaVal)
                    const cupo = salida?.cupoDisponible ?? 0
                    const agotada = salida?.agotada ?? false
                    const esActiva = hora === horaVal && !usarHoraPersonalizada

                    // Check which days this horario operates
                    const diasLabels = h.diasSemana
                      .map((d) => ['L', 'M', 'X', 'J', 'V', 'S', 'D'][d - 1] ?? d)
                      .join(' ')

                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => {
                          if (!agotada) {
                            setHoraElegida(horaVal)
                            setUsarHoraPersonalizada(false)
                          }
                        }}
                        disabled={agotada && !!salida}
                        className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${esActiva
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : agotada && !!salida
                            ? 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed border-border/40'
                            : 'bg-background hover:bg-muted border-border/80'
                          }`}
                      >
                        {formato12h(horaVal)}
                        {salida && !agotada && cupo > 0 && (
                          <span className="ml-1.5 text-xs opacity-80">({cupo})</span>
                        )}
                        {agotada && !!salida && <X className="ml-1.5 h-3 w-3 inline" />}
                        <span className="ml-1.5 text-xs opacity-60 font-normal">{diasLabels}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Opción de personalizar hora */}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {
                  setUsarHoraPersonalizada(!usarHoraPersonalizada)
                  if (!usarHoraPersonalizada && horaPersonalizada) {
                    setHoraElegida('')
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition"
              >
                <Clock className="h-3 w-3" />
                {usarHoraPersonalizada ? 'Usar horario del catálogo' : 'Personalizar hora de salida'}
              </button>

              {usarHoraPersonalizada && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="time"
                    value={horaPersonalizada}
                    onChange={(e) => {
                      setHoraPersonalizada(e.target.value)
                      setHoraElegida('')
                    }}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
                  />
                  {horaPersonalizada && (
                    <span className="text-xs text-muted-foreground">
                      Salida a las {formato12h(horaPersonalizada)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {horariosDisponibles.length > 0 && horariosDisponibles.every((h) => h.agotada) && (
              <p className="mt-1.5 text-xs text-destructive font-semibold">
                Todos los horarios están completos para esta fecha
              </p>
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
                  aria-label="Quitar un adulto"
                  className="flex h-8 w-8 items-center justify-center rounded-full border bg-background hover:bg-muted"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-sm font-medium">{adultos}</span>
                <button
                  type="button"
                  onClick={() => setAdultos(adultos + 1)}
                  aria-label="Añadir un adulto"
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
                  aria-label="Quitar un niño"
                  className="flex h-8 w-8 items-center justify-center rounded-full border bg-background hover:bg-muted"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-sm font-medium">{ninos}</span>
                <button
                  type="button"
                  onClick={() => setNinos(ninos + 1)}
                  aria-label="Añadir un niño"
                  className="flex h-8 w-8 items-center justify-center rounded-full border bg-background hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <input type="hidden" name="ninos" value={ninos} />
          </div>
        </div>

<<<<<<< HEAD
=======
        {/* Selector de Modalidad de Pago */}
        <div className="space-y-2 pt-1">
          <label className="block text-sm font-medium">¿Cómo deseas pagar?</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMetodoPago('DESTINO')}
              className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition ${metodoPago === 'DESTINO'
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border bg-card hover:bg-muted/50'
                }`}
            >
              <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                <Banknote className="h-4 w-4 text-success" />
                <span>Pagar el día del tour</span>
              </div>
              <span className="text-xs text-muted-foreground leading-tight">
                Pagas en el punto de encuentro al momento de abordar.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMetodoPago('ONLINE_SIMULADO')}
              className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition relative ${metodoPago === 'ONLINE_SIMULADO'
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border bg-card hover:bg-muted/50'
                }`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <CreditCard className="h-4 w-4 text-primary" />
                <span>Pagar ahora en línea</span>
                <span className="text-xs bg-warning/15 text-warning px-1.5 py-0.2 rounded-full font-bold">
                  Prueba
                </span>
              </div>
              <span className="text-xs text-muted-foreground leading-tight">
                Tarjeta crédito/débito • Acceso y boleto de inmediato.
              </span>
            </button>
          </div>
        </div>

>>>>>>> origin/main
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
              <span className="text-h2 font-black text-primary font-mono">
                {formatMoney(subtotal, { moneda })}
              </span>
<<<<<<< HEAD
              <p className="text-[10px] text-muted-foreground">
                Elige tu método de pago en el checkout
=======
              <p className="text-xs text-muted-foreground">
                {metodoPago === 'ONLINE_SIMULADO' ? 'Pago inmediato online' : 'Pago presencial al abordar'}
>>>>>>> origin/main
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
              if (!fecha || (tipoItem !== 'PASE_DIA' && !hora)) return
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
                moneda })
              if (!isAuthenticated) {
                router.push(`/login?redirect=${encodeURIComponent('/checkout')}`)
              }
            }}
            disabled={pending || followingPending || !fecha || (tipoItem !== 'PASE_DIA' && !hora) || (!usarHoraPersonalizada && horariosDisponibles.every((h) => h.agotada))}
            className="flex items-center justify-center gap-2 w-full rounded-lg border-2 border-primary bg-background py-3 text-sm font-semibold text-primary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShoppingCart className="h-4 w-4" />
            Agregar al carrito
          </button>

          <button
            type="button"
            onClick={() => {
              if (!fecha || (tipoItem !== 'PASE_DIA' && !hora)) return
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
                moneda })
              router.push(isAuthenticated ? '/checkout' : `/login?redirect=${encodeURIComponent('/checkout')}`)
            }}
            disabled={pending || followingPending || !fecha || (tipoItem !== 'PASE_DIA' && !hora) || (!usarHoraPersonalizada && horariosDisponibles.every((h) => h.agotada))}
            className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {followingPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparando...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Reservar ahora
              </span>
            )}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Selecciona tu método de pago al confirmar en el checkout.
        </p>
      </form>
    </div>
  )
}