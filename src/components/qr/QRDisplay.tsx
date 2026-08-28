'use client'

import { useEffect, useState } from 'react'
import { toQrDataUrl } from '@/lib/qr'

/**
 * QR del sistema: protagonista, con marco de gradiente de marca.
 * El interior se mantiene blanco puro con módulos oscuros para no
 * comprometer la lectura del escáner.
 */
export function QRDisplay({
  token,
  size = 240,
}: {
  token: string
  size?: number
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    toQrDataUrl(token, size)
      .then((url) => {
        if (active) setDataUrl(url)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [token, size])

  return (
    <div className="rounded-[1.75rem] bg-gradient-to-br from-emerald-500 via-teal-400 to-emerald-600 p-[3px] shadow-premium-lg">
      <div
        className="flex items-center justify-center rounded-2xl bg-card p-4"
        style={{ width: size + 32, height: size + 32 }}
      >
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt="Código QR de membresía"
            width={size}
            height={size}
            className="animate-scale-in"
          />
        ) : (
          <div
            className="skeleton-shimmer rounded-xl"
            style={{ width: size, height: size }}
          />
        )}
      </div>
    </div>
  )
}
