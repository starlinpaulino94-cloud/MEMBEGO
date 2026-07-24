'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, PackagePlus, X } from 'lucide-react'
import { guardarProducto } from '@/modules/carwash/inventario-actions'
import type { ProductoInv } from '@/modules/carwash/inventario'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * App Car Wash · E5 — alta/edición de un producto del inventario.
 * Sin `producto` es el formulario de "Nuevo producto" (plegado tras un botón);
 * con `producto` edita y queda abierto.
 */
export function ProductoForm({ producto }: { producto?: ProductoInv }) {
  const editando = Boolean(producto)
  const [abierto, setAbierto] = useState(editando)
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function action(formData: FormData) {
    startTransition(async () => {
      const res = await guardarProducto({}, formData)
      if (res.success) {
        toast.success(res.success)
        if (!editando) {
          formRef.current?.reset()
          setAbierto(false)
        }
      }
      if (res.error) toast.error(res.error)
    })
  }

  if (!abierto) {
    return (
      <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setAbierto(true)}>
        <PackagePlus className="h-4 w-4" /> Nuevo producto
      </Button>
    )
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-4 rounded-2xl border border-border/70 bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          {editando ? `Editar · ${producto?.nombre}` : 'Nuevo producto'}
        </h2>
        {!editando && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {producto && <input type="hidden" name="id" value={producto.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="inv-nombre">Nombre *</Label>
          <Input
            id="inv-nombre"
            name="nombre"
            required
            maxLength={120}
            defaultValue={producto?.nombre}
            placeholder="Ej. Shampoo para autos"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-categoria">Categoría</Label>
          <Input
            id="inv-categoria"
            name="categoria"
            maxLength={60}
            defaultValue={producto?.categoria ?? ''}
            placeholder="Ej. Químicos"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-unidad">Unidad</Label>
          <Input
            id="inv-unidad"
            name="unidad"
            maxLength={30}
            defaultValue={producto?.unidad ?? 'unidad'}
            placeholder="unidad, galón, litro…"
          />
        </div>
        {!editando && (
          <div className="space-y-1.5">
            <Label htmlFor="inv-inicial">Stock inicial</Label>
            <Input
              id="inv-inicial"
              name="stockInicial"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="inv-minimo">Stock mínimo (alerta)</Label>
          <Input
            id="inv-minimo"
            name="stockMinimo"
            inputMode="decimal"
            defaultValue={producto ? String(producto.stockMinimo) : ''}
            placeholder="0"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-costo">Costo (RD$, opcional)</Label>
          <Input
            id="inv-costo"
            name="costo"
            inputMode="decimal"
            defaultValue={producto?.costo != null ? String(producto.costo) : ''}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="inv-notas">Notas</Label>
          <Input
            id="inv-notas"
            name="notas"
            maxLength={300}
            defaultValue={producto?.notas ?? ''}
            placeholder="Proveedor, presentación…"
          />
        </div>
        {editando && (
          <label className="flex items-center gap-2 pt-6 text-sm text-foreground">
            <input
              type="checkbox"
              name="activo"
              defaultChecked={producto?.activo}
              className="h-4 w-4 rounded border-border"
            />
            Producto activo
          </label>
        )}
      </div>
      <Button type="submit" disabled={pending} className="gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {editando ? 'Guardar cambios' : 'Crear producto'}
      </Button>
    </form>
  )
}
