'use client'

/**
 * App Car Wash · Fase 3 — proveedores y órdenes de compra.
 *
 * LO PRIMERO QUE SE VE ES "QUÉ HAY QUE PEDIR". No la lista de proveedores ni
 * el historial: lo que está bajo mínimo y nadie ha pedido todavía. Esa es la
 * pregunta que trae a alguien a esta pantalla.
 *
 * El módulo de inventario ya dice qué está bajo mínimo. Lo que agrega este es
 * el "y nadie lo ha pedido": sin ese filtro, se compra dos veces.
 */

import { useActionState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Pencil, Power, ShoppingCart, TriangleAlert, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  guardarProveedor,
  alternarProveedor,
  crearOrden,
  type Fase3State,
} from '@/modules/carwash/fase3-actions'
import { ORDEN_ESTADO_LABELS, type OrdenEstado, type PanelCompras, type ProveedorResumen } from '@/modules/carwash/compras'

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

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' }).format(new Date(d))
}

const CHIP: Record<string, string> = {
  BORRADOR: 'bg-muted text-muted-foreground',
  PEDIDA: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  RECIBIDA: 'bg-success/15 text-success',
  CANCELADA: 'bg-destructive/10 text-destructive',
}

function useAviso(state: Fase3State) {
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])
}

export function ComprasPanel({
  panel,
  proveedores,
  editando,
}: {
  panel: PanelCompras
  proveedores: ProveedorResumen[]
  editando: ProveedorResumen | null
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Por pedir" valor={String(panel.porPedir.length)} pie="bajo mínimo y sin orden" destacar={panel.porPedir.length > 0} />
        <Kpi label="En camino" valor={String(panel.kpis.enCamino)} pie="órdenes pedidas" />
        <Kpi label="Borradores" valor={String(panel.kpis.borradores)} pie="sin enviar al proveedor" />
        <Kpi label="Comprado" valor={fmtRD(panel.kpis.gastoPeriodo)} pie="recibido en el período" />
      </div>

      {/* ── Lo que hay que pedir ─────────────────────────────────────────── */}
      {panel.porPedir.length > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-5">
          <p className="flex items-center gap-2 font-bold text-foreground">
            <TriangleAlert className="h-5 w-5" /> Hay que pedir {panel.porPedir.length} producto(s)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Están en su mínimo o por debajo y no aparecen en ninguna orden abierta.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {panel.porPedir.map((p) => (
              <li
                key={p.id}
                className="rounded-lg bg-card px-3 py-1.5 text-sm text-foreground"
              >
                {p.nombre}{' '}
                <span className="text-xs text-muted-foreground">
                  {p.stock} / {p.stockMinimo} {p.unidad}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <NuevaOrden proveedores={panel.proveedores} />
          <FormProveedor editando={editando} />
        </div>

        <div className="space-y-6">
          <Ordenes ordenes={panel.ordenes} />
          <Proveedores proveedores={proveedores} />
        </div>
      </div>
    </div>
  )
}

function Kpi({
  label,
  valor,
  pie,
  destacar,
}: {
  label: string
  valor: string
  pie: string
  destacar?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        destacar ? 'border-warning/40 bg-warning/10' : 'border-border/70 bg-card'
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-bold tabular-nums text-foreground">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{pie}</p>
    </div>
  )
}

function NuevaOrden({ proveedores }: { proveedores: { id: string; nombre: string }[] }) {
  const [state, formAction, pending] = useActionState(crearOrden, initial)
  useAviso(state)

  if (proveedores.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
        Crea primero un proveedor: una orden de compra siempre es <b>a alguien</b>.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <ShoppingCart className="h-4 w-4" /> Nueva orden
      </h2>
      <select name="proveedorId" required className={input} defaultValue="">
        <option value="" disabled>
          Elige el proveedor
        </option>
        {proveedores.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      <input name="notas" maxLength={500} placeholder="Nota (opcional)" className={input} />
      <Button type="submit" disabled={pending} className="w-full gap-1.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Crear borrador
      </Button>
      <p className="text-xs text-muted-foreground">
        Nace como borrador: le agregas los productos y luego la marcas como pedida.
      </p>
    </form>
  )
}

function FormProveedor({ editando }: { editando: ProveedorResumen | null }) {
  const [state, formAction, pending] = useActionState(guardarProveedor, initial)
  useAviso(state)

  return (
    <form
      action={formAction}
      key={editando?.id ?? 'nuevo'}
      className="space-y-3 rounded-2xl border border-border/70 bg-card p-5"
    >
      <input type="hidden" name="id" value={editando?.id ?? ''} />
      <h2 className="text-sm font-bold text-foreground">
        {editando ? `Editar ${editando.nombre}` : 'Nuevo proveedor'}
      </h2>
      <input
        name="nombre"
        required
        maxLength={80}
        defaultValue={editando?.nombre ?? ''}
        placeholder="Distribuidora Química del Este"
        className={input}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          name="contacto"
          maxLength={80}
          defaultValue={editando?.contacto ?? ''}
          placeholder="Contacto"
          className={input}
        />
        <input
          name="telefono"
          maxLength={30}
          defaultValue={editando?.telefono ?? ''}
          placeholder="Teléfono"
          className={input}
        />
        <input name="rnc" maxLength={20} placeholder="RNC" className={input} />
        <input
          name="diasCredito"
          inputMode="numeric"
          defaultValue={editando?.diasCredito ?? 0}
          placeholder="Días de crédito"
          className={input}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} variant="secondary" className="gap-1.5">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {editando ? 'Guardar' : 'Agregar proveedor'}
        </Button>
        {editando && (
          <Button asChild variant="ghost">
            <Link href="/admin/app/carwash/compras">Cancelar</Link>
          </Button>
        )}
      </div>
    </form>
  )
}

function Ordenes({ ordenes }: { ordenes: PanelCompras['ordenes'] }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Órdenes de compra
      </h2>
      {ordenes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          <Truck className="mx-auto mb-2 h-7 w-7 opacity-40" />
          Sin órdenes todavía.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Orden</th>
                <th className="px-4 py-3 font-semibold">Proveedor</th>
                <th className="px-4 py-3 font-semibold">Líneas</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {ordenes.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/app/carwash/compras/${o.id}`}
                      className="font-mono font-semibold text-foreground hover:underline"
                    >
                      {o.numero}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">{fmtFecha(o.createdAt)}</p>
                  </td>
                  <td className="max-w-40 truncate px-4 py-3 text-foreground">{o.proveedor}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{o.lineas}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-foreground">
                    {fmtRD(o.total)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        CHIP[o.estado] ?? 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {ORDEN_ESTADO_LABELS[o.estado as OrdenEstado] ?? o.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Proveedores({ proveedores }: { proveedores: ProveedorResumen[] }) {
  if (proveedores.length === 0) return null
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Proveedores
      </h2>
      <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-card">
        {proveedores.map((p) => (
          <div
            key={p.id}
            className={`flex items-center justify-between gap-3 p-3 ${p.activo ? '' : 'opacity-55'}`}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{p.nombre}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[p.contacto, p.telefono, p.diasCredito > 0 && `${p.diasCredito} días de crédito`]
                  .filter(Boolean)
                  .join(' · ') || 'Sin contacto'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {p.ordenesAbiertas > 0 && (
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                  {p.ordenesAbiertas} abierta(s)
                </span>
              )}
              <Button asChild size="sm" variant="ghost">
                <Link href={`/admin/app/carwash/compras?editar=${p.id}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <BotonActivar id={p.id} activo={p.activo} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function BotonActivar({ id, activo }: { id: string; activo: boolean }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      title={activo ? 'Desactivar' : 'Activar'}
      onClick={() =>
        start(async () => {
          const r = await alternarProveedor(id)
          if (r.error) toast.error(r.error)
          else if (r.success) toast.success(r.success)
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
    </Button>
  )
}
