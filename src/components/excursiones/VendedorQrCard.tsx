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
  nombre,
}: {
  codigo: string
  enlaceUrl: string
  nombre: string
}) {
  const mensaje = `¡Hola! Soy ${nombre}. Regístrate aquí para reservar tus excursiones: ${enlaceUrl}`

  return (
    <section className="rounded-2xl border border-border bg-card p-5 text-center">
      <h2 className="text-h3 text-foreground">Su QR de vendedor</h2>
      <p className="mt-1 text-caption text-muted-foreground">
        Los clientes que escaneen este QR se registran atribuidos a este vendedor.
      </p>
      <div className="mt-4 flex justify-center">
        <QRDisplay token={enlaceUrl} />
      </div>
      <p className="mt-3 font-mono text-sm font-semibold text-foreground">{codigo}</p>
      <p className="break-all text-caption text-muted-foreground">{enlaceUrl}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            navigator.clipboard
              ?.writeText(enlaceUrl)
              .then(() => toast.success('Enlace copiado.'))
              .catch(() => toast.error('No se pudo copiar; selecciónalo a mano.'))
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copiar enlace
        </Button>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Share2 className="h-3.5 w-3.5" /> Compartir por WhatsApp
          </a>
        </Button>
      </div>
    </section>
  )
}
