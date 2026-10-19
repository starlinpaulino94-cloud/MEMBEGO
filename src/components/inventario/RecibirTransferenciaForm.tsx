'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cancelarTransferencia, recibirTransferencia } from '@/modules/inventory/actions'
import { MAX_MOTIVO_TRASLADO } from '@/modules/inventory/traslados'
import { formatearCantidad } from '@/modules/inventory/formato'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'

interface LineaPorRecibir {
  varianteId: string
  nombre: string
  sku: string
  /** Lo que sigue en camino de este producto. */
  pendiente: number
}

const entero = (t: string): number | null => (/^\d{1,7}$/.test(t.trim()) ? Number(t.trim()) : null)

/**
 * Lo que se hace con una transferencia que sigue en camino: RECIBIR lo que llegó
 * (una parte o todo), CERRAR CON FALTANTE si lo que falta no va a llegar (el motivo
 * es obligatorio) o CANCELARLA (lo que sigue en camino vuelve al origen).
 */
export function RecibirTransferenciaForm({ trasladoId, numero, origenNombre, destinoNombre, lineas }: { trasladoId: string; numero: string; origenNombre: string; destinoNombre: string; lineas: LineaPorRecibir[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [llego, setLlego] = useState<Record<string, string>>(() => Object.fromEntries(lineas.map((l) => [l.varianteId, String(l.pendiente)])))
  const [modo, setModo] = useState<'recibir' | 'faltante' | 'cancelar' | null>(null)
  const [motivo, setMotivo] = useState('')
  const [claveRecibir, setClaveRecibir] = useState(() => nuevaClave())

  const pedidas = lineas.map((l) => ({ varianteId: l.varianteId, cantidad: entero(llego[l.varianteId] ?? '0') ?? -1 }))
  const hayError = pedidas.some((p, i) => p.cantidad < 0 || p.cantidad > lineas[i].pendiente)
  const total = pedidas.reduce((s, p) => s + Math.max(p.cantidad, 0), 0)

  function validar(): boolean {
    const i = pedidas.findIndex((p, k) => p.cantidad < 0 || p.cantidad > lineas[k].pendiente)
    if (i >= 0) {
      toast.error(`Revisa lo que llegó de «${lineas[i].nombre}»: es un entero de 0 hasta ${formatearCantidad(lineas[i].pendiente)}.`)
      return false
    }
    return true
  }

  function enviarRecepcion(opciones: { todo?: boolean; cerrarConFaltante?: boolean }) {
    if (!opciones.todo && !validar()) return
    start(async () => {
      const r = await recibirTransferencia({
        trasladoId,
        ...(opciones.todo ? { todo: true } : { lineas: pedidas.filter((p) => p.cantidad > 0) }),
        cerrarConFaltante: opciones.cerrarConFaltante === true,
        motivo,
        clave: claveRecibir,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setClaveRecibir(nuevaClave())
      toast.success(
        r.estado === 'RECEIVED'
          ? `Transferencia ${r.numero} cerrada: ${formatearCantidad(r.recibidas)} recibidas${r.perdidas > 0 ? `, ${formatearCantidad(r.perdidas)} perdidas` : ''}.`
          : `Recibidas ${formatearCantidad(r.recibidas)}. Faltan ${formatearCantidad(r.enTransito)} por llegar.`
      )
      router.refresh()
    })
  }

  function cancelar() {
    start(async () => {
      const r = await cancelarTransferencia({ trasladoId, motivo })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Transferencia ${r.numero} cancelada: ${formatearCantidad(r.devueltas)} unidades volvieron a ${origenNombre}.`)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recibir en {destinoNombre}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Escribe cuántas unidades llegaron de cada producto. Lo que no llegue lo puedes seguir esperando, dar por perdido (con motivo) o cancelar para que vuelva a {origenNombre}.</p>
        <ul className="divide-y rounded-lg border" aria-label="Lo que llegó">
          {lineas.map((l) => (
            <li key={l.varianteId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  SKU {l.sku} · faltan {formatearCantidad(l.pendiente)} por llegar
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`rt-${l.varianteId}`} className="sr-only">
                  Llegó de {l.nombre}
                </Label>
                <Input
                  id={`rt-${l.varianteId}`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={llego[l.varianteId] ?? ''}
                  onChange={(e) => setLlego((x) => ({ ...x, [l.varianteId]: e.target.value }))}
                  aria-invalid={(entero(llego[l.varianteId] ?? '') ?? -1) < 0 || (entero(llego[l.varianteId] ?? '') ?? 0) > l.pendiente}
                  className="w-24 text-right tabular-nums"
                />
                <span className="text-xs text-muted-foreground">de {formatearCantidad(l.pendiente)}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => enviarRecepcion({})} disabled={pending || hayError || total === 0}>
            {pending && modo === null && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Recibir lo que llegó
          </Button>
          <Button type="button" variant="outline" onClick={() => enviarRecepcion({ todo: true })} disabled={pending}>
            Recibir todo lo pendiente
          </Button>
          <Button type="button" variant="outline" onClick={() => setModo(modo === 'faltante' ? null : 'faltante')} disabled={pending}>
            Cerrar con faltante
          </Button>
          <Button type="button" variant="outline" onClick={() => setModo(modo === 'cancelar' ? null : 'cancelar')} disabled={pending}>
            Cancelar envío
          </Button>
        </div>

        {modo === 'faltante' && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="rt-motivo-faltante">Motivo del faltante *</Label>
              <Input id="rt-motivo-faltante" value={motivo} maxLength={MAX_MOTIVO_TRASLADO} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: se mojaron 3 cajas en el camino" />
            </div>
            <p className="text-xs text-muted-foreground">Se reciben las cantidades de arriba y lo que falte se da por perdido: no vuelve al origen ni entra al destino. Queda guardado con este motivo.</p>
            <Button type="button" variant="destructive" onClick={() => enviarRecepcion({ cerrarConFaltante: true })} disabled={pending || hayError}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Confirmar cierre con faltante
            </Button>
          </div>
        )}

        {modo === 'cancelar' && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="rt-motivo-cancelar">Motivo (opcional)</Label>
              <Input id="rt-motivo-cancelar" value={motivo} maxLength={MAX_MOTIVO_TRASLADO} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: el destino ya no lo necesita" />
            </div>
            <p className="text-xs text-muted-foreground">
              Lo que sigue en camino vuelve a {origenNombre}. Lo que ya se recibió en {destinoNombre} se queda allí.
            </p>
            <Button type="button" variant="destructive" onClick={cancelar} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Sí, cancelar la transferencia {numero}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
