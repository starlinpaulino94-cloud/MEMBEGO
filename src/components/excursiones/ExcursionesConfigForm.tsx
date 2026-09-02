'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  guardarExcursionesConfig,
  type ConfigActionState,
} from '@/modules/excursiones/config-actions'
import type { ExcursionesConfigResuelta } from '@/modules/excursiones/config'
import { Save, Settings2, ShieldCheck, RefreshCcw, DollarSign, FileText, ScanLine, CalendarDays, Bell, CreditCard, ArrowLeftRight } from 'lucide-react'

const init: ConfigActionState = {}

export function ExcursionesConfigForm({
  config,
}: {
  config: ExcursionesConfigResuelta
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(guardarExcursionesConfig, init)

  const [permitirReduccion, setPermitirReduccion] = useState(
    config.politica.permitirReduccionPasajeros
  )
  const [permitirCancelacion, setPermitirCancelacion] = useState(
    config.politica.permitirCancelacion
  )
  const [tipoReembolso, setTipoReembolso] = useState(config.politica.tipoReembolso)

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) {
      toast.error(state.error)
    }
  }, [state, router])

  return (
    <form action={formAction} className="space-y-6">
      {/* 1. Atribución y Moneda */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <Settings2 className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Atribución y Operación Comercial
            </h2>
            <p className="text-xs text-muted-foreground">
              Reglas de asignación de ventas a vendedores y configuración de moneda.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="politicaAtribucion" className="text-xs font-semibold">
              Política de atribución
            </Label>
            <select
              id="politicaAtribucion"
              name="politicaAtribucion"
              defaultValue={config.politicaAtribucion}
              className="mt-1.5 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="PRIMERA">Primer contacto (First Touch)</option>
              <option value="ULTIMA">Último contacto (Last Touch)</option>
              <option value="RESERVA">Al momento de la reserva</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Define qué vendedor recibe la comisión cuando el cliente interactúa con varios enlaces.
            </p>
          </div>

          <div>
            <Label htmlFor="ventanaAtribucionDias" className="text-xs font-semibold">
              Ventana de atribución (días)
            </Label>
            <Input
              id="ventanaAtribucionDias"
              name="ventanaAtribucionDias"
              type="number"
              min={1}
              max={365}
              defaultValue={config.ventanaAtribucionDias}
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Días que vive una atribución de visita/escaneo sin registro previo.
            </p>
          </div>

          <div>
            <Label htmlFor="monedaDefecto" className="text-xs font-semibold">
              Moneda por defecto
            </Label>
            <select
              id="monedaDefecto"
              name="monedaDefecto"
              defaultValue={config.monedaDefecto}
              className="mt-1.5 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="DOP">RD$ — Peso dominicano</option>
              <option value="USD">US$ — Dólar estadounidense</option>
              <option value="EUR">€ — Euro</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Moneda base para precios y liquidaciones.
            </p>
          </div>

          <div>
            <Label htmlFor="reglaAprobacion" className="text-xs font-semibold">
              Aprobación de comisiones
            </Label>
            <select
              id="reglaAprobacion"
              name="reglaAprobacion"
              defaultValue={config.reglaAprobacion}
              className="mt-1.5 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="MANUAL">Manual (Revisión por supervisor)</option>
              <option value="AUTOMATICA">Automática (Al confirmar la venta)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Cómo pasan las comisiones generadas a estado APROBADA para liquidación.
            </p>
          </div>
        </div>
      </div>

      {/* 2. Políticas de Reserva y Modificación */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <RefreshCcw className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Políticas de Modificación y Cancelación
            </h2>
            <p className="text-xs text-muted-foreground">
              Controla si los clientes pueden reducir pasajeros o cancelar y los tiempos límites requeridos.
            </p>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* Reducción de pasajeros */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
            <label htmlFor="permitirReduccionPasajeros" className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer hover:bg-muted transition-colors">
              <input
                type="checkbox"
                id="permitirReduccionPasajeros"
                name="permitirReduccionPasajeros"
                checked={permitirReduccion}
                onChange={(e) => setPermitirReduccion(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
              />
              <span className="text-xs font-bold text-foreground">Permitir reducción de pasajeros</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Permite al cliente o admin reducir la cantidad de pasajeros en una reserva confirmada o pendiente.
            </p>

            {permitirReduccion && (
              <div>
                <Label htmlFor="anticipacionMinimaHoras" className="text-xs font-semibold">
                  Anticipación mínima para modificar (horas)
                </Label>
                <Input
                  id="anticipacionMinimaHoras"
                  name="anticipacionMinimaHoras"
                  type="number"
                  min={0}
                  max={720}
                  defaultValue={config.politica.anticipacionMinimaHoras}
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Horas antes del tour para poder reducir pasajeros (ej. 24 = hasta 1 día antes).
                </p>
              </div>
            )}
          </div>

          {/* Cancelación */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
            <label htmlFor="permitirCancelacion" className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer hover:bg-muted transition-colors">
              <input
                type="checkbox"
                id="permitirCancelacion"
                name="permitirCancelacion"
                checked={permitirCancelacion}
                onChange={(e) => setPermitirCancelacion(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
              />
              <span className="text-xs font-bold text-foreground">Permitir cancelación de reserva</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Permite cancelar una reserva completa antes de la fecha de la excursión.
            </p>

            {permitirCancelacion && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="anticipacionCancelacionHoras" className="text-xs font-semibold">
                    Anticipación mínima para cancelar (horas)
                  </Label>
                  <Input
                    id="anticipacionCancelacionHoras"
                    name="anticipacionCancelacionHoras"
                    type="number"
                    min={0}
                    max={720}
                    defaultValue={config.politica.anticipacionCancelacionHoras}
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Horas antes de la excursión requeridas para cancelar (ej. 48 = 2 días antes).
                  </p>
                </div>

                <div>
                  <Label htmlFor="penalizacionCancelacionPct" className="text-xs font-semibold">
                    Penalización por cancelación (%)
                  </Label>
                  <Input
                    id="penalizacionCancelacionPct"
                    name="penalizacionCancelacionPct"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={config.politica.penalizacionCancelacionPct}
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Porcentaje retenido al cancelar (0% = reembolso completo de lo pagado).
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Políticas de Reembolso */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <DollarSign className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Políticas de Reembolso
            </h2>
            <p className="text-xs text-muted-foreground">
              Tipo de reembolso otorgado en cancelaciones o reducciones con saldo a favor.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="tipoReembolso" className="text-xs font-semibold">
              Tipo de reembolso
            </Label>
            <select
              id="tipoReembolso"
              name="tipoReembolso"
              value={tipoReembolso}
              onChange={(e) => setTipoReembolso(e.target.value as typeof tipoReembolso)}
              className="mt-1.5 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="COMPLETO">Reembolso monetario directo (Total o Parcial)</option>
              <option value="PARCIAL">Reembolso parcial solo con autorización</option>
              <option value="CREDITO">Crédito a favor para futuras reservas</option>
              <option value="NINGUNO">Sin reembolsos monetarios</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Cómo se procesa la diferencia si el cliente pagó por adelantado y reduce pasajeros.
            </p>
          </div>

          <div>
            <Label htmlFor="horasLimiteReembolso" className="text-xs font-semibold">
              Horas límite para reembolso
            </Label>
            <Input
              id="horasLimiteReembolso"
              name="horasLimiteReembolso"
              type="number"
              min={0}
              max={720}
              defaultValue={config.politica.horasLimiteReembolso}
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Horas antes de la excursión para poder procesar la devolución.
            </p>
          </div>
        </div>
      </div>

      {/* 4. Notas y Políticas Visibles al Cliente */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <FileText className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Notas y Políticas para el Cliente
            </h2>
            <p className="text-xs text-muted-foreground">
              Texto descriptivo visible en el catálogo y detalle de reservas.
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="notasPoliticas" className="text-xs font-semibold">
            Términos y condiciones de reserva (texto libre)
          </Label>
          <Textarea
            id="notasPoliticas"
            name="notasPoliticas"
            rows={4}
            defaultValue={config.notasPoliticas ?? ''}
            placeholder="Ej: Las cancelaciones con más de 48 horas tienen reembolso del 100%. No se aceptan modificaciones con menos de 24 horas..."
            className="mt-1.5 text-xs sm:text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Este texto se presentará a los clientes al reservar y en sus comprobantes.
          </p>
        </div>
      </div>

      {/* 5. Configuración de Check-in */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <ScanLine className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Configuración de Check-in
            </h2>
            <p className="text-xs text-muted-foreground">
              Controla el comportamiento del escáner de check-in y los códigos QR.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 items-start">
          <div>
            <Label htmlFor="diasGraciaCheckin" className="text-xs font-semibold">
              Días de gracia
            </Label>
            <Input
              id="diasGraciaCheckin"
              name="diasGraciaCheckin"
              type="number"
              min={0}
              max={30}
              defaultValue={config.diasGraciaCheckin}
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Días antes/después del tour que se permite hacer check-in.
            </p>
          </div>

          <label htmlFor="permitirCheckinSinPago" className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer hover:bg-muted transition-colors">
            <input
              type="checkbox"
              id="permitirCheckinSinPago"
              name="permitirCheckinSinPago"
              defaultChecked={config.permitirCheckinSinPago}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
            />
            <span className="text-xs font-bold text-foreground">Permitir check-in sin pago</span>
          </label>

          <div>
            <Label htmlFor="prefijoCheckin" className="text-xs font-semibold">
              Prefijo QR
            </Label>
            <Input
              id="prefijoCheckin"
              name="prefijoCheckin"
              type="text"
              maxLength={10}
              defaultValue={config.prefijoCheckin}
              className="mt-1.5 font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Prefijo del código QR (ej: "EXC:", "TOUR:").
            </p>
          </div>
        </div>
      </div>

      {/* 6. Configuración de Reserva */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <CalendarDays className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Configuración de Reserva
            </h2>
            <p className="text-xs text-muted-foreground">
              Límites de anticipación y capacidad por reserva.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="anticipacionMinimaReservaHoras" className="text-xs font-semibold">
              Anticipación mínima (horas)
            </Label>
            <Input
              id="anticipacionMinimaReservaHoras"
              name="anticipacionMinimaReservaHoras"
              type="number"
              min={0}
              max={720}
              defaultValue={config.anticipacionMinimaReservaHoras}
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Horas mínimas antes del tour para crear una reserva.
            </p>
          </div>

          <div>
            <Label htmlFor="anticipacionMaximaReservaDias" className="text-xs font-semibold">
              Anticipación máxima (días)
            </Label>
            <Input
              id="anticipacionMaximaReservaDias"
              name="anticipacionMaximaReservaDias"
              type="number"
              min={1}
              max={365}
              defaultValue={config.anticipacionMaximaReservaDias}
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Días máximos a futuro para crear una reserva.
            </p>
          </div>

          <div>
            <Label htmlFor="maxPasajerosPorReserva" className="text-xs font-semibold">
              Máximo pasajeros por reserva
            </Label>
            <Input
              id="maxPasajerosPorReserva"
              name="maxPasajerosPorReserva"
              type="number"
              min={1}
              max={1000}
              defaultValue={config.maxPasajerosPorReserva}
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Total máximo de pasajeros (adultos + niños) por reserva.
            </p>
          </div>
        </div>
      </div>

      {/* 7. Notificaciones */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <Bell className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Notificaciones
            </h2>
            <p className="text-xs text-muted-foreground">
              Configuración de emails y recordatorios para clientes y admins.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label htmlFor="enviarConfirmacionReserva" className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer hover:bg-muted transition-colors self-end">
            <input
              type="checkbox"
              id="enviarConfirmacionReserva"
              name="enviarConfirmacionReserva"
              defaultChecked={config.enviarConfirmacionReserva}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
            />
            <span className="text-xs font-bold text-foreground">Enviar confirmación de reserva</span>
          </label>

          <div>
            <Label htmlFor="enviarRecordatorioHoras" className="text-xs font-semibold">
              Recordatorio (horas antes)
            </Label>
            <Input
              id="enviarRecordatorioHoras"
              name="enviarRecordatorioHoras"
              type="number"
              min={0}
              max={168}
              defaultValue={config.enviarRecordatorioHoras}
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Horas antes del tour para enviar recordatorio (0 = deshabilitado).
            </p>
          </div>

          <div>
            <Label htmlFor="emailNotificaciones" className="text-xs font-semibold">
              Email de notificaciones
            </Label>
            <Input
              id="emailNotificaciones"
              name="emailNotificaciones"
              type="email"
              defaultValue={config.emailNotificaciones ?? ''}
              placeholder="admin@ejemplo.com"
              className="mt-1.5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Email destino para notificaciones admin.
            </p>
          </div>
        </div>
      </div>

      {/* 8. Métodos de Pago */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <CreditCard className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Métodos de Pago
            </h2>
            <p className="text-xs text-muted-foreground">
              Selecciona qué métodos de pago están habilitados para reservas.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          {['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'DEPOSITO', 'LINK'].map((metodo) => (
            <label key={metodo} htmlFor={`pago_${metodo}`} className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer hover:bg-muted transition-colors">
              <input
                type="checkbox"
                id={`pago_${metodo}`}
                name="metodosPagoHabilitados"
                value={metodo}
                defaultChecked={config.metodosPagoHabilitados.includes(metodo)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
              />
              <span className="text-xs font-bold text-foreground">{metodo.charAt(0) + metodo.slice(1).toLowerCase()}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 9. Tasas de Cambio */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <ArrowLeftRight className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm sm:text-base font-bold text-foreground">
              Tasas de Cambio
            </h2>
            <p className="text-xs text-muted-foreground">
              Configura las tasas de conversión entre monedas para reportes y display.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="tasa_DOP_USD" className="text-xs font-semibold">
              DOP → USD
            </Label>
            <Input
              id="tasa_DOP_USD"
              name="tasa_DOP_USD"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={config.tasasCambio.DOP_USD ?? ''}
              placeholder="0.018"
              className="mt-1.5 font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              1 DOP = X USD
            </p>
          </div>

          <div>
            <Label htmlFor="tasa_USD_DOP" className="text-xs font-semibold">
              USD → DOP
            </Label>
            <Input
              id="tasa_USD_DOP"
              name="tasa_USD_DOP"
              type="number"
              step="0.01"
              min="0"
              defaultValue={config.tasasCambio.USD_DOP ?? ''}
              placeholder="55.5"
              className="mt-1.5 font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              1 USD = X DOP
            </p>
          </div>

          <div>
            <Label htmlFor="tasa_EUR_USD" className="text-xs font-semibold">
              EUR → USD
            </Label>
            <Input
              id="tasa_EUR_USD"
              name="tasa_EUR_USD"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={config.tasasCambio.EUR_USD ?? ''}
              placeholder="1.08"
              className="mt-1.5 font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              1 EUR = X USD
            </p>
          </div>
        </div>
      </div>

      {/* Botón Guardar */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending} className="gap-2 px-6">
          <Save className="h-4 w-4" />
          {pending ? 'Guardando...' : 'Guardar configuración'}
        </Button>
      </div>
    </form>
  )
}
