import Link from 'next/link'
import Image from 'next/image'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { getClienteAllMemberships, getClientePerfil } from '@/modules/cliente/queries'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { getSeguidasIds } from '@/modules/social/queries'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import {
  Car,
  ChevronRight,
  Gift,
  QrCode,
  Settings,
  Store,
  TicketPercent,
} from 'lucide-react'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi cuenta' }

type TabId = 'todas' | 'favoritas' | 'activas' | 'vencidas'

const TABS: { id: TabId; label: string; href: string }[] = [
  { id: 'todas', label: 'Todas mis cuentas', href: '/cliente/empresas' },
  { id: 'favoritas', label: 'Favoritos', href: '/cliente/perfil?tab=favoritas' },
  { id: 'activas', label: 'Pases activos', href: '/cliente/perfil?tab=activas' },
  { id: 'vencidas', label: 'Vencidas', href: '/cliente/perfil?tab=vencidas' },
]

function fmtFechaCorta(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' }).format(d)
}

/**
 * CX2 · Cuenta = centro de la persona (contrato Stitch S02).
 *
 * Aquí vive lo que la persona USA: membresías, beneficios, empresas
 * frecuentes, la invitación. Lo que la persona CONFIGURA (datos, seguridad,
 * soporte, sesión) se mudó a `/cliente/ajustes`, detrás del engranaje —
 * decisión del usuario (2026-09-09): Cuenta y Configuración son pantallas
 * separadas.
 */
export default async function PerfilPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole('CLIENTE')

  if (!user.metadata.clienteId) {
    return <SinEmpresaTodavia que="ficha en ningún negocio" detalle="Tu cuenta de Membego está lista. Los datos de contacto se completan al unirte a tu primer negocio." />
  }

  const sp = await searchParams
  const tab: TabId =
    sp.tab === 'favoritas' || sp.tab === 'activas' || sp.tab === 'vencidas'
      ? sp.tab
      : 'todas'

  let cliente = null
  let loadError = false
  try {
    cliente = await getClientePerfil(user.metadata.clienteId)
  } catch (e) {
    const { logErrorBd } = await import('@/lib/prisma-errors')
    logErrorBd('cliente-perfil', e, { clienteId: user.metadata.clienteId })
    loadError = true
  }

  if (loadError)
    return <p className="text-muted-foreground">No pudimos cargar tu información. Intenta de nuevo más tarde.</p>
  if (!cliente) return <p className="text-muted-foreground">No se encontró tu información.</p>

  const ahora = new Date()

  const [memberships, compras, seguidas, beneficiosCount] = await Promise.all([
    getClienteAllMemberships(user.supabaseId, cliente.id).catch(() => []),
    (async () => {
      const ids = await misClienteIds(user.supabaseId).catch(() => [] as string[])
      if (ids.length === 0) return []
      return sinEmpresa('cuenta: beneficios activos de la persona', (tx) =>
        tx.productoCompra.findMany({
          where: { clienteId: { in: ids }, estado: 'ACTIVA', usosRestantes: { gt: 0 } },
          select: {
            id: true,
            usosRestantes: true,
            fechaVencimiento: true,
            company: { select: { name: true } },
            promocion: { select: { titulo: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
      ).catch(() => [])
    })(),
    user.metadata.dbUserId
      ? getSeguidasIds(user.metadata.dbUserId).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
    conEmpresa(cliente.companyId, (tx) =>
      tx.productoCompra.count({
        where: { clienteId: cliente.id, estado: 'ACTIVA', usosRestantes: { gt: 0 } },
      })
    ).catch(() => 0),
  ])

  const vigente = (m: { estado: string; fechaVencimiento: Date | null }) =>
    m.estado === 'ACTIVA' && (!m.fechaVencimiento || m.fechaVencimiento > ahora)
  const vencida = (m: { estado: string; fechaVencimiento: Date | null }) =>
    m.estado === 'VENCIDA' || (m.fechaVencimiento !== null && m.fechaVencimiento <= ahora)

  const activas = memberships.filter(vigente)
  const vencidas = memberships.filter(vencida)
  const favoritas = memberships.filter((m) => seguidas.has(m.companyId))
  const visibles =
    tab === 'activas' ? activas : tab === 'vencidas' ? vencidas : tab === 'favoritas' ? favoritas : memberships
  const conteos: Record<TabId, number> = {
    todas: memberships.length,
    favoritas: favoritas.length,
    activas: activas.length,
    vencidas: vencidas.length,
  }

  const empresas = [...new Map(memberships.map((m) => [m.companyId, m.company])).values()]
  const nombre = cliente.nombre.split(' ')[0] || 'ti'
  const iniciales = cliente.nombre.trim().slice(0, 1).toUpperCase()

  const tiles = [
    { label: 'Membresías', href: '/mis-membresias' },
    { label: 'Actividad y citas', href: '/cliente/citas' },
    { label: 'Mis pagos', href: '/cliente/pagos' },
    { label: 'Beneficios', href: '/cliente/mis-promociones' },
  ]

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Saludo: el engranaje lleva a Configuración (pantalla propia) ── */}
      <section className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary-soft text-h3 text-primary"
        >
          {iniciales}
        </span>
        <h1 className="min-w-0 flex-1 truncate text-h2 text-foreground">
          Hola, {nombre}
        </h1>
        <Link
          href="/cliente/ajustes"
          aria-label="Configuración de la cuenta"
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-fast hover:bg-retail-mist hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Settings className="h-5 w-5" aria-hidden />
        </Link>
      </section>

      {/* ── Accesos: teselas suaves, como en el diseño ─────────────────── */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.href + t.label}
            href={t.href}
            className="flex min-h-14 items-center justify-center rounded-lg bg-retail-mist px-3 text-label-lg text-foreground outline-none transition-colors duration-fast hover:bg-brand-primary-soft active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t.label}
          </Link>
        ))}
      </section>

      {/* ── Pestañas con conteos reales ────────────────────────────────── */}
      <div className="relative">
        <nav aria-label="Filtrar membresías" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pr-12">
          {TABS.map((t) => {
            const activo = t.id === 'todas' ? tab === 'todas' : tab === t.id
            const n = t.id === 'todas' ? null : conteos[t.id]
            return (
              <Link
                key={t.id}
                href={t.href}
                aria-current={activo ? 'page' : undefined}
                className={
                  activo
                    ? 'inline-flex min-h-10 shrink-0 items-center rounded-full bg-retail-deep px-4 text-label-lg text-white transition active:scale-[0.97]'
                    : 'inline-flex min-h-10 shrink-0 items-center rounded-full border border-border bg-card px-4 text-label-lg text-muted-foreground transition hover:text-foreground active:scale-[0.97]'
                }
              >
                {t.label}
                {n !== null && <span className="ml-1 tabular-nums">({n})</span>}
              </Link>
            )
          })}
        </nav>
        <span
          data-overflow-affordance="end"
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-end bg-gradient-to-l from-background via-background/90 to-transparent pr-1 text-primary lg:hidden"
        >
          <ChevronRight className="size-4" />
        </span>
      </div>

      {/* ── Tus membresías (tarjeta del contrato: estado, tesela, pase) ── */}
      <section>
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-h2 text-foreground">Tus membresías</h2>
          <Link
            href="/mis-membresias"
            className="shrink-0 text-label-lg text-primary hover:underline"
          >
            Ver todas ({memberships.length})
          </Link>
        </div>
        {visibles.length === 0 ? (
          <EmptyState
            icon={QrCode}
            title={tab === 'todas' ? 'Aún no tienes membresías' : 'Nada aquí con este filtro'}
            description="Al suscribirte a un negocio, tus pases aparecen aquí."
            action={
              <Button asChild>
                <Link href="/cliente/planes">Explorar planes</Link>
              </Button>
            }
          />
        ) : (
          <ul className="mt-3 space-y-3">
            {visibles.map((m) => {
              const ok = vigente(m)
              const EmpresaIcon = m.company.type === 'carwash' ? Car : Store
              return (
                <li key={m.id} className="rounded-lg border border-border bg-card p-4 elevation-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-label-md font-medium text-muted-foreground">
                        <span
                          aria-hidden
                          className={
                            ok ? 'h-2 w-2 rounded-full bg-success' : 'h-2 w-2 rounded-full bg-muted-foreground/50'
                          }
                        />
                        <span className={ok ? 'font-semibold text-success' : undefined}>
                          {ok ? 'ACTIVO' : m.estado}
                        </span>
                        {m.fechaVencimiento && (
                          <span>· Renueva {fmtFechaCorta(m.fechaVencimiento)}</span>
                        )}
                      </p>
                      <p className="mt-1 truncate text-h3 text-foreground">{m.company.name}</p>
                      <p className="text-caption">
                        Plan {m.plan.nombre} ·{' '}
                        {m.plan.esIlimitado
                          ? 'usos ilimitados'
                          : `${m.lavadosRestantes} de ${m.plan.lavadosIncluidos ?? '—'} disponibles`}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-retail-mist text-primary"
                    >
                      <EmpresaIcon className="h-6 w-6" />
                    </span>
                  </div>
                  {/* La fila del pase: el gesto más frecuente, a un toque. */}
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-retail-mist p-2 pl-3">
                    <span className="flex min-w-0 items-center gap-2 text-label-md font-semibold text-foreground">
                      <QrCode className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span className="truncate">Pase digital listo</span>
                    </span>
                    <Link
                      href={`/cliente/qr?id=${m.id}`}
                      className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-retail-deep px-4 text-label-md font-semibold text-white transition hover:opacity-95 active:scale-[0.98]"
                    >
                      Ver QR y uso
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Banner comercial ───────────────────────────────────────────── */}
      <section className="flex items-center justify-between gap-3 rounded-lg bg-retail-deep p-4 text-white">
        <div className="min-w-0">
          <p className="text-body font-bold leading-snug">
            Disfruta visitas y servicios sin límite
          </p>
          <p className="mt-0.5 truncate text-caption text-white/85">
            Ahorra hasta un 40% en tus locales favoritos
          </p>
        </div>
        <Link
          href="/cliente/planes"
          className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-card px-4 text-label-md font-bold text-primary transition active:scale-[0.97]"
        >
          Explorar planes
        </Link>
      </section>

      {/* ── Usar de nuevo: la imagen manda, como en el resto de la app ─── */}
      {empresas.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-h2 text-foreground">Usar de nuevo</h2>
            <Link
              href="/cliente/empresas"
              className="shrink-0 text-label-lg text-primary hover:underline"
            >
              Visitar frecuentes
            </Link>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {empresas.slice(0, 4).map((e) => {
              const esCarwash = e.type === 'carwash'
              return (
                <li key={e.id} className="overflow-hidden rounded-lg border border-border bg-card elevation-1">
                  <div className="relative aspect-16/10 w-full bg-muted">
                    {e.logoUrl ? (
                      <Image
                        src={e.logoUrl}
                        alt=""
                        fill
                        sizes="(min-width: 640px) 20rem, 50vw"
                        className="object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="flex size-full items-center justify-center bg-brand-primary-soft text-h1 text-primary"
                      >
                        {e.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-label-lg text-foreground">{e.name}</p>
                    <Link
                      href={esCarwash ? '/cliente/citas' : `/cliente/empresas/${e.slug}`}
                      className="mt-2 flex min-h-10 items-center justify-center rounded-full border border-primary px-3 text-label-md font-bold text-primary transition-colors duration-fast hover:bg-brand-primary-soft active:scale-[0.98]"
                    >
                      {esCarwash ? 'Pedir turno rápido' : 'Canjear descuento'}
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* ── Tus beneficios y cupones ───────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-h2 text-foreground">
            Tus beneficios y cupones
          </h2>
          <Link
            href="/cliente/mis-promociones"
            className="shrink-0 text-label-lg text-primary hover:underline"
          >
            Ver todos ({beneficiosCount})
          </Link>
        </div>
        {compras.length === 0 ? (
          <p className="mt-2 rounded-lg border border-border bg-card p-4 text-small text-muted-foreground">
            Sin beneficios activos por ahora.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {compras.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/cliente/mis-promociones/${c.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 elevation-1 outline-none transition-colors duration-fast hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
                    <TicketPercent className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-semibold text-foreground">
                      {c.promocion?.titulo ?? 'Beneficio'}
                    </span>
                    <span className="block truncate text-label-md text-muted-foreground">
                      {c.company.name}
                      {c.fechaVencimiento ? ` · Vence ${fmtFechaCorta(c.fechaVencimiento)}` : ' · Disponible'}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Invita y gana: la banda suave del diseño ───────────────────── */}
      <Link
        href="/cliente/invita-y-gana"
        className="flex items-center gap-3 rounded-lg bg-brand-primary-soft p-4 outline-none transition-colors duration-fast hover:bg-retail-mist focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card text-primary">
          <Gift className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-small font-bold text-retail-deep">
            Invita amigos y gana
          </span>
          <span className="block truncate text-label-md text-retail-deep/75">
            Recompensas por cada invitado que se une
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-retail-deep/60" aria-hidden />
      </Link>
    </div>
  )
}
