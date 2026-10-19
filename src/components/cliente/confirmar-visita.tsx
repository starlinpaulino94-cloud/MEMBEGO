'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, MessageSquareWarning } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { confirmarVisitaAction, disputarVisitaAction } from '@/modules/visitas-membego/actions'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · «Tu visita fue completada. ¿Es correcto?»
 * (§33–§34). Confirmar manda el total que el cliente VIO: si cambió, el
 * servidor lo rechaza. Reportar abre una disputa que Membego revisa; nada se
 * ajusta solo. Pensado para el teléfono: dos botones grandes.
 */
export function ConfirmarVisita({ visitId, total, totalFormateado, yaConfirmada, disputaAbierta }: { visitId: string; total: string; totalFormateado: string; yaConfirmada: boolean; disputaAbierta: boolean }) {
  const [confirmacion, confirmar, confirmando] = useActionState<EstadoAccion, FormData>(confirmarVisitaAction, {})
  const [reporte, reportar, reportando] = useActionState<EstadoAccion, FormData>(disputarVisitaAction, {})
  const [reportando_, setReportando] = useState(false)
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    const s = confirmacion.success ?? reporte.success
    if (s && visto.current !== s) {
      visto.current = s
      toast.success(s)
      router.refresh()
    }
  }, [confirmacion.success, reporte.success, router])

  if (yaConfirmada || confirmacion.success) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success" data-testid="visita-confirmada">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        {confirmacion.success ?? 'Confirmaste esta visita. Gracias.'}
      </p>
    )
  }
  if (disputaAbierta || reporte.success) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-warning/15 p-3 text-sm text-warning" data-testid="visita-reportada">
        <MessageSquareWarning className="size-4 shrink-0" aria-hidden />
        {reporte.success ?? 'Recibimos tu reporte. Membego lo está revisando con el negocio.'}
      </p>
    )
  }

  return (
    <div className="space-y-3" data-testid="confirmar-visita">
      <p className="text-h4">El negocio reportó compras adicionales por {totalFormateado}. ¿Es correcto?</p>
      <form action={confirmar}>
        <input type="hidden" name="visitId" value={visitId} />
        <input type="hidden" name="total" value={total} />
        {confirmacion.error && <p className="mb-2 text-sm text-destructive" role="alert" data-testid="confirmar-error">{confirmacion.error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={confirmando || reportando} loading={confirmando} data-testid="btn-confirmar-visita">
          Sí, es correcto
        </Button>
      </form>
      {reportando_ ? (
        <form action={reportar} className="space-y-2 rounded-lg border border-border p-3" data-testid="form-reportar-visita">
          <input type="hidden" name="visitId" value={visitId} />
          <div>
            <Label htmlFor="claim">Cuéntanos qué pasó</Label>
            <Textarea id="claim" name="claim" rows={3} maxLength={1000} required minLength={3} autoFocus data-testid="reporte-claim" placeholder="Por ejemplo: solo compré un refresco, no un postre." />
          </div>
          <div>
            <Label htmlFor="claimedTotal">¿Cuánto compraste de verdad? (opcional, RD$)</Label>
            <Input id="claimedTotal" name="claimedTotal" inputMode="decimal" data-testid="reporte-monto" />
          </div>
          {reporte.error && <p className="text-sm text-destructive" role="alert" data-testid="reportar-error">{reporte.error}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={reportando} loading={reportando} data-testid="btn-reportar-enviar">Enviar reporte</Button>
            <Button type="button" variant="ghost" onClick={() => setReportando(false)}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="lg" className="w-full" onClick={() => setReportando(true)} data-testid="btn-reportar-visita">
          No, reportar un problema
        </Button>
      )}
    </div>
  )
}
