'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  Banknote,
  Coins,
  Landmark,
  Loader2,
  Lock,
  Search,
  Store,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import Form from 'next/form'
import {
  abrirCaja,
  cerrarCaja,
  cobrarOrden,
  type CajaActionState,
} from '@/modules/caja/actions'
import type { OrdenPendiente } from '@/modules/caja/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@membego/ui/cn'

const initial: CajaActionState = {}

function useToastState(state: CajaActionState) {
  useEffect(() => {
    if (state.success && state.detalle) toast.success(state.detalle)
    if (state.error) toast.error(state.error)
  }, [state])
}

/** Apertura de caja: sucursal + balance inicial + turno. */
export function AbrirCajaForm({
  sucursales,
}: {
  sucursales: { id: string; nombre: string; direccion: string | null }[]
}) {
  const [state, formAction, pending] = useActionState(abrirCaja, initial)
  useToastState(state)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="sucursalId">Sucursal</Label>
        <select
          id="sucursalId"
          name="sucursalId"
          required
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
        >
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
              {s.direccion ? ` — ${s.direccion}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="balanceInicial">Efectivo inicial (RD$)</Label>
          <Input id="balanceInicial" name="balanceInicial" type="number" min="0" step="0.01" defaultValue="0" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="turno">Turno (opcional)</Label>
          <Input id="turno" name="turno" placeholder="Mañana / Tarde / Noche" />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="w-full py-6 text-base font-semibold">
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Abrir caja
      </Button>
    </form>
  )
}

/** Cierre con arqueo: efectivo contado + observaciones. */
export function CerrarCajaForm({
  cajaSesionId,
  esperado,
}: {
  cajaSesionId: string
  /** inicial + efectivo cobrado en la sesión (referencia para el conteo). */
  esperado: number
}) {
  const [state, formAction, pending] = useActionState(cerrarCaja, initial)
  const [abierto, setAbierto] = useState(false)
  useToastState(state)

  if (!abierto) {
    return (
      <Button variant="outline" onClick={() => setAbierto(true)} className="w-full gap-2">
        <Lock className="h-4 w-4" /> Cerrar caja
      </Button>
    )
  }

  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <input type="hidden" name="cajaSesionId" value={cajaSesionId} />
      <p className="text-sm font-semibold text-foreground">Cierre de caja (arqueo)</p>
      <p className="text-caption text-muted-foreground">
        Efectivo esperado: <strong className="tabular-nums">RD${esperado.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>.
        Cuenta el efectivo real y regístralo; la diferencia queda en el historial.
      </p>
      <div className="space-y-2">
        <Label htmlFor="balanceFinal">Efectivo contado (RD$)</Label>
        <Input id="balanceFinal" name="balanceFinal" type="number" min="0" step="0.01" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="observaciones">Observaciones (opcional)</Label>
        <Textarea id="observaciones" name="observaciones" rows={2} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setAbierto(false)} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="flex-1">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Confirmar cierre
        </Button>
      </div>
    </form>
  )
}

/** Buscador de órdenes (GET: recarga la lista server-rendered). */
export function BuscadorOrdenes({ q }: { q: string }) {
  return (
    <Form action="/empleado/caja" className="flex gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={q}
          placeholder="Referencia, nombre, teléfono o correo…"
          className="pl-9"
        />
      </div>
      <Button type="submit" variant="secondary">
        Buscar
      </Button>
    </Form>
  )
}

const ESTADO_CHIP: Record<string, string> = {
  PENDIENTE: 'bg-warning/15 text-warning-foreground',
  PENDIENTE_PAGO: 'bg-info/10 text-info',
  EN_VALIDACION: 'bg-info/10 text-info',
  SOLICITADA: 'bg-warning/15 text-warning-foreground',
  RECHAZADA: 'bg-destructive/10 text-destructive',
  CAMBIO_PLAN: 'bg-primary/10 text-primary',
}

const METODOS = [
  { value: 'EFECTIVO', label: 'Efectivo', icon: Banknote },
  { value: 'TRANSFERENCIA', label: 'Transferencia', icon: Landmark },
  { value: 'MIXTO', label: 'Mixto', icon: Coins },
  { value: 'OTRO', label: 'Otro', icon: Wallet },
] as const

/** Tarjeta de orden pendiente con el flujo de cobro en 2 toques. */
export function OrdenCobroCard({
  orden,
  cajaSesionId,
}: {
  orden: OrdenPendiente
  cajaSesionId: string
}) {
  const [state, formAction, pending] = useActionState(cobrarOrden, initial)
  const [cobrando, setCobrando] = useState(false)
  const [metodo, setMetodo] = useState<string>('EFECTIVO')
  // Pago mixto: el cajero escribe la parte en EFECTIVO y la transferencia se
  // deriva del total (nunca quedan partes que no suman).
  const [efectivoMixto, setEfectivoMixto] = useState('')
  const efectivoNum = Math.round((Number(efectivoMixto) || 0) * 100) / 100
  const transferenciaNum = Math.max(0, Math.round((orden.monto - efectivoNum) * 100) / 100)
  const mixtoValido = efectivoNum > 0 && efectivoNum < orden.monto
  useToastState(state)

  if (state.success) {
    return (
      <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm">
        <p className="font-semibold text-success">Cobro registrado ✔</p>
        <p className="mt-1 text-foreground">
          {orden.clienteNombre} · {orden.detalle} · RD${orden.monto.toLocaleString('es-DO')}
        </p>
        {state.detalle && <p className="mt-1 text-caption text-muted-foreground">{state.detalle}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{orden.clienteNombre}</p>
          <p className="truncate text-sm text-muted-foreground">{orden.detalle}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
            {orden.referencia && (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono font-bold text-foreground">
                {orden.referencia}
              </code>
            )}
            {orden.clienteTelefono && <span>{orden.clienteTelefono}</span>}
            {orden.sucursalPago && (
              <span className="inline-flex items-center gap-1">
                <Store className="h-3 w-3" /> {orden.sucursalPago}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-h3 tabular-nums text-foreground">
            RD${orden.monto.toLocaleString('es-DO')}
          </p>
          <span
            className={cn(
              'mt-1 inline-block rounded-full px-2 py-0.5 text-caption font-bold uppercase tracking-wide',
              ESTADO_CHIP[orden.estado] ?? 'bg-muted text-muted-foreground'
            )}
          >
            {orden.estado.replaceAll('_', ' ')}
          </span>
        </div>
      </div>

      {!cobrando ? (
        <Button onClick={() => setCobrando(true)} className="mt-3 w-full font-semibold">
          Cobrar
        </Button>
      ) : (
        <form action={formAction} className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <input type="hidden" name="cajaSesionId" value={cajaSesionId} />
          <input type="hidden" name="ordenTipo" value={orden.tipo} />
          <input type="hidden" name="ordenId" value={orden.id} />
          <input type="hidden" name="metodoCobro" value={metodo} />

          <div className="grid grid-cols-4 gap-2">
            {METODOS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMetodo(value)}
                aria-pressed={metodo === value}
                className={cn(
                  'rounded-xl border p-2.5 text-center text-caption font-semibold transition',
                  metodo === value
                    ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                    : 'border-border/70 text-muted-foreground hover:border-primary/40'
                )}
              >
                <Icon className="mx-auto mb-1 h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {metodo === 'MIXTO' && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Label htmlFor={`efectivo-${orden.id}`} className="w-28 shrink-0 text-caption">
                  En efectivo
                </Label>
                <Input
                  id={`efectivo-${orden.id}`}
                  type="number"
                  min={0.01}
                  max={orden.monto}
                  step="0.01"
                  value={efectivoMixto}
                  onChange={(e) => setEfectivoMixto(e.target.value)}
                  placeholder="0.00"
                  className="h-9"
                />
              </div>
              <p className="text-caption text-muted-foreground">
                Por transferencia:{' '}
                <strong className="tabular-nums text-foreground">
                  RD${transferenciaNum.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </strong>
                {' '}(se registra un comprobante por cada parte).
              </p>
              {!mixtoValido && efectivoMixto !== '' && (
                <p className="text-caption text-destructive">
                  El efectivo debe ser mayor que 0 y menor que el total.
                </p>
              )}
              <input type="hidden" name="montoEfectivo" value={efectivoNum} />
              <input type="hidden" name="montoTransferencia" value={transferenciaNum} />
            </div>
          )}

          <Input name="observaciones" placeholder="Observaciones (opcional)" />

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setCobrando(false)} className="flex-1">
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={pending || (metodo === 'MIXTO' && !mixtoValido)}
              className="flex-1 font-semibold"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar RD${orden.monto.toLocaleString('es-DO')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
