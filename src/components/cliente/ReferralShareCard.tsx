'use client'

import { useState } from 'react'
import {
  Share2,
  Copy,
  Check,
  QrCode,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
  Facebook,
  Twitter,
} from 'lucide-react'
import { registrarShare } from '@/modules/referidos/shareActions'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface Props {
  url: string
  companyName: string
}

export function ReferralShareCard({ url, companyName }: Props) {
  const { copied, copy } = useCopyToClipboard()
  const [qrOpen, setQrOpen] = useState(false)

  // El texto SIN el enlace se usa en el share nativo (la URL va aparte en
  // `url`; incluirla también en `text` hacía que WhatsApp mostrara el enlace
  // dos veces y sus bots de vista previa lo visitaran doble).
  const mensajeSinUrl = `Únete a ${companyName} en MembeGo y disfruta beneficios exclusivos. Regístrate con mi enlace:`
  const mensaje = `${mensajeSinUrl} ${url}`

  // Tracking fire-and-forget: compartir nunca debe fallar por el registro.
  function track(canal: string) {
    registrarShare(canal).catch(() => {})
  }

  async function copiar() {
    await copy(url, { successMessage: 'Enlace copiado.' })
  }

  async function compartirNativo() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: `Únete a ${companyName}`, text: mensajeSinUrl, url })
        track('native')
      } catch {
        // usuario canceló: no cuenta como share
      }
    } else {
      // Escritorio sin Web Share API: copia como respaldo.
      await copiar()
    }
  }

  const canales = [
    {
      id: 'whatsapp',
      nombre: 'WhatsApp',
      icon: MessageCircle,
      href: `https://wa.me/?text=${encodeURIComponent(mensaje)}`,
    },
    {
      id: 'telegram',
      nombre: 'Telegram',
      icon: Send,
      // Telegram añade la URL por su cuenta: el texto va sin enlace para no duplicarlo.
      href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(mensajeSinUrl)}`,
    },
    {
      id: 'facebook',
      nombre: 'Facebook',
      icon: Facebook,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    },
    {
      id: 'x',
      nombre: 'X',
      icon: Twitter,
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(mensaje)}`,
    },
    {
      id: 'email',
      nombre: 'Email',
      icon: Mail,
      href: `mailto:?subject=${encodeURIComponent(`Únete a ${companyName}`)}&body=${encodeURIComponent(mensaje)}`,
    },
    {
      id: 'sms',
      nombre: 'SMS',
      icon: MessageSquare,
      href: `sms:?body=${encodeURIComponent(mensaje)}`,
    },
  ]

  return (
    <div className="space-y-3">
      {/* Enlace + copiar */}
      <div className="flex gap-2">
        <Input readOnly value={url} className="bg-card font-mono text-sm" />
        <Button type="button" onClick={copiar} variant="outline" className="shrink-0">
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={compartirNativo} className="flex-1 bg-primary hover:bg-primary/90 sm:flex-none">
          <Share2 className="mr-2 h-4 w-4" />
          Compartir
        </Button>

        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" onClick={() => track('qr')}>
              <QrCode className="mr-2 h-4 w-4" />
              Mi código QR
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Tu QR de referido</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-2">
              <QRDisplay token={url} />
              <p className="text-center text-sm text-muted-foreground">
                Cualquiera que lo escanee llegará a tu enlace de referido de {companyName}.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Canales directos (respaldo escritorio / preferencia del usuario) */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {canales.map((c) => (
          <a
            key={c.id}
            href={c.href}
            target={c.id === 'email' || c.id === 'sms' ? undefined : '_blank'}
            rel="noopener noreferrer"
            onClick={() => track(c.id)}
            className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2.5 text-xs text-muted-foreground transition hover:border-primary/30 hover:bg-primary/10"
          >
            <c.icon className="h-4 w-4" />
            {c.nombre}
          </a>
        ))}
      </div>
    </div>
  )
}
