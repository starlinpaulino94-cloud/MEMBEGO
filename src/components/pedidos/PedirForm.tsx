'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { crearPedidoComoCliente } from '@/modules/orders/cliente-actions'
import { formatearMonto } from '@/modules/orders/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface OpcionVariante {
  id: string
  name: string
  price: string
  available: boolean
}

function nuevaClave(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

const campoSelector = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'

interface Props {
  /** Dónde volver tras iniciar sesión. */
  retorno: string
  moneda: string
  /** Si el ítem tiene más de una variante se pide elegir; con una sola no se enseña el selector. */
  conVariantes: boolean
  variantes: OpcionVariante[]
  sucursales: { id: string; nombre: string }[]
}

/**
 * «Pedir» en la ficha pública de un producto. Funciona sin saber si hay sesión
 * (la página es estática): si no la hay, la acción lo dice y se manda a la
 * persona a iniciar sesión y volver aquí. El precio que se muestra es solo
 * informativo; el pedido lo fija el servidor desde el catálogo.
 */
export function PedirForm({ retorno, moneda, conVariantes, variantes, sucursales }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const disponibles = variantes.filter((v) => v.available)
  const [varianteId, setVarianteId] = useState(disponibles[0]?.id ?? '')
  const [cantidad, setCantidad] = useState('1')
  const [sucursalId, setSucursalId] = useState(sucursales.length === 1 ? sucursales[0].id : '')
  const [notas, setNotas] = useState('')
  const clave = useRef(nuevaClave())

  if (disponibles.length === 0) return <p className="text-sm text-muted-foreground">Por ahora no hay existencias para pedir.</p>

  const variante = disponibles.find((v) => v.id === varianteId) ?? disponibles[0]
  const n = Number(cantidad)
  const total = Number.isInteger(n) && n > 0 ? (Number(variante.price) * n).toFixed(2) : null

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!Number.isInteger(n) || n < 1) {
      toast.error('Escribe una cantidad entera de 1 en adelante.')
      return
    }
    if (!sucursalId) {
      toast.error('Elige la sucursal donde recogerás tu pedido.')
      return
    }
    start(async () => {
      const r = await crearPedidoComoCliente({ varianteId: variante.id, cantidad: n, sucursalId, notas: notas.trim() || null, clave: clave.current, origen: 'navegacion' })
      if (!r.ok) {
        if (r.sinSesion) {
          router.push(`/login?redirect=${encodeURIComponent(retorno)}`)
          return
        }
        toast.error(r.error)
        return
      }
      toast.success(`Pedido ${r.code} enviado.`)
      router.push(`/cliente/pedidos/${r.pedidoId}`)
    })
  }

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-lg border border-border p-4" aria-label="Hacer un pedido">
      <h2 className="flex items-center gap-2 text-h3 text-foreground">
        <ShoppingBag className="h-4 w-4" aria-hidden />
        Hacer un pedido
      </h2>
      {conVariantes && (
        <div className="space-y-1.5">
          <Label htmlFor="pd-variante">Opción</Label>
          <select id="pd-variante" value={variante.id} onChange={(e) => setVarianteId(e.target.value)} className={campoSelector}>
            {disponibles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {formatearMonto(v.price, moneda)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pd-cantidad">Cantidad</Label>
          <Input id="pd-cantidad" name="cantidad" inputMode="numeric" autoComplete="off" required value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </div>
        {sucursales.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="pd-sucursal">Sucursal donde lo recogerás</Label>
            <select id="pd-sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={campoSelector} required>
              <option value="">Elige una sucursal</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pd-notas">Nota para la empresa (opcional)</Label>
        <Input id="pd-notas" name="notas" maxLength={500} autoComplete="off" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: lo recojo después de las 5" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total ? (
            <>
              Total estimado <span className="font-semibold text-foreground tabular-nums">{formatearMonto(total, moneda)}</span>
            </>
          ) : (
            'Indica la cantidad'
          )}
        </p>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviar pedido
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">La empresa confirmará tu pedido y el monto final. El pago se hace con ella, fuera de MembeGo.</p>
    </form>
  )
}
