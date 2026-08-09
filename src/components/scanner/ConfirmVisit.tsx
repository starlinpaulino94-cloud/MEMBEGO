'use client'

import { useActionState, useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  Calendar,
  CreditCard,
  Gift,
  Sparkles,
  Shield,
  Megaphone,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  confirmarVisita,
  type ClienteLookup,
  type ConfirmState,
} from '@/modules/visitas/actions'
import { ComprobanteReceipt } from '@/components/scanner/ComprobanteReceipt'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { desdeFormData } from '@/modules/scanner/colaOffline'
import type { ColaOffline } from '@/components/scanner/useColaOffline'

type EncolarVisita = ColaOffline['encolar']

/** El estado del formulario más el caso "quedó pendiente de enviar". */
type EstadoConCola = ConfirmState & { encolada?: boolean }

interface Sucursal {
  id: string
  nombre: string
}

const SERVICIOS_CARWASH = [
  'Lavado básico',
  'Lavado premium',
  'Aspirado completo',
  'Detallado',
  'Aromatizante',
]
const SERVICIOS_RESTAURANTE = [
  'Menú ejecutivo',
  'Comida premium',
  'Bebida premium',
  'Postre',
  'Consumo general',
]
// Cualquier otro tipo de negocio: opciones neutras, sin asumir la industria.
const SERVICIOS_GENERICOS = [
  'Uso de membresía',
  'Servicio estándar',
  'Servicio premium',
  'Producto incluido',
  'Otro beneficio',
]

const initial: EstadoConCola = {}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(iso))
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso)
  )
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof User }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  )
}

export function ConfirmVisit({
  cliente,
  sucursales = [],
  onDone,
  onScanNext,
  encolar,
}: {
  cliente: ClienteLookup
  sucursales?: Sucursal[]
  onDone: () => void
  /** Vuelve directo a la cámara para el siguiente cliente (loop sin fricción). */
  onScanNext?: () => void
  /**
   * Guarda la visita para reenviarla cuando vuelva la red (Fase 7 · punto 28).
   * Opcional: sin ella el componente se comporta como antes.
   */
  encolar?: EncolarVisita
}) {
  const [servicio, setServicio] = useState('')
  // §13: si la membresía está asociada a UN vehículo, viene preseleccionado —
  // el empleado confirma la placa de un vistazo en vez de elegir a ciegas.
  const [vehiculoId, setVehiculoId] = useState(() =>
    cliente.vehiculosMembresia?.length === 1 ? cliente.vehiculosMembresia[0].id : ''
  )
  const [sucursalId, setSucursalId] = useState('')
  /**
   * La acción, envuelta para que un fallo de RED no se pierda.
   *
   * `confirmarVisita` es una server action: cuando no hay conexión, la llamada
   * revienta con una excepción de red que no llega al estado del formulario
   * —sube por el árbol y la recoge el ErrorBoundary del escáner—. El resultado
   * para el empleado era una pantalla de error con un coche esperando.
   *
   * Aquí se atrapa esa excepción, la visita se guarda en el dispositivo y se
   * devuelve un estado propio: la operación NO se anuncia como registrada
   * (sería mentira), se anuncia como pendiente. Los errores de NEGOCIO que sí
   * devuelve el servidor —QR usado, sin permisos— siguen su camino intacto:
   * esos no mejoran reintentando.
   */
  const accion = useCallback(
    async (previo: EstadoConCola, formData: FormData): Promise<EstadoConCola> => {
      try {
        return await confirmarVisita(previo, formData)
      } catch (e) {
        if (!encolar) throw e
        const guardada = encolar({
          tipo: 'visita',
          datos: desdeFormData(formData),
          etiqueta: cliente.nombre ?? undefined,
        })
        if (!guardada) throw e
        return { encolada: true }
      }
    },
    [encolar, cliente.nombre]
  )

  const [state, formAction, pending] = useActionState<EstadoConCola, FormData>(accion, initial)

  // Defensa contra payloads incompletos (bundle viejo en el teléfono + acción
  // nueva en el servidor, o viceversa): nunca dejar que un campo faltante
  // tumbe la pantalla del scanner.
  const vehiculos = cliente.vehiculos ?? []
  // Onboarding v2 (§13): vehículo(s) a los que ESTA membresía está asociada.
  // Vacío en membresías anteriores al rediseño: la pantalla queda como siempre.
  const vehiculosMembresia = cliente.vehiculosMembresia ?? []
  const asociadosIds = new Set(vehiculosMembresia.map((v) => v.id))
  const planBeneficios = cliente.planBeneficios ?? []
  const alertas = cliente.alertas ?? []
  const visitasRecientes = cliente.visitasRecientes ?? []

  // Los servicios sugeridos dependen del tipo de negocio; nunca se asume
  // Car Wash por defecto: cualquier industria no contemplada usa la lista
  // genérica.
  const isCarwash = cliente.empresaType === 'carwash' || vehiculos.length > 0
  const servicios = isCarwash
    ? SERVICIOS_CARWASH
    : cliente.empresaType === 'restaurante'
      ? SERVICIOS_RESTAURANTE
      : SERVICIOS_GENERICOS
  const isValid = cliente.puedeUsar

  useEffect(() => {
    if (state.success) toast.success('Uso registrado.')
    if (state.error) toast.error(state.error)
    // Nunca "registrado": la visita todavía no existe en el servidor. Decirle
    // al empleado que sí quedó registrada sería la peor mentira posible aquí,
    // porque dejaría de vigilarla.
    if (state.encolada) {
      toast.info('Sin conexión. La visita se enviará sola en cuanto vuelva la red.')
      if (onScanNext) onScanNext()
      else onDone()
    }
  }, [state.success, state.error, state.encolada, onScanNext, onDone])

  if (state.success && state.visitId) {
    return (
      <ComprobanteReceipt
        cliente={cliente}
        visitId={state.visitId}
        servicio={state.servicio ?? servicio}
        restantes={state.restantes ?? 0}
        transaccionId={state.transaccionId}
        codigo={state.codigo}
        ticketNumero={state.ticketNumero}
        ticket={state.ticket}
        onDone={onDone}
        onScanNext={onScanNext}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-3',
          isValid ? 'border-success/25 bg-success/10' : 'border-destructive/25 bg-destructive/10'
        )}
      >
        {isValid ? (
          <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
        ) : (
          <XCircle className="h-6 w-6 shrink-0 text-destructive" />
        )}
        <div>
          <p className={cn('font-bold', isValid ? 'text-success' : 'text-destructive')}>
            {isValid ? 'Membresía válida' : 'Membresía inválida'}
          </p>
          {!isValid && cliente.mensaje && (
            <p className="text-sm text-destructive/90">{cliente.mensaje}</p>
          )}
        </div>
      </div>

      {/* Client card */}
      <div
        className={cn(
          'rounded-xl border-2 bg-card p-4',
          isValid ? 'border-success/30' : 'border-destructive/30'
        )}
      >
        <div className="flex items-start gap-4">
          {cliente.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cliente.avatarUrl}
              alt={cliente.nombre}
              width={64}
              height={64}
              className={cn(
                'h-16 w-16 rounded-2xl object-cover ring-2',
                isValid ? 'ring-success/30' : 'ring-destructive/30'
              )}
            />
          ) : (
            <div
              className={cn(
                'flex h-16 w-16 items-center justify-center rounded-2xl',
                isValid ? 'bg-success/10' : 'bg-destructive/10'
              )}
            >
              <User className={cn('h-8 w-8', isValid ? 'text-success' : 'text-destructive')} />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-h2 leading-tight text-foreground">{cliente.nombre}</p>
            <p className="text-sm text-muted-foreground">{cliente.empresa}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge
                variant={
                  cliente.estado === 'ACTIVA'
                    ? 'success'
                    : cliente.estado === 'VENCIDA'
                      ? 'warning'
                      : 'secondary'
                }
                className="text-caption"
              >
                {cliente.estado ?? 'Sin membresía'}
              </Badge>
              {cliente.esIlimitado && (
                <Badge variant="warning" className="text-caption">
                  <Sparkles className="mr-1 h-3 w-3" /> Ilimitado
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Info grid */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-border/60 pt-3">
          <InfoRow label="Plan" value={cliente.planNombre ?? 'Sin plan'} icon={CreditCard} />
          <InfoRow
            label="Usos restantes"
            value={cliente.esIlimitado ? 'Ilimitado' : `${cliente.lavadosRestantes} de ${cliente.lavadosIncluidos}`}
            icon={Gift}
          />
          <InfoRow label="Inicio" value={fmtDate(cliente.fechaInicio)} icon={Calendar} />
          <InfoRow label="Vencimiento" value={fmtDate(cliente.fechaVencimiento)} icon={Calendar} />
          <InfoRow
            label="Total visitas"
            value={String(cliente.totalVisitas)}
            icon={Shield}
          />
          <InfoRow
            label="Último uso"
            value={cliente.ultimoUso ? fmtDateTime(cliente.ultimoUso) : 'Primera vez'}
            icon={Clock}
          />
        </div>

        {/* Beneficios */}
        {planBeneficios.length > 0 && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <p className="mb-1.5 text-overline text-muted-foreground">
              Beneficios incluidos
            </p>
            <div className="flex flex-wrap gap-1.5">
              {planBeneficios.map((b) => (
                <Badge key={b} variant="info" className="text-caption">
                  {b}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Promociones */}
        {cliente.promocionesActivas > 0 && (
          <div className="mt-2 flex items-center gap-2 text-caption text-muted-foreground">
            <Megaphone className="h-3.5 w-3.5 text-primary" />
            <span>{cliente.promocionesActivas} promoción{cliente.promocionesActivas !== 1 ? 'es' : ''} disponible{cliente.promocionesActivas !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Alerts */}
      {alertas.length > 0 && (
        <div className="space-y-1.5">
          {alertas.map((alerta) => (
            <div
              key={alerta}
              className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning-foreground"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {alerta}
            </div>
          ))}
        </div>
      )}

      {/* Recent visits */}
      {visitasRecientes.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-overline text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Últimas visitas
          </p>
          <div className="space-y-1">
            {visitasRecientes.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{v.servicio}</span>
                <span className="text-caption text-muted-foreground">{fmtDateTime(v.fecha)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action area */}
      {!isValid ? (
        <div className="space-y-3">
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              {cliente.mensaje ?? 'No se puede registrar esta visita.'}
            </AlertDescription>
          </Alert>
          <Button onClick={onScanNext ?? onDone} size="xl" className="w-full">
            Escanear siguiente
          </Button>
        </div>
      ) : (
        <form action={formAction} className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
          <input type="hidden" name="membershipId" value={cliente.membershipId ?? ''} />
          <input type="hidden" name="qrTokenId" value={cliente.qrTokenId ?? ''} />
          <input type="hidden" name="servicio" value={servicio} />
          <input type="hidden" name="vehiculoId" value={vehiculoId} />
          <input type="hidden" name="sucursalId" value={sucursalId} />

          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <p className="text-sm font-semibold text-foreground">Registrar visita</p>

          {sucursales.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-caption">Sucursal</Label>
              <Select value={sucursalId} onValueChange={setSucursalId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona sucursal (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {sucursales.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-caption">Servicio *</Label>
            <Select value={servicio} onValueChange={setServicio}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un servicio" />
              </SelectTrigger>
              <SelectContent>
                {servicios.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* §13: el empleado ve para QUÉ vehículo es la membresía (placa y
              categoría incluidas) y confirma de un vistazo. Solo aparece en
              membresías con vehículo asociado (compras del rediseño). */}
          {vehiculosMembresia.length > 0 && (
            <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-caption">
              <p className="font-semibold text-foreground">
                Membresía para{vehiculosMembresia.length > 1 ? ' estos vehículos' : ''}:
              </p>
              {vehiculosMembresia.map((v) => (
                <p key={v.id} className="mt-0.5 text-muted-foreground">{v.label}</p>
              ))}
            </div>
          )}

          {vehiculos.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-caption">Vehículo</Label>
              <Select value={vehiculoId} onValueChange={setVehiculoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona vehículo (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {vehiculos.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.label}
                      {vehiculosMembresia.length > 0 && !asociadosIds.has(v.id)
                        ? ' — no asociado a la membresía'
                        : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notas" className="text-caption">Notas</Label>
            <Textarea id="notas" name="notas" rows={2} placeholder="Observaciones opcionales…" />
          </div>

          <div className="space-y-2 pt-1">
            {!servicio && (
              <p className="text-center text-small text-muted-foreground">
                Selecciona el servicio para poder confirmar.
              </p>
            )}
            <div className="flex gap-3">
              <Button
                type="submit"
                variant="success"
                disabled={pending || !servicio}
                className="flex-1 font-semibold"
                size="xl"
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Confirmar uso
              </Button>
              <Button type="button" variant="outline" onClick={onDone} size="xl">
                Cancelar
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
