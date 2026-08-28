'use client'

/**
 * Check-in en el muelle. Dos pasos a propósito: leer y CONFIRMAR.
 *
 * Un escáner que embarca al leer convierte un escaneo accidental en un dato
 * falso del manifiesto, y el manifiesto es lo que después responde «¿quién se
 * subió a ese bus?». Aquí el operador ve el nombre, la excursión y el saldo
 * antes de tocar nada.
 *
 * Acepta el lector físico (que teclea el código) y la cámara del teléfono, que
 * es lo que hay a mano junto a un autobús.
 */

import { useActionState, useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Camera,
  Keyboard,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Layers,
  Clock,
  CalendarDays,
  CheckSquare,
  Square,
  Minus,
  Plus,
  Banknote,
  Lock,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  buscarParaCheckin,
  registrarCheckin,
  registrarCobroCheckin,
  type CheckinBusqueda,
  type CheckinActionState,
} from '@/modules/excursiones/checkin/actions'
import { QRScanner } from '@/components/scanner/QRScanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatMoney, formatDateTime } from '@/lib/format'

const init: CheckinActionState = {}

type Reserva = NonNullable<CheckinBusqueda['reserva']>

export function CheckinScanner() {
  const router = useRouter()
  const [modo, setModo] = useState<'camara' | 'codigo'>('codigo')
  const [codigo, setCodigo] = useState('')
  const [reserva, setReserva] = useState<Reserva | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [cobrarSaldo, setCobrarSaldo] = useState(false)
  const [montoCobro, setMontoCobro] = useState('')
  const [metodoCobro, setMetodoCobro] = useState<'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'LINK'>('EFECTIVO')
  const [referenciaCobro, setReferenciaCobro] = useState('')
  const [cobrandoSolo, startCobroSolo] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [presentes, setPresentes] = useState('')
  const [buscando, iniciarBusqueda] = useTransition()
  const [state, confirmarAction, confirmando] = useActionState(registrarCheckin, init)
  // Qué embarque ya acusó recibo el operador. Comparar contra `state.success`
  // permite saber si hay uno NUEVO sin tocar el estado desde un efecto: el
  // panel de confirmación aparece solo y se cierra cuando él pulsa.
  const [acusado, setAcusado] = useState('')

  useEffect(() => {
    if (state.success) router.refresh()
    if (state.error) toast.error(state.error)
  }, [state, router])

  const embarqueNuevo = !!state.success && state.success !== acusado

  const siguiente = useCallback(() => {
    if (state.success) setAcusado(state.success)
    setReserva(null)
    setSelectedItemIds([])
    setCobrarSaldo(false)
    setMontoCobro('')
    setReferenciaCobro('')
    setCodigo('')
    setError(null)
  }, [state.success])

  const buscar = useCallback((texto: string) => {
    const limpio = texto.trim()
    if (!limpio) return
    setError(null)
    if (state.success) setAcusado(state.success)
    iniciarBusqueda(async () => {
      const res = await buscarParaCheckin(limpio)
      if (res.error) {
        setReserva(null)
        setSelectedItemIds([])
        setError(res.error)
        return
      }
      if (res.reserva) {
        setReserva(res.reserva)
        setPresentes(String(res.reserva.totalPasajeros))
        setMontoCobro(String(res.reserva.saldo))
        setCobrarSaldo(res.reserva.saldo > 0)
        setMetodoCobro('EFECTIVO')
        setReferenciaCobro('')

        // Si es combo, seleccionar por defecto las actividades pendientes de check-in
        if (res.reserva.esCombo && res.reserva.items.length > 0) {
          const pendientes = res.reserva.items
            .filter((it) => !it.checkinAt && it.estado !== 'CHECKIN_COMPLETADO' && it.estado !== 'EMBARCADA')
            .map((it) => it.id)
          if (pendientes.length > 0) {
            setSelectedItemIds(pendientes)
          } else {
            // Si todas estaban completas, seleccionarlas todas por si desea reconfirmar
            setSelectedItemIds(res.reserva.items.map((it) => it.id))
          }
        } else {
          setSelectedItemIds([])
        }
      }
    })
  }, [state.success])

  const handleCobrarSolo = () => {
    if (!reserva) return
    const fd = new FormData()
    fd.set('reservaId', reserva.id)
    fd.set('monto', montoCobro || String(reserva.saldo))
    fd.set('metodo', metodoCobro)
    fd.set('referencia', referenciaCobro)
    startCobroSolo(async () => {
      const res = await registrarCobroCheckin({}, fd)
      if (res.error) {
        toast.error(res.error)
      } else if (res.success) {
        toast.success(res.success)
        if (typeof res.saldoRestante === 'number') {
          setReserva((prev) => (prev ? { ...prev, saldo: res.saldoRestante! } : null))
          setMontoCobro(String(res.saldoRestante))
          if (res.saldoRestante <= 0) {
            setCobrarSaldo(false)
          }
        }
      }
    })
  }

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    )
  }

  const seleccionarTodosItems = () => {
    if (reserva?.items) {
      setSelectedItemIds(reserva.items.map((it) => it.id))
    }
  }

  const seleccionarSoloPendientes = () => {
    if (reserva?.items) {
      const pend = reserva.items
        .filter((it) => !it.checkinAt && it.estado !== 'CHECKIN_COMPLETADO' && it.estado !== 'EMBARCADA')
        .map((it) => it.id)
      setSelectedItemIds(pend.length > 0 ? pend : reserva.items.map((it) => it.id))
    }
  }

  // ── Embarque registrado ───────────────────────────────────────────────────
  if (embarqueNuevo) {
    return (
      <section className="rounded-2xl border border-success/25 bg-success/5 p-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <p className="mt-2 text-h3 text-foreground">{state.success}</p>
        <Button type="button" size="lg" className="mt-4" onClick={siguiente}>
          Escanear el siguiente
        </Button>
      </section>
    )
  }

  // ── Reserva encontrada: confirmar embarque ────────────────────────────────
  if (reserva) {
    const esCombo = reserva.esCombo && reserva.items && reserva.items.length > 0

    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-h3 text-foreground">{reserva.cliente}</p>
                {esCombo && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary border border-primary/20">
                    <Layers className="h-3 w-3" />
                    Combo ({reserva.itemsCompletados}/{reserva.totalItems} embarcados)
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{reserva.excursion}</p>
              <p className="text-caption text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">{reserva.numero}</span> ·{' '}
                {formatDate(new Date(reserva.fecha))}
                {reserva.hora ? ` · ${reserva.hora}` : ''}
              </p>
              {reserva.telefono ? (
                <p className="text-caption text-muted-foreground">{reserva.telefono}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-h2 text-foreground">{reserva.totalPasajeros}</p>
              <p className="text-caption text-muted-foreground">
                {reserva.adultos} adulto{reserva.adultos === 1 ? '' : 's'}
                {reserva.ninos > 0 ? ` · ${reserva.ninos} niño${reserva.ninos === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          </div>

          {reserva.aviso ? (
            <Alert className="mt-3">
              <AlertDescription className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {reserva.aviso}
              </AlertDescription>
            </Alert>
          ) : null}

          {reserva.yaEmbarcada && !esCombo ? (
            <Alert className="mt-3">
              <AlertDescription>
                Esta reserva ya tenía check-in ({reserva.presentes} de {reserva.totalPasajeros}).
                Confirmar de nuevo corrige el número, no lo suma.
              </AlertDescription>
            </Alert>
          ) : null}

          {reserva.saldo > 0 ? (
            <div className="mt-3 flex items-center gap-2">
              <StatusChip tone="warning">
                Debe {formatMoney(reserva.saldo, { moneda: reserva.moneda }, 2)}
              </StatusChip>
              <span className="text-caption text-muted-foreground">
                Cóbralo antes de que suba, o déjalo registrado en la reserva.
              </span>
            </div>
          ) : null}
        </section>

        <form action={confirmarAction} className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <input type="hidden" name="reservaId" value={reserva.id} />

          {/* DESGLOSE Y SELECCIÓN DE ACTIVIDADES EN COMBO */}
          {esCombo && (
            <div className="space-y-3 border-b border-border/80 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <Label className="text-sm font-bold text-foreground">
                    Selecciona las actividades a confirmar en este turno:
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Marca únicamente la actividad que el cliente está por abordar ahora.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={seleccionarTodosItems}
                  >
                    Todas
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={seleccionarSoloPendientes}
                  >
                    Solo pendientes
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {reserva.items.map((item) => {
                  const isChecked = selectedItemIds.includes(item.id)
                  const yaEmbarcado = !!item.checkinAt || item.estado === 'CHECKIN_COMPLETADO' || item.estado === 'EMBARCADA'
                  const esDaypass = item.tipoItem === 'PASE_DIA'

                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleItem(item.id)}
                      className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-start gap-3 select-none ${
                        isChecked
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border bg-background hover:bg-muted/40'
                      }`}
                    >
                      <button
                        type="button"
                        className="mt-0.5 text-primary shrink-0 focus:outline-hidden"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleItem(item.id)
                        }}
                      >
                        {isChecked ? (
                          <CheckSquare className="h-5 w-5 fill-primary text-primary-foreground" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className={`text-sm font-bold ${isChecked ? 'text-primary' : 'text-foreground'}`}>
                            {item.actividadNombre}
                          </span>
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              yaEmbarcado
                                ? 'bg-success/10 text-success border border-success/20'
                                : 'bg-warning/10 text-warning border border-warning/20'
                            }`}
                          >
                            {yaEmbarcado
                              ? `✓ Embarcado ${item.checkinAt ? formatDateTime(new Date(item.checkinAt)) : ''}`
                              : 'Pendiente'}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 font-medium">
                            <CalendarDays className="h-3.5 w-3.5 text-primary/70" />
                            {item.fecha}
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <Clock className="h-3.5 w-3.5 text-primary/70" />
                            {esDaypass ? 'Acceso libre (Pase de Día)' : item.hora ?? 'Horario abierto'}
                          </span>
                        </div>
                      </div>

                      {isChecked && <input type="hidden" name="itemIds" value={item.id} />}
                    </div>
                  )
                })}
              </div>

              {selectedItemIds.length === 0 && (
                <p className="text-xs font-semibold text-destructive">
                  Debes seleccionar al menos una actividad del combo para realizar el check-in.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="chk-presentes" className="text-sm font-bold text-foreground">
                ¿Cuántos pasajeros se suben?
              </Label>
              {parseInt(presentes, 10) !== reserva.totalPasajeros && (
                <button
                  type="button"
                  onClick={() => setPresentes(String(reserva.totalPasajeros))}
                  className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                >
                  Marcar todos ({reserva.totalPasajeros})
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-xl text-foreground hover:bg-muted active:scale-95 shrink-0 border-border"
                disabled={(parseInt(presentes, 10) || 0) <= 0}
                onClick={() => {
                  const act = Math.max(0, (parseInt(presentes, 10) || 0) - 1)
                  setPresentes(String(act))
                }}
              >
                <Minus className="h-5 w-5" />
              </Button>

              <div className="relative flex-1">
                <Input
                  id="chk-presentes"
                  name="presentes"
                  type="number"
                  min="0"
                  max={reserva.totalPasajeros}
                  value={presentes}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '') {
                      setPresentes('')
                      return
                    }
                    const n = parseInt(val, 10)
                    if (!isNaN(n)) {
                      setPresentes(String(Math.max(0, Math.min(reserva.totalPasajeros, n))))
                    }
                  }}
                  className="h-12 text-center text-xl font-bold font-mono"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground pointer-events-none">
                  / {reserva.totalPasajeros} pax
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-xl text-foreground hover:bg-muted active:scale-95 shrink-0 border-border"
                disabled={(parseInt(presentes, 10) || 0) >= reserva.totalPasajeros}
                onClick={() => {
                  const act = Math.min(reserva.totalPasajeros, (parseInt(presentes, 10) || 0) + 1)
                  setPresentes(String(act))
                }}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Reservaron {reserva.totalPasajeros} {reserva.totalPasajeros === 1 ? 'persona' : 'personas'}. Usa los botones + y - si alguien no aborda en este turno.
            </p>
          </div>

          {/* PANEL DE FALTA DE PAGO / COBRO DE SALDO */}
          {reserva.saldo > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-warning">
                      Falta de pago: {formatMoney(reserva.saldo, { moneda: reserva.moneda }, 2)} pendientes
                    </p>
                    <p className="text-xs text-warning">
                      Registra el cobro antes de permitir el acceso al cliente.
                    </p>
                  </div>
                </div>
                <StatusChip tone="warning">Saldo pendiente</StatusChip>
              </div>

              <div className="pt-2 border-t border-warning/20 space-y-3">
                <label className="flex items-center gap-2.5 text-xs font-bold text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="cobrarSaldo"
                    value="true"
                    checked={cobrarSaldo}
                    onChange={(e) => setCobrarSaldo(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Registrar cobro de saldo al confirmar el embarque</span>
                </label>

                {cobrarSaldo && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <Label className="text-xs font-semibold">Monto a cobrar ({reserva.moneda})</Label>
                      <Input
                        name="montoCobro"
                        type="number"
                        step="0.01"
                        min="0"
                        max={reserva.saldo}
                        value={montoCobro}
                        onChange={(e) => setMontoCobro(e.target.value)}
                        className="mt-1 font-mono font-bold text-sm bg-background"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-semibold">Método de cobro</Label>
                      <select
                        name="metodoCobro"
                        value={metodoCobro}
                        onChange={(e) =>
                          setMetodoCobro(
                            e.target.value as 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'LINK'
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                      >
                        <option value="EFECTIVO">Efectivo</option>
                        <option value="TARJETA">Tarjeta / POS</option>
                        <option value="TRANSFERENCIA">Transferencia</option>
                        <option value="LINK">Link de Pago</option>
                      </select>
                    </div>

                    <div>
                      <Label className="text-xs font-semibold">Referencia / POS (opcional)</Label>
                      <Input
                        name="referenciaCobro"
                        type="text"
                        placeholder="Ej: Aprobación #1234"
                        value={referenciaCobro}
                        onChange={(e) => setReferenciaCobro(e.target.value)}
                        className="mt-1 text-sm bg-background"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={cobrandoSolo}
                    onClick={handleCobrarSolo}
                    className="text-xs border-warning/40 text-warning hover:bg-warning/10 gap-1.5"
                  >
                    {cobrandoSolo ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Banknote className="h-3.5 w-3.5" />
                    )}
                    Registrar solo el pago ahora
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* MENSAJE DE BLOQUEO POR FALTA DE PAGO */}
          {reserva.saldo > 0.01 && (!cobrarSaldo || (Number(montoCobro) || 0) < reserva.saldo - 0.01) && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <span>
                Embarque bloqueado por falta de pago: Debes marcar y registrar el cobro de los {formatMoney(reserva.saldo, { moneda: reserva.moneda }, 2)} pendientes para autorizar el acceso.
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              type="submit"
              size="lg"
              disabled={
                confirmando ||
                (esCombo && selectedItemIds.length === 0) ||
                (reserva.saldo > 0.01 && (!cobrarSaldo || (Number(montoCobro) || 0) < reserva.saldo - 0.01))
              }
              className="gap-2"
            >
              {confirmando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : reserva.saldo > 0.01 && (!cobrarSaldo || (Number(montoCobro) || 0) < reserva.saldo - 0.01) ? (
                <Lock className="h-4 w-4" />
              ) : (
                <UserCheck className="h-4 w-4" />
              )}
              {reserva.saldo > 0.01 && (!cobrarSaldo || (Number(montoCobro) || 0) < reserva.saldo - 0.01)
                ? 'Embarque bloqueado (Requiere Pago)'
                : reserva.saldo > 0.01 && cobrarSaldo
                ? `Cobrar ${formatMoney(Number(montoCobro) || reserva.saldo, { moneda: reserva.moneda }, 2)} y Confirmar`
                : esCombo
                ? `Confirmar embarque (${selectedItemIds.length} ${
                    selectedItemIds.length === 1 ? 'actividad' : 'actividades'
                  })`
                : 'Confirmar embarque'}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={siguiente}
            >
              Escanear otro
            </Button>
          </div>
        </form>
      </div>
    )
  }

  // ── Lectura ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={modo === 'codigo' ? 'default' : 'outline'}
          size="sm"
          className="gap-1.5"
          onClick={() => setModo('codigo')}
        >
          <Keyboard className="h-4 w-4" /> Código
        </Button>
        <Button
          type="button"
          variant={modo === 'camara' ? 'default' : 'outline'}
          size="sm"
          className="gap-1.5"
          onClick={() => setModo('camara')}
        >
          <Camera className="h-4 w-4" /> Cámara
        </Button>
      </div>

      {modo === 'camara' ? (
        <QRScanner onScan={(texto) => buscar(texto)} onUseReader={() => setModo('codigo')} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            buscar(codigo)
          }}
          className="space-y-3 rounded-2xl border border-border bg-card p-5"
        >
          <div>
            <Label htmlFor="chk-codigo">Código de la reserva</Label>
            <Input
              id="chk-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="EXC:…"
              autoFocus
              autoComplete="off"
            />
            <p className="mt-1 text-caption text-muted-foreground">
              Un lector físico escribe aquí solo: escanea y pulsa buscar.
            </p>
          </div>
          <Button type="submit" disabled={buscando} className="gap-2">
            {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Buscar reserva
          </Button>
        </form>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
