'use client'

import { useActionState, useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Loader2, 
  Clock, 
  CalendarDays, 
  Plus, 
  Trash2, 
  MapPin, 
  Check, 
  Sparkles,
  Info,
  DollarSign
} from 'lucide-react'
import { toast } from 'sonner'
import {
  crearExcursion,
  actualizarExcursion,
  type CatalogoActionState,
} from '@/modules/excursiones/catalogo/actions'
import { MONEDAS, DIAS_SEMANA, calcularHoraRegreso } from '@/modules/excursiones/catalogo/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: CatalogoActionState = {}

export interface ExcursionEditable {
  id: string
  nombre: string
  descripcion: string | null
  duracionMin: number | null
  ubicacion: string | null
  categoria: string | null
  moneda: string
  impuestoPct: unknown
  capacidad: number | null
  puntoSalida: string | null
  horaSalida: string | null
  horaRegreso: string | null
  incluye: string | null
  noIncluye: string | null
  politicas: string | null
  horarios?: {
    id: string
    horaSalida: string
    diasSemana: unknown
    cupo?: number | null
  }[]
}

const CATEGORIAS_SUGERIDAS = [
  'Playa y Catamarán',
  'Aventura y Buggies',
  'Ecoturismo y Montaña',
  'Cultural e Histórica',
  'Paseo en Barco',
  'Snorkel y Buceo',
  'Gastronómica'
]

const DURACION_PRESETS = [
  { label: '1 hora', horas: 1 },
  { label: '2 horas', horas: 2 },
  { label: '3 horas', horas: 3 },
  { label: '4 horas (Medio día)', horas: 4 },
  { label: '6 horas', horas: 6 },
  { label: '8 horas (Día completo)', horas: 8 },
  { label: '10 horas', horas: 10 },
]

const HORAS_PRESETS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'
]

export function ExcursionForm({ excursion }: { excursion?: ExcursionEditable }) {
  const router = useRouter()
  const accion = excursion ? actualizarExcursion : crearExcursion
  const [state, formAction, pending] = useActionState(accion, init)

  // Duración en horas (por defecto 3 horas o convertido desde duracionMin)
  const [duracionHoras, setDuracionHoras] = useState<number>(() => {
    if (excursion?.duracionMin) return Number((excursion.duracionMin / 60).toFixed(1))
    return 3
  })

  // Lista de horas de salida configuradas
  const [horasSalida, setHorasSalida] = useState<string[]>(() => {
    if (excursion?.horarios && excursion.horarios.length > 0) {
      const unique = Array.from(
        new Set(excursion.horarios.map((h) => String(h.horaSalida || '').trim().slice(0, 5)).filter(Boolean))
      ).sort()
      if (unique.length > 0) return unique
    }
    if (excursion?.horaSalida) return [excursion.horaSalida.trim().slice(0, 5)]
    return ['09:00', '11:00']
  })

  const [nuevaHoraInput, setNuevaHoraInput] = useState('14:00')

  // Días de operación (1=Lun ... 7=Dom)
  const [diasSeleccionados, setDiasSeleccionados] = useState<number[]>(() => {
    if (excursion?.horarios && excursion.horarios.length > 0) {
      const allDays = new Set<number>()
      for (const h of excursion.horarios) {
        if (Array.isArray(h.diasSemana)) {
          h.diasSemana.forEach((d) => {
            const num = Number(d)
            if (num >= 1 && num <= 7) allDays.add(num)
          })
        }
      }
      if (allDays.size > 0) return Array.from(allDays).sort()
    }
    return [1, 2, 3, 4, 5, 6, 7]
  })

  // Minutos calculados
  const duracionMin = useMemo(() => {
    return Math.max(15, Math.round(duracionHoras * 60))
  }, [duracionHoras])

  // Formato visual amigable de hora en 12h (AM/PM)
  const formato12h = (h24: string) => {
    if (!h24 || !h24.includes(':')) return h24
    const [hStr, mStr] = h24.split(':')
    const h = parseInt(hStr, 10)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${mStr} ${ampm}`
  }

  // Agregar una nueva hora
  const agregarHora = (hora: string) => {
    const limpia = hora.trim().slice(0, 5)
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(limpia)) return
    if (!horasSalida.includes(limpia)) {
      setHorasSalida([...horasSalida, limpia].sort())
    }
  }

  const removerHora = (hora: string) => {
    if (horasSalida.length <= 1) {
      toast.error('Debe haber al menos una hora de salida')
      return
    }
    setHorasSalida(horasSalida.filter((h) => h !== hora))
  }

  // Preset de días
  const seleccionarPresetDias = (tipo: 'todos' | 'laborables' | 'finde') => {
    if (tipo === 'todos') setDiasSeleccionados([1, 2, 3, 4, 5, 6, 7])
    if (tipo === 'laborables') setDiasSeleccionados([1, 2, 3, 4, 5])
    if (tipo === 'finde') setDiasSeleccionados([6, 7])
  }

  const toggleDia = (dia: number) => {
    if (diasSeleccionados.includes(dia)) {
      if (diasSeleccionados.length <= 1) {
        toast.error('Debe seleccionar al menos un día de salida')
        return
      }
      setDiasSeleccionados(diasSeleccionados.filter((d) => d !== dia))
    } else {
      setDiasSeleccionados([...diasSeleccionados, dia].sort())
    }
  }

  // Preparar JSON para el backend
  const horariosDataJson = useMemo(() => {
    return JSON.stringify(
      horasSalida.map((h) => ({
        horaSalida: h,
        diasSemana: diasSeleccionados,
        cupo: null,
      }))
    )
  }, [horasSalida, diasSeleccionados])

  // Primera hora de salida y su hora de regreso calculada
  const primeraHoraSalida = horasSalida[0] || '09:00'
  const primeraHoraRegreso = useMemo(() => {
    return calcularHoraRegreso(primeraHoraSalida, duracionMin) || ''
  }, [primeraHoraSalida, duracionMin])

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      if (state.excursionId) router.replace(`/admin/excursiones/catalogo/${state.excursionId}`)
      else router.refresh()
    }
  }, [state, router])

  return (
    <form action={formAction} className="space-y-8">
      {excursion ? <input type="hidden" name="excursionId" value={excursion.id} /> : null}

      {/* Campos ocultos calculados */}
      <input type="hidden" name="duracionMin" value={duracionMin} />
      <input type="hidden" name="horaSalida" value={primeraHoraSalida} />
      <input type="hidden" name="horaRegreso" value={primeraHoraRegreso} />
      <input type="hidden" name="horariosData" value={horariosDataJson} />

      {/* SECCIÓN 1: DATOS PRINCIPALES */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
        <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Información general de la excursión
        </h3>

        <div>
          <Label htmlFor="exc-nombre" className="text-xs sm:text-sm font-semibold">Nombre de la excursión *</Label>
          <Input 
            id="exc-nombre" 
            name="nombre" 
            defaultValue={excursion?.nombre ?? ''} 
            placeholder="Ej.: Isla Saona Premium & Piscinas Naturales" 
            className="mt-1 h-11 text-sm sm:text-base font-medium"
            required 
          />
        </div>

        <div>
          <Label htmlFor="exc-desc" className="text-xs sm:text-sm font-semibold">Descripción</Label>
          <Textarea 
            id="exc-desc" 
            name="descripcion" 
            defaultValue={excursion?.descripcion ?? ''} 
            placeholder="Describe la experiencia, actividades, paradas y lo que hace único a este tour."
            rows={3}
            className="mt-1 text-sm resize-y"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="exc-categoria" className="text-xs sm:text-sm font-semibold">Categoría</Label>
            <Input 
              id="exc-categoria" 
              name="categoria" 
              defaultValue={excursion?.categoria ?? ''} 
              placeholder="Ej.: Playa, Aventura, Buggies…" 
              className="mt-1 h-10 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CATEGORIAS_SUGERIDAS.slice(0, 4).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    const input = document.getElementById('exc-categoria') as HTMLInputElement
                    if (input) input.value = cat
                  }}
                  className="rounded-lg border border-border/80 bg-muted/50 px-2 py-0.5 text-caption font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition"
                >
                  + {cat}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="exc-capacidad" className="text-xs sm:text-sm font-semibold">Capacidad total por salida</Label>
            <Input 
              id="exc-capacidad" 
              name="capacidad" 
              type="number" 
              min="1" 
              defaultValue={excursion?.capacidad ?? 30} 
              placeholder="Ej.: 30 cupos"
              className="mt-1 h-10 text-sm font-medium"
            />
            <p className="mt-1 text-caption text-muted-foreground">Número máximo de pasajeros por turno.</p>
          </div>
        </div>
      </div>

      {/* SECCIÓN 2: DURACIÓN Y HORARIOS DE SALIDA CON CÁLCULO DE LLEGADA */}
      <div className="rounded-2xl border border-primary/20 bg-card p-5 sm:p-6 space-y-6 shadow-sm">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Duración y Horarios de Salida
          </h3>
          <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
            La hora de llegada se calcula automáticamente según la duración seleccionada.
          </p>
        </div>

        {/* 1. Selección de Duración en Horas */}
        <div className="space-y-2.5 rounded-xl bg-muted/40 p-4 border border-border/60">
          <Label className="text-xs sm:text-sm font-bold text-foreground">
            Duración de la excursión (en horas) *
          </Label>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-36">
              <Input
                type="number"
                min="0.5"
                max="24"
                step="0.5"
                value={duracionHoras}
                onChange={(e) => setDuracionHoras(Math.max(0.5, parseFloat(e.target.value) || 1))}
                className="h-11 text-base font-bold pr-12 text-primary"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none">
                hrs
              </span>
            </div>

            <span className="text-xs sm:text-sm font-semibold text-muted-foreground">
              ({duracionMin} minutos de recorrido)
            </span>
          </div>

          {/* Presets rápidos de duración */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {DURACION_PRESETS.map((p) => {
              const activo = duracionHoras === p.horas
              return (
                <button
                  key={p.horas}
                  type="button"
                  onClick={() => setDuracionHoras(p.horas)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    activo
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'border border-border bg-background hover:bg-muted text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 2. Lista de Horarios de Salida y Llegadas Calculadas */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs sm:text-sm font-bold text-foreground">
              Horas de salida programadas ({horasSalida.length})
            </Label>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            {horasSalida.map((h) => {
              const llegadaCalc = calcularHoraRegreso(h, duracionMin) || '--:--'
              return (
                <div 
                  key={h}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs hover:border-primary/40 transition"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-black text-primary">
                        {formato12h(h)}
                      </span>
                      <span className="text-xs font-bold text-muted-foreground">Salida</span>
                    </div>
                    <p className="text-caption font-medium text-muted-foreground flex items-center gap-1">
                      🏁 Llegada estimada: <strong className="text-foreground">{formato12h(llegadaCalc)}</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => removerHora(h)}
                    disabled={horasSalida.length <= 1}
                    className="p-2 text-muted-foreground hover:text-destructive transition disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Eliminar este horario"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Agregar nueva hora */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Input
              type="time"
              value={nuevaHoraInput}
              onChange={(e) => setNuevaHoraInput(e.target.value)}
              className="h-10 w-32 text-sm font-bold"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => agregarHora(nuevaHoraInput)}
              className="h-10 gap-1.5 text-xs sm:text-sm font-bold"
            >
              <Plus className="h-4 w-4" />
              Agregar horario
            </Button>

            {/* Presets rápidos para agregar */}
            <div className="flex flex-wrap items-center gap-1 pl-2">
              <span className="text-caption text-muted-foreground hidden sm:inline">Rápidos:</span>
              {HORAS_PRESETS.map((hPreset) => {
                const yaEsta = horasSalida.includes(hPreset)
                if (yaEsta) return null
                return (
                  <button
                    key={hPreset}
                    type="button"
                    onClick={() => agregarHora(hPreset)}
                    className="rounded-lg border border-border/80 bg-muted/60 px-2 py-1 text-caption font-semibold text-foreground hover:bg-primary/10 hover:text-primary transition"
                  >
                    + {formato12h(hPreset)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* 3. Días de la Semana en que opera */}
        <div className="space-y-3 pt-2 border-t border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-xs sm:text-sm font-bold text-foreground">
              Días de operación semanales
            </Label>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => seleccionarPresetDias('todos')}
                className={`rounded-lg px-2.5 py-1 text-caption font-bold transition ${
                  diasSeleccionados.length === 7
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card hover:bg-muted text-muted-foreground'
                }`}
              >
                Todos los días
              </button>
              <button
                type="button"
                onClick={() => seleccionarPresetDias('laborables')}
                className={`rounded-lg px-2.5 py-1 text-caption font-bold transition ${
                  diasSeleccionados.length === 5 && !diasSeleccionados.includes(6) && !diasSeleccionados.includes(7)
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card hover:bg-muted text-muted-foreground'
                }`}
              >
                Lun a Vie
              </button>
              <button
                type="button"
                onClick={() => seleccionarPresetDias('finde')}
                className={`rounded-lg px-2.5 py-1 text-caption font-bold transition ${
                  diasSeleccionados.length === 2 && diasSeleccionados.includes(6) && diasSeleccionados.includes(7)
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card hover:bg-muted text-muted-foreground'
                }`}
              >
                Fin de semana
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {DIAS_SEMANA.map((d) => {
              const seleccionado = diasSeleccionados.includes(d.n)
              return (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDia(d.n)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${
                    seleccionado
                      ? 'border-primary bg-primary/10 text-primary font-black shadow-xs'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {seleccionado && <Check className="h-3.5 w-3.5" />}
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* SECCIÓN 3: PRECIOS Y MONEDA */}
      {!excursion ? (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6 space-y-4 shadow-sm">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Precio base de la excursión (Variante Estándar)
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Podrás agregar más variantes de precio (VIP, niños, residentes) en cualquier momento desde el catálogo.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="exc-precio-adulto" className="text-xs sm:text-sm font-semibold">Precio por adulto *</Label>
              <Input 
                id="exc-precio-adulto" 
                name="precioAdulto" 
                type="number" 
                min="0.01" 
                step="0.01" 
                placeholder="80.00" 
                className="mt-1 h-11 text-base font-bold"
                required 
              />
            </div>
            <div>
              <Label htmlFor="exc-precio-nino" className="text-xs sm:text-sm font-semibold">Precio por niño (opcional)</Label>
              <Input 
                id="exc-precio-nino" 
                name="precioNino" 
                type="number" 
                min="0" 
                step="0.01" 
                placeholder="40.00" 
                className="mt-1 h-11 text-sm font-medium"
              />
            </div>
            <div>
              <Label htmlFor="exc-moneda" className="text-xs sm:text-sm font-semibold">Moneda</Label>
              <select
                id="exc-moneda"
                name="moneda"
                defaultValue="DOP"
                className="mt-1 block h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-primary"
              >
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
          <h3 className="text-base font-bold text-foreground">Moneda e Impuestos</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="exc-moneda" className="text-xs sm:text-sm font-semibold">Moneda</Label>
              <select
                id="exc-moneda"
                name="moneda"
                defaultValue={excursion.moneda}
                className="mt-1 block h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:ring-2 focus:ring-primary"
              >
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="exc-impuesto" className="text-xs sm:text-sm font-semibold">Impuesto (%)</Label>
              <Input 
                id="exc-impuesto" 
                name="impuestoPct" 
                type="number" 
                min="0" 
                max="100" 
                step="0.01" 
                defaultValue={excursion.impuestoPct != null ? String(excursion.impuestoPct) : ''} 
                className="mt-1 h-11 text-sm"
              />
            </div>
          </div>
        </div>
      )}
      {!excursion ? <input type="hidden" name="impuestoPct" value="" /> : null}

      {/* SECCIÓN 4: UBICACIÓN Y PUNTO DE ENCUENTRO */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
        <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          Ubicación y Punto de Salida
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="exc-ubicacion" className="text-xs sm:text-sm font-semibold">Ciudad / Región</Label>
            <Input 
              id="exc-ubicacion" 
              name="ubicacion" 
              defaultValue={excursion?.ubicacion ?? ''} 
              placeholder="Ej.: Bayahíbe, La Romana" 
              className="mt-1 h-11 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="exc-punto" className="text-xs sm:text-sm font-semibold">Punto exacto de encuentro</Label>
            <Input 
              id="exc-punto" 
              name="puntoSalida" 
              defaultValue={excursion?.puntoSalida ?? ''} 
              placeholder="Ej.: Muelle Principal de Bayahíbe, frente al faro" 
              className="mt-1 h-11 text-sm"
            />
          </div>
        </div>
      </div>

      {/* SECCIÓN 5: QUÉ INCLUYE Y POLÍTICAS */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
        <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <Info className="h-5 w-5 text-primary" />
          Inclusiones y Políticas
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="exc-incluye" className="text-xs sm:text-sm font-semibold">¿Qué incluye?</Label>
            <Textarea 
              id="exc-incluye" 
              name="incluye" 
              defaultValue={excursion?.incluye ?? ''} 
              placeholder="Transporte en lancha, almuerzo buffet, bebidas abiertas, chalecos, guía certificado…" 
              rows={3}
              className="mt-1 text-sm resize-y"
            />
          </div>
          <div>
            <Label htmlFor="exc-noincluye" className="text-xs sm:text-sm font-semibold">¿Qué NO incluye?</Label>
            <Textarea 
              id="exc-noincluye" 
              name="noIncluye" 
              defaultValue={excursion?.noIncluye ?? ''} 
              placeholder="Propinas, fotos profesionales, compras personales…" 
              rows={3}
              className="mt-1 text-sm resize-y"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="exc-politicas" className="text-xs sm:text-sm font-semibold">Políticas y recomendaciones</Label>
          <Textarea 
            id="exc-politicas" 
            name="politicas" 
            defaultValue={excursion?.politicas ?? ''} 
            placeholder="Llevar protector solar, toalla, traje de baño. Cancelaciones con 24h de anticipación…" 
            rows={3}
            className="mt-1 text-sm resize-y"
          />
        </div>
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
        <Button 
          type="submit" 
          disabled={pending} 
          className="h-12 w-full sm:w-auto px-8 rounded-xl font-bold text-sm sm:text-base shadow-sm gap-2"
        >
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {excursion ? 'Guardar cambios' : 'Crear y publicar excursión'}
        </Button>
      </div>
    </form>
  )
}
