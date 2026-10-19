'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, PackagePlus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { cancelarOrdenCompra, pedirOrdenCompra } from '@/modules/inventory/actions'
import { MAX_MOTIVO_ORDEN } from '@/modules/inventory/compras'
import { formatearCantidad } from '@/modules/inventory/formato'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Lo que se hace con una orden que todavía no ha recibido nada:
 *   · BORRADOR → editarla, PEDIRLA al proveedor (desde ahí sus líneas no cambian) o descartarla;
 *   · PEDIDA (sin nada recibido) → cancelarla, y entonces el motivo es obligatorio (el proveedor la esperaba).
 * Una recibida en parte no se cancela: se cierra con faltante en el formulario de recibir.
 */
export function AccionesOrdenCompra({ ordenId, numero, estado, proveedorNombre, unidades, valor }: { ordenId: string; numero: string; estado: 'DRAFT' | 'ORDERED'; proveedorNombre: string; unidades: number; valor: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')

  function pedir() {
    start(async () => {
      const r = await pedirOrdenCompra({ ordenId })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Orden ${r.numero} pedida a ${proveedorNombre}: ${formatearCantidad(r.unidades)} unidades por ${r.valor}.`)
      router.refresh()
    })
  }

  function cancelar() {
    if (estado === 'ORDERED' && motivo.trim() === '') {
      toast.error('Cancelar una orden ya pedida necesita un motivo: el proveedor la estaba esperando.')
      return
    }
    start(async () => {
      const r = await cancelarOrdenCompra({ ordenId, motivo })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(estado === 'DRAFT' ? `Borrador ${r.numero} descartado.` : `Orden ${r.numero} cancelada.`)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{estado === 'DRAFT' ? 'Borrador' : 'Orden pedida'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {estado === 'DRAFT'
            ? `Es un borrador: todavía no se le pidió nada a ${proveedorNombre} y no mueve el inventario. Al pedirla (${formatearCantidad(unidades)} unidades por ${valor}), las líneas dejan de editarse.`
            : `Esperando la mercancía de ${proveedorNombre}. Cuando llegue, regístrala abajo. Si no va a llegar nada, puedes cancelarla.`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {estado === 'DRAFT' && (
            <>
              <Button type="button" onClick={pedir} disabled={pending}>
                {pending && !cancelando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <PackagePlus className="mr-2 h-4 w-4" aria-hidden />}
                Pedir al proveedor
              </Button>
              <Button asChild type="button" variant="outline">
                <Link href={`/admin/inventario/compras/${ordenId}/editar`}>
                  <Pencil className="mr-2 h-4 w-4" aria-hidden />
                  Editar
                </Link>
              </Button>
            </>
          )}
          <Button type="button" variant="outline" onClick={() => setCancelando((c) => !c)} disabled={pending}>
            {estado === 'DRAFT' ? 'Descartar borrador' : 'Cancelar orden'}
          </Button>
        </div>

        {cancelando && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="ac-motivo">{estado === 'DRAFT' ? 'Motivo (opcional)' : 'Motivo *'}</Label>
              <Input id="ac-motivo" value={motivo} maxLength={MAX_MOTIVO_ORDEN} onChange={(e) => setMotivo(e.target.value)} placeholder={estado === 'DRAFT' ? 'Ej: ya no hace falta' : 'Ej: el proveedor se quedó sin existencias'} />
            </div>
            <p className="text-xs text-muted-foreground">{estado === 'DRAFT' ? 'El borrador queda cancelado: no se borra, y su número no se vuelve a usar.' : 'La orden queda cancelada con este motivo y todo lo pedido se cierra como faltante. No entra nada al inventario.'}</p>
            <Button type="button" variant="destructive" onClick={cancelar} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Sí, {estado === 'DRAFT' ? 'descartar' : 'cancelar'} la orden {numero}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
