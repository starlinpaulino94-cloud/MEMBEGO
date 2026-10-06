'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { asignarAction, type EstadoAccion } from '@/modules/supply/actions'
import { SUPPLY_DESTINOS, SUPPLY_DESTINO_LABELS } from '@/modules/supply/catalogo'

interface Props {
  loteId: string
  disponibles: number
  /** `campana`: apartar para un destino. `oferta`: publicar con precio, ventana y tope (§14). */
  modo?: 'campana' | 'oferta'
  sucursales?: { id: string; nombre: string }[]
  precioReferencia?: number | null
  costoUnitario?: number
}

export function FormAsignar({ loteId, disponibles, modo = 'campana', sucursales = [], precioReferencia, costoUnitario }: Props) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(asignarAction, {})
  const esOferta = modo === 'oferta'
  const k = `${modo}-${loteId}`

  return (
    <form action={accion} className="space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="loteId" value={loteId} />
      {esOferta && <input type="hidden" name="destinoTipo" value="OFERTA" />}
      <p className="text-sm font-medium">{esOferta ? 'Crear una oferta publicable' : 'Apartar unidades para una campaña'}</p>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor={`etiqueta-${k}`}>Nombre</Label>
          <Input id={`etiqueta-${k}`} name="etiqueta" required maxLength={200} placeholder={esOferta ? 'Pizza a RD$399' : 'Bienvenida Membego'} />
        </div>
        {!esOferta && (
          <div>
            <Label htmlFor={`destino-${k}`}>Destino</Label>
            <select id={`destino-${k}`} name="destinoTipo" defaultValue="CAMPANA" className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              {SUPPLY_DESTINOS.filter((d) => d !== 'OFERTA').map((d) => (
                <option key={d} value={d}>
                  {SUPPLY_DESTINO_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Label htmlFor={`cantidad-${k}`}>Cantidad</Label>
          <Input id={`cantidad-${k}`} name="cantidad" type="number" min={1} max={disponibles} required placeholder={String(Math.min(200, disponibles))} />
        </div>
        {esOferta && (
          <div>
            <Label htmlFor={`precio-${k}`}>Precio al cliente (0 = gratis)</Label>
            <Input id={`precio-${k}`} name="precioCliente" type="number" min={0} step="0.01" required placeholder={precioReferencia ? String(Math.round(precioReferencia * 0.66)) : '399'} />
          </div>
        )}
      </div>

      {esOferta && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`inicio-${k}`}>Desde</Label>
              <Input id={`inicio-${k}`} name="inicioAt" type="date" />
            </div>
            <div>
              <Label htmlFor={`fin-${k}`}>Hasta</Label>
              <Input id={`fin-${k}`} name="finAt" type="date" />
            </div>
            <div>
              <Label htmlFor={`max-${k}`}>Máximo por persona</Label>
              <Input id={`max-${k}`} name="maxPorCliente" type="number" min={1} step="1" placeholder="1" />
            </div>
          </div>
          {sucursales.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium">Sucursales (vacío = todas las del lote)</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {sucursales.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="sucursalIds" value={s.id} />
                    {s.nombre}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {costoUnitario != null && (
            <p className="text-caption text-muted-foreground">
              Costo Membego por unidad RD${costoUnitario.toLocaleString('es-DO')}
              {precioReferencia ? ` · precio público RD$${precioReferencia.toLocaleString('es-DO')}` : ''}. Lo que cobres por encima del costo es margen; por debajo, subsidio.
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pendiente}>
          {pendiente ? 'Guardando…' : esOferta ? 'Publicar oferta' : 'Apartar'}
        </Button>
        <span className="text-caption text-muted-foreground">
          {esOferta
            ? 'Se publica en la vitrina del cliente de inmediato (las de pago, solo si Membego tiene cuenta de cobro activa).'
            : `Quedan ${disponibles.toLocaleString('es-DO')} sin asignar. Apartar no consume: liberarlas es un clic.`}
        </span>
      </div>

      {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
      {estado.success && <p className="text-sm text-success">{estado.success}</p>}
    </form>
  )
}
