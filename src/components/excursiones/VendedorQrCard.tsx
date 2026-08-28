'use client'

/**
 * «Mi QR» del vendedor (§36): el QR grande, el código, el enlace, copiar y
 * compartir por WhatsApp. Es el QR de ADQUISICIÓN — un identificador estable
 * de captación, no una credencial transaccional (§84).
 */

import { Copy, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { Button } from '@/components/ui/button'

export function VendedorQrCard({
  codigo,
  enlaceUrl,
  qrUrl,
  nombre,
}: {
  codigo: string
  enlaceUrl: string
  /** URL marcada como QR; si falta, el QR lleva el enlace tal cual. */
  qrUrl?: string
  nombre: string
}) {
  const mensaje = `¡Hola! Soy ${nombre}. Regístrate aquí para reservar tus excursiones: ${enlaceUrl}`

  return (
    <section aria-labelledby="qr-card-heading" className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 text-center shadow-sm space-y-4">
      <div>
        <h2 id="qr-card-heading" className="text-base sm:text-lg font-bold text-foreground">
          Tu Código QR & Enlace de Venta
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Todos los clientes que escaneen este QR o usen tu enlace quedarán asignados a ti.
        </p>
      </div>

      <div className="flex justify-center py-2">
        <div className="rounded-2xl border border-border/80 bg-background p-4 shadow-sm inline-block">
          <QRDisplay token={qrUrl ?? enlaceUrl} />
        </div>
      </div>

      <div className="space-y-1">
        <span className="inline-block font-mono text-sm font-extrabold text-primary bg-primary/10 px-3 py-1 rounded-lg">
          {codigo}
        </span>
        <p className="break-all text-xs font-mono text-muted-foreground/80 px-2 select-all">
          {enlaceUrl}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2 h-10 text-xs font-bold bg-background shadow-sm hover:bg-muted"
          onClick={() => {
            navigator.clipboard
              ?.writeText(enlaceUrl)
              .then(() => toast.success('¡Enlace de venta copiado al portapapeles!'))
              .catch(() => toast.error('No se pudo copiar; selecciónalo manualmente.'))
          }}
        >
          <Copy className="h-4 w-4" /> Copiar enlace
        </Button>

        <Button asChild className="w-full gap-2 h-10 text-xs font-bold shadow-sm bg-success hover:bg-success text-white">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Share2 className="h-4 w-4" /> Enviar por WhatsApp
          </a>
        </Button>
      </div>
    </section>
  )
}
