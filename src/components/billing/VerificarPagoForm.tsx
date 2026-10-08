'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { verificarPagoBancario } from '@/modules/orders/superadmin-actions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const campoSelector = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'

/**
 * El superadmin confirma, con el extracto bancario a la vista, que el pago de un pedido llegó.
 * Es lo que lleva el pedido a «pago verificado»; lo que registra la empresa no pasa de
 * «reportado». Si la comisión ya se cobró como CPA, el libro recibe el ajuste al porcentaje.
 */
export function VerificarPagoForm({ companyId, moneda }: { companyId: string; moneda: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [codigo, setCodigo] = useState('')
  const [referenciaBancaria, setReferenciaBancaria] = useState('')
  const [referenciaDelPago, setReferenciaDelPago] = useState('')
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<'TRANSFER' | 'CARD'>('TRANSFER')

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await verificarPagoBancario({ companyId, codigoPedido: codigo, referenciaBancaria, monto, metodo, referenciaDelPago })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      const ajuste = r.comision === 'AJUSTADA' ? ' · comisión ajustada al porcentaje' : ''
      toast.success(r.repetido ? 'Ese movimiento ya había verificado este pedido.' : `Pago verificado (${r.nivel})${ajuste}`)
      setCodigo('')
      setReferenciaBancaria('')
      setReferenciaDelPago('')
      setMonto('')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Verificar un pago contra el banco
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Con el extracto a la vista. La referencia del extracto es la clave: la misma línea no verifica dos veces. Si el pedido cobró CPA, el libro recibe el ajuste al porcentaje.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vp-codigo">Código del pedido</Label>
            <Input id="vp-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="MBG-PED-2026-000123" autoComplete="off" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vp-metodo">Método</Label>
              <select id="vp-metodo" className={campoSelector} value={metodo} onChange={(e) => setMetodo(e.target.value === 'CARD' ? 'CARD' : 'TRANSFER')}>
                <option value="TRANSFER">Transferencia</option>
                <option value="CARD">Tarjeta</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vp-monto">Monto ({moneda})</Label>
              <Input id="vp-monto" type="number" step="0.01" min="0" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vp-banco">Referencia del extracto bancario</Label>
            <Input id="vp-banco" value={referenciaBancaria} onChange={(e) => setReferenciaBancaria(e.target.value)} placeholder="Línea o id del movimiento" autoComplete="off" required maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vp-ref">Referencia del pago (la que ve la empresa, opcional)</Label>
            <Input id="vp-ref" value={referenciaDelPago} onChange={(e) => setReferenciaDelPago(e.target.value)} placeholder="Número de transferencia" autoComplete="off" maxLength={80} />
          </div>
          <Button type="submit" disabled={pending || !codigo.trim() || !referenciaBancaria.trim() || !monto}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Verificar pago
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
