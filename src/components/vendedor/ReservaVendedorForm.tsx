'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Loader2,
  Calendar as CalendarIcon,
  Clock,
  Users,
  User,
  Mail,
  MapPin,
  Building2,
  Ticket,
  BedDouble,
  Search,
  Check,
  Layers,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Info,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  crearReservaVendedor,
  type ReservaVendedorState,
} from '@/modules/excursiones/reservas/vendedor-actions'
import { calcularTotales } from '@/modules/excursiones/reservas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatMoney } from '@/lib/format'

const init: ReservaVendedorState = {}

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
  comboItems?: { nombre: string; duracionMin: number | null }[]
  variantes: { id: string; nombre: string; precioAdulto: number; precioNino: number | null }[]
  horarios: { id: string; horaSalida: string; diasSemana: number[] }[]
}

export interface ClienteOpcion {
  id: string
  nombre: string
  email?: string | null
  telefono?: string | null
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

export function ReservaVendedorForm({
  excursiones,
  clientes = [],
  companyId,
}: {
  excursiones: ExcursionOpcion[]
  clientes?: ClienteOpcion[]
  companyId: string
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearReservaVendedor, init)

  // Estado del formulario
  const [busqueda, setBusqueda] = useState('')
  const [excursionId, setExcursionId] = useState(excursiones[0]?.id ?? '')
  const [varianteId, setVarianteId] = useState(excursiones[0]?.variantes[0]?.id ?? '')
  const [hora, setHora] = useState(excursiones[0]?.horarios?.[0]?.horaSalida ?? '')
  const [fecha, setFecha] = useState(getTodayString())
  const [adultos, setAdultos] = useState(2)
  const [ninos, setNinos] = useState(0)

  // Datos del cliente
  const [modoCliente, setModoCliente] = useState<'NUEVO' | 'EXISTENTE'>('NUEVO')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')

  // Logística de agencia
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

  // Sincronizar variante y horario si cambia la excursión
  useEffect(() => {
    if (excursion) {
      if (!excursion.variantes.find((v) => v.id === varianteId)) {
        setVarianteId(excursion.variantes[0]?.id ?? '')
      }
      if (!excursion.horarios?.find((h) => h.horaSalida === hora)) {
        setHora(excursion.horarios?.[0]?.horaSalida ?? '')
      }
    }
  }, [excursion, varianteId, hora])

  // Toast de feedback
  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      const timer = setTimeout(() => {
        router.push('/vendedor/reservas')
        router.refresh()
      }, 2000)
      return () => clearTimeout(timer)
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

  // Cálculo en tiempo real
  const totales = useMemo(() => {
    if (!variante || !excursion) return null
    return calcularTotales({
      precioAdulto: variante.precioAdulto,
      precioNino: variante.precioNino,
      impuestoPct: excursion.impuestoPct ?? 0,
      adultos: adultos || 0,
      ninos: ninos || 0,
      descuento: 0,
    })
  }, [variante, excursion, adultos, ninos])

  // Handler para seleccionar cliente existente
  const handleSeleccionarClienteExistente = (clienteId: string) => {
    const c = clientes.find((x) => x.id === clienteId)
    if (c) {
      setClienteNombre(c.nombre)
      setClienteEmail(c.email || '')
    }
  }

  if (excursiones.length === 0) {
    return (
      <Alert className="border-warning/30 bg-warning/10">
        <Info className="h-5 w-5 text-warning" />
        <AlertDescription className="text-sm font-medium">
          No hay excursiones activas en esta empresa para reservar.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={formAction} className="relative pb-28 lg:pb-0 w-full min-w-0 max-w-full">
      {/* CAMPOS OCULTOS PARA EL FORM ACTION */}
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="excursionId" value={excursion?.id ?? ''} />
      <input type="hidden" name="varianteId" value={variante?.id ?? ''} />
      <input type="hidden" name="fecha" value={fecha} />
      <input type="hidden" name="hora" value={hora} />
      <input type="hidden" name="adultos" value={String(adultos)} />
      <input type="hidden" name="ninos" value={String(ninos)} />
      <input type="hidden" name="clienteNombre" value={clienteNombre} />
      <input type="hidden" name="clienteEmail" value={clienteEmail} />
      <input type="hidden" name="voucherAgencia" value={voucherAgencia} />
      <input type="hidden" name="hotelRecogida" value={hotelRecogida} />
      <input type="hidden" name="lobbyRecogida" value={lobbyRecogida} />
      <input type="hidden" name="horaRecogida" value={horaRecogida} />
      <input type="hidden" name="habitacion" value={habitacion} />
      <input type="hidden" name="notas" value={notas} />

      <div className="grid gap-6 lg:grid-cols-12 items-start w-full min-w-0 max-w-full">
        {/* ── COLUMNA PRINCIPAL (PASOS DEL FORMULARIO) ── */}
        <div className="space-y-6 lg:col-span-8 w-full min-w-0 max-w-full">
          {state.error && (
            <Alert variant="destructive" className="animate-in fade-in duration-300 w-full min-w-0">
              <AlertDescription className="font-semibold">{state.error}</AlertDescription>
            </Alert>
          )}

          {state.success && (
            <Alert className="border-success/30 bg-success/10 text-success animate-in fade-in duration-300 w-full min-w-0">
              <ShieldCheck className="h-5 w-5 text-success shrink-0" />
              <AlertDescription className="font-semibold">{state.success}</AlertDescription>
            </Alert>
          )}

          {/* PASO 1: SELECCIÓN VISUAL DE EXCURSIÓN */}
          <section aria-labelledby="paso-excursion" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border-b border-border/60 pb-3 w-full min-w-0">
              <div className="min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Paso 1</span>
                <h2 id="paso-excursion" className="text-base sm:text-lg font-bold text-foreground truncate">
                  Selecciona la excursión o paquete
                </h2>
              </div>
              {excursiones.length > 2 && (
                <div className="relative w-full sm:w-60 min-w-0">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Buscar tour o combo..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    className="h-10 pl-9 text-xs bg-background w-full"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 w-full min-w-0">
              {excursionesFiltradas.map((e) => {
                const isSelected = e.id === excursion?.id
                const basePrecio = e.variantes[0]?.precioAdulto ?? 0
                return (
                  <button
                    type="button"
                    key={e.id}
                    onClick={() => setExcursionId(e.id)}
                    className={`group relative flex flex-col justify-between text-left rounded-xl border p-3.5 transition-all min-h-[90px] active:scale-[0.99] w-full min-w-0 overflow-hidden ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm'
                        : 'border-border/70 bg-card hover:border-primary/40 hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-start gap-3 w-full min-w-0">
                      {e.portadaUrl ? (
                        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted">
                          <Image
                            src={e.portadaUrl}
                            alt={e.nombre}
                            fill
                            className="object-cover transition-transform group-hover:scale-105"
                            sizes="56px"
                          />
                        </div>
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          {e.tipoItem === 'COMBO' ? <Layers className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
                        </div>
                      )}

                      <div className="min-w-0 flex-1 pr-5">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          {e.tipoItem === 'COMBO' && (
                            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary shrink-0">
                              <Layers className="h-2.5 w-2.5" /> Combo
                            </span>
                          )}
                          {e.categoria && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground truncate max-w-[100px]">
                              {e.categoria}
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-bold text-foreground truncate">{e.nombre}</h4>
                        {e.duracionMin && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3 shrink-0" />
                            {Math.floor(e.duracionMin / 60) > 0 ? `${Math.floor(e.duracionMin / 60)}h ` : ''}
                            {e.duracionMin % 60 > 0 ? `${e.duracionMin % 60}m` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-xs w-full min-w-0">
                      <span className="text-muted-foreground">Desde</span>
                      <span className="font-bold text-foreground">
                        {formatMoney(basePrecio, { moneda: e.moneda })}
                      </span>
                    </div>

                    {isSelected && (
                      <div className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0 z-10">
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {excursionesFiltradas.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No se encontraron excursiones con el término &quot;{busqueda}&quot;.
              </p>
            )}
          </section>

          {/* PASO 2: VARIANTE Y HORARIOS */}
          <section aria-labelledby="paso-variante" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="border-b border-border/60 pb-3 w-full min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Paso 2</span>
              <h2 id="paso-variante" className="text-base sm:text-lg font-bold text-foreground truncate">
                Modalidad & Turno
              </h2>
            </div>

            {/* Selector de Variante */}
            <div className="space-y-2 w-full min-w-0">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Variante / Paquete
              </Label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 w-full min-w-0">
                {excursion?.variantes.map((v) => {
                  const isSelected = v.id === variante?.id
                  return (
                    <button
                      type="button"
                      key={v.id}
                      onClick={() => setVarianteId(v.id)}
                      className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition-all min-h-[56px] active:scale-[0.99] w-full min-w-0 overflow-hidden ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm'
                          : 'border-border bg-card hover:border-primary/40'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-sm font-bold text-foreground truncate">{v.nombre}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          Adulto: <span className="font-semibold text-foreground">{formatMoney(v.precioAdulto, { moneda: excursion.moneda })}</span>
                          {v.precioNino != null && (
                            <> · Niño: <span className="font-semibold text-foreground">{formatMoney(v.precioNino, { moneda: excursion.moneda })}</span></>
                          )}
                        </p>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-primary shrink-0 ml-2" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Selector de Horarios (Pills) */}
            <div className="space-y-2 pt-2 w-full min-w-0">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Turno / Horario de Salida
              </Label>
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
            </div>
          </section>

          {/* PASO 3: FECHA & PASAJEROS */}
          <section aria-labelledby="paso-fecha-pasajeros" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 max-w-full overflow-hidden">
            <div className="border-b border-border/60 pb-3 w-full min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Paso 3</span>
              <h2 id="paso-fecha-pasajeros" className="text-base sm:text-lg font-bold text-foreground truncate">
                Fecha & Pasajeros
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 w-full min-w-0">
              {/* Selección de Fecha */}
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
                      fecha === getTodayString() ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border bg-background hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() => setFecha(addDaysToString(1))}
                    className={`rounded-lg border px-3 py-2 min-h-[40px] text-xs font-medium transition active:scale-95 ${
                      fecha === addDaysToString(1) ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border bg-background hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    Mañana
                  </button>
                  <button
                    type="button"
                    onClick={() => setFecha(addDaysToString(2))}
                    className={`rounded-lg border px-3 py-2 min-h-[40px] text-xs font-medium transition active:scale-95 ${
                      fecha === addDaysToString(2) ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border bg-background hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    Pasado mañana
                  </button>
                </div>
              </div>

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
                      <span className="block text-[11px] text-muted-foreground truncate">
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
                      <span className="block text-[11px] text-muted-foreground truncate">
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
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Paso 4</span>
                <h2 id="paso-cliente" className="text-base sm:text-lg font-bold text-foreground truncate">
                  Datos del pasajero principal
                </h2>
              </div>

              {clientes.length > 0 && (
                <div className="grid grid-cols-2 w-full sm:w-auto rounded-xl bg-muted p-1 text-xs shrink-0">
                  <button
                    type="button"
                    onClick={() => setModoCliente('NUEVO')}
                    className={`rounded-lg py-2 px-3 font-bold transition text-center ${
                      modoCliente === 'NUEVO' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Nuevo cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => setModoCliente('EXISTENTE')}
                    className={`rounded-lg py-2 px-3 font-bold transition text-center ${
                      modoCliente === 'EXISTENTE' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Cliente existente
                  </button>
                </div>
              )}
            </div>

            {modoCliente === 'EXISTENTE' && clientes.length > 0 ? (
              <div className="space-y-2 w-full min-w-0">
                <Label className="text-xs font-semibold block truncate">Selecciona el cliente de la lista</Label>
                <select
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
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 w-full min-w-0">
              <div className="space-y-2 w-full min-w-0">
                <Label htmlFor="clienteNombreInput" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                  Nombre y Apellido *
                </Label>
                <div className="relative w-full min-w-0">
                  <User className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="clienteNombreInput"
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                    placeholder="Ej: Laura Méndez"
                    className="pl-9 h-12 bg-background text-sm font-medium w-full"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2 w-full min-w-0">
                <Label htmlFor="clienteEmailInput" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
                  Correo electrónico *
                </Label>
                <div className="relative w-full min-w-0">
                  <Mail className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="clienteEmailInput"
                    type="email"
                    value={clienteEmail}
                    onChange={(e) => setClienteEmail(e.target.value)}
                    placeholder="cliente@ejemplo.com"
                    className="pl-9 h-12 bg-background text-sm font-medium w-full"
                    required
                  />
                </div>
              </div>
            </div>
          </section>

          {/* PASO 5: LOGÍSTICA DE AGENCIA & HOTEL PICKUP (ACORDEÓN / TOGGLE) */}
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
                className="text-xs h-9 min-h-[36px] bg-background w-full sm:w-auto shrink-0"
              >
                {mostrarLogistica ? 'Ocultar campos' : 'Completar logística'}
              </Button>
            </div>

            {mostrarLogistica && (
              <div className="space-y-4 pt-2 border-t border-primary/15 animate-in fade-in duration-300 w-full min-w-0">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 w-full min-w-0">
                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="voucherInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <Ticket className="h-3.5 w-3.5 shrink-0" /> Voucher / Localizador de Agencia
                    </Label>
                    <Input
                      id="voucherInput"
                      value={voucherAgencia}
                      onChange={(e) => setVoucherAgencia(e.target.value.toUpperCase())}
                      placeholder="Ej: AG-9824, TUI-004"
                      className="bg-background uppercase font-mono h-11 w-full"
                    />
                  </div>

                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="hotelInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <Building2 className="h-3.5 w-3.5 shrink-0" /> Hotel / Resort de Hospedaje
                    </Label>
                    <Input
                      id="hotelInput"
                      value={hotelRecogida}
                      onChange={(e) => setHotelRecogida(e.target.value)}
                      placeholder="Ej: Hard Rock Resort Punta Cana"
                      className="bg-background h-11 w-full"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 w-full min-w-0">
                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="lobbyInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <MapPin className="h-3.5 w-3.5 shrink-0" /> Lobby / Encuentro
                    </Label>
                    <Input
                      id="lobbyInput"
                      value={lobbyRecogida}
                      onChange={(e) => setLobbyRecogida(e.target.value)}
                      placeholder="Ej: Lobby Central"
                      className="bg-background h-11 w-full"
                    />
                  </div>

                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="horaRecogidaInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <Clock className="h-3.5 w-3.5 shrink-0" /> Hora de Pickup
                    </Label>
                    <Input
                      id="horaRecogidaInput"
                      type="time"
                      value={horaRecogida}
                      onChange={(e) => setHoraRecogida(e.target.value)}
                      className="bg-background h-11 w-full"
                    />
                  </div>

                  <div className="space-y-1.5 w-full min-w-0">
                    <Label htmlFor="habitacionInput" className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 truncate">
                      <BedDouble className="h-3.5 w-3.5 shrink-0" /> Habitación (Opcional)
                    </Label>
                    <Input
                      id="habitacionInput"
                      value={habitacion}
                      onChange={(e) => setHabitacion(e.target.value)}
                      placeholder="Ej: 3204"
                      className="bg-background h-11 w-full"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* PASO 6: NOTAS Y OBSERVACIONES */}
          <section aria-labelledby="paso-notas" className="rounded-2xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm space-y-2 w-full min-w-0 max-w-full overflow-hidden">
            <Label htmlFor="notasInput" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">
              Notas / Solicitudes especiales (Opcional)
            </Label>
            <Input
              id="notasInput"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Alergias, requerimientos de transporte, idiomas..."
              className="h-11 bg-background w-full"
            />
          </section>
        </div>

        {/* ── COLUMNA LATERAL (STICKY SUMMARY - DESKTOP ONLY) ── */}
        <aside aria-label="Resumen de reserva" className="hidden lg:block lg:col-span-4 lg:sticky lg:top-28 lg:self-start space-y-4 w-full min-w-0 max-w-full">
          <div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-sm space-y-4 w-full min-w-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/60 pb-3 w-full min-w-0">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground truncate">
                Resumen de Reserva
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary shrink-0">
                <Sparkles className="h-3 w-3" /> En Vivo
              </span>
            </div>

            {/* Tarjeta de la excursión seleccionada */}
            {excursion && (
              <div className="rounded-xl border border-border/60 bg-muted/40 p-3 space-y-2 w-full min-w-0 overflow-hidden">
                <div className="flex items-center gap-3 w-full min-w-0">
                  {excursion.portadaUrl ? (
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border bg-muted">
                      <Image
                        src={excursion.portadaUrl}
                        alt={excursion.nombre}
                        fill
                        className="object-cover"
                        sizes="48px"
                      />
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Sparkles className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-foreground truncate">{excursion.nombre}</h4>
                    <p className="text-xs text-muted-foreground truncate">{variante?.nombre}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40 w-full min-w-0">
                  <span className="flex items-center gap-1 font-semibold text-foreground">
                    <CalendarIcon className="h-3 w-3 text-primary shrink-0" /> {fecha}
                  </span>
                  {hora && (
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <Clock className="h-3 w-3 text-primary shrink-0" /> {hora}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3 shrink-0" /> {adultos} ad.{ninos > 0 ? `, ${ninos} niñ.` : ''}
                  </span>
                </div>
              </div>
            )}

            {/* Desglose de Precios */}
            <div className="space-y-2 text-xs w-full min-w-0">
              {variante && (
                <>
                  <div className="flex justify-between text-muted-foreground gap-2">
                    <span className="truncate">{adultos} Adulto(s) × {formatMoney(variante.precioAdulto, { moneda: excursion.moneda })}</span>
                    <span className="font-semibold text-foreground shrink-0">
                      {formatMoney(adultos * variante.precioAdulto, { moneda: excursion.moneda })}
                    </span>
                  </div>

                  {ninos > 0 && (
                    <div className="flex justify-between text-muted-foreground gap-2">
                      <span className="truncate">{ninos} Niño(s) × {formatMoney(variante.precioNino ?? variante.precioAdulto, { moneda: excursion.moneda })}</span>
                      <span className="font-semibold text-foreground shrink-0">
                        {formatMoney(ninos * (variante.precioNino ?? variante.precioAdulto), { moneda: excursion.moneda })}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between border-t border-border/40 pt-1.5 text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="font-medium text-foreground">
                      {formatMoney(totales?.subtotal ?? 0, { moneda: excursion.moneda })}
                    </span>
                  </div>

                  {(excursion.impuestoPct ?? 0) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Impuestos ({excursion.impuestoPct}%)</span>
                      <span>{formatMoney(totales?.impuestos ?? 0, { moneda: excursion.moneda })}</span>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-baseline justify-between border-t border-border/60 pt-3">
                <span className="text-sm font-bold text-foreground">Total a pagar</span>
                <span className="font-mono text-xl font-extrabold text-primary">
                  {formatMoney(totales?.total ?? 0, { moneda: excursion.moneda })}
                </span>
              </div>
            </div>

            <Button
              type="submit"
              disabled={pending || !clienteNombre.trim() || !clienteEmail.trim()}
              className="w-full h-12 text-sm font-bold shadow-md transition-all active:scale-[0.99]"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creando reserva...
                </>
              ) : (
                <>
                  Crear Reserva Directa
                  <ChevronRight className="ml-1.5 h-4 w-4" />
                </>
              )}
            </Button>

            <p className="text-[11px] text-center text-muted-foreground">
              Al crear la reserva se generará el localizador y se enviará el boleto digital con QR al correo del cliente.
            </p>
          </div>
        </aside>
      </div>

      {/* ── MOBILE STICKY BOTTOM BAR (SOLO MÓVIL & TABLET < LG) ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/80 bg-card/95 backdrop-blur-md p-3 sm:p-4 shadow-2xl lg:hidden w-full">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 w-full min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate max-w-[150px] font-semibold text-foreground">{excursion?.nombre}</span>
              <span>·</span>
              <span className="shrink-0">{adultos + ninos} pax</span>
            </div>
            <p className="font-mono text-lg sm:text-xl font-extrabold text-primary truncate">
              {formatMoney(totales?.total ?? 0, { moneda: excursion?.moneda ?? 'USD' })}
            </p>
          </div>

          <Button
            type="submit"
            disabled={pending || !clienteNombre.trim() || !clienteEmail.trim()}
            className="h-12 px-5 sm:px-6 font-bold shadow-md shrink-0 text-sm active:scale-95"
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creando...
              </>
            ) : (
              <>
                Crear Reserva
                <ChevronRight className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}
