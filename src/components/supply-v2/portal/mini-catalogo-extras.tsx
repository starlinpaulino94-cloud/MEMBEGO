'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusChip } from '@/components/ui/status-chip'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { guardarExtraAction } from '@/modules/visitas-membego/actions'

export interface ExtraConfigurable {
  id: string
  name: string
  price: string | null
  activo: boolean
  /** Lo compra Membego (tiene acuerdo): el nombre lo administra Membego. */
  deMembego: boolean
}

/**
 * SUPPLIER & FULFILLMENT COMMERCE · el mini catálogo de extras del proveedor
 * (§26): nombre, precio y activo. No es un Commerce Catalog; son los ítems
 * del catálogo de Supply marcados «se vende como extra». El precio que se
 * guarda aquí es el que el servidor relee al registrar una venta.
 */
export function MiniCatalogoExtras({ extras, puedeConfigurar }: { extras: ExtraConfigurable[]; puedeConfigurar: boolean }) {
  const [nuevo, setNuevo] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  return (
    <Card data-testid="mini-catalogo-extras">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Extras que vendes en una visita</CardTitle>
        {puedeConfigurar && !nuevo && (
          <Button type="button" size="sm" variant="outline" onClick={() => setNuevo(true)} data-testid="btn-nuevo-extra">
            <Plus className="mr-1 size-4" aria-hidden />
            Añadir extra
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-caption text-muted-foreground">
          Lo que el cliente puede comprarte además de lo que Membego incluyó. Estos precios son los que el escáner usa; Membego cobra su comisión solo sobre lo que registres aquí, nunca sobre lo que ya te compró.
        </p>
        {nuevo && <FormExtra alCerrar={() => setNuevo(false)} />}
        {extras.length === 0 && !nuevo ? (
          <p className="text-sm text-muted-foreground" data-testid="sin-extras">Todavía no tienes extras. Añade los más comunes: bebidas, postres, acompañantes.</p>
        ) : (
          <ul className="divide-y divide-border text-sm" data-testid="extras-configurados">
            {extras.map((e) => (
              <li key={e.id} className="py-2" data-testid="extra-configurado">
                {editando === e.id ? (
                  <FormExtra extra={e} alCerrar={() => setEditando(null)} />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{e.name}</span>
                      <span className="block text-caption text-muted-foreground">
                        {e.price != null ? `RD$${Number(e.price).toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : 'sin precio'}
                        {e.deMembego ? ' · también lo compra Membego' : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusChip tone={e.activo ? 'success' : 'neutral'}>{e.activo ? 'Activo' : 'Inactivo'}</StatusChip>
                      {puedeConfigurar && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(e.id)} data-testid="btn-editar-extra">Editar</Button>
                      )}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function FormExtra({ extra, alCerrar }: { extra?: ExtraConfigurable; alCerrar: () => void }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(guardarExtraAction, {})
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
      alCerrar()
    }
  }, [estado, router, alCerrar])
  const sufijo = extra?.id ?? 'nuevo'
  return (
    <form action={enviar} className="space-y-2 rounded-lg border border-border p-3" data-testid="form-extra">
      {extra && <input type="hidden" name="id" value={extra.id} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`extraNombre-${sufijo}`}>Nombre</Label>
          <Input id={`extraNombre-${sufijo}`} name="name" defaultValue={extra?.name ?? ''} required minLength={2} maxLength={160} readOnly={extra?.deMembego} data-testid="extra-nombre" />
        </div>
        <div>
          <Label htmlFor={`extraPrecio-${sufijo}`}>Precio (RD$)</Label>
          <Input id={`extraPrecio-${sufijo}`} name="price" inputMode="decimal" defaultValue={extra?.price ?? ''} required data-testid="extra-precio" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="activo" value="on" defaultChecked={extra?.activo ?? true} className="size-4" />
        Activo (se ofrece en el escáner)
      </label>
      {/* Un checkbox sin marcar no viaja: este campo le dice al servidor que el formulario sí lo traía. */}
      <input type="hidden" name="activoPresente" value="1" />
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-guardar-extra">Guardar</Button>
        <Button type="button" size="sm" variant="ghost" onClick={alCerrar}>Cancelar</Button>
      </div>
    </form>
  )
}
