'use client'

/**
 * Acciones por fila del módulo Seguimiento (Fase S2): contactar al cliente
 * (WhatsApp con plantilla / correo), recordatorio in-app y canje INTERNO del
 * QR por el administrador, con confirmación y registro auditable.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, MessageCircle, BellRing, QrCode } from 'lucide-react'
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
import { enviarRecordatorioSeguimiento } from '@/modules/seguimiento/actions'
import { confirmarCanjePromocion } from '@/modules/promociones/canjeActions'

export interface SeguimientoAccionesProps {
  compraId: string
  qrTokenId: string | null
  estado: 'SIN_USAR' | 'USADO' | 'VENCIDO'
  cliente: string
  telefono: string | null
  email: string | null
  promocion: string
  empresa: string
  /** Mensaje de contacto ya renderizado con la plantilla configurada. */
  mensaje: string
}

export function SeguimientoAcciones(props: SeguimientoAccionesProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notas, setNotas] = useState('')
  const [pending, startTransition] = useTransition()
  const [recordando, startRecordar] = useTransition()

  const mensaje = props.mensaje
  // RD usa código de país 1; tolera teléfonos guardados con o sin él.
  const digits = props.telefono?.replace(/\D/g, '') ?? ''
  const waNumero = digits.length === 11 && digits.startsWith('1') ? digits : digits ? `1${digits}` : ''
  const waHref = waNumero ? `https://wa.me/${waNumero}?text=${encodeURIComponent(mensaje)}` : null
  const mailHref = props.email
    ? `mailto:${props.email}?subject=${encodeURIComponent(`Tu ${props.promocion} gratis te espera`)}&body=${encodeURIComponent(mensaje)}`
    : null

  const puedeRecordar = props.estado === 'SIN_USAR'
  const puedeCanjear = props.estado !== 'VENCIDO' && !!props.qrTokenId

  function recordar() {
    startRecordar(async () => {
      const res = await enviarRecordatorioSeguimiento(props.compraId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Recordatorio enviado a ${props.cliente} dentro de la app.`)
      router.refresh()
    })
  }

  function canjearInterno() {
    if (!props.qrTokenId) return
    startTransition(async () => {
      const fd = new FormData()
      fd.set('compraId', props.compraId)
      fd.set('qrTokenId', props.qrTokenId!)
      fd.set('interno', '1')
      if (notas.trim()) fd.set('notas', notas.trim())
      const res = await confirmarCanjePromocion({}, fd)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        res.consumida
          ? `Canje interno registrado. La recompensa de ${props.cliente} quedó consumida.`
          : `Canje interno registrado. Le quedan ${res.restantes} uso${res.restantes === 1 ? '' : 's'}.`
      )
      setOpen(false)
      setNotas('')
      router.refresh()
    })
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {waHref && (
        <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Contactar por WhatsApp">
          <a href={waHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4 text-success" />
          </a>
        </Button>
      )}
      {mailHref && (
        <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Contactar por correo">
          <a href={mailHref}>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </a>
        </Button>
      )}
      {puedeRecordar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Enviar recordatorio dentro de la app"
          onClick={recordar}
          disabled={recordando}
        >
          {recordando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BellRing className="h-4 w-4 text-warning" />
          )}
        </Button>
      )}
      {puedeCanjear && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <QrCode className="h-3.5 w-3.5" /> Canjear
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Canje interno de la recompensa</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Vas a canjear <strong className="text-foreground">{props.promocion}</strong> de{' '}
                <strong className="text-foreground">{props.cliente}</strong> sin escanear su QR.
                Quedará registrado como <strong>canje interno</strong> con tu nombre, la fecha y
                la hora exacta, y el QR del cliente dejará de ser válido para este uso.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor={`canje-notas-${props.compraId}`}>Motivo / notas (opcional)</Label>
                <Textarea
                  id={`canje-notas-${props.compraId}`}
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Ej. El cliente vino sin teléfono; se atendió en mostrador"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={canjearInterno} disabled={pending} className="gap-2">
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar canje interno
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
