'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { revisarSolicitudMerchantAction } from '@/modules/supply-v2/actions-solicitud-merchant'
import type { DecisionSolicitud } from '@/modules/supply-v2/suppliers/solicitud-merchant-dominio'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Membego decide una solicitud (§41):
 * en revisión, más información, aprobar o rechazar. Aprobar enciende las
 * capacidades en la MISMA empresa; rechazar exige un motivo legible.
 */
export function RevisarSolicitud({ applicationId, supplierId, estado }: { applicationId: string; supplierId: string; estado: 'SUBMITTED' | 'UNDER_REVIEW' | 'MORE_INFO_REQUIRED' }) {
  const [resultado, enviar, pendiente] = useActionState<EstadoAccion<{ status: string; capacidades: string[] }>, FormData>(revisarSolicitudMerchantAction, {})
  const [decision, setDecision] = useState<DecisionSolicitud>(estado === 'SUBMITTED' ? 'UNDER_REVIEW' : 'APPROVED')
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (resultado.success && visto.current !== resultado.success) {
      visto.current = resultado.success
      toast.success(resultado.success)
      router.refresh()
    }
  }, [resultado, router])

  if (resultado.success) return <p className="text-sm text-success" data-testid="solicitud-decidida">{resultado.success}</p>

  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3" data-testid="form-revisar-solicitud">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="supplierId" value={supplierId} />
      <div>
        <Label htmlFor={`decision-${applicationId}`}>Decisión</Label>
        <select id={`decision-${applicationId}`} name="decision" value={decision} onChange={(e) => setDecision(e.target.value as DecisionSolicitud)} className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" data-testid="select-decision">
          {estado === 'SUBMITTED' && <option value="UNDER_REVIEW">Tomar en revisión</option>}
          {estado !== 'MORE_INFO_REQUIRED' && <option value="MORE_INFO_REQUIRED">Pedir más información</option>}
          <option value="APPROVED">Aprobar: encender comercio en la misma empresa</option>
          <option value="REJECTED">Rechazar</option>
        </select>
      </div>
      {decision === 'MORE_INFO_REQUIRED' && (
        <div>
          <Label htmlFor={`peticion-${applicationId}`}>Qué falta (lo verá el proveedor)</Label>
          <Textarea id={`peticion-${applicationId}`} name="peticion" rows={2} maxLength={1000} required minLength={3} data-testid="peticion-info" />
        </div>
      )}
      {(decision === 'REJECTED' || decision === 'APPROVED') && (
        <div>
          <Label htmlFor={`motivo-${applicationId}`}>{decision === 'REJECTED' ? 'Motivo (obligatorio, lo verá el proveedor)' : 'Nota para el proveedor (opcional)'}</Label>
          <Textarea id={`motivo-${applicationId}`} name="motivo" rows={2} maxLength={1000} required={decision === 'REJECTED'} minLength={decision === 'REJECTED' ? 3 : undefined} data-testid="motivo-decision" />
        </div>
      )}
      <div>
        <Label htmlFor={`notas-${applicationId}`}>Notas internas (no salen al proveedor)</Label>
        <Textarea id={`notas-${applicationId}`} name="notasInternas" rows={2} maxLength={2000} />
      </div>
      {resultado.error && <p className="text-sm text-destructive" role="alert" data-testid="revisar-error">{resultado.error}</p>}
      <Button type="submit" size="sm" variant={decision === 'REJECTED' ? 'destructive' : 'default'} disabled={pendiente} loading={pendiente} data-testid="btn-decidir-solicitud">
        {decision === 'APPROVED' ? 'Aprobar' : decision === 'REJECTED' ? 'Rechazar' : decision === 'MORE_INFO_REQUIRED' ? 'Pedir información' : 'Tomar en revisión'}
      </Button>
    </form>
  )
}
