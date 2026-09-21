'use client'

import Link from 'next/link'
import Image from 'next/image'
import { QrCode, ShieldCheck, ChevronRight } from 'lucide-react'
import type { WalletStackItem } from '@/components/wallet/WalletStack'

export function VibeMembresiasActivas({ wallet }: { wallet: readonly WalletStackItem[] }) {
  const activas = wallet.filter((w) => w.isActive)
  if (activas.length === 0) return null

  const principal = activas[0]

  return (
    <section className="px-4 mb-4" aria-label="Membresía activa">
      <div className="relative overflow-hidden rounded-2xl border border-vibe-violet/30 bg-gradient-to-br from-card via-card to-vibe-lavanda/40 p-3.5 elevation-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative size-10 shrink-0 overflow-hidden rounded-xl border border-vibe-borde bg-vibe-niebla">
              {principal.card.company.logoUrl ? (
                <Image
                  src={principal.card.company.logoUrl}
                  alt={principal.card.company.name}
                  fill
                  className="object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center font-bold text-vibe-violet">
                  {principal.card.company.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-overline text-vibe-violet">
                  <ShieldCheck className="size-3" /> Membresía Activa
                </span>
                {activas.length > 1 ? (
                  <Link
                    href="/mis-membresias"
                    className="rounded-full bg-vibe-chip px-1.5 py-0.2 text-label-sm font-bold text-muted-foreground hover:text-foreground"
                  >
                    +{activas.length - 1} más
                  </Link>
                ) : null}
              </div>
              <h4 className="truncate text-label-md font-bold text-foreground">
                {principal.card.company.name} · {principal.card.planNombre}
              </h4>
              <p className="text-small text-muted-foreground">
                {principal.card.esIlimitado
                  ? 'Uso ilimitado'
                  : principal.card.usosRestantes != null
                    ? `${principal.card.usosRestantes} ${
                        principal.card.usosRestantes === 1 ? 'uso disponible' : 'usos disponibles'
                      }`
                    : principal.card.expiryText ?? 'Vigente'}
              </p>
            </div>
          </div>

          <Link
            href="/cliente/qr"
            className="shrink-0 flex items-center gap-1.5 rounded-full grad-vibe px-3 py-2 text-label-sm font-bold text-white shadow-sm hover:opacity-95 transition-opacity active:scale-[0.98]"
          >
            <QrCode className="size-4" />
            <span>Ver QR</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
