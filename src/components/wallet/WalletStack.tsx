'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { ChevronRight, QrCode, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WalletCard, type WalletCardData } from './WalletCard'

export interface WalletStackItem {
  id: string
  card: WalletCardData
  /** Token del QR activo (null = sin QR: la tarjeta enlaza al detalle). */
  qrToken: string | null
  isActive: boolean
}

/**
 * Pila de tarjetas estilo Apple Wallet:
 * - La tarjeta seleccionada se ve completa; las demás asoman como franjas
 *   apiladas arriba (tocar una franja la trae al frente).
 * - Tocar la tarjeta del frente la GIRA en 3D para revelar su código QR
 *   (si está activa); un toque más la devuelve. "Detalles" lleva a la página
 *   completa de la membresía.
 */
export function WalletStack({ items }: { items: WalletStackItem[] }) {
  const [frontId, setFrontId] = useState(items[0]?.id ?? '')
  const [flipped, setFlipped] = useState(false)

  const front = items.find((i) => i.id === frontId) ?? items[0]
  if (!front) return null
  const resto = items.filter((i) => i.id !== front.id)

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Franjas de las tarjetas en segundo plano */}
      {resto.length > 0 && (
        <div className="space-y-[-3.25rem]">
          {resto.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setFrontId(item.id)
                setFlipped(false)
              }}
              aria-label={`Mostrar tarjeta de ${item.card.company.name}`}
              className="relative block h-[4.5rem] w-full overflow-hidden rounded-[1.4rem] text-left shadow-card transition-transform duration-slow hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-ring"
              style={{ zIndex: idx + 1 }}
            >
              <WalletCard data={item.card} className="pointer-events-none" />
            </button>
          ))}
        </div>
      )}

      {/* Tarjeta del frente (con giro 3D hacia el QR) */}
      <div className={cn('relative', resto.length > 0 && 'mt-4')} style={{ zIndex: resto.length + 1 }}>
        <FlippableCard item={front} flipped={flipped} onToggle={() => setFlipped((f) => !f)} />
      </div>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        {front.qrToken && front.isActive
          ? 'Toca la tarjeta para ver su código QR'
          : 'Toca la tarjeta para ver los detalles'}
      </p>
    </div>
  )
}

function FlippableCard({
  item,
  flipped,
  onToggle,
}: {
  item: WalletStackItem
  flipped: boolean
  onToggle: () => void
}) {
  const canFlip = !!item.qrToken && item.isActive
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  // El QR se genera la primera vez que la tarjeta se gira.
  useEffect(() => {
    if (!flipped || !item.qrToken || qrUrl) return
    let active = true
    QRCode.toDataURL(item.qrToken, {
      width: 480,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (active) setQrUrl(url)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [flipped, item.qrToken, qrUrl])

  if (!canFlip) {
    return (
      <Link
        href={`/membresia/${item.id}`}
        aria-label={`Ver detalles de la membresía de ${item.card.company.name}`}
        className="block transition-transform duration-slow hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <WalletCard data={item.card} />
      </Link>
    )
  }

  return (
    <div className="[perspective:1400px]">
      <div
        className={cn(
          'relative aspect-[1.586/1] min-h-[196px] w-full transition-transform duration-hero [transform-style:preserve-3d]',
          flipped && '[transform:rotateY(180deg)]'
        )}
      >
        {/* Cara frontal: la tarjeta */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Mostrar código QR de ${item.card.company.name}`}
          className="absolute inset-0 rounded-[1.4rem] text-left [backface-visibility:hidden] focus-visible:outline-2 focus-visible:outline-ring"
        >
          <WalletCard data={item.card} className="h-full min-h-0" />
          <span className="pointer-events-none absolute right-4 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur">
            <QrCode className="h-4.5 w-4.5" aria-hidden />
          </span>
        </button>

        {/* Cara trasera: el QR en contenedor blanco impecable */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[1.4rem] border border-border/60 bg-white p-4 shadow-premium [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Volver a la tarjeta"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:bg-muted"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrUrl}
              alt=""
              role="img"
              aria-label="Código QR único de validación de membresía"
              className="h-[62%] w-auto"
            />
          ) : (
            <div className="skeleton-shimmer h-[62%] w-[40%] rounded-xl" />
          )}
          <p className="text-xs font-medium text-muted-foreground">
            {item.card.company.name}
          </p>
          <Link
            href={`/membresia/${item.id}`}
            className="inline-flex min-h-9 items-center gap-1 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            Ver detalles <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  )
}
