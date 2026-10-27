'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Star } from 'lucide-react'
import { toast } from 'sonner'
import { desvincularProveedorDeProducto, vincularProveedorDeProducto } from '@/modules/inventory/actions'
import { MAX_CODIGO_PROVEEDOR, MAX_DIAS_ENTREGA } from '@/modules/inventory/compras'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ProveedorDelProducto {
  proveedorId: string
  nombre: string
  activo: boolean
  codigoProveedor: string | null
  /** Ya formateado («12.50»); null = todavía no se le ha comprado. */
  ultimoCosto: string | null
  /** Ya formateada («13 oct 2026»). */
  ultimoCostoEn: string | null
  diasEntrega: number | null
  preferido: boolean
}

/**
 * Qué proveedores surten UN producto: su código, cuánto tardan, el último costo al que se les compró y cuál es el
 * PREFERIDO (a lo sumo uno). Se agrega o se corrige uno con el formulario de abajo (elegir uno que ya está lo actualiza)
 * y se quita con «Quitar». El último costo no se escribe: lo deja cada recepción de una orden.
 */
export function ProveedoresDeProductoCard({ varianteId, proveedores, opciones }: { varianteId: string; proveedores: ProveedorDelProducto[]; opciones: Array<{ id: string; nombre: string }> }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [proveedorId, setProveedorId] = useState(opciones[0]?.id ?? '')
  const [codigo, setCodigo] = useState('')
  const [dias, setDias] = useState('')
  const [preferido, setPreferido] = useState(false)

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!proveedorId) {
      toast.error('Elige el proveedor.')
      return
    }
    if (dias.trim() !== '' && (!/^\d{1,3}$/.test(dias.trim()) || Number(dias) > MAX_DIAS_ENTREGA)) {
      toast.error(`Los días de entrega son un número entero de 0 a ${MAX_DIAS_ENTREGA}.`)
      return
    }
    start(async () => {
      const r = await vincularProveedorDeProducto({ varianteId, proveedorId, codigoProveedor: codigo, diasEntrega: dias.trim() === '' ? null : Number(dias), preferido })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.preferido ? 'Proveedor guardado como el preferido de este producto.' : 'Proveedor guardado.')
      setCodigo('')
      setDias('')
      setPreferido(false)
      router.refresh()
    })
  }

  function hacerPreferido(p: ProveedorDelProducto) {
    start(async () => {
      const r = await vincularProveedorDeProducto({ varianteId, proveedorId: p.proveedorId, codigoProveedor: p.codigoProveedor, diasEntrega: p.diasEntrega, preferido: true })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`${p.nombre} es ahora el proveedor preferido.`)
      router.refresh()
    })
  }

  function quitar(p: ProveedorDelProducto) {
    start(async () => {
      const r = await desvincularProveedorDeProducto({ varianteId, proveedorId: p.proveedorId })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`${p.nombre} ya no figura como proveedor de este producto.`)
      router.refresh()
    })
  }

  const campo = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
  return (
    <div className="space-y-4">
      {proveedores.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay proveedores registrados para este producto. Al recibir una orden de compra, el proveedor queda aquí con el último costo al que se le compró.</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Proveedores del producto">
          {proveedores.map((p) => (
            <li key={p.proveedorId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {p.nombre}
                  {p.preferido && (
                    <Badge className="ml-2 align-middle">
                      <Star className="mr-1 h-3 w-3" aria-hidden />
                      Preferido
                    </Badge>
                  )}
                  {!p.activo && (
                    <Badge variant="outline" className="ml-2 align-middle">
                      Desactivado
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.codigoProveedor ? `Código ${p.codigoProveedor} · ` : ''}
                  {p.ultimoCosto ? `último costo ${p.ultimoCosto}${p.ultimoCostoEn ? ` (${p.ultimoCostoEn})` : ''}` : 'todavía no se le ha comprado'}
                  {p.diasEntrega !== null && ` · entrega en ${p.diasEntrega} día${p.diasEntrega === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!p.preferido && (
                  <Button type="button" size="sm" variant="outline" onClick={() => hacerPreferido(p)} disabled={pending}>
                    Hacer preferido
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => quitar(p)} disabled={pending} aria-label={`Quitar a ${p.nombre}`}>
                  Quitar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {opciones.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay proveedores activos. Crea uno en «Proveedores» para vincularlo a este producto.</p>
      ) : (
        <form onSubmit={enviar} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem_8rem_auto] sm:items-end" aria-label="Agregar proveedor al producto">
          <div className="space-y-1.5">
            <Label htmlFor="pp-proveedor">Proveedor</Label>
            <select id="pp-proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className={campo}>
              {opciones.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                  {proveedores.some((p) => p.proveedorId === o.id) ? ' (ya vinculado: se actualiza)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-codigo">Su código</Label>
            <Input id="pp-codigo" value={codigo} maxLength={MAX_CODIGO_PROVEEDOR} onChange={(e) => setCodigo(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-dias">Días de entrega</Label>
            <Input id="pp-dias" inputMode="numeric" autoComplete="off" value={dias} onChange={(e) => setDias(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={preferido} onChange={(e) => setPreferido(e.target.checked)} className="h-4 w-4" />
              Preferido
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Guardar
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
