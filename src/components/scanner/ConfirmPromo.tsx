'use client'

/**
 * Fase E5 · Confirmación de canje de una PROMOCIÓN comprada (escáner).
 * Mismo patrón que ConfirmVisit: validación visual → confirmar → comprobante
 * imprimible (Receipt Engine) con el TX-ID oficial del Transaction Engine.
 */

import { useActionState, useEffect, useState } from 'react'
import {
  Loader2,
  XCircle,
  CheckCircle2,
  User,
  Ticket,
  Clock,
  Megaphone,
  Printer,
  ScanLine,
  Hash,
} from 'lucide-react'
import { toast } from 'sonner'
import { confirmarCanjePromocion, type CanjeState } from '@/modules/promociones/canjeActions'
import type { PromoCompraLookup } from '@/modules/visitas/actions'
import { registrarImpresionTx } from '@/modules/transacciones/actions'
import { ReceiptTicket } from '@/components/scanner/ReceiptTicket'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface Sucursal {
  id: string
  nombre: string
}

const init: CanjeState = {}

function fmtFecha(iso: string | null) {
  if (!iso) return 'Sin vencimiento'
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function ConfirmPromo({
  compra,
  sucursales = [],
  onDone,
  onScanNext,
}: {
  compra: PromoCompraLookup
  sucursales?: Sucursal[]
  onDone: () => void
  onScanNext?: () => void
}) {
  const [sucursalId, setSucursalId] = useState('')
  const [state, formAction, pending] = useActionState(confirmarCanjePromocion, init)
  const [printCount, setPrintCount] = useState(0)

  useEffect(() => {
    if (state.success) toast.success('Canje registrado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  // ── Pantalla de éxito con ticket ──────────────────────────────────────────
  if (state.success) {
    return (
      <>
        <div className="print:hidden space-y-5">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
              <CheckCircle2 className="h-9 w-9 text-success" />
            </div>
            <h3 className="text-xl font-bold text-foreground">Canje registrado</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.consumida
                ? 'Era el último uso: la promoción quedó consumida.'
                : `Quedan ${state.restantes} uso${state.restantes !== 1 ? 's' : ''}. El cliente recibió un QR nuevo.`}
            </p>
            {state.siguientePaso && (
              <p className="mt-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                🔗 Se desbloqueó «{state.siguientePaso.titulo}» en{' '}
                {state.siguientePaso.companyName}. Avísale al cliente: ya está en su app.
              </p>
            )}
          </div>

          <div className="rounded-xl border-2 border-success/25 bg-card p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Promoción</span>
              <span className="font-semibold text-foreground">{compra.promoTitulo}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cliente</span>
              <span className="font-semibold text-foreground">{compra.nombre}</span>
            </div>
            {state.codigo && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Transacción</span>
                <span className="font-mono font-semibold text-foreground">{state.codigo}</span>
              </div>
            )}
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
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="flex-col gap-1 h-auto py-3"
              onClick={() => {
                if (state.transaccionId) {
                  registrarImpresionTx(
                    state.transaccionId,
                    printCount > 0 ? 'Reimpresión desde el canje' : undefined
                  ).catch(() => {})
                }
                setPrintCount((c) => c + 1)
                setTimeout(() => window.print(), printCount === 0 ? 350 : 0)
              }}
            >
              <Printer className="h-5 w-5" />
              <span className="text-xs">{printCount > 0 ? 'Reimprimir' : 'Imprimir'}</span>
            </Button>
            <Button variant="outline" className="flex-col gap-1 h-auto py-3" onClick={onDone}>
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-xs">Finalizar</span>
            </Button>
          </div>
        </div>

        {state.ticket && (
          <ReceiptTicket
            ticket={state.ticket}
            esCopia={printCount > 1}
            logoUrl={state.ticket.empresa.logoUrl}
          />
        )}
      </>
    )
  }

  // ── Pantalla de validación + confirmación ─────────────────────────────────
  const puede = compra.puedeUsar
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
            {puede ? 'Promoción válida para canje' : 'No se puede canjear'}
          </p>
          {!puede && compra.mensaje && (
            <p className="text-sm text-destructive/90">{compra.mensaje}</p>
          )}
        </div>
      </div>

      {/* Tarjeta de la promoción comprada */}
      <div
        className={cn(
          'rounded-xl border-2 bg-card p-4',
          puede ? 'border-success/30' : 'border-destructive/30'
        )}
      >
        <div className="flex items-start gap-4">
          {compra.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={compra.avatarUrl}
              alt={compra.nombre}
              className={cn('h-16 w-16 rounded-2xl object-cover ring-2', puede ? 'ring-success/30' : 'ring-destructive/30')}
            />
          ) : (
            <div className={cn('flex h-16 w-16 items-center justify-center rounded-2xl', puede ? 'bg-success/10' : 'bg-destructive/10')}>
              <User className={cn('h-8 w-8', puede ? 'text-success' : 'text-destructive')} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-foreground leading-tight">{compra.nombre}</p>
            <p className="text-sm text-muted-foreground">{compra.empresa}</p>
            <Badge variant="info" className="mt-1.5 text-[10px]">
              <Megaphone className="mr-1 h-3 w-3" /> Promoción comprada
            </Badge>
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-border/60 pt-3 text-sm">
          <div className="flex items-start gap-2">
            <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">{compra.promoTitulo}</p>
              {compra.promoDescripcion && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{compra.promoDescripcion}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Ticket className="h-3.5 w-3.5" /> Usos
            </span>
            <span className="font-medium text-foreground">
              {compra.usosRestantes} de {compra.usosIncluidos}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Vence
            </span>
            <span className="font-medium text-foreground">{fmtFecha(compra.fechaVencimiento)}</span>
            {compra.codigo && (
              <>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Hash className="h-3.5 w-3.5" /> Cupón
                </span>
                <span className="font-mono font-medium text-foreground">{compra.codigo}</span>
              </>
            )}
          </div>
        </div>

        {compra.alertas.map((a) => (
          <p key={a} className="mt-3 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
            {a}
          </p>
        ))}
      </div>

      {!puede ? (
        <div className="space-y-3">
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{compra.mensaje ?? 'No se puede canjear esta promoción.'}</AlertDescription>
          </Alert>
          <Button onClick={onScanNext ?? onDone} size="xl" className="w-full">
            Escanear siguiente
          </Button>
        </div>
      ) : (
        <form action={formAction} className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
          <input type="hidden" name="compraId" value={compra.compraId} />
          <input type="hidden" name="qrTokenId" value={compra.qrTokenId} />
          <input type="hidden" name="sucursalId" value={sucursalId} />

          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <p className="text-sm font-semibold text-foreground">Registrar canje</p>

          {sucursales.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Sucursal</Label>
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
            <Label htmlFor="notas-canje" className="text-xs">Notas</Label>
            <Textarea id="notas-canje" name="notas" rows={2} placeholder="Observaciones opcionales…" />
          </div>

          <div className="flex gap-3">
            <Button type="submit" variant="success" disabled={pending} className="flex-1 font-semibold" size="lg">
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
