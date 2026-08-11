import Image from 'next/image'
import { Clock, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UsageMeter } from './UsageMeter'

export type WalletCardTone = 'active' | 'pending' | 'expired'

export interface WalletCardData {
  company: {
    name: string
    logoUrl: string | null
    /** Hex de marca del negocio (Company.colorPrimario). */
    colorPrimario?: string | null
  }
  planNombre: string
  estadoLabel: string
  tone: WalletCardTone
  /** Texto de vigencia ya resuelto (ej. "Vence en 26 días"). */
  expiryText?: string | null
  esIlimitado: boolean
  usosRestantes: number
  usosTotales: number | null
}

/** ¿Es un hex de color utilizable como fondo de tarjeta? */
function esHex(c?: string | null): c is string {
  return !!c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())
}

const TONE_BG: Record<WalletCardTone, string> = {
  active: 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900',
  pending: 'bg-gradient-to-br from-slate-600 to-slate-700',
  expired: 'bg-gradient-to-br from-slate-500 to-slate-600',
}

const TONE_CHIP: Record<WalletCardTone, string> = {
  active: 'bg-white/15 text-white ring-1 ring-white/25',
  pending: 'bg-amber-500/25 text-amber-100 ring-1 ring-amber-300/30',
  expired: 'bg-red-500/25 text-red-100 ring-1 ring-red-300/30',
}

/**
 * Tarjeta de membresía "física digital" (estilo Apple Wallet): hereda el color
 * de marca del negocio, logo en la esquina, nombre del plan en tipografía
 * monoespaciada y medidor de consumo en la base. Sin hooks: se usa igual desde
 * server components (detalle) y client components (WalletStack).
 */
export function WalletCard({ data, className }: { data: WalletCardData; className?: string }) {
  const { company, planNombre, estadoLabel, tone, expiryText } = data
  const brand = tone === 'active' && esHex(company.colorPrimario)
    ? company.colorPrimario.trim()
    : null

  // Gradiente de marca: el hex del negocio mezclado con navy para asegurar
  // contraste del texto blanco (color-mix), con el color puro solo al final.
  const brandStyle = brand
    ? {
        backgroundColor: brand,
        backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${brand} 45%, #0b1220) 0%, color-mix(in srgb, ${brand} 72%, #0b1220) 55%, ${brand} 100%)`,
      }
    : undefined

  return (
    <div
      className={cn(
        'relative flex aspect-[1.586/1] min-h-[196px] w-full flex-col justify-between overflow-hidden rounded-[1.4rem] p-5 text-white shadow-premium ring-1 ring-white/10 sm:p-6',
        !brand && TONE_BG[tone],
        className
      )}
      style={brandStyle}
    >
      {/* Textura sutil de tarjeta física */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '22px 22px',
        }}
      />
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-white/10 blur-3xl" />

      {/* Cabecera: empresa + logo en la esquina */}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight">
            {company.name}
          </p>
          {/* 12px es el suelo del sistema y esta tarjeta se mira de reojo, con
              el móvil en una mano, para saber cuántos usos quedan. El contraste
              ya cumplía AA (6,23:1 medido sobre el degradado); lo que fallaba
              era el tamaño. */}
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-white/70">
            <Shield className="h-3 w-3" aria-hidden />
            Membresía digital
          </p>
        </div>
        {company.logoUrl ? (
          <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/20 bg-white shadow-lg">
            <Image src={company.logoUrl} alt="" fill sizes="40px" className="object-cover" />
          </span>
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-xs font-bold backdrop-blur">
            {company.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      {/* Plan en tipografía monoespaciada premium */}
      <div className="relative">
        <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-white/60">
          Plan
        </p>
        <p className="mt-0.5 truncate font-mono text-xl font-bold uppercase tracking-widest sm:text-2xl">
          {planNombre}
        </p>
      </div>

      {/* Base: medidor de consumo protagonista + vigencia + estado */}
      <div className="relative space-y-2">
        <UsageMeter
          esIlimitado={data.esIlimitado}
          restantes={data.usosRestantes}
          total={data.usosTotales}
          tone="dark"
        />
        <div className="flex items-center justify-between gap-2">
          {expiryText ? (
            <p className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-white/75">
              <Clock className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{expiryText}</span>
            </p>
          ) : (
            <span />
          )}
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
              TONE_CHIP[tone]
            )}
          >
            {estadoLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
