'use client'

/**
 * App Car Wash · Fase 3 — detalle de una orden de compra.
 *
 * EL CICLO ES EL QUE MANDA: borrador (se arma) → pedida (se espera) → recibida
 * (entra al stock). Cada estado habilita cosas distintas, y la pantalla lo
 * refleja en vez de mostrar todos los botones siempre:
 *
 *  · Borrador: se agregan y quitan líneas. Pedir la cierra a edición.
 *  · Pedida: ya no se editan líneas —el proveedor tiene otra cosa en la mano—
 *    pero SÍ se ajusta lo que realmente llegó, porque entregar incompleto
 *    pasa más de lo que uno quisiera.
 *  · Recibida: solo lectura. El stock ya se movió.
 */

import { useActionState, useEffect, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, PackageCheck, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  agregarLinea,
  quitarLinea,
  moverOrden,
  ajustarRecibido,
  type Fase3State,
} from '@/modules/carwash/fase3-actions'
import {
  ORDEN_ESTADO_LABELS,
  puedeEditarLineas,
  type OrdenDetalle as OrdenDetalleTipo,
  type OrdenEstado,
} from '@/modules/carwash/compras'

const initial: Fase3State = {}

const input =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm placeholder:text-muted-foreground'

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 2,
  }).format(n)
}

function useAviso(state: Fase3State) {
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])
}

export interface ProductoOpcion {
  id: string
  nombre: string
  unidad: string
  costo: number | null
}

export function OrdenDetalle({
  orden,
  productos,
}: {
  orden: OrdenDetalleTipo
  productos: ProductoOpcion[]
}) {
  const editable = puedeEditarLineas(orden.estado)
  const recibiendo = orden.estado === 'PEDIDA'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {ORDEN_ESTADO_LABELS[orden.estado as OrdenEstado] ?? orden.estado}
          </p>
          <p className="text-2xl font-bold tabular-nums text-foreground">{fmtRD(orden.total)}</p>
          <p className="text-xs text-muted-foreground">
            {orden.lineas.length} línea(s) · {orden.proveedor.nombre}
            {orden.proveedor.telefono ? ` · ${orden.proveedor.telefono}` : ''}
          </p>
        </div>
        <Acciones orden={orden} />
      </div>

      {orden.notas && (
        <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">{orden.notas}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {editable ? (
          <AgregarLinea ordenId={orden.id} productos={productos} />
        ) : (
          <p className="h-fit rounded-2xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
            {recibiendo
              ? 'La orden ya está pedida: las líneas no se editan, pero puedes ajustar lo que realmente llegó antes de recibirla.'
              : 'Esta orden está cerrada. Su contenido queda como registro de lo que se compró.'}
          </p>
        )}

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Productos
          </h2>
          {orden.lineas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Sin líneas todavía. Agrega productos para poder pedirla.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
              <table className="w-full min-w-[580px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Producto</th>
                    <th className="px-4 py-3 font-semibold">Pedido</th>
                    {recibiendo && <th className="px-4 py-3 font-semibold">Llegó</th>}
                    <th className="px-4 py-3 font-semibold">Costo</th>
                    <th className="px-4 py-3 font-semibold">Subtotal</th>
                    {editable && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {orden.lineas.map((l) => (
                    <tr key={l.id}>
                      <td className="max-w-56 truncate px-4 py-3 text-foreground">{l.nombre}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {l.cantidad} {l.unidad}
                      </td>
                      {recibiendo && (
                        <td className="px-4 py-3">
                          <FormRecibido linea={l} />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {fmtRD(l.costoUnitario)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-foreground">
                        {fmtRD(
                          (l.cantidadRecibida ?? l.cantidad) * l.costoUnitario
                        )}
                      </td>
                      {editable && (
                        <td className="px-4 py-3 text-right">
                          <BotonQuitar id={l.id} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Acciones({ orden }: { orden: OrdenDetalleTipo }) {
  const [pending, start] = useTransition()

  function mover(destino: string, confirmacion?: string) {
    if (confirmacion && !window.confirm(confirmacion)) return
    start(async () => {
      const r = await moverOrden(orden.id, destino)
      if (r.error) toast.error(r.error)
      else if (r.success) toast.success(r.success)
    })
  }

  if (orden.estado === 'BORRADOR') {
    return (
      <div className="flex gap-2">
        <Button disabled={pending} className="gap-1.5" onClick={() => mover('PEDIDA')}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Marcar como pedida
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => mover('CANCELADA', '¿Cancelar esta orden?')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  if (orden.estado === 'PEDIDA') {
    return (
      <div className="flex gap-2">
        <Button
          disabled={pending}
          className="gap-1.5"
          onClick={() =>
            mover(
              'RECIBIDA',
              'Al recibir, los productos ENTRAN al inventario y la orden se cierra. ¿Continuar?'
            )
          }
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PackageCheck className="h-4 w-4" />
          )}
          Recibir e ingresar al stock
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => mover('CANCELADA', '¿Cancelar esta orden?')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return null
}

function AgregarLinea({
  ordenId,
  productos,
}: {
  ordenId: string
  productos: ProductoOpcion[]
}) {
  const [state, formAction, pending] = useActionState(agregarLinea, initial)
  useAviso(state)

  if (productos.length === 0) {
    return (
      <p className="h-fit rounded-2xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
        No tienes productos en el inventario. Créalos primero: una orden compra
        productos que ya existen, para que al recibirla el stock sepa a dónde ir.
      </p>
    )
  }

  return (
    <form
      action={formAction}
      className="h-fit space-y-3 rounded-2xl border border-border/70 bg-card p-5"
    >
      <input type="hidden" name="ordenId" value={ordenId} />
      <h2 className="text-sm font-bold text-foreground">Agregar producto</h2>
      <select name="productoId" required className={input} defaultValue="">
        <option value="" disabled>
          Elige el producto
        </option>
        {productos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre} ({p.unidad})
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input name="cantidad" required inputMode="decimal" placeholder="Cantidad" className={input} />
        <input
          name="costoUnitario"
          required
          inputMode="decimal"
          placeholder="Costo unitario"
          className={input}
        />
      </div>
      <Button type="submit" disabled={pending} variant="secondary" className="w-full gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Agregar
      </Button>
    </form>
  )
}

function FormRecibido({ linea }: { linea: OrdenDetalleTipo['lineas'][number] }) {
  const [state, formAction, pending] = useActionState(ajustarRecibido, initial)
  useAviso(state)
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="lineaId" value={linea.id} />
      <input
        name="cantidadRecibida"
        inputMode="decimal"
        defaultValue={linea.cantidadRecibida ?? ''}
        placeholder={String(linea.cantidad)}
        className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-sm"
      />
      <Button type="submit" size="sm" variant="ghost" disabled={pending} className="h-9 px-2">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '✓'}
      </Button>
    </form>
  )
}

function BotonQuitar({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      className="text-muted-foreground hover:text-destructive"
      onClick={() =>
        start(async () => {
          const r = await quitarLinea(id)
          if (r.error) toast.error(r.error)
          else if (r.success) toast.success(r.success)
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  )
}
