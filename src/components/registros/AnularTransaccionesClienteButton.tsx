'use client'

/**
 * Anulación masiva de las transacciones de un cliente (limpieza de cuentas de
 * PRUEBA / corrección contable). Pide motivo obligatorio; al confirmar, TODAS
 * sus transacciones aplicadas pasan a ANULADAS y dejan de sumar en ganancias,
 * cierres y reportes. Nada se elimina: queda el historial con el motivo.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eraser, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { anularTransaccionesCliente } from '@/modules/transacciones/actions'

export function AnularTransaccionesClienteButton({
  clienteId,
  nombre,
}: {
  clienteId: string
  nombre: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()

  function confirmar() {
    startTransition(async () => {
      const res = await anularTransaccionesCliente(clienteId, motivo)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        res.anuladas === 0
          ? 'Este cliente no tiene transacciones aplicadas.'
          : `${res.anuladas} transacci${res.anuladas === 1 ? 'ón anulada' : 'ones anuladas'}. Los montos ya no suman en los reportes.`
      )
      setOpen(false)
      setMotivo('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-warning/40 text-warning">
          <Eraser className="h-4 w-4" /> Anular todas sus transacciones
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Anular las transacciones de {nombre}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            TODAS las transacciones aplicadas de este cliente (ventas, usos,
            comprobantes) pasarán a <strong>ANULADAS</strong> y dejarán de sumar
            en ganancias, cierres y reportes. No se elimina nada: cada una
            conserva su historial con el motivo. Pensado para limpiar cuentas
            de <strong>prueba</strong>.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`motivo-masivo-${clienteId}`}>Motivo</Label>
            <Textarea
              id={`motivo-masivo-${clienteId}`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Ej. Cuenta de prueba: montos no reales"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <div className="flex flex-col items-end gap-1.5">
            <Button
              variant="destructive"
              onClick={confirmar}
              disabled={pending || motivo.trim().length < 3}
              className="gap-2"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Anular todo
            </Button>
            {/* El botón deshabilitado sin explicación se reportó como «no hace
                nada»: quien no escribía el motivo hacía clic en un botón muerto
                y no pasaba nada, sin error. El porqué tiene que estar escrito. */}
            {motivo.trim().length < 3 && !pending && (
              <span className="text-xs text-muted-foreground">
                Escribe el motivo para habilitar el botón.
              </span>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
