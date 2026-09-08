import Link from 'next/link'
import { QrCode, Star, CircleHelp, ArrowRight, ChevronRight } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { getClienteAllMemberships } from '@/modules/cliente/queries'
import { getFeaturedPromotions, getCompanyStats } from '@/modules/marketplace/cached'
import { QRDisplay } from '@/components/qr/QRDisplay'
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
    const [destacadas, bienvenida] = await Promise.all([
      getFeaturedPromotions(4).catch(() => []),
      user.metadata.clienteId && user.metadata.companyId
        ? conEmpresa(user.metadata.companyId, (tx) =>
            tx.company.findUnique({
              where: { id: user.metadata.companyId! },
              select: {
                bienvenidaActiva: true,
                bienvenidaTipo: true,
                bienvenidaValor: true,
              },
            })
          ).catch(() => null)
        : Promise.resolve(null),
    ])
    const stats = await Promise.all(
      destacadas.slice(0, 4).map((p) =>
        getCompanyStats(p.company.slug)
          .then((s) => ({ id: p.id, rating: s?.averageRating ?? null, n: s?.totalRatings ?? 0 }))
          .catch(() => ({ id: p.id, rating: null as number | null, n: 0 }))
      )
    )
    const ratingDe = new Map(stats.map((s) => [s.id, s]))
    const mostrarBienvenida = !!bienvenida?.bienvenidaActiva && memberships.length === 0
    const textoBienvenida =
      bienvenida?.bienvenidaTipo === 'MONTO' && bienvenida.bienvenidaValor != null
        ? `Bono de bienvenida de ${formatMoney(Number(bienvenida.bienvenidaValor))} con tu primera membresía registrada`
        : 'Beneficio de bienvenida con tu primera membresía registrada'

    return (
      <div className="space-y-5 animate-fade-up">
        <section className="flex flex-col items-center px-4 pt-6 text-center">
          <span className="flex h-28 w-28 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <QrCode className="h-14 w-14" aria-hidden />
          </span>
          <h1 className="mt-4 text-[22px] font-bold tracking-tight text-foreground">
            No tienes beneficios activos
          </h1>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Nada aquí todavía. Solo posibilidades para ahorrar y disfrutar cada día.
          </p>
          <Link
            href="/cliente/explorar"
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            Continuar explorando negocios locales <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>

        {mostrarBienvenida && (
          <section className="rounded-xl border border-border bg-card p-4">
            <p className="inline-block rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
              Beneficio exclusivo
            </p>
            <p className="mt-2 text-[15px] font-semibold text-foreground">{textoBienvenida}</p>
            <Link
              href="/cliente/planes"
              className="mt-3 flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98]"
            >
              Ver membresías disponibles
            </Link>
          </section>
        )}

        {destacadas.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between px-1">
              <div>
                <h2 className="text-[18px] font-bold tracking-tight text-foreground">
                  Beneficios y membresías
                </h2>
                <p className="text-[13px] text-muted-foreground">Los más populares cerca de ti</p>
              </div>
              <Link
                href="/cliente/promociones"
                className="shrink-0 text-[13px] font-semibold text-primary hover:underline"
              >
                Ver todo
              </Link>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-3">
              {destacadas.slice(0, 4).map((p) => {
                const r = ratingDe.get(p.id)
                return (
                  <li
                    key={p.id}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    {p.imagenUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imagenUrl}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <span className="flex aspect-square w-full items-center justify-center bg-muted text-2xl font-bold text-muted-foreground">
                        {p.titulo.slice(0, 1)}
                      </span>
                    )}
                    <div className="p-3">
                      <p className="line-clamp-2 min-h-10 text-[14px] font-semibold leading-snug text-foreground">
                        {p.titulo}
                      </p>
                      {r?.rating != null && (
                        <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
                          <Star className="h-3.5 w-3.5 fill-retail-star text-retail-star" aria-hidden />
                          {Number(r.rating).toFixed(1)} ({r.n})
                        </p>
                      )}
                      {p.venta && (
                        <p className="mt-1 text-[15px] font-bold text-foreground">
                          {formatMoney(p.venta.precio)}
                        </p>
                      )}
                      <Link
                        href={`/cliente/promociones/${p.id}`}
                        className="mt-2 flex min-h-10 items-center justify-center rounded-full bg-primary px-3 text-[13px] font-bold text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98]"
                      >
                        Ver beneficio
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section className="flex items-start gap-3 rounded-xl bg-muted/60 p-4">
          <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-foreground">¿Cómo funciona Mi QR?</p>
            <p className="text-[13px] text-muted-foreground">
              Al suscribirte a cualquier negocio afiliado, tu código personal se activará aquí
              al instante para canjear en caja.
            </p>
          </div>
        </section>
      </div>
    )
  }

  const vencimiento = textoVencimiento(usable.fechaVencimiento, usable.estado)
  const usos = usable.plan.esIlimitado
    ? 'Ilimitado'
    : `${usable.lavadosRestantes} de ${usable.plan.lavadosIncluidos ?? '—'} usos`

  return (
    <div className="space-y-4 animate-fade-up">
      <section className="overflow-hidden rounded-xl border border-border bg-card p-5 text-center">
        <p className="text-[13px] font-medium text-muted-foreground">{usable.company.name}</p>
        <h1 className="mt-0.5 text-[18px] font-bold text-foreground">{usable.plan.nombre}</h1>
        <div className="mx-auto mt-4 w-fit rounded-2xl border border-border bg-card p-4">
          <QRDisplay token={usable.qrToken!.token} size={220} />
        </div>
        <p className="mt-3 text-sm font-semibold text-foreground">{usos}</p>
        {vencimiento && <p className="text-[13px] text-muted-foreground">{vencimiento}</p>}
        <Link
          href={`/membresia/${usable.id}`}
          className="mt-4 flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98]"
        >
          Ver detalle y movimientos
        </Link>
      </section>

      {memberships.length > 1 && (
        <section>
          <h2 className="px-1 text-[15px] font-bold text-foreground">Tus pases</h2>
          <ul className="mt-2 space-y-2">
            {memberships.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/cliente/qr?id=${m.id}`}
                  aria-current={m.id === usable.id ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-xl border bg-card p-4 outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                    m.id === usable.id ? 'border-primary' : 'border-border'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {m.company.name} · {m.plan.nombre}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">{m.estado}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
