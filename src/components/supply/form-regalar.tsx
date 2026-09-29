'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { emitirDerechoAction, type EstadoAccion } from '@/modules/supply/actions'
import { ESTRATEGIAS_SELECCION, ESTRATEGIA_LABELS } from '@/modules/supply/fefo'

/**
 * MEMBEGO SUPPLY · REGALAR / EMITIR un beneficio a una persona (§15).
 *
 * Con `loteId` regala de ese lote. Sin él, elige el lote por FEFO entre los
 * del proveedor y producto elegidos (y cambiar la estrategia queda auditado).
 * La persona se identifica por correo, nombre exacto o id; si hay ambigüedad
 * el servidor no emite.
 */
export function FormRegalar({
  loteId,
  proveedores = [],
}: {
  loteId?: string
  proveedores?: { id: string; nombre: string }[]
}) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(emitirDerechoAction, {})
  const k = loteId ?? 'global'
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <form action={accion} className="space-y-3 rounded-lg border border-border p-4">
      {loteId && <input type="hidden" name="loteId" value={loteId} />}
      <input type="hidden" name="precioCliente" value="0" />
      <p className="text-sm font-medium">{loteId ? 'Regalar una unidad de este lote' : 'Emitir un beneficio'}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor={`cliente-${k}`}>Persona (correo, nombre exacto o id de cliente)</Label>
          <Input id={`cliente-${k}`} name="clienteBusqueda" required maxLength={160} placeholder="ana@correo.com" />
        </div>
        <div>
          <Label htmlFor={`destino-${k}`}>Por qué</Label>
          <select id={`destino-${k}`} name="destinoTipo" defaultValue="REGALO" className={select}>
            <option value="REGALO">Regalo</option>
            <option value="CAMPANA">Campaña / bienvenida</option>
            <option value="MEMBRESIA">Membresía</option>
            <option value="RECOMPENSA">Recompensa</option>
            <option value="REFERIDO">Referido</option>
            <option value="INFLUENCER">Influencer</option>
          </select>
        </div>
        {!loteId && (
          <div>
            <Label htmlFor={`proveedor-${k}`}>Proveedor</Label>
            <select id={`proveedor-${k}`} name="proveedorId" defaultValue="" className={select}>
              <option value="">Cualquiera</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {!loteId && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label htmlFor={`item-${k}`}>Producto (como aparece en el lote)</Label>
            <Input id={`item-${k}`} name="item" maxLength={200} placeholder="Pizza Grande Pepperoni" />
          </div>
          <div>
            <Label htmlFor={`estrategia-${k}`}>Qué lote usar</Label>
            <select id={`estrategia-${k}`} name="estrategia" defaultValue="FEFO" className={select}>
              {ESTRATEGIAS_SELECCION.map((e) => (
                <option key={e} value={e}>
                  {ESTRATEGIA_LABELS[e]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pendiente}>
          {pendiente ? 'Emitiendo…' : 'Emitir beneficio'}
        </Button>
        <span className="text-caption text-muted-foreground">Crea el derecho y su voucher; la persona lo ve en «Beneficios Membego» y recibe aviso.</span>
      </div>
      {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
      {estado.success && <p className="text-sm text-success">{estado.success}</p>}
    </form>
  )
}
