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

interface LotePorRecibir {
  loteId: string
  codigo: string
  vencimiento: string | null
  /** Lo que sigue en camino de este lote. */
  pendiente: number
}

interface LineaPorRecibir {
  varianteId: string
  nombre: string
  sku: string
  /** Lo que sigue en camino de este producto. */
  pendiente: number
  /** INV-5b4: los lotes de la línea que todavía tienen algo en camino (vacío si el producto no lleva lotes). */
  lotes?: LotePorRecibir[]
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
  // Lo que llegó: por producto (`varianteId`) o, en un producto con lotes, por lote (`varianteId|loteId`).
  const llave = (l: LineaPorRecibir, lote?: LotePorRecibir) => (lote ? `${l.varianteId}|${lote.loteId}` : l.varianteId)
  const [llego, setLlego] = useState<Record<string, string>>(() => Object.fromEntries(lineas.flatMap((l) => (l.lotes && l.lotes.length > 0 ? l.lotes.map((x) => [llave(l, x), String(x.pendiente)]) : [[llave(l), String(l.pendiente)]]))))
  const [modo, setModo] = useState<'recibir' | 'faltante' | 'cancelar' | null>(null)
  const [motivo, setMotivo] = useState('')
  const [claveRecibir, setClaveRecibir] = useState(() => nuevaClave())

  const conLotes = (l: LineaPorRecibir) => (l.lotes?.length ?? 0) > 0
  // Un producto con lotes pide cada lote (entero de 0 hasta lo que de él sigue en camino); la línea es la suma.
  const pedidas = lineas.map((l) => {
    if (!conLotes(l))
      return {
        varianteId: l.varianteId,
        cantidad: entero(llego[l.varianteId] ?? '0') ?? -1,
        lotes: undefined as { loteId: string; cantidad: number }[] | undefined,
      }
    const porLote = l.lotes!.map((x) => ({
      loteId: x.loteId,
      cantidad: entero(llego[llave(l, x)] ?? '0') ?? -1,
      tope: x.pendiente,
    }))
    const mal = porLote.some((x) => x.cantidad < 0 || x.cantidad > x.tope)
    return {
      varianteId: l.varianteId,
      cantidad: mal ? -1 : porLote.reduce((s, x) => s + x.cantidad, 0),
      lotes: porLote.filter((x) => x.cantidad > 0).map((x) => ({ loteId: x.loteId, cantidad: x.cantidad })),
    }
  })
  const hayError = pedidas.some((p, i) => p.cantidad < 0 || p.cantidad > lineas[i].pendiente)
  const total = pedidas.reduce((s, p) => s + Math.max(p.cantidad, 0), 0)

  function validar(): boolean {
    const i = pedidas.findIndex((p, k) => p.cantidad < 0 || p.cantidad > lineas[k].pendiente)
    if (i >= 0) {
      toast.error(
        conLotes(lineas[i])
          ? `Revisa lo que llegó de cada lote de «${lineas[i].nombre}»: es un entero de 0 hasta lo que falta de ese lote.`
          : `Revisa lo que llegó de «${lineas[i].nombre}»: es un entero de 0 hasta ${formatearCantidad(lineas[i].pendiente)}.`
      )
      return false
    }
    return true
  }

  function enviarRecepcion(opciones: { todo?: boolean; cerrarConFaltante?: boolean }) {
    if (!opciones.todo && !validar()) return
    start(async () => {
      const r = await recibirTransferencia({
        trasladoId,
        ...(opciones.todo
          ? { todo: true }
          : {
              lineas: pedidas
                .filter((p) => p.cantidad > 0)
                .map((p) => ({
                  varianteId: p.varianteId,
                  cantidad: p.cantidad,
                  ...(p.lotes ? { lotes: p.lotes } : {}),
                })),
            }),
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
            <li key={l.varianteId} className="space-y-3 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    SKU {l.sku} · faltan {formatearCantidad(l.pendiente)} por llegar
                    {conLotes(l) && ' · llega por lotes'}
                  </p>
                </div>
                {!conLotes(l) && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`rt-${l.varianteId}`} className="sr-only">
                      Llegó de {l.nombre}
                    </Label>
                    <Input
                      id={`rt-${l.varianteId}`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={llego[l.varianteId] ?? ''}
                      onChange={(e) =>
                        setLlego((x) => ({
                          ...x,
                          [l.varianteId]: e.target.value,
                        }))
                      }
                      aria-invalid={(entero(llego[l.varianteId] ?? '') ?? -1) < 0 || (entero(llego[l.varianteId] ?? '') ?? 0) > l.pendiente}
                      className="w-24 text-right tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">de {formatearCantidad(l.pendiente)}</span>
                  </div>
                )}
              </div>
              {conLotes(l) && (
                <ul className="space-y-2 rounded-lg bg-muted/40 p-3" aria-label={`Lotes por recibir de ${l.nombre}`}>
                  {l.lotes!.map((x) => (
                    <li key={x.loteId} data-lote={x.codigo} className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Lote {x.codigo}</p>
                        <p className="text-xs text-muted-foreground">
                          {x.vencimiento ? `Vence ${x.vencimiento}` : 'No vence'} · faltan {formatearCantidad(x.pendiente)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`rt-${l.varianteId}-${x.loteId}`} className="sr-only">
                          Llegó del lote {x.codigo} de {l.nombre}
                        </Label>
                        <Input
                          id={`rt-${l.varianteId}-${x.loteId}`}
                          inputMode="numeric"
                          autoComplete="off"
                          value={llego[llave(l, x)] ?? ''}
                          onChange={(e) =>
                            setLlego((v) => ({
                              ...v,
                              [llave(l, x)]: e.target.value,
                            }))
                          }
                          aria-invalid={(entero(llego[llave(l, x)] ?? '') ?? -1) < 0 || (entero(llego[llave(l, x)] ?? '') ?? 0) > x.pendiente}
                          className="w-24 text-right tabular-nums"
                        />
                        <span className="text-xs text-muted-foreground">de {formatearCantidad(x.pendiente)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
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
