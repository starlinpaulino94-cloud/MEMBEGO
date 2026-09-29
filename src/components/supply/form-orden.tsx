'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearOrdenAction, type EstadoAccion } from '@/modules/supply/actions'

export interface AcuerdoParaOrden {
  id: string
  codigo: string
  proveedor: string
  itemNombre: string
  cantidad: number
  costoUnitario: number
  impuestoPorcentaje: number | null
}

interface Linea {
  item: string
  cantidad: string
  costo: string
}

/**
 * MEMBEGO SUPPLY · NUEVA ORDEN DE COMPRA desde la pantalla de órdenes (§5).
 *
 * Proveedor → acuerdo → líneas (varias) → impuestos → total → nace en BORRADOR.
 * La aprobación es otro paso, con otra persona: aquí solo se pide.
 */
export function FormOrden({ acuerdos }: { acuerdos: AcuerdoParaOrden[] }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(crearOrdenAction, {})
  const [acuerdoId, setAcuerdoId] = useState(acuerdos[0]?.id ?? '')
  const acuerdo = acuerdos.find((a) => a.id === acuerdoId)
  const [lineas, setLineas] = useState<Linea[]>(() =>
    acuerdos[0] ? [{ item: acuerdos[0].itemNombre, cantidad: String(acuerdos[0].cantidad), costo: String(acuerdos[0].costoUnitario) }] : [{ item: '', cantidad: '', costo: '' }]
  )
  const [impuestoPct, setImpuestoPct] = useState(String(acuerdos[0]?.impuestoPorcentaje ?? 0))

  if (acuerdos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay acuerdos aprobados contra los que comprar. Crea uno en <Link href="/superadmin/supply/acuerdos" className="underline">Acuerdos</Link> y apruébalo.
      </p>
    )
  }

  const subtotal = lineas.reduce((t, l) => t + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0)
  const impuestos = Math.round(subtotal * ((Number(impuestoPct) || 0) / 100) * 100) / 100
  const total = subtotal + impuestos

  const cambiarAcuerdo = (id: string) => {
    setAcuerdoId(id)
    const a = acuerdos.find((x) => x.id === id)
    if (a) {
      setLineas([{ item: a.itemNombre, cantidad: String(a.cantidad), costo: String(a.costoUnitario) }])
      setImpuestoPct(String(a.impuestoPorcentaje ?? 0))
    }
  }
  const editar = (i: number, campo: keyof Linea, valor: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="acuerdoId" value={acuerdoId} />
      <input type="hidden" name="impuestos" value={impuestos.toFixed(2)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="acuerdoOrden">Proveedor y acuerdo</Label>
          <select id="acuerdoOrden" value={acuerdoId} onChange={(e) => cambiarAcuerdo(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
            {acuerdos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.proveedor} · {a.codigo} · {a.itemNombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="impuestoPct">% impuestos</Label>
          <Input id="impuestoPct" type="number" min={0} max={100} step="0.01" value={impuestoPct} onChange={(e) => setImpuestoPct(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Líneas</p>
        {lineas.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <Label htmlFor={`lineaItem-${i}`}>Producto / servicio</Label>
              <Input id={`lineaItem-${i}`} name="lineaItem" required maxLength={200} value={l.item} onChange={(e) => editar(i, 'item', e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`lineaCantidad-${i}`}>Cantidad</Label>
              <Input id={`lineaCantidad-${i}`} name="lineaCantidad" type="number" min={1} step="1" required value={l.cantidad} onChange={(e) => editar(i, 'cantidad', e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`lineaCosto-${i}`}>Costo unitario</Label>
              <Input id={`lineaCosto-${i}`} name="lineaCosto" type="number" min={0} step="0.01" required value={l.costo} onChange={(e) => editar(i, 'costo', e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setLineas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} disabled={lineas.length === 1}>
                Quitar
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setLineas((ls) => [...ls, { item: acuerdo?.itemNombre ?? '', cantidad: '', costo: String(acuerdo?.costoUnitario ?? '') }])}>
          + Añadir línea
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="condicionesPagoOrden">Forma de pago</Label>
          <Input id="condicionesPagoOrden" name="condicionesPago" maxLength={1000} placeholder="30% anticipo, resto al recibir" />
        </div>
        <div>
          <Label htmlFor="notasOrden">Notas</Label>
          <Textarea id="notasOrden" name="notas" rows={1} maxLength={2000} />
        </div>
      </div>

      <p className="rounded-lg bg-muted/40 p-3 text-sm">
        Subtotal RD${subtotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })} · impuestos RD${impuestos.toLocaleString('es-DO', { minimumFractionDigits: 2 })} ·{' '}
        <strong>Total RD${total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pendiente}>
          {pendiente ? 'Creando…' : 'Crear orden en borrador'}
        </Button>
        <span className="text-caption text-muted-foreground">Después: enviar a aprobación → aprobar (otra persona) → confirmar → recibir (genera los lotes).</span>
      </div>
      {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
      {estado.success && (
        <p className="text-sm text-success">
          {estado.success} <Link href={`/superadmin/supply/ordenes/${estado.id}`} className="underline">Abrir la orden</Link>.
        </p>
      )}
    </form>
  )
}
