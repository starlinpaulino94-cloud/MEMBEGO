'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { recibirOrdenCompra } from '@/modules/inventory/actions'
import { MAX_MOTIVO_ORDEN, MAX_NOTA_ORDEN, MAX_REFERENCIA_ORDEN } from '@/modules/inventory/compras'
import { formatearCantidad } from '@/modules/inventory/formato'
import { validarLotesDeLinea } from '@/modules/inventory/lotes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'
import { EditorDeLotes, loteNuevo, lotesParaEnviar, sumaDeLotes, type LoteForm } from './EditorDeLotes'

interface LineaPorRecibir {
  varianteId: string
  nombre: string
  sku: string
  /** Lo que todavía puede llegar de este producto. */
  pendiente: number
  /** El costo pactado, para mostrar. */
  costo: string
  /** INV-5b2: el producto lleva lotes: lo que llega se reparte entre lotes (código, vencimiento y cantidad). */
  llevaLotes: boolean
  exigeVencimiento: boolean
}

const entero = (t: string): number | null => (/^\d{1,7}$/.test(t.trim()) ? Number(t.trim()) : null)

/**
 * RECIBIR mercancía de una orden pedida: se escribe cuánto llegó de cada producto (por defecto, todo lo que falta) y se
 * registra como una entrada de mercancía con el costo de la orden. Lo que no llega se sigue esperando, o se CIERRA CON
 * FALTANTE (el motivo es obligatorio) si ya no va a llegar. No se puede recibir más de lo pedido: si el proveedor mandó
 * de más, se registra como una entrada aparte.
 *
 * INV-5b2 · Un producto que LLEVA LOTES no se recibe con una cantidad suelta: se dice de qué lote(s) llegó (código, vencimiento y
 * cuántas unidades de cada uno) y su cantidad es la suma. Por eso con productos con lotes no hay «recibir todo»: hay que decir el lote.
 */
export function RecibirOrdenCompraForm({ ordenId, sucursalNombre, hayRecibido, lineas }: { ordenId: string; sucursalNombre: string; hayRecibido: boolean; lineas: LineaPorRecibir[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [llego, setLlego] = useState<Record<string, string>>(() => Object.fromEntries(lineas.map((l) => [l.varianteId, String(l.pendiente)])))
  // Los lotes de lo que llegó, por producto (solo los que llevan lotes): por defecto un lote con todo lo que falta.
  const [lotes, setLotes] = useState<Record<string, LoteForm[]>>(() => Object.fromEntries(lineas.filter((l) => l.llevaLotes).map((l) => [l.varianteId, [loteNuevo(l.pendiente)]])))
  const [modo, setModo] = useState<'faltante' | null>(null)
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  const [clave, setClave] = useState(() => nuevaClave())

  const hayLotes = lineas.some((l) => l.llevaLotes)
  /** Lo que llegó de una línea: la suma de sus lotes si los lleva; si no, lo que se escribió (-1 = no es un entero). */
  const llegoDe = (l: LineaPorRecibir): number => (l.llevaLotes ? sumaDeLotes(lotes[l.varianteId] ?? []) : (entero(llego[l.varianteId] ?? '0') ?? -1))
  const pedidas = lineas.map((l) => ({ varianteId: l.varianteId, cantidad: llegoDe(l) }))
  const hayError = pedidas.some((p, i) => p.cantidad < 0 || p.cantidad > lineas[i].pendiente)
  const total = pedidas.reduce((s, p) => s + Math.max(p.cantidad, 0), 0)
  // Cerrar con faltante sin que haya llegado NADA es cancelar: el servidor lo rechaza, y aquí ni se ofrece.
  const puedeCerrar = hayRecibido || total > 0

  function validar(): boolean {
    const i = pedidas.findIndex((p, k) => p.cantidad < 0 || p.cantidad > lineas[k].pendiente)
    if (i >= 0) {
      toast.error(`Revisa lo que llegó de «${lineas[i].nombre}»: es un entero de 0 hasta ${formatearCantidad(lineas[i].pendiente)}.`)
      return false
    }
    // Los lotes de cada producto que los lleva y que llegó, con las mismas reglas del servidor (que las vuelve a aplicar).
    for (let k = 0; k < lineas.length; k++) {
      if (!lineas[k].llevaLotes || pedidas[k].cantidad === 0) continue
      const v = validarLotesDeLinea(lotesParaEnviar(lotes[lineas[k].varianteId] ?? []), pedidas[k].cantidad, { exigirVencimiento: lineas[k].exigeVencimiento })
      if (!v.ok) {
        toast.error(`«${lineas[k].nombre}»: ${v.error}`)
        return false
      }
    }
    return true
  }

  function enviar(opciones: { todo?: boolean; cerrarConFaltante?: boolean }) {
    if (!opciones.todo && !validar()) return
    if (opciones.cerrarConFaltante && motivo.trim() === '') {
      toast.error('Cerrar con faltante necesita un motivo: qué pasó con lo que no llegó.')
      return
    }
    start(async () => {
      const r = await recibirOrdenCompra({
        ordenId,
        ...(opciones.todo
          ? { todo: true }
          : { lineas: pedidas.flatMap((p, i) => (p.cantidad > 0 ? [{ ...p, ...(lineas[i].llevaLotes ? { lotes: lotesParaEnviar(lotes[p.varianteId] ?? []) } : {}) }] : [])) }),
        cerrarConFaltante: opciones.cerrarConFaltante === true,
        motivo,
        referencia,
        nota,
        clave,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setClave(nuevaClave())
      toast.success(
        r.estado === 'RECEIVED'
          ? `Orden ${r.numero} cerrada: ${formatearCantidad(r.recibidas)} recibidas${r.cerradas > 0 ? `, ${formatearCantidad(r.cerradas)} de faltante` : ''}${r.entradaNumero ? ` (entrada ${r.entradaNumero})` : ''}.`
          : `Recibidas ${formatearCantidad(r.recibidas)} en ${sucursalNombre}${r.entradaNumero ? ` (entrada ${r.entradaNumero})` : ''}. Faltan ${formatearCantidad(r.pendientes)} por llegar.`
      )
      setReferencia('')
      setNota('')
      setMotivo('')
      setModo(null)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recibir en {sucursalNombre}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Escribe cuántas unidades llegaron de cada producto. Entran al inventario de {sucursalNombre} con el costo de la orden y mueven el costo promedio. Lo que no llegue lo puedes seguir esperando o cerrar con faltante.
        </p>
        {hayLotes && <p className="text-sm text-muted-foreground">Los productos con lotes se reciben diciendo de qué lote llegaron; por eso aquí no hay «recibir todo». Para dejar uno sin recibir, pon su lote en 0.</p>}
        <ul className="divide-y rounded-lg border" aria-label="Lo que llegó">
          {lineas.map((l, i) => (
            <li key={l.varianteId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  SKU {l.sku} · costo {l.costo} · faltan {formatearCantidad(l.pendiente)} por llegar
                </p>
              </div>
              <div className="flex items-center gap-2">
                {l.llevaLotes ? (
                  <p className="w-24 text-right text-sm tabular-nums" aria-label={`Total de ${l.nombre}`} aria-invalid={pedidas[i].cantidad > l.pendiente}>
                    {formatearCantidad(Math.max(pedidas[i].cantidad, 0))}
                  </p>
                ) : (
                  <>
                    <Label htmlFor={`ro-${l.varianteId}`} className="sr-only">
                      Llegó de {l.nombre}
                    </Label>
                    <Input
                      id={`ro-${l.varianteId}`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={llego[l.varianteId] ?? ''}
                      onChange={(e) => setLlego((x) => ({ ...x, [l.varianteId]: e.target.value }))}
                      aria-invalid={(entero(llego[l.varianteId] ?? '') ?? -1) < 0 || (entero(llego[l.varianteId] ?? '') ?? 0) > l.pendiente}
                      className="w-24 text-right tabular-nums"
                    />
                  </>
                )}
                <span className="text-xs text-muted-foreground">de {formatearCantidad(l.pendiente)}</span>
              </div>
              {l.llevaLotes && (
                <EditorDeLotes
                  nombre={l.nombre}
                  exigeVencimiento={l.exigeVencimiento}
                  lotes={lotes[l.varianteId] ?? []}
                  idBase="ro"
                  indice={i}
                  onChange={(nuevos) => setLotes((x) => ({ ...x, [l.varianteId]: nuevos }))}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ro-referencia">Factura o remisión del proveedor (opcional)</Label>
            <Input id="ro-referencia" value={referencia} maxLength={MAX_REFERENCIA_ORDEN} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej: FAC-00231" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ro-nota">Nota (opcional)</Label>
            <Input id="ro-nota" value={nota} maxLength={MAX_NOTA_ORDEN} onChange={(e) => setNota(e.target.value)} placeholder="Ej: llegó la primera mitad" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => enviar({})} disabled={pending || hayError || total === 0}>
            {pending && modo === null && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Recibir lo que llegó
          </Button>
          {!hayLotes && (
            <Button type="button" variant="outline" onClick={() => enviar({ todo: true })} disabled={pending}>
              Recibir todo lo pendiente
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setModo(modo === 'faltante' ? null : 'faltante')} disabled={pending || !puedeCerrar} title={puedeCerrar ? undefined : 'Si no llegó nada, cancela la orden'}>
            Cerrar con faltante
          </Button>
        </div>

        {modo === 'faltante' && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="ro-motivo">Motivo del faltante *</Label>
              <Input id="ro-motivo" value={motivo} maxLength={MAX_MOTIVO_ORDEN} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: el proveedor se quedó sin existencias" />
            </div>
            <p className="text-xs text-muted-foreground">Se reciben las cantidades de arriba y lo que falte se da por no recibido: la orden queda cerrada con este motivo y no se puede reabrir.</p>
            <Button type="button" variant="destructive" onClick={() => enviar({ cerrarConFaltante: true })} disabled={pending || hayError}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Confirmar cierre con faltante
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
