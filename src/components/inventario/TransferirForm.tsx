'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { transferirInventario } from '@/modules/inventory/actions'
import { formatearCantidad } from '@/modules/inventory/formato'
import type { LoteVista } from '@/modules/inventory/lotes-queries'
import { repartoDeTextos } from '@/modules/inventory/traslados'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'
import { ElegirLotes } from './ElegirLotes'

export interface OpcionTransferencia {
  id: string
  nombre: string
  disponible: number
}

/**
 * Mueve existencias DISPONIBLES de una sucursal a otra, en una sola operación.
 * INV-5b4: si el producto lleva lotes (`lotesPorSucursal` viene), sale del lote que antes vence o de los que se elijan, y entra al destino
 * en esos mismos lotes.
 */
export function TransferirForm({ varianteId, sucursales, lotesPorSucursal }: { varianteId: string; sucursales: OpcionTransferencia[]; lotesPorSucursal?: Record<string, LoteVista[]> }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [origen, setOrigen] = useState(sucursales.find((s) => s.disponible > 0)?.id ?? sucursales[0]?.id ?? '')
  const [destino, setDestino] = useState(sucursales.find((s) => s.id !== origen)?.id ?? '')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [elegir, setElegir] = useState(false)
  const [eleccion, setEleccion] = useState<Record<string, string>>({})
  const clave = useRef(nuevaClave())
  const deOrigen = sucursales.find((s) => s.id === origen)
  const llevaLotes = lotesPorSucursal !== undefined
  const lotesDeOrigen = (lotesPorSucursal?.[origen] ?? []).filter((l) => l.disponible > 0)
  const manual = llevaLotes && elegir
  const elegido = repartoDeTextos(eleccion)

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const numero = manual ? elegido.suma : Number(cantidad.trim())
    if (manual ? elegido.hayError || numero < 1 : cantidad.trim() === '' || !Number.isInteger(numero) || numero < 1) {
      toast.error(manual ? 'Escribe cuánto sale de cada lote: enteros de 1 en adelante, en al menos un lote.' : 'Escribe una cantidad entera de 1 en adelante.')
      return
    }
    start(async () => {
      const r = await transferirInventario({ varianteId, origenId: origen, destinoId: destino, cantidad: numero, motivo, ...(manual ? { lotes: elegido.reparto } : {}), clave: clave.current })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Transferencia registrada.')
      clave.current = nuevaClave()
      setCantidad('')
      setMotivo('')
      setEleccion({})
      router.refresh()
    })
  }

  const select = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightLeft className="h-4 w-4" />
          Transferir entre sucursales
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="space-y-3" aria-label="Transferir existencias">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="tr-origen">Desde</Label>
              <select
                id="tr-origen"
                value={origen}
                onChange={(e) => {
                  setOrigen(e.target.value)
                  // Lo tecleado era de los lotes de la otra sucursal.
                  setEleccion({})
                }}
                className={select}
              >
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} ({formatearCantidad(s.disponible)} disp.)
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-destino">Hacia</Label>
              <select id="tr-destino" value={destino} onChange={(e) => setDestino(e.target.value)} className={select}>
                {sucursales
                  .filter((s) => s.id !== origen)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-cantidad">Cantidad</Label>
              {manual ? (
                <output id="tr-cantidad" className="flex h-9 items-center text-sm font-medium tabular-nums" aria-live="polite">
                  {formatearCantidad(elegido.suma)}
                </output>
              ) : (
                <Input id="tr-cantidad" name="cantidad" inputMode="numeric" autoComplete="off" required value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              )}
            </div>
          </div>
          {llevaLotes && (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">De qué lotes sale</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="tr-lotes" checked={!elegir} onChange={() => setElegir(false)} />
                  El que antes vence (automático)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="tr-lotes" checked={elegir} onChange={() => setElegir(true)} />
                  Elegir los lotes
                </label>
              </div>
              {elegir &&
                (lotesDeOrigen.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay lotes con unidades disponibles en {deOrigen?.nombre ?? 'esta sucursal'}.</p>
                ) : (
                  <ElegirLotes idBase="tr-lote" producto="este producto" lotes={lotesDeOrigen} valores={eleccion} alCambiar={setEleccion} />
                ))}
              <p className="text-xs text-muted-foreground">En el destino entra en esos mismos lotes, con el mismo vencimiento.</p>
            </fieldset>
          )}
          <p className="text-xs text-muted-foreground">
            Solo se transfiere lo disponible{deOrigen ? ` (en ${deOrigen.nombre} hay ${formatearCantidad(deOrigen.disponible)})` : ''}; lo apartado no se mueve.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="tr-motivo">Motivo (opcional)</Label>
            <Input id="tr-motivo" name="motivo" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: reabasto de la sucursal norte" />
          </div>
          <Button type="submit" size="sm" disabled={pending || !destino || origen === destino || (manual && (elegido.hayError || elegido.suma < 1))}>
            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Transferir
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
