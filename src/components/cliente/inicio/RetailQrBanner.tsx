import { QrCode } from 'lucide-react'
import Link from 'next/link'

export function RetailQrBanner() {
  return (
    <section className="bg-background px-4 py-3 md:px-6" aria-label="Canje con código QR">
      <Link
        href="/cliente/qr"
        className="retail-header mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-xl p-4 text-primary-foreground elevation-1"
      >
        <div>
          <p className="text-overline text-primary-foreground/80">Canje inmediato</p>
          <h2 className="mt-0.5 text-h3">¿Vas a un comercio asociado hoy?</h2>
          <p className="mt-1 max-w-2xl text-caption text-primary-foreground/90">
            Muestra tu código QR en caja para aplicar tus beneficios.
          </p>
        </div>
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-card text-primary elevation-1">
          <QrCode className="size-7" aria-hidden />
        </span>
      </Link>
    </section>
  )
}
