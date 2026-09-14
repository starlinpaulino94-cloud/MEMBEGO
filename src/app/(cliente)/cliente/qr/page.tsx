import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { getClienteAllMemberships } from '@/modules/cliente/queries'
import { getFeaturedPromotions, getCompanyStats } from '@/modules/marketplace/cached'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { QrSinBeneficio, type PromoDestacada } from '@/components/cliente/qr/QrSinBeneficio'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi QR' }

function textoVencimiento(v: Date | null, estado: string): string | null {
  if (!v) return null
  const dias = Math.ceil((v.getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `Venció el ${v.toLocaleDateString('es-DO')}`
  if (estado !== 'ACTIVA') return null
  if (dias === 0) return 'Vence hoy'
  return `Vence en ${dias} día${dias !== 1 ? 's' : ''}`
}

export default async function MiQrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole('CLIENTE')
  const sp = await searchParams
  const memberships = await getClienteAllMemberships(
    user.supabaseId,
    user.metadata.clienteId
  ).catch(() => [])

  const pedida = (sp.id ?? '').trim()
  const activas = memberships.filter((m) => m.estado === 'ACTIVA')
  const elegida =
    memberships.find((m) => m.id === pedida) ??
    activas.find((m) => m.qrToken) ??
    activas[0] ??
    null
  const ahora = new Date()
  const usable =
    elegida &&
    elegida.estado === 'ACTIVA' &&
    elegida.qrToken &&
    (!elegida.fechaVencimiento || elegida.fechaVencimiento > ahora)
      ? elegida
      : null

  if (!usable) {
    const [destacadas, empresa, ubicacion] = await Promise.all([
      getFeaturedPromotions(4).catch(() => []),
      user.metadata.clienteId && user.metadata.companyId
        ? conEmpresa(user.metadata.companyId, (tx) =>
            tx.company.findUnique({
              where: { id: user.metadata.companyId! },
              select: { bienvenidaActiva: true, bienvenidaTipo: true, bienvenidaValor: true },
            })
          ).catch(() => null)
        : Promise.resolve(null),
      user.metadata.dbUserId
        ? LocationService.primaria(user.metadata.dbUserId).catch(() => null)
        : Promise.resolve(null),
    ])

    const primeras = destacadas.slice(0, 4)
    const stats = await Promise.all(
      primeras.map((p) =>
        getCompanyStats(p.company.slug)
          .then((s) => ({ id: p.id, rating: s?.averageRating ?? null, n: s?.totalRatings ?? 0 }))
          .catch(() => ({ id: p.id, rating: null as number | null, n: 0 }))
      )
    )
    const porPromo = new Map(stats.map((s) => [s.id, s]))
    const tarjetas: PromoDestacada[] = primeras.map((promo) => ({
      promo,
      valoracion: porPromo.get(promo.id)?.rating ?? null,
      resenas: porPromo.get(promo.id)?.n ?? 0,
    }))

    // El beneficio de bienvenida solo se anuncia si la empresa lo financia Y
    // esta persona todavía no tiene ninguna membresía: es de primera vez.
    const ofreceBienvenida = !!empresa?.bienvenidaActiva && memberships.length === 0
    const bienvenida = !ofreceBienvenida
      ? null
      : empresa?.bienvenidaTipo === 'MONTO' && empresa.bienvenidaValor != null
        ? `Bono de bienvenida de ${formatMoney(Number(empresa.bienvenidaValor))} con tu primera membresía registrada`
        : 'Beneficio de bienvenida con tu primera membresía registrada'

    return (
      <QrSinBeneficio
        destacadas={tarjetas}
        bienvenida={bienvenida}
        ciudad={ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null}
      />
    )
  }

  const vencimiento = textoVencimiento(usable.fechaVencimiento, usable.estado)
  const usos = usable.plan.esIlimitado
    ? 'Ilimitado'
    : `${usable.lavadosRestantes} de ${usable.plan.lavadosIncluidos ?? '—'} usos`

  return (
    <div className="animate-fade-up space-y-4">
      <section className="overflow-hidden rounded-xl border border-vibe-borde bg-card p-5 text-center elevation-2">
        <p className="text-label-md text-muted-foreground">{usable.company.name}</p>
        <h1 className="mt-0.5 break-words text-h2 text-foreground">{usable.plan.nombre}</h1>
        <div className="mx-auto mt-4 w-fit rounded-lg border border-vibe-borde bg-card p-4">
          <QRDisplay token={usable.qrToken!.token} size={220} />
        </div>
        <p className="mt-3 text-label-lg text-foreground">{usos}</p>
        {vencimiento ? <p className="text-caption text-muted-foreground">{vencimiento}</p> : null}
        <Link
          href={`/membresia/${usable.id}`}
          className="grad-vibe-cta mt-4 flex min-h-11 items-center justify-center rounded-full px-4 text-label-lg font-bold text-white outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.98]"
        >
          Ver detalle y movimientos
        </Link>
      </section>

      {memberships.length > 1 ? (
        <section aria-labelledby="qr-pases">
          <h2 id="qr-pases" className="px-1 text-h4 text-foreground">
            Tus pases
          </h2>
          <ul className="mt-2 space-y-2">
            {memberships.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/cliente/qr?id=${m.id}`}
                  aria-current={m.id === usable.id ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-xl border bg-card p-4 elevation-1 outline-none transition focus-visible:ring-2 focus-visible:ring-vibe-violet',
                    m.id === usable.id ? 'border-vibe-violet' : 'border-vibe-borde'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-label-lg text-foreground">
                      {m.company.name} · {m.plan.nombre}
                    </span>
                    <span className="block text-label-md text-muted-foreground">{m.estado}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
