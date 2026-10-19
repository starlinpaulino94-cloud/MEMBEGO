'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { aplicarConteo, cancelarConteo } from '@/modules/inventory/actions'
import { MAX_MOTIVO_CANCELACION } from '@/modules/inventory/conteos'
import { formatearCantidad } from '@/modules/inventory/formato'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Rechazada {
  varianteId: string
  /** INV-5b3: el lote de la línea rechazada (null en un producto sin lotes); el nombre ya lo incluye. */
  loteId: string | null
  nombre: string
  sku: string
  motivo: string
}

/**
 * Cierre de un conteo abierto: APLICAR los ajustes o CANCELAR. Aplicar es todo o
 * nada: si alguna línea dejaría menos de lo apartado, no se aplica ninguna y aquí
 * se listan, con el porqué, para corregirlas (recontar o quitar) y volver a intentar.
 */
export function AplicarConteoForm({ conteoId, numero, productos, ajustes }: { conteoId: string; numero: string; productos: number; ajustes: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmado, setConfirmado] = useState(false)
  const [rechazadas, setRechazadas] = useState<Rechazada[]>([])
  const [motivo, setMotivo] = useState('')
  const [cancelando, setCancelando] = useState(false)

  function aplicar() {
    start(async () => {
      const r = await aplicarConteo({ conteoId })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      if (!r.aplicada) {
        setRechazadas(r.rechazadas)
        toast.error(`No se aplicó nada: ${r.rechazadas.length === 1 ? 'una línea no se puede aplicar' : `${r.rechazadas.length} líneas no se pueden aplicar`}.`)
        return
      }
      setRechazadas([])
      toast.success(`Conteo ${r.numero} aplicado: ${formatearCantidad(r.resumen.ajustadas)} ajuste${r.resumen.ajustadas === 1 ? '' : 's'}.`)
      router.push(`/admin/inventario/conteos/${conteoId}`)
    })
  }

  function cancelar() {
    start(async () => {
      const r = await cancelarConteo({ conteoId, motivo })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Conteo ${r.numero} cancelado. No se movió ninguna existencia.`)
      router.push('/admin/inventario/conteos')
    })
  }

  return (
    <div className="space-y-4">
      {rechazadas.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">No se aplicó nada. Estas líneas no se pueden aplicar tal como están:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm" aria-label="Líneas que no se pueden aplicar">
              {rechazadas.map((x) => (
                <li key={`${x.varianteId}|${x.loteId ?? ''}`}>
                  <strong>{x.nombre}</strong> <span className="text-xs">(SKU {x.sku})</span>: {x.motivo}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">Recuéntalas o quítalas del conteo en la pantalla de captura, y vuelve a revisar.</p>
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Aplicar el conteo {numero}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Se ajustarán las existencias de {formatearCantidad(ajustes)} de los {formatearCantidad(productos)} productos contados, por la diferencia con lo que decía el sistema cuando se contaron. Lo que no se contó no se toca. Una vez
            aplicado, el conteo ya no se puede editar: un error se corrige con otro ajuste.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="mt-1" />
            <span>Revisé las diferencias y quiero ajustar las existencias.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={aplicar} disabled={!confirmado || pending || productos === 0}>
              {pending && !cancelando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Aplicar conteo
            </Button>
            <Button type="button" variant="outline" onClick={() => setCancelando((x) => !x)} disabled={pending}>
              Cancelar este conteo
            </Button>
          </div>
          {cancelando && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="ac-motivo">Motivo (opcional)</Label>
                <Input id="ac-motivo" value={motivo} maxLength={MAX_MOTIVO_CANCELACION} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: se contó la sucursal equivocada" />
              </div>
              <p className="text-xs text-muted-foreground">Cancelar descarta lo contado y no mueve ninguna existencia. Queda guardado quién lo canceló y por qué.</p>
              <Button type="button" variant="destructive" onClick={cancelar} disabled={pending}>
                {pending && cancelando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Sí, cancelar el conteo
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
