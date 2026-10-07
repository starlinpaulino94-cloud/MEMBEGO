'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { confirmarRecepcionAction, type EstadoAccion } from '@/modules/supply-v2/actions'
import type { RecepcionConfirmada } from '@/modules/supply-v2/procurement/receipts'

export interface LineaParaRecibir {
  id: string
  producto: string
  comprado: number
  recibido: number
}

function nuevaClave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

/**
 * MEMBEGO SUPPLY · REGISTRAR RECEPCIÓN (§36). Enseña comprado, recibido
 * y pendiente por línea; el servidor vuelve a validar. La clave de
 * idempotencia nace con el formulario y se renueva tras cada éxito: el doble
 * clic no crea dos lotes.
 */
export function FormRecepcion({
  ordenId,
  lineas,
  sucursales,
}: {
  ordenId: string
  lineas: LineaParaRecibir[]
  sucursales: { id: string; nombre: string }[]
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion<RecepcionConfirmada>, FormData>(confirmarRecepcionAction, {})
  const [clave, setClave] = useState(nuevaClave)
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [ultima, setUltima] = useState<RecepcionConfirmada | null>(null)
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.data || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    setUltima(estado.data)
    setCantidades({})
    setClave(nuevaClave())
    router.refresh()
  }, [estado, router])

  const pendientes = lineas.filter((l) => l.comprado - l.recibido > 0)
  const hoy = new Date().toISOString().slice(0, 10)
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  if (ultima) {
    const unidades = ultima.lots.reduce((t, l) => t + l.quantity, 0)
    return (
      <Card id="recepcion">
        <CardHeader>
          <CardTitle>Recepción registrada</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 rounded-lg border border-success/30 bg-success/5 p-4" data-testid="recepcion-exito">
            <p className="text-sm font-medium">
              {unidades.toLocaleString('es-DO')} unidades{' '}
              {ultima.purchaseOrderStatus === 'RECEIVED' ? 'recibidas: la orden quedó completa.' : 'disponibles.'}
            </p>
            <p className="text-caption text-muted-foreground">
              Recepción {ultima.number} · {ultima.lots.map((l) => l.code).join(', ')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/superadmin/supply/supply">Ver Supply</Link>
              </Button>
              {ultima.purchaseOrderStatus !== 'RECEIVED' && (
                <Button type="button" variant="outline" onClick={() => setUltima(null)}>
                  Registrar otra recepción
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (pendientes.length === 0) return null

  return (
    <Card id="recepcion">
      <CardHeader>
        <CardTitle>Registrar recepción</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={accion} className="space-y-4" data-testid="form-recepcion">
          <input type="hidden" name="purchaseOrderId" value={ordenId} />
          <input type="hidden" name="idempotencyKey" value={clave} />
          <div className="space-y-3">
            {pendientes.map((l) => {
              const pendiente = l.comprado - l.recibido
              return (
                <div key={l.id} className="rounded-lg border border-border p-3">
                  <input type="hidden" name="lineId" value={l.id} />
                  <p className="font-medium">{l.producto}</p>
                  <dl className="mt-1 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Comprado</dt>
                      <dd className="tabular-nums">{l.comprado.toLocaleString('es-DO')}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Recibido</dt>
                      <dd className="tabular-nums" data-testid="linea-recibido">
                        {l.recibido.toLocaleString('es-DO')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Pendiente</dt>
                      <dd className="tabular-nums" data-testid="linea-pendiente">
                        {pendiente.toLocaleString('es-DO')}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2">
                    <Label htmlFor={`cantidad-${l.id}`}>Cantidad ahora</Label>
                    <Input
                      id={`cantidad-${l.id}`}
                      name="lineQuantity"
                      type="number"
                      min={1}
                      max={pendiente}
                      step={1}
                      inputMode="numeric"
                      required={pendientes.length === 1}
                      value={cantidades[l.id] ?? ''}
                      onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: e.target.value }))}
                      placeholder={String(pendiente)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="receivedAt">Fecha</Label>
              <Input id="receivedAt" name="receivedAt" type="date" defaultValue={hoy} required />
            </div>
            <div>
              <Label htmlFor="expiresAt">Vencimiento (opcional)</Label>
              <Input id="expiresAt" name="expiresAt" type="date" />
            </div>
            {sucursales.length > 0 && (
              <div>
                <Label htmlFor="branchId">Sucursal (opcional)</Label>
                <select id="branchId" name="branchId" defaultValue="" className={select}>
                  <option value="">Sin sucursal</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="reference">Referencia</Label>
              <Input id="reference" name="reference" maxLength={120} placeholder="Guía, factura o conduce" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="recepcionNotas">Notas</Label>
              <Textarea id="recepcionNotas" name="notes" rows={2} maxLength={2000} />
            </div>
          </div>
          {estado.error && (
            <p className="text-sm text-destructive" role="alert">
              {estado.error}
            </p>
          )}
          <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-confirmar-recepcion">
            Confirmar recepción
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
