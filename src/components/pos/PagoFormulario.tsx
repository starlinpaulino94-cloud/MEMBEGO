'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ETIQUETA_METODO_POS, METODOS_POS, type MetodoPos } from '@/modules/pos/domain'

const campo = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm'

export interface EstadoDePago {
  metodo: MetodoPos
  referencia: string
  recibido: string
}

export const PAGO_INICIAL: EstadoDePago = { metodo: 'EFECTIVO', referencia: '', recibido: '' }

/** Cuánto se devuelve, para enseñarlo mientras se teclea (el servidor lo vuelve a calcular). */
export function cambioParaMostrar(total: number, recibido: string): number | null {
  const n = Number(recibido)
  if (recibido.trim() === '' || !Number.isFinite(n) || n < total) return null
  return Math.round((n - total) * 100) / 100
}

/**
 * Cómo paga: efectivo (con lo que entregó, para el cambio), transferencia o tarjeta (con su referencia, que
 * es lo que hace verificable el pago). Compartido por «Cobrar pedido» y «Venta de mostrador».
 */
export function PagoFormulario({ valor, onChange, total, prefijo }: { valor: EstadoDePago; onChange: (v: EstadoDePago) => void; total: number; prefijo: string }) {
  const cambio = valor.metodo === 'EFECTIVO' ? cambioParaMostrar(total, valor.recibido) : null
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${prefijo}-metodo`}>Cómo paga</Label>
        <select id={`${prefijo}-metodo`} className={campo} value={valor.metodo} onChange={(e) => onChange({ ...valor, metodo: e.target.value as MetodoPos })}>
          {METODOS_POS.map((m) => (
            <option key={m} value={m}>
              {ETIQUETA_METODO_POS[m]}
            </option>
          ))}
        </select>
      </div>
      {valor.metodo === 'EFECTIVO' ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${prefijo}-recibido`}>Efectivo recibido (opcional)</Label>
          <Input id={`${prefijo}-recibido`} inputMode="decimal" value={valor.recibido} onChange={(e) => onChange({ ...valor, recibido: e.target.value })} placeholder="Para calcular el cambio" />
          {cambio !== null && <p className="text-sm font-semibold text-foreground">Cambio: RD${cambio.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</p>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${prefijo}-referencia`}>{valor.metodo === 'TRANSFERENCIA' ? 'Referencia de la transferencia' : 'Número de autorización'}</Label>
          <Input id={`${prefijo}-referencia`} value={valor.referencia} onChange={(e) => onChange({ ...valor, referencia: e.target.value })} maxLength={80} autoComplete="off" />
          <p className="text-xs text-muted-foreground">Es el comprobante del pago: sin él no se puede cobrar por este medio.</p>
        </div>
      )}
    </div>
  )
}
