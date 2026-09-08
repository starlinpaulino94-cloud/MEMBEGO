import { QrCode } from 'lucide-react'
import Link from 'next/link'

/**
 * CONTRASTE: por qué este banner no lleva el degradado de la cabecera.
 *
 * `retail-header` va de #0284c7 a #06b6d4. Con texto blanco encima eso da
 * entre 4.10:1 y 2.45:1 — por debajo del 4.5:1 que WCAG AA pide para texto
 * normal, y en el extremo cian el párrafo era ilegible. Reducir la opacidad
 * del texto (estaba al 80 % y al 90 %) lo empeoraba todavía más.
 *
 * El azul profundo sólido da 5.93:1 con blanco al 100 %, y mantiene el mismo
 * lenguaje de color. El degradado se queda en la cabecera de la carcasa, donde
 * no lleva texto encima: los controles van sobre fondo claro propio.
 */
export function RetailQrBanner() {
  return (
    <section className="bg-background px-4 py-3 md:px-6" aria-label="Canje con código QR">
      <Link
        href="/cliente/qr"
        className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-xl bg-retail-deep p-4 text-white elevation-1 outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <div className="min-w-0">
          <p className="text-overline text-white">Canje inmediato</p>
          <h2 className="mt-0.5 text-h3 text-white">¿Vas a un comercio asociado hoy?</h2>
          <p className="mt-1 max-w-2xl text-caption text-white">
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
