'use client'

/**
 * EXCURSIONES · Formulario de Alta de Reserva (Panel Administración).
 *
 * Inspirado en el flujo ágil y visual del vendedor:
 * 1. Selección visual con búsqueda de excursión o paquete.
 * 2. Horarios inteligentes con turnos recomendados para combos o multi-fecha.
 * 3. Selección de fecha con atajos rápidos y contadores táctiles de pasajeros.
 * 4. Gestión de clientes: nuevo cliente (con auto-aprovisionamiento y vinculación
 *    de cuenta global) o cliente existente.
 * 5. Asignación opcional de vendedor/agente comercial, canal y descuento.
 * 6. Logística de hotel y voucher de agencia (colapsable).
 * 7. Resumen financiero en tiempo real y garantía de cupos en BD.
 */

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Loader2,
  Calendar as CalendarIcon,
  Clock,
  User,
  Mail,
  Phone,
  MapPin,
  Building2,
  Ticket,
  BedDouble,
  Search,
  Check,
  Sparkles,
  ShieldCheck,
  Info,
  BadgePercent,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  crearReserva,
  type ReservaActionState,
} from '@/modules/excursiones/reservas/actions'
import {
  calcularTotales,
  calcularPrecioEfectivo,
  generarCombinacionesCombo,
  type ReglaPrecioDinamico,
} from '@/modules/excursiones/reservas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatMoney } from '@/lib/format'

const init: ReservaActionState = {}

export interface ExcursionOpcion {
  id: string
  nombre: string
  portadaUrl?: string | null
  duracionMin?: number | null
  categoria?: string | null
  tipoItem?: string
  ubicacion?: string | null
  moneda: string
  impuestoPct: number | null
  comboItems?: {
    id: string
    nombre: string
    tipoItem?: string
    duracionMin: number | null
    horaSalida?: string | null
    permitirSolapamiento?: boolean
    horarioFijo?: unknown
    horarios: { id: string; horaSalida: string; diasSemana: number[] }[]
  }[]
  variantes: {
    id: string
    nombre: string
    precioAdulto: number
    precioNino: number | null
    preciosDinamicos?: ReglaPrecioDinamico[]
  }[]
  horarios: { id: string; horaSalida: string; diasSemana: number[] }[]
}

export interface ClienteOpcion {
  id: string
  nombre: string
  email?: string | null
  telefono?: string | null
}

export interface VendedorOpcion {
  id: string
  nombre: string
  apellido?: string | null
  codigo: string
  tipo?: string | null
  estado?: string
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

export function ReservaForm({
  excursiones,
  clientes = [],
  vendedores = [],
  // `companyId` llega por props y este formulario no lo usa: la empresa la
  // resuelve el servidor en la acción, que es donde tiene que resolverse.
}: {
  excursiones: ExcursionOpcion[]
  clientes?: ClienteOpcion[]
  vendedores?: VendedorOpcion[]
  companyId?: string
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearReserva, init)

  // Estado del formulario
  const [busqueda, setBusqueda] = useState('')
  const [excursionId, setExcursionId] = useState(excursiones[0]?.id ?? '')
  const [varianteId, setVarianteId] = useState(excursiones[0]?.variantes[0]?.id ?? '')
  const [hora, setHora] = useState(excursiones[0]?.horarios?.[0]?.horaSalida ?? '')
  const [fecha, setFecha] = useState(getTodayString())
  const [adultos, setAdultos] = useState(2)
  const [ninos, setNinos] = useState(0)
  const [descuento, setDescuento] = useState('')

  // Asignación de Vendedor y Canal
  const [vendedorId, setVendedorId] = useState('')
  const [canal, setCanal] = useState('MOSTRADOR')

  // Configuración específica de combos
  const [modoComboFechas, setModoComboFechas] = useState<'MISMO_DIA' | 'DIAS_DIFERENTES'>('MISMO_DIA')
  const [comboTurnoSeleccionado, setComboTurnoSeleccionado] = useState<string>('')
  const [itinerarioMultiFecha, setItinerarioMultiFecha] = useState<Record<string, { fecha: string; hora: string }>>({})

  // Datos del cliente
  const [modoCliente, setModoCliente] = useState<'NUEVO' | 'EXISTENTE'>(clientes.length > 0 ? 'EXISTENTE' : 'NUEVO')
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? '')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')

  // Logística de agencia & recogida
  const [mostrarLogistica, setMostrarLogistica] = useState(false)
  const [voucherAgencia, setVoucherAgencia] = useState('')
  const [hotelRecogida, setHotelRecogida] = useState('')
  const [lobbyRecogida, setLobbyRecogida] = useState('')
  const [horaRecogida, setHoraRecogida] = useState('')
  const [habitacion, setHabitacion] = useState('')
  const [notas, setNotas] = useState('')

  const excursion = useMemo(
    () => excursiones.find((e) => e.id === excursionId) ?? excursiones[0],
    [excursiones, excursionId]
  )

  const variante = useMemo(
    () => excursion?.variantes.find((v) => v.id === varianteId) ?? excursion?.variantes[0],
    [excursion, varianteId]
  )

  const esCombo = excursion?.tipoItem === 'COMBO' && Boolean(excursion?.comboItems && excursion.comboItems.length > 0)

  const combinacionesCombo = useMemo(() => {
    if (!esCombo || !excursion?.comboItems) return []
    return generarCombinacionesCombo(
      excursion.comboItems.map((ci) => ({
        id: ci.id,
        nombre: ci.nombre,
        tipoItem: ci.tipoItem,
        duracionMin: ci.duracionMin,
        horaSalida: ci.horaSalida,
        horarios: ci.horarios || [],
        permitirSolapamiento: ci.permitirSolapamiento,
        horarioFijo: Array.isArray(ci.horarioFijo) ? (ci.horarioFijo as string[]) : null,
      }))
    )
  }, [esCombo, excursion])

  /**
   * AJUSTES EN RENDER, NO EN EFECTOS.
   *
   * Los tres bloques de abajo hacen lo mismo que hacían tres `useEffect`:
   * cuando la excursión cambia y la variante, el turno o la hora que había
   * elegidos ya no existen en la nueva, se cae al primero disponible.
   *
   * Hacerlo en un efecto costaba un render pintado con un valor inválido —el
   * precio de una variante que ya no está— antes de corregirlo. React
   * documenta el ajuste durante el render justo para esto, y aquí converge
   * solo: en cuanto el valor pertenece a la lista, la condición es falsa.
   *
   * Se mantienen las condiciones exactas que tenían los efectos. Uno de ellos
   * llevaba además un `eslint-disable` con un motivo que ya no describía nada
   * («reacciona al resultado async de la acción»): esto no reacciona a ninguna
   * acción, ajusta estado derivado de props.
   */
  if (
    esCombo &&
    combinacionesCombo.length > 0 &&
    (!comboTurnoSeleccionado || !combinacionesCombo.some((c) => c.id === comboTurnoSeleccionado))
  ) {
    setComboTurnoSeleccionado(combinacionesCombo[0].id)
    setHora(combinacionesCombo[0].horaInicio)
  }
  if (excursion && !excursion.variantes.find((v) => v.id === varianteId)) {
    setVarianteId(excursion.variantes[0]?.id ?? '')
  }
  if (excursion && !excursion.horarios?.find((h) => h.horaSalida === hora)) {
    setHora(excursion.horarios?.[0]?.horaSalida ?? '')
  }

  /**
   * El itinerario del combo se rearma cuando cambia la fecha o el combo.
   *
   * El efecto anterior dependía del OBJETO `excursion`: bastaba con que el
   * padre volviera a renderizar con una referencia nueva para que se borrara
   * lo que el cliente hubiera elegido día por día. La clave por identidad
   * —ids de los items más la fecha— solo cambia cuando cambió algo de verdad.
   */
  const claveItinerario =
    esCombo && excursion?.comboItems
      ? `${fecha}|${excursion.comboItems.map((ci) => ci.id).join(',')}`
      : null
  const [itinerarioArmadoPara, setItinerarioArmadoPara] = useState<string | null>(null)
  if (claveItinerario && claveItinerario !== itinerarioArmadoPara) {
    setItinerarioArmadoPara(claveItinerario)
    const initial: Record<string, { fecha: string; hora: string }> = {}
    excursion!.comboItems!.forEach((ci) => {
      initial[ci.id] = {
        fecha,
        hora: ci.tipoItem === 'PASE_DIA' ? '' : ci.horaSalida || '09:00',
      }
    })
    setItinerarioMultiFecha(initial)
  }

  // Serializar itinerario combo para FormData
  const comboItinerarioJson = useMemo(() => {
    if (!esCombo || !excursion?.comboItems) return ''
    if (modoComboFechas === 'DIAS_DIFERENTES') {
      return JSON.stringify(
        excursion.comboItems.map((ci) => {
          const cfg = itinerarioMultiFecha[ci.id] || { fecha, hora: ci.horaSalida }
          return {
            actividadId: ci.id,
            fecha: cfg.fecha,
            hora: ci.tipoItem === 'PASE_DIA' ? null : cfg.hora,
          }
        })
      )
    } else {
      const turno = combinacionesCombo.find((c) => c.id === comboTurnoSeleccionado) || combinacionesCombo[0]
      return JSON.stringify(
        excursion.comboItems.map((ci) => ({
          actividadId: ci.id,
          fecha,
          hora: ci.tipoItem === 'PASE_DIA' ? null : turno?.horariosAsignados[ci.id] || ci.horaSalida || '09:00',
        }))
      )
    }
  }, [esCombo, excursion, modoComboFechas, itinerarioMultiFecha, fecha, combinacionesCombo, comboTurnoSeleccionado])

  // Redirección y Toast de feedback
  useEffect(() => {
    if (state.creada) {
      toast.success(state.success ?? 'Reserva creada con éxito.')
      router.push(`/admin/excursiones/reservas/${state.creada.reservaId}`)
      router.refresh()
    }
  }, [state, router])

  // Excursiones filtradas por búsqueda
  const excursionesFiltradas = useMemo(() => {
    if (!busqueda.trim()) return excursiones
    const q = busqueda.toLowerCase().trim()
    return excursiones.filter(
      (e) =>
        e.nombre.toLowerCase().includes(q) ||
        (e.categoria && e.categoria.toLowerCase().includes(q)) ||
        (e.ubicacion && e.ubicacion.toLowerCase().includes(q))
    )
  }, [excursiones, busqueda])

  const totales = useMemo(() => {
    if (!variante || !excursion) return null
    const fechaObj = fecha ? new Date(`${fecha}T12:00:00.000Z`) : new Date()
    const reglas = variante.preciosDinamicos ?? null
    const { precioAdulto, precioNino } = calcularPrecioEfectivo(fechaObj, hora, variante.precioAdulto, variante.precioNino, reglas)

    const calc = calcularTotales({
      precioAdulto,
      precioNino,
      impuestoPct: excursion.impuestoPct ?? 0,
      adultos: adultos || 0,
      ninos: ninos || 0,
      descuento: Number(descuento) || 0,
    })

    return {
      ...calc,
      precioAdulto,
      precioNino,
    }
  }, [variante, excursion, adultos, ninos, descuento, fecha, hora])

  // Handler para seleccionar cliente existente
  const handleSeleccionarClienteExistente = (cId: string) => {
    setClienteId(cId)
    const c = clientes.find((x) => x.id === cId)
    if (c) {
      setClienteNombre(c.nombre)
      setClienteEmail(c.email || '')
      setClienteTelefono(c.telefono || '')
    }
  }

  if (excursiones.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Para crear una reserva hace falta al menos una excursión activa con una variante con precio.
          Créala en el catálogo de excursiones y vuelve aquí.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={formAction} className="space-y-6 w-full min-w-0 max-w-full">
      {/* Campos ocultos requeridos para la acción */}
      <input type="hidden" name="excursionId" value={excursionId} />
      <input type="hidden" name="varianteId" value={varianteId} />
      <input type="hidden" name="hora" value={hora} />
      <input type="hidden" name="adultos" value={adultos} />
      <input type="hidden" name="ninos" value={ninos} />
      <input type="hidden" name="comboItinerarioJson" value={comboItinerarioJson} />

      {modoCliente === 'EXISTENTE' ? (
        <input type="hidden" name="clienteId" value={clienteId} />
      ) : (
        <>
          <input type="hidden" name="clienteNombre" value={clienteNombre} />
          <input type="hidden" name="clienteEmail" value={clienteEmail} />
          <input type="hidden" name="clienteTelefono" value={clienteTelefono} />
        </>
      )}

      {vendedorId && <input type="hidden" name="vendedorId" value={vendedorId} />}
      <input type="hidden" name="canal" value={canal} />
      <input type="hidden" name="descuento" value={descuento || '0'} />

      {/* Logística de agencia oculta */}
      <input type="hidden" name="voucherAgencia" value={voucherAgencia} />
      <input type="hidden" name="hotelRecogida" value={hotelRecogida} />
      <input type="hidden" name="lobbyRecogida" value={lobbyRecogida} />
      <input type="hidden" name="horaRecogida" value={horaRecogida} />
      <input type="hidden" name="habitacion" value={habitacion} />
      <input type="hidden" name="notas" value={notas} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 w-full min-w-0">
        {/* COLUMNA PRINCIPAL (PASOS 1 A 6) */}
        <div className="space-y-6 lg:col-span-2 w-full min-w-0">
          
          {/* PASO 1: SELECCIÓN DE EXCURSIÓN O COMBO */}
          <section aria-labelledby="paso-excursion" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border/60 pb-3 w-full min-w-0">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Paso 1</span>
                <h2 id="paso-excursion" className="text-base sm:text-lg font-bold text-foreground truncate">
                  Selecciona la excursión o paquete
                </h2>
              </div>
              <span className="text-xs text-muted-foreground font-medium">
                {excursionesFiltradas.length} disponibles
              </span>
            </div>

            {/* Barra de búsqueda de actividades */}
            <div className="relative w-full min-w-0">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, categoría o ubicación..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="pl-9 h-11 text-xs sm:text-sm bg-background w-full"
              />
              {busqueda && (
                <button
                  type="button"
                  onClick={() => setBusqueda('')}
                  className="absolute right-3 top-3 text-xs text-muted-foreground hover:text-foreground"
                >
                  Limpiar
                </button>
              )}
            </div>

            {/* Grid de Tarjetas de Excursiones */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 max-h-[360px] overflow-y-auto pr-1 w-full min-w-0">
              {excursionesFiltradas.map((e) => {
                const isSelected = e.id === excursionId
                const minPrecio = Math.min(...e.variantes.map((v) => v.precioAdulto))
                const esC = e.tipoItem === 'COMBO'
                const esP = e.tipoItem === 'PASE_DIA'

                return (
                  <button
                    type="button"
                    key={e.id}
                    onClick={() => {
                      setExcursionId(e.id)
                      setVarianteId(e.variantes[0]?.id ?? '')
                      setHora(e.horarios?.[0]?.horaSalida ?? '')
                    }}
                    className={`group relative flex flex-col rounded-xl border p-3 text-left transition-all w-full min-w-0 active:scale-[0.98] ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm'
                        : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30'
                    }`}
                  >
                    {/* Imagen miniatura */}
                    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted mb-2.5">
                      {e.portadaUrl ? (
                        <Image
                          src={e.portadaUrl}
                          alt={e.nombre}
                          fill
                          className="object-cover transition group-hover:scale-105"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground/40 font-medium text-xs">
                          Sin imagen
                        </div>
                      )}

                      {/* Badge de tipo */}
                      <span
                        className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold shadow-xs ${
                          esC
                            ? 'bg-warning text-white'
                            : esP
                            ? 'bg-success text-white'
                            : 'bg-primary text-primary-foreground'
                        }`}
                      >
                        {esC ? 'Combo' : esP ? 'Daypass' : 'Actividad'}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col justify-between w-full min-w-0 space-y-2">
                      <div className="w-full min-w-0">
                        <p className="font-bold text-xs sm:text-sm text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                          {e.nombre}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 truncate">
                          {e.duracionMin && (
                            <span className="flex items-center gap-0.5 shrink-0">
                              <Clock className="h-3 w-3" />
                              {e.duracionMin}m
                            </span>
                          )}
                          {e.ubicacion && (
                            <span className="flex items-center gap-0.5 truncate">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {e.ubicacion}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/50 pt-2 text-xs w-full min-w-0">
                        <span className="text-xs text-muted-foreground">Desde</span>
                        <span className="font-mono font-bold text-primary truncate">
                          {formatMoney(minPrecio, { moneda: e.moneda })}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* PASO 2: MODALIDAD, TARIFAS & HORARIOS */}
          <section aria-labelledby="paso-modalidad" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="border-b border-border/60 pb-3 w-full min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Paso 2</span>
              <h2 id="paso-modalidad" className="text-base sm:text-lg font-bold text-foreground truncate">
                Modalidad, tarifas y turnos
              </h2>
            </div>

            {/* Opciones de tarifa / Variantes */}
            <div className="space-y-2 w-full min-w-0">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Opciones de tarifa
              </Label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 w-full min-w-0">
                {excursion?.variantes.map((v) => {
                  const isSelected = v.id === varianteId
                  return (
                    <button
                      type="button"
                      key={v.id}
                      onClick={() => setVarianteId(v.id)}
                      className={`flex flex-col text-left rounded-xl border p-3.5 transition-all w-full min-w-0 active:scale-[0.99] ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm'
                          : 'border-border bg-card hover:border-primary/40'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full min-w-0">
                        <span className="font-bold text-xs sm:text-sm text-foreground truncate">{v.nombre}</span>
                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0 ml-1" />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-2 text-xs">
                        <span className="font-mono font-bold text-primary">
                          {formatMoney(v.precioAdulto, { moneda: excursion.moneda })} <span className="text-xs font-normal text-muted-foreground">/adulto</span>
                        </span>
                        {v.precioNino != null && (
                          <span className="font-mono text-muted-foreground text-xs">
                            • {formatMoney(v.precioNino, { moneda: excursion.moneda })} <span className="text-xs">/niño</span>
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Selector de Horarios o Combos */}
            <div className="space-y-2.5 pt-2 border-t border-border/60 w-full min-w-0">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                {esCombo ? 'Programación del Paquete Combo' : 'Turno / Hora de Salida'}
              </Label>

              {esCombo ? (
                <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4 w-full min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-primary/15 pb-3 w-full min-w-0">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-foreground flex items-center gap-1.5 truncate">
                        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                        Modalidad de Fechas
                      </span>
                      <p className="text-xs text-muted-foreground truncate">
                        ¿El cliente realizará las actividades el mismo día o en fechas separadas?
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border bg-background p-0.5 text-xs font-semibold shrink-0">
                      <button
                        type="button"
                        onClick={() => setModoComboFechas('MISMO_DIA')}
                        className={`rounded-lg px-3 py-1.5 transition ${
                          modoComboFechas === 'MISMO_DIA'
                            ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Mismo Día
                      </button>
                      <button
                        type="button"
                        onClick={() => setModoComboFechas('DIAS_DIFERENTES')}
                        className={`rounded-lg px-3 py-1.5 transition ${
                          modoComboFechas === 'DIAS_DIFERENTES'
                            ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Días Separados
                      </button>
                    </div>
                  </div>

                  {modoComboFechas === 'MISMO_DIA' ? (
                    <div className="space-y-2.5 w-full min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Turnos coordinados sin solapamiento horario para el paquete:
                      </p>
                      <div className="grid grid-cols-1 gap-2.5 w-full min-w-0">
                        {combinacionesCombo.map((comb, idx) => {
                          const isSel = comb.id === comboTurnoSeleccionado
                          return (
                            <button
                              type="button"
                              key={comb.id}
                              onClick={() => {
                                setComboTurnoSeleccionado(comb.id)
                                setHora(comb.horaInicio)
                              }}
                              className={`flex flex-col text-left rounded-xl border p-3.5 transition-all w-full min-w-0 active:scale-[0.99] ${
                                isSel
                                  ? 'border-primary bg-primary/10 ring-2 ring-primary/60 shadow-xs'
                                  : 'border-border bg-card hover:border-primary/40'
                              }`}
                            >
                              <div className="flex items-center justify-between w-full min-w-0">
                                <span className={`font-bold text-xs sm:text-sm flex items-center gap-1.5 truncate ${isSel ? 'text-primary font-extrabold' : 'text-foreground'}`}>
                                  <Clock className="h-4 w-4 text-primary shrink-0" />
                                  {comb.nombre}
                                  {idx === 0 && (
                                    <span className="text-xs font-bold bg-primary text-primary-foreground px-1.5 py-0.2 rounded-full ml-1">
                                      Recomendado
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono text-xs font-semibold text-primary shrink-0">
                                  {comb.horaInicio} → {comb.horaFin} ({(comb.duracionTotalMin / 60).toFixed(1)}h)
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed font-medium">
                                {comb.resumenTexto}
                              </p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 w-full min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Configura la fecha y el turno de cada actividad o Daypass:
                      </p>
                      <div className="space-y-3 w-full min-w-0">
                        {excursion.comboItems?.map((ci) => {
                          const esPd = ci.tipoItem === 'PASE_DIA'
                          const itemConfig = itinerarioMultiFecha[ci.id] || {
                            fecha,
                            hora: ci.horaSalida || '09:00',
                          }
                          return (
                            <div
                              key={ci.id}
                              className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-2.5 w-full min-w-0"
                            >
                              <div className="flex items-center justify-between gap-2 w-full min-w-0">
                                <span className="text-sm font-bold text-foreground truncate">
                                  {ci.nombre}
                                </span>
                                <span
                                  className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                                    esPd
                                      ? 'bg-success/10 text-success border border-success/20'
                                      : 'bg-primary/10 text-primary border border-primary/20'
                                  }`}
                                >
                                  {esPd ? 'Daypass (Acceso Libre)' : 'Actividad'}
                                </span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full min-w-0">
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground font-semibold">
                                    Fecha
                                  </Label>
                                  <Input
                                    type="date"
                                    min={getTodayString()}
                                    value={itemConfig.fecha}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      setItinerarioMultiFecha((prev) => ({
                                        ...prev,
                                        [ci.id]: { ...prev[ci.id], fecha: val },
                                      }))
                                    }}
                                    className="h-10 text-xs bg-background w-full"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground font-semibold">
                                    Turno / Salida
                                  </Label>
                                  {esPd ? (
                                    <div className="h-10 rounded-lg border border-dashed border-success/30 bg-success/5 px-3 flex items-center text-xs font-medium text-success">
                                      Acceso libre todo el día
                                    </div>
                                  ) : (
                                    <select
                                      value={itemConfig.hora}
                                      onChange={(e) => {
                                        const val = e.target.value
                                        setItinerarioMultiFecha((prev) => ({
                                          ...prev,
                                          [ci.id]: { ...prev[ci.id], hora: val },
                                        }))
                                      }}
                                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs font-medium"
                                    >
                                      {ci.horarios && ci.horarios.length > 0 ? (
                                        ci.horarios.map((h) => (
                                          <option key={h.id} value={h.horaSalida}>
                                            {h.horaSalida}
                                          </option>
                                        ))
                                      ) : (
                                        <option value={ci.horaSalida || '09:00'}>
                                          {ci.horaSalida || '09:00'}
                                        </option>
                                      )}
                                    </select>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : excursion?.tipoItem === 'PASE_DIA' ? (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  <span>Pase de Día — Acceso libre válido durante toda la fecha reservada (sin turno rígido).</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 w-full min-w-0">
                  {excursion?.horarios && excursion.horarios.length > 0 ? (
                    excursion.horarios.map((h) => {
                      const isSelected = h.horaSalida === hora
                      return (
                        <button
                          type="button"
                          key={h.id}
                          onClick={() => setHora(h.horaSalida)}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 min-h-[44px] text-xs font-bold transition-all active:scale-95 ${
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30'
                              : 'border-border bg-background text-foreground hover:bg-muted'
                          }`}
                        >
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          {h.horaSalida}
                        </button>
                      )
                    })
                  ) : (
                    <p className="text-xs text-muted-foreground">Esta excursión no requiere selección de turno cerrado.</p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* PASO 3: FECHA & PASAJEROS */}
          <section aria-labelledby="paso-fecha-pasajeros" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="border-b border-border/60 pb-3 w-full min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Paso 3</span>
              <h2 id="paso-fecha-pasajeros" className="text-base sm:text-lg font-bold text-foreground truncate">
                Fecha & Pasajeros
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 w-full min-w-0">
              {/* Selección de Fecha */}
              {esCombo && modoComboFechas === 'DIAS_DIFERENTES' ? (
                <div className="space-y-3 w-full min-w-0">
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                    Fechas Programadas (Multi-Fecha)
                  </Label>
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-2 text-xs w-full min-w-0">
                    {excursion.comboItems?.map((ci) => {
                      const itemConfig = itinerarioMultiFecha[ci.id] || { fecha, hora: ci.horaSalida }
                      return (
                        <div key={ci.id} className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground truncate">{ci.nombre}:</span>
                          <span className="font-mono font-bold text-primary shrink-0">
                            {itemConfig.fecha}{' '}
                            {ci.tipoItem === 'PASE_DIA'
                              ? '(Acceso Libre)'
                              : itemConfig.hora
                              ? `(${itemConfig.hora})`
                              : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 w-full min-w-0">
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                    Fecha del Tour
                  </Label>
                  <div className="relative w-full min-w-0">
                    <CalendarIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="date"
                      min={getTodayString()}
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      className="pl-9 h-12 text-sm font-semibold bg-background w-full"
                      required
                    />
                  </div>

                  {/* Atajos Rápidos */}
                  <div className="flex flex-wrap gap-2 w-full min-w-0">
                    <button
                      type="button"
                      onClick={() => setFecha(getTodayString())}
                      className={`rounded-lg border px-3 py-2 min-h-[40px] text-xs font-medium transition active:scale-95 ${
                        fecha === getTodayString()
                          ? 'border-primary bg-primary/10 text-primary font-bold'
                          : 'border-border bg-background hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      Hoy
                    </button>
                    <button
                      type="button"
                      onClick={() => setFecha(addDaysToString(1))}
                      className={`rounded-lg border px-3 py-2 min-h-[40px] text-xs font-medium transition active:scale-95 ${
                        fecha === addDaysToString(1)
                          ? 'border-primary bg-primary/10 text-primary font-bold'
                          : 'border-border bg-background hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      Mañana
                    </button>
                    <button
                      type="button"
                      onClick={() => setFecha(addDaysToString(2))}
                      className={`rounded-lg border px-3 py-2 min-h-[40px] text-xs font-medium transition active:scale-95 ${
                        fecha === addDaysToString(2)
                          ? 'border-primary bg-primary/10 text-primary font-bold'
                          : 'border-border bg-background hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      Pasado mañana
                    </button>
                  </div>
                </div>
              )}

              {/* Contadores Táctiles de Pasajeros */}
              <div className="space-y-3 w-full min-w-0">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Cantidad de Pasajeros
                </Label>
                <div className="space-y-2.5 w-full min-w-0">
                  {/* Adultos */}
                  <div className="flex items-center justify-between rounded-xl border border-border bg-background p-3 sm:px-4 min-h-[56px] w-full min-w-0">
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="text-sm font-bold text-foreground block truncate">Adultos</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {variante ? formatMoney(variante.precioAdulto, { moneda: excursion.moneda }) : ''} c/u
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setAdultos((prev) => Math.max(1, prev - 1))}
                        disabled={adultos <= 1}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/70 text-foreground font-bold hover:bg-muted active:scale-95 disabled:opacity-40"
                        aria-label="Disminuir adultos"
                      >
                        -
                      </button>
                      <span className="w-7 text-center font-mono text-lg font-bold text-foreground">
                        {adultos}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAdultos((prev) => prev + 1)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary font-bold hover:bg-primary/20 active:scale-95"
                        aria-label="Aumentar adultos"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Niños */}
                  <div className="flex items-center justify-between rounded-xl border border-border bg-background p-3 sm:px-4 min-h-[56px] w-full min-w-0">
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="text-sm font-bold text-foreground block truncate">Niños</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {variante
                          ? formatMoney(variante.precioNino ?? variante.precioAdulto, { moneda: excursion.moneda })
                          : ''} c/u
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setNinos((prev) => Math.max(0, prev - 1))}
                        disabled={ninos <= 0}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/70 text-foreground font-bold hover:bg-muted active:scale-95 disabled:opacity-40"
                        aria-label="Disminuir niños"
                      >
                        -
                      </button>
                      <span className="w-7 text-center font-mono text-lg font-bold text-foreground">
                        {ninos}
                      </span>
                      <button
                        type="button"
                        onClick={() => setNinos((prev) => prev + 1)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary font-bold hover:bg-primary/20 active:scale-95"
                        aria-label="Aumentar niños"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* PASO 4: DATOS DEL CLIENTE / PASAJERO */}
          <section aria-labelledby="paso-cliente" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/60 pb-3 w-full min-w-0">
              <div className="min-w-0">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Paso 4</span>
                <h2 id="paso-cliente" className="text-base sm:text-lg font-bold text-foreground truncate">
                  Datos del pasajero principal
                </h2>
              </div>

              {clientes.length > 0 && (
                <div className="grid grid-cols-2 w-full sm:w-auto rounded-xl bg-muted p-1 text-xs shrink-0">
                  <button
                    type="button"
                    onClick={() => setModoCliente('EXISTENTE')}
                    className={`rounded-lg py-2 px-3 font-bold transition text-center ${
                      modoCliente === 'EXISTENTE' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Cliente existente
                  </button>
                  <button
                    type="button"
                    onClick={() => setModoCliente('NUEVO')}
                    className={`rounded-lg py-2 px-3 font-bold transition text-center ${
                      modoCliente === 'NUEVO' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Nuevo cliente
                  </button>
                </div>
              )}
            </div>

            {modoCliente === 'EXISTENTE' && clientes.length > 0 ? (
              <div className="space-y-3 w-full min-w-0">
                <Label className="text-xs font-semibold block truncate">Selecciona el cliente de la lista</Label>
                <select
                  value={clienteId}
                  onChange={(e) => handleSeleccionarClienteExistente(e.target.value)}
                  className="flex h-12 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring truncate"
                >
                  <option value="">-- Elige un cliente existente --</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.email ? `(${c.email})` : ''} {c.telefono ? `· 📞 ${c.telefono}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-3 w-full min-w-0">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary shrink-0" />
                  <span>
                    Si el cliente no está registrado o ya existe en otra empresa de MembeGo, se le vinculará automáticamente a tu negocio y se le enviará su pase digital.
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 w-full min-w-0">
                  <div className="space-y-1.5 w-full min-w-0">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                      Nombre y Apellido *
                    </Label>
                    <div className="relative w-full min-w-0">
                      <User className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={clienteNombre}
                        onChange={(e) => setClienteNombre(e.target.value)}
                        placeholder="Ej: Laura Méndez"
                        className="pl-9 h-12 bg-background text-sm font-medium w-full"
                        required={modoCliente === 'NUEVO'}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 w-full min-w-0">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                      Correo Electrónico *
                    </Label>
                    <div className="relative w-full min-w-0">
                      <Mail className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="email"
                        value={clienteEmail}
                        onChange={(e) => setClienteEmail(e.target.value)}
                        placeholder="cliente@ejemplo.com"
                        className="pl-9 h-12 bg-background text-sm font-medium w-full"
                        required={modoCliente === 'NUEVO'}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 w-full min-w-0">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                      Teléfono (Opcional)
                    </Label>
                    <div className="relative w-full min-w-0">
                      <Phone className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="tel"
                        value={clienteTelefono}
                        onChange={(e) => setClienteTelefono(e.target.value)}
                        placeholder="+1 809 000 0000"
                        className="pl-9 h-12 bg-background text-sm font-medium w-full"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* PASO 5: ATRIBUCIÓN COMERCIAL, CANAL Y DESCUENTO (ADMIN) */}
          <section aria-labelledby="paso-comercial" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="border-b border-border/60 pb-3 w-full min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Paso 5</span>
              <h2 id="paso-comercial" className="text-base sm:text-lg font-bold text-foreground truncate">
                Atribución Comercial & Descuentos
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 w-full min-w-0">
              {/* Asignar a Vendedor */}
              <div className="space-y-1.5 w-full min-w-0">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                  Vendedor / Agente
                </Label>
                <select
                  value={vendedorId}
                  onChange={(e) => setVendedorId(e.target.value)}
                  className="flex h-12 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring truncate"
                >
                  <option value="">-- Venta Directa (Sin Vendedor) --</option>
                  {vendedores
                    .filter((v) => v.estado !== 'INACTIVO')
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nombre} {v.apellido} ({v.codigo}) {v.tipo ? `· ${v.tipo}` : ''}
                      </option>
                    ))}
                </select>
              </div>

              {/* Canal de Venta */}
              <div className="space-y-1.5 w-full min-w-0">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                  Canal de Venta
                </Label>
                <select
                  value={canal}
                  onChange={(e) => setCanal(e.target.value)}
                  className="flex h-12 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring truncate"
                >
                  <option value="MOSTRADOR">Mostrador / En Punto</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="TELEFONO">Llamada Telefónica</option>
                  <option value="AGENCIA">Agencia / Touroperador</option>
                  <option value="HOTEL">Hotel Concierge</option>
                  <option value="WEB">Web / Portal Directo</option>
                </select>
              </div>

              {/* Descuento Comercial */}
              <div className="space-y-1.5 w-full min-w-0">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                  Descuento Comercial ({excursion.moneda})
                </Label>
                <div className="relative w-full min-w-0">
                  <BadgePercent className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={descuento}
                    onChange={(e) => setDescuento(e.target.value)}
                    placeholder="0.00"
                    className="pl-9 h-12 bg-background text-sm font-medium w-full"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* PASO 6: LOGÍSTICA DE AGENCIA & HOTEL PICKUP (COLAPSABLE) */}
          <section aria-labelledby="paso-logistica" className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 id="paso-logistica" className="text-base font-bold text-foreground truncate">
                    Voucher de Agencia & Logística de Hotel
                  </h3>
                  <p className="text-xs text-muted-foreground truncate">
                    Para turoperadores, hoteles o recogida en lobby
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMostrarLogistica(!mostrarLogistica)}
                className="text-xs h-9 min-h-[36px] bg-background w-full sm:w-auto shrink-0 cursor-pointer"
              >
                {mostrarLogistica ? 'Ocultar campos' : 'Completar logística'}
              </Button>
            </div>

            {mostrarLogistica && (
              <div className="space-y-4 pt-2 border-t border-primary/15 animate-in fade-in duration-slow w-full min-w-0">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 w-full min-w-0">
                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="adminVoucherInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <Ticket className="h-3.5 w-3.5 shrink-0" /> Voucher / Localizador de Agencia
                    </Label>
                    <Input
                      id="adminVoucherInput"
                      value={voucherAgencia}
                      onChange={(e) => setVoucherAgencia(e.target.value.toUpperCase())}
                      placeholder="Ej: TO-88492-RD"
                      className="h-11 bg-background text-sm font-mono uppercase w-full"
                    />
                  </div>

                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="adminHotelInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <Building2 className="h-3.5 w-3.5 shrink-0" /> Hotel / Complejo de Recogida
                    </Label>
                    <Input
                      id="adminHotelInput"
                      value={hotelRecogida}
                      onChange={(e) => setHotelRecogida(e.target.value)}
                      placeholder="Ej: Hard Rock Hotel Punta Cana"
                      className="h-11 bg-background text-sm w-full"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 w-full min-w-0">
                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="adminLobbyInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <MapPin className="h-3.5 w-3.5 shrink-0" /> Lobby / Puerta
                    </Label>
                    <Input
                      id="adminLobbyInput"
                      value={lobbyRecogida}
                      onChange={(e) => setLobbyRecogida(e.target.value)}
                      placeholder="Ej: Lobby Principal"
                      className="h-11 bg-background text-sm w-full"
                    />
                  </div>

                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="adminHoraRecogidaInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <Clock className="h-3.5 w-3.5 shrink-0" /> Hora de Pickup
                    </Label>
                    <Input
                      id="adminHoraRecogidaInput"
                      type="time"
                      value={horaRecogida}
                      onChange={(e) => setHoraRecogida(e.target.value)}
                      className="h-11 bg-background text-sm font-mono w-full"
                    />
                  </div>

                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="adminHabitacionInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <BedDouble className="h-3.5 w-3.5 shrink-0" /> Habitación
                    </Label>
                    <Input
                      id="adminHabitacionInput"
                      value={habitacion}
                      onChange={(e) => setHabitacion(e.target.value)}
                      placeholder="Ej: 1402"
                      className="h-11 bg-background text-sm w-full"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Notas Generales */}
            <div className="space-y-1.5 pt-1 w-full min-w-0">
              <Label htmlFor="adminNotasInput" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                Notas de la Reserva / Solicitudes Especiales
              </Label>
              <Input
                id="adminNotasInput"
                name="notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Alergias, idiomas, solicitudes de asientos, etc."
                className="h-11 bg-background text-sm w-full"
              />
            </div>
          </section>
        </div>

        {/* BARRA LATERAL: RESUMEN DE RESERVA EN TIEMPO REAL */}
        <div className="lg:col-span-1 w-full min-w-0">
          <div className="sticky top-6 rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0">
            <div className="border-b border-border/60 pb-3 w-full min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block truncate">
                Resumen de Reserva
              </span>
              <h3 className="text-base sm:text-lg font-bold text-foreground truncate">
                {excursion.nombre}
              </h3>
            </div>

            {/* Miniatura y Detalles */}
            <div className="flex items-center gap-3 w-full min-w-0">
              <div className="relative h-14 w-14 sm:h-16 sm:w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                {excursion.portadaUrl ? (
                  <Image
                    src={excursion.portadaUrl}
                    alt={excursion.nombre}
                    fill
                    className="object-cover"
                    sizes="64px"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    Excursión
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <span className="text-xs font-bold text-foreground block truncate">
                  {variante.nombre}
                </span>
                <span className="text-xs text-muted-foreground block truncate">
                  📅 {fecha} {hora ? `· ⏰ ${hora}` : ''}
                </span>
                <span className="text-xs text-primary font-semibold block truncate">
                  👥 {adultos} Adulto(s){ninos > 0 ? ` · ${ninos} Niño(s)` : ''}
                </span>
              </div>
            </div>

            {/* Desglose de Importes */}
            {totales && (
              <div className="space-y-2 rounded-xl bg-muted/40 p-3.5 text-xs w-full min-w-0">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="truncate pr-2">
                    {adultos} Adulto(s) × {formatMoney(totales.precioAdulto, { moneda: excursion.moneda })}
                  </span>
                  <span className="font-mono font-medium text-foreground shrink-0">
                    {formatMoney(adultos * totales.precioAdulto, { moneda: excursion.moneda })}
                  </span>
                </div>

                {ninos > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="truncate pr-2">
                      {ninos} Niño(s) × {formatMoney(totales.precioNino ?? totales.precioAdulto, { moneda: excursion.moneda })}
                    </span>
                    <span className="font-mono font-medium text-foreground shrink-0">
                      {formatMoney(ninos * (totales.precioNino ?? totales.precioAdulto), { moneda: excursion.moneda })}
                    </span>
                  </div>
                )}

                {totales.descuento > 0 && (
                  <div className="flex items-center justify-between text-success font-semibold border-t border-border/50 pt-1.5">
                    <span>Descuento aplicado</span>
                    <span className="font-mono shrink-0">
                      −{formatMoney(totales.descuento, { moneda: excursion.moneda })}
                    </span>
                  </div>
                )}

                {totales.impuestos > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground border-t border-border/50 pt-1.5">
                    <span>Impuestos ({excursion.impuestoPct}%)</span>
                    <span className="font-mono font-medium text-foreground shrink-0">
                      {formatMoney(totales.impuestos, { moneda: excursion.moneda })}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-border/80 pt-2 text-sm font-bold text-foreground">
                  <span>Total a Reservar</span>
                  <span className="font-mono text-base sm:text-lg text-primary shrink-0">
                    {formatMoney(totales.total, { moneda: excursion.moneda })}
                  </span>
                </div>
              </div>
            )}

            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={pending}
              className="w-full h-12 rounded-xl text-sm font-bold shadow-md cursor-pointer gap-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-all active:scale-[0.99]"
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Procesando reserva...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 shrink-0" />
                  Crear Reserva
                </>
              )}
            </Button>

            <div className="space-y-1.5 pt-1 text-xs text-muted-foreground border-t border-border/60">
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                Garantía de cupo validada en tiempo real.
              </p>
              <p className="flex items-center gap-1.5">
                <Ticket className="h-3.5 w-3.5 text-primary shrink-0" />
                Genera código QR de Check-in para embarque.
              </p>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
