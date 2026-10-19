'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CreditCard, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Target = { membershipId: string } | { compraId: string }
type Card = {
  id: string
  marca: string | null
  ultimos4: string | null
  vencMes: number | null
  vencAnio: number | null
  predeterminada: boolean
  eliminacionPendiente: boolean
  vencida: boolean
}
type Result = { ok?: boolean; status?: string; sessionId?: string; error?: string }

export function PagoCardnetGuardada({ objetivo, montoTexto, onAprobado, onIniciar }: {
  objetivo: Target
  montoTexto: string
  onAprobado: () => void
  onIniciar?: () => void
}) {
  const [cards, setCards] = useState<Card[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activationCode, setActivationCode] = useState('')
  const [busy, setBusy] = useState(false)
  const polling = useRef(false)
  const terminal = useRef(false)

  useEffect(() => {
    let active = true
    void fetch('/api/pagos/cardnet-token/guardada/tarjetas', { cache: 'no-store' })
      .then(async (response) => response.ok ? await response.json() as { tarjetas?: Card[] } : null)
      .then((data) => { if (active) setCards(data?.tarjetas ?? []) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const poll = useCallback(async () => {
    if (!sessionId || polling.current || terminal.current) return
    polling.current = true
    try {
      const response = await fetch('/api/pagos/cardnet-token/guardada/estado', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const data = await response.json() as Result
      if (data.status) setStatus(data.status)
      if (data.status === 'approved') {
        terminal.current = true
        onAprobado()
      } else if (data.status === 'declined') {
        terminal.current = true
        setError('El banco no aprobó el pago. Puedes intentarlo con otra tarjeta.')
      } else if (data.status === 'expired') {
        terminal.current = true
        setError('La sesión venció. Inicia un nuevo intento de pago.')
      }
    } catch {
      setError('No pudimos consultar el pago. Seguiremos verificando de forma segura.')
    } finally {
      polling.current = false
    }
  }, [onAprobado, sessionId])

  useEffect(() => {
    if (!sessionId || terminal.current) return
    void poll()
    const interval = setInterval(() => void poll(), 2500)
    return () => clearInterval(interval)
  }, [poll, sessionId])

  const iniciar = async () => {
    if (!selectedId || busy) return
    onIniciar?.()
    setBusy(true)
    setError(null)
    terminal.current = false
    try {
      const response = await fetch('/api/pagos/cardnet-token/guardada/sesion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...objetivo, tarjetaGuardadaId: selectedId }),
      })
      const data = await response.json() as Result
      if (!response.ok || !data.sessionId) throw new Error(data.error || 'No se pudo iniciar el pago.')
      setStatus(data.status ?? 'processing')
      setSessionId(data.sessionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el pago.')
    } finally {
      setBusy(false)
    }
  }

  const activar = async () => {
    if (!sessionId || busy || !/^[A-Za-z0-9]{6}$/.test(activationCode.trim())) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/pagos/cardnet-token/guardada/activar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, activationCode: activationCode.trim() }),
      })
      const data = await response.json() as Result
      if (data.status) setStatus(data.status)
      if (!response.ok) setError(data.error || 'No pudimos confirmar la activación.')
      else if (data.status === 'declined') setError('El banco no aprobó el pago.')
      else if (data.status === 'expired') { terminal.current = true; setError('La tarjeta ya no está disponible. Elige otra.') }
    } catch {
      setError('No pudimos confirmar la activación. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const available = cards.filter((card) => !card.vencida && !card.eliminacionPendiente)
  if (available.length === 0) return null

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label="Pagar con una tarjeta guardada">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Usar una tarjeta guardada</h3>
      </div>
      <div className="space-y-2">
        {available.map((card) => {
          const selected = selectedId === card.id
          return (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={busy || !!sessionId}
              onClick={() => setSelectedId(selected ? null : card.id)}
              className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${selected ? 'border-primary bg-primary/5' : 'border-border'} disabled:opacity-60`}
            >
              <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 text-sm font-medium text-foreground">
                {card.marca || 'Tarjeta'}{card.ultimos4 ? ` ···· ${card.ultimos4}` : ''}
                <span className="block text-xs font-normal text-muted-foreground">
                  {card.vencMes && card.vencAnio ? `Vence ${String(card.vencMes).padStart(2, '0')}/${card.vencAnio}` : 'Guardada en CardNET'}
                  {card.predeterminada ? ' · Predeterminada' : ''}
                </span>
              </span>
              {selected ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
            </button>
          )
        })}
      </div>
      {status === 'activation_required' ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" />Ingresa el código que aparece en el cargo de verificación de tu banco.</p>
          <div className="flex gap-2">
            <input aria-label="Código de activación" inputMode="text" maxLength={6} value={activationCode} onChange={(event) => setActivationCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm tracking-widest" />
            <Button type="button" disabled={busy || !/^[A-Za-z0-9]{6}$/.test(activationCode)} onClick={() => void activar()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verificar'}</Button>
          </div>
        </div>
      ) : sessionId ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            {status === 'declined' || status === 'expired' ? null : <Loader2 className="h-4 w-4 animate-spin" />}
            {status === 'declined' || status === 'expired' ? 'El pago terminó.' : 'Confirmando tu pago…'}
          </p>
          {status === 'declined' || status === 'expired' ? (
            <Button type="button" variant="outline" onClick={() => {
              terminal.current = false
              setSessionId(null)
              setStatus(null)
              setError(null)
              setSelectedId(null)
            }}>Elegir otra tarjeta o reintentar</Button>
          ) : null}
        </div>
      ) : (
        <Button type="button" disabled={!selectedId || busy} onClick={() => void iniciar()} className="w-full">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Pagar {montoTexto} con esta tarjeta
        </Button>
      )}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
      <p className="text-xs leading-5 text-muted-foreground">El pago se procesa solo cuando lo confirmas aquí. No activa renovaciones automáticas.</p>
    </section>
  )
}
