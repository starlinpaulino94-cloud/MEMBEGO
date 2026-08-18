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
import { Camera, Keyboard, Loader2, CheckCircle2, AlertTriangle, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  buscarParaCheckin,
  registrarCheckin,
  type CheckinBusqueda,
  type CheckinActionState,
} from '@/modules/excursiones/checkin/actions'
import { QRScanner } from '@/components/scanner/QRScanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatMoney } from '@/lib/format'

const init: CheckinActionState = {}

type Reserva = NonNullable<CheckinBusqueda['reserva']>

export function CheckinScanner() {
  const router = useRouter()
  const [modo, setModo] = useState<'camara' | 'codigo'>('codigo')
  const [codigo, setCodigo] = useState('')
  const [reserva, setReserva] = useState<Reserva | null>(null)
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
        setError(res.error)
        return
      }
      if (res.reserva) {
        setReserva(res.reserva)
        setPresentes(String(res.reserva.totalPasajeros))
      }
    })
  }, [state.success])

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
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-h3 text-foreground">{reserva.cliente}</p>
              <p className="text-sm text-muted-foreground">{reserva.excursion}</p>
              <p className="text-caption text-muted-foreground">
                <span className="font-mono">{reserva.numero}</span> ·{' '}
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

          {reserva.yaEmbarcada ? (
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

        <form action={confirmarAction} className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <input type="hidden" name="reservaId" value={reserva.id} />
          <div>
            <Label htmlFor="chk-presentes">¿Cuántos se suben?</Label>
            <Input
              id="chk-presentes"
              name="presentes"
              type="number"
              min="0"
              max={reserva.totalPasajeros}
              value={presentes}
              onChange={(e) => setPresentes(e.target.value)}
              className="text-h3"
            />
            <p className="mt-1 text-caption text-muted-foreground">
              Reservaron {reserva.totalPasajeros}. Si falta alguien, baja el número.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={confirmando} className="gap-2">
              {confirmando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserCheck className="h-4 w-4" />
              )}
              Confirmar embarque
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
