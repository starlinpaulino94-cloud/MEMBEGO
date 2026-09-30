'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearConciliacionAction, registrarMontoProveedorAction, resolverConciliacionAction } from '@/modules/supply-v2/actions-finanzas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { ConciliacionCreada } from '@/modules/supply-v2/finance/reconciliation'

function useRefrescoAlExito(estado: EstadoAccion<unknown>) {
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
    }
  }, [estado, router])
}

/** Abrir una conciliación (§43–§45): Membego pone su lado; el del proveedor es opcional y sin él NO cuadra sola. */
export function FormConciliacion({ proveedores }: { proveedores: { id: string; commercialName: string }[] }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<ConciliacionCreada>, FormData>(crearConciliacionAction, {})
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && estado.id && visto.current !== estado.id) {
      visto.current = estado.id
      toast.success(estado.success)
      router.push(`/superadmin/supply-v2/finanzas/conciliaciones/${estado.id}`)
    }
  }, [estado, router])
  const hoy = new Date()
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10)
  return (
    <form action={enviar} className="space-y-3" data-testid="form-conciliacion">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="concProveedor">Proveedor</Label>
          <select id="concProveedor" name="supplierId" required className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm" defaultValue={proveedores[0]?.id ?? ''} data-testid="conciliacion-proveedor">
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.commercialName}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="concMonto">Saldo según el proveedor (opcional)</Label>
          <Input id="concMonto" name="supplierAmount" type="number" step="0.01" placeholder="Lo que dice su estado de cuenta" data-testid="conciliacion-monto-proveedor" />
        </div>
        <div>
          <Label htmlFor="concDesde">Desde</Label>
          <Input id="concDesde" name="periodStart" type="date" required defaultValue={inicio} />
        </div>
        <div>
          <Label htmlFor="concHasta">Hasta</Label>
          <Input id="concHasta" name="periodEnd" type="date" required defaultValue={hoy.toISOString().slice(0, 10)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="concNotas">Notas</Label>
          <Textarea id="concNotas" name="notes" rows={2} maxLength={2000} />
        </div>
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-abrir-conciliacion">Abrir conciliación</Button>
    </form>
  )
}

export function RegistrarMontoProveedor({ reconciliationId }: { reconciliationId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(registrarMontoProveedorAction, {})
  useRefrescoAlExito(estado)
  return (
    <form action={enviar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="reconciliationId" value={reconciliationId} />
      <div>
        <Label htmlFor="montoProveedor">Saldo según el proveedor</Label>
        <Input id="montoProveedor" name="supplierAmount" type="number" step="0.01" required className="w-44" data-testid="monto-proveedor" />
      </div>
      <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-registrar-monto-proveedor">Comparar</Button>
      {estado.error && <p className="w-full text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function ResolverConciliacion({ reconciliationId }: { reconciliationId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(resolverConciliacionAction, {})
  const [abierto, setAbierto] = useState(false)
  useRefrescoAlExito(estado)
  if (!abierto) return <Button type="button" variant="outline" onClick={() => setAbierto(true)} data-testid="btn-resolver-conciliacion">Marcar como resuelta</Button>
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="reconciliationId" value={reconciliationId} />
      <Label htmlFor="notasResolucion">Cómo se resolvió (obligatorio)</Label>
      <Textarea id="notasResolucion" name="notas" rows={2} maxLength={2000} required autoFocus data-testid="notas-resolucion" />
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-resolver-conciliacion-confirmar">Resolver</Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}
