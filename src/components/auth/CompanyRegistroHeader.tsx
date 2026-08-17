import { Gift, UserCheck } from 'lucide-react'

/**
 * Encabezado con la marca de la empresa en el registro por empresa
 * (Onboarding Fase 4 · O-11) y badge de invitación (O-12). El layout de auth
 * es genérico (MembeGo), así que este bloque aporta el branding del negocio:
 * banner, logo, nombre y color de marca.
 */
export function CompanyRegistroHeader({
  name,
  logoUrl,
  bannerUrl,
  colorPrimario,
  referido,
  vendedor,
}: {
  name: string
  logoUrl: string | null
  bannerUrl: string | null
  colorPrimario: string | null
  referido: boolean
  /** Vendedor cuyo QR o enlace trajo a esta persona (Excursiones). */
  vendedor?: string | null
}) {
  const accent = colorPrimario || '#0ea5e9'

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card">
      {bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bannerUrl} alt="" className="h-24 w-full object-cover" />
      )}
      <div className="flex items-center gap-3 p-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={name}
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white"
            style={{ background: accent }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-caption">Crea tu cuenta en</p>
          <p className="truncate text-h3 text-foreground">{name}</p>
        </div>
      </div>

      {(referido || vendedor) && (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {referido && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white"
              style={{ background: accent }}
            >
              <Gift className="h-3.5 w-3.5" /> Vienes por una invitación
            </span>
          )}
          {vendedor && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground">
              <UserCheck className="h-3.5 w-3.5" /> Te atiende {vendedor}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
