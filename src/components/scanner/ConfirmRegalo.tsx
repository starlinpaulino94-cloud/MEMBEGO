'use client'

/**
 * Confirmación de canje de un REGALO VIP (escáner). Mismo patrón que
 * ConfirmPromo; lo distinto es el cupo: por PERÍODO (se renueva solo), así
 * que el cliente siempre recibe un QR nuevo tras el canje — el regalo nunca
 * queda «consumido», solo agota el período.
 */

import { useActionState, useEffect } from 'react'
import {
  Loader2,
  XCircle,
  CheckCircle2,
  User,
  Gift,
  Ticket,
  Clock,
  ScanLine,
} from 'lucide-react'
import { toast } from 'sonner'
import { confirmarCanjeRegalo, type CanjeRegaloState } from '@/modules/ofertas/canjeActions'
import type { RegaloLookup } from '@/modules/visitas/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

const init: CanjeRegaloState = {}

const PERIODO_TXT: Record<string, string> = {
  SEMANAL: 'a la semana',
  MENSUAL: 'al mes',
  TOTAL: 'en total',
}

function fmtFecha(iso: string | null) {
  if (!iso) return 'Sin vencimiento'
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(iso))
}

export function ConfirmRegalo({
  regalo,
  onDone,
  onScanNext,
}: {
  regalo: RegaloLookup
  onDone: () => void
  onScanNext?: () => void
}) {
  const [state, formAction, pending] = useActionState(confirmarCanjeRegalo, init)

  useEffect(() => {
    if (state.success) toast.success('Canje registrado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  // ── Éxito ─────────────────────────────────────────────────────────────────
  if (state.success) {
    return (
      <div className="space-y-5">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 className="h-9 w-9 text-success" />
          </div>
          <h3 className="text-h2 text-foreground">Canje registrado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.restantes === 0
              ? `Cupo del período completo. Se renueva solo ${PERIODO_TXT[regalo.periodo] ?? ''} y el cliente ya tiene su QR nuevo.`
              : `Quedan ${state.restantes} uso${state.restantes !== 1 ? 's' : ''} ${PERIODO_TXT[regalo.periodo] ?? ''}. El cliente recibió un QR nuevo.`}
          </p>
        </div>

        <div className="space-y-2 rounded-xl border-2 border-success/25 bg-card p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Regalo</span>
            <span className="font-semibold text-foreground">{regalo.titulo}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Cliente</span>
            <span className="font-semibold text-foreground">{regalo.nombre}</span>
          </div>
          {state.ticketNumero && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Ticket</span>
              <span className="font-mono text-foreground">{state.ticketNumero}</span>
            </div>
          )}
        </div>

        {onScanNext && (
          <Button onClick={onScanNext} size="xl" className="w-full gap-2 font-semibold">
            <ScanLine className="h-5 w-5" />
            Escanear siguiente
          </Button>
        )}
        <Button variant="outline" className="w-full" onClick={onDone}>
          Finalizar
        </Button>
      </div>
    )
  }

  // ── Validación + confirmación ─────────────────────────────────────────────
  const puede = regalo.puedeUsar
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-3',
          puede ? 'border-success/25 bg-success/10' : 'border-destructive/25 bg-destructive/10'
        )}
      >
        {puede ? (
          <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
        ) : (
          <XCircle className="h-6 w-6 shrink-0 text-destructive" />
        )}
        <div>
          <p className={cn('font-bold', puede ? 'text-success' : 'text-destructive')}>
            {puede ? 'Regalo válido para canje' : 'No se puede canjear'}
          </p>
          {!puede && regalo.mensaje && (
            <p className="text-sm text-destructive/90">{regalo.mensaje}</p>
          )}
        </div>
      </div>

      <div
        className={cn(
          'rounded-xl border-2 bg-card p-4',
          puede ? 'border-success/30' : 'border-destructive/30'
        )}
      >
        <div className="flex items-start gap-4">
          {regalo.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={regalo.avatarUrl}
              alt={regalo.nombre}
              className={cn(
                'h-16 w-16 rounded-2xl object-cover ring-2',
                puede ? 'ring-success/30' : 'ring-destructive/30'
              )}
            />
          ) : (
            <div
              className={cn(
                'flex h-16 w-16 items-center justify-center rounded-2xl',
                puede ? 'bg-success/10' : 'bg-destructive/10'
              )}
            >
              <User className={cn('h-8 w-8', puede ? 'text-success' : 'text-destructive')} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-h2 leading-tight text-foreground">{regalo.nombre}</p>
            <p className="text-sm text-muted-foreground">{regalo.empresa}</p>
            <Badge variant="info" className="mt-1.5 text-caption">
              <Gift className="mr-1 h-3 w-3" /> Regalo VIP
            </Badge>
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-border/60 pt-3 text-sm">
          <div className="flex items-start gap-2">
            <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">{regalo.titulo}</p>
              {regalo.descripcion && (
                <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
                  {regalo.descripcion}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Ticket className="h-3.5 w-3.5" /> Usos {PERIODO_TXT[regalo.periodo] ?? ''}
            </span>
            <span className="font-medium text-foreground">
              {regalo.restantesPeriodo} de {regalo.usosPorPeriodo}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Vence
            </span>
            <span className="font-medium text-foreground">{fmtFecha(regalo.vigenciaHasta)}</span>
          </div>
        </div>

        {puede && regalo.restantesPeriodo === 1 && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
            Es el último uso de este período; el cupo se renueva solo.
          </p>
        )}
      </div>

      {!puede ? (
        <div className="space-y-3">
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{regalo.mensaje ?? 'No se puede canjear este regalo.'}</AlertDescription>
          </Alert>
          <Button onClick={onScanNext ?? onDone} size="xl" className="w-full">
            Escanear siguiente
          </Button>
        </div>
      ) : (
        <form action={formAction} className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
          <input type="hidden" name="invitadoId" value={regalo.invitadoId} />
          <input type="hidden" name="qrTokenId" value={regalo.qrTokenId} />

          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <p className="text-sm font-semibold text-foreground">Registrar canje</p>

          <div className="space-y-1.5">
            <Label htmlFor="notas-canje-regalo" className="text-caption">
              Notas
            </Label>
            <Textarea id="notas-canje-regalo" name="notas" rows={2} placeholder="Observaciones opcionales…" />
          </div>

          <div className="flex gap-3">
            <Button
              type="submit"
              variant="success"
              disabled={pending}
              className="flex-1 font-semibold"
              size="lg"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirmar canje
            </Button>
            <Button type="button" variant="outline" onClick={onDone} size="xl">
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
