import Link from 'next/link'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { logout } from '@/modules/auth/actions'
import {
  getClienteAllMemberships,
  getClientePerfil,
} from '@/modules/cliente/queries'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { getSeguidasIds } from '@/modules/social/queries'
import { ProfileForm } from '@/components/cliente/ProfileForm'
import { IdMembegoCard } from '@/components/cliente/IdMembegoCard'
import { ensureCodigoCorto } from '@/lib/referidos'
import { ChangePasswordForm } from '@/components/cliente/ChangePasswordForm'
import { UbicacionViviendaForm } from '@/components/cliente/UbicacionViviendaForm'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import {
  User,
  ShieldCheck,
  Car,
  MapPin,
  Lock,
  ChevronRight,
  Settings,
  WalletCards,
  CalendarDays,
  Receipt,
  TicketPercent,
  Gift,
  Headset,
  CreditCard,
  ScrollText,
  LogOut,
  QrCode,
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
 * Saludo → accesos → pestañas con conteos reales → membresías → volver a
 * usar → beneficios → invita y gana → configuración y soporte → sesión →
 * Configuración (formularios existentes reutilizados tal cual).
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

  const isCarwash = cliente.company.type === 'carwash'
  const ahora = new Date()

  const [memberships, compras, seguidas, beneficiosCount, ubicacion, idMembego] =
    await Promise.all([
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
      user.metadata.dbUserId
        ? LocationService.primaria(user.metadata.dbUserId).catch(() => null)
        : Promise.resolve(null),
      ensureCodigoCorto(cliente.id).catch(() => null),
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
  const zonaActual = ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null

  const tiles = [
    { label: 'Membresías', icon: WalletCards, href: '/mis-membresias' },
    { label: 'Actividad y citas', icon: CalendarDays, href: '/cliente/citas' },
    { label: 'Mis pagos', icon: Receipt, href: '/cliente/pagos' },
    { label: 'Beneficios', icon: TicketPercent, href: '/cliente/mis-promociones' },
  ]

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Saludo ─────────────────────────────────────────────────────── */}
      <section className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary"
        >
          {iniciales}
        </span>
        <h1 className="min-w-0 flex-1 truncate text-h2 text-foreground">
          Hola, {nombre}
        </h1>
        <Link
          href="#configuracion"
          aria-label="Configuración de la cuenta"
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Settings className="h-5 w-5" aria-hidden />
        </Link>
      </section>

      {/* ── Accesos ────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <Link
            key={t.href + t.label}
            href={t.href}
            className="flex min-h-14 items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none transition hover:border-primary/30 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t.label}
          </Link>
        ))}
      </section>

      {/* ── Pestañas con conteos reales ────────────────────────────────── */}
      <nav aria-label="Filtrar membresías" className="relative no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
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

      {/* ── Tus membresías ─────────────────────────────────────────────── */}
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
              return (
                <li key={m.id} className="rounded-lg border border-border bg-card p-4">
                  <p className="flex items-center gap-2 text-label-md font-medium text-muted-foreground">
                    <span
                      aria-hidden
                      className={
                        ok ? 'h-2 w-2 rounded-full bg-success' : 'h-2 w-2 rounded-full bg-muted-foreground/50'
                      }
                    />
                    {ok ? 'ACTIVO' : m.estado}
                    {m.fechaVencimiento && (
                      <span>· Renueva {fmtFechaCorta(m.fechaVencimiento)}</span>
                    )}
                  </p>
                  <p className="mt-1 text-body font-bold text-foreground">
                    {m.company.name}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    Plan {m.plan.nombre} ·{' '}
                    {m.plan.esIlimitado
                      ? 'usos ilimitados'
                      : `${m.lavadosRestantes} de ${m.plan.lavadosIncluidos ?? '—'} disponibles`}
                  </p>
                  <Link
                    href={`/cliente/qr?id=${m.id}`}
                    className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-full bg-retail-deep px-4 text-label-lg text-white transition hover:opacity-95 active:scale-[0.98]"
                  >
                    <QrCode className="h-4 w-4" aria-hidden /> Ver QR y uso
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Banner comercial ───────────────────────────────────────────── */}
      <section className="rounded-lg bg-retail-deep p-4 text-white">
        <p className="text-body font-bold leading-snug">
          Disfruta visitas y servicios sin límite
        </p>
        <p className="mt-0.5 text-caption text-white">
          Ahorra hasta un 40% en tus locales favoritos
        </p>
        <Link
          href="/cliente/planes"
          className="mt-3 inline-flex min-h-10 items-center rounded-full bg-card px-4 text-caption font-bold text-primary transition active:scale-[0.97]"
        >
          Explorar planes
        </Link>
      </section>

      {/* ── Usar de nuevo ──────────────────────────────────────────────── */}
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
          <ul className="mt-3 grid grid-cols-2 gap-3">
            {empresas.slice(0, 4).map((e) => {
              const esCarwash = e.type === 'carwash'
              return (
                <li key={e.id} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="p-3">
                    <p className="truncate text-label-lg text-foreground">{e.name}</p>
                    <Link
                      href={esCarwash ? '/cliente/citas' : `/cliente/empresas/${e.slug}`}
                      className="mt-2 flex min-h-10 items-center justify-center rounded-full border border-primary px-3 text-caption font-bold text-primary transition hover:bg-primary/5 active:scale-[0.98]"
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
          <p className="mt-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Sin beneficios activos por ahora.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {compras.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/cliente/mis-promociones/${c.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 outline-none transition hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <TicketPercent className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
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

      {/* ── Invita y gana ──────────────────────────────────────────────── */}
      <Link
        href="/cliente/invita-y-gana"
        className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 outline-none transition hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Gift className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            Invita amigos y gana
          </span>
          <span className="block truncate text-label-md text-muted-foreground">
            Recompensas por cada invitado que se une
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      </Link>

      {/* ── Configuración y soporte ────────────────────────────────────── */}
      <section>
        <h2 className="px-1 text-h2 text-foreground">
          Configuración y soporte
        </h2>
        <ul className="mt-3 space-y-2">
          {[
            { href: '/cliente/ayuda', icon: Headset, label: 'Servicio al cliente y soporte 24/7' },
            { href: '/cliente/pagos', icon: CreditCard, label: 'Métodos de pago y facturas' },
            { href: '/privacy', icon: ScrollText, label: 'Términos legales y privacidad' },
          ].map((r) => (
            <li key={r.href + r.label}>
              <Link
                href={r.href}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 outline-none transition hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground">
                  <r.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-h4 text-foreground">
                  {r.label}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          ))}
          <li>
            <form
              action={logout}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <LogOut className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-h4 text-destructive">
                Cerrar sesión
              </span>
              <button
                type="submit"
                aria-label="Cerrar sesión"
                className="rounded-lg p-1 text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </li>
        </ul>
      </section>

      {/* ── Configuración (formularios existentes, sin cambios de lógica) ── */}
      <section id="configuracion" className="scroll-mt-24 space-y-3">
        <p className="px-1 text-label-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Configuración
        </p>
        {idMembego && <IdMembegoCard codigo={idMembego} />}
        <Card className="border-border/60 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-h4">
              <User className="h-4 w-4 text-muted-foreground" />
              Cuenta
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm
              clienteId={cliente.id}
              nombre={cliente.nombre}
              email={cliente.email}
              telefono={cliente.telefono ?? null}
              avatarUrl={cliente.avatarUrl ?? null}
              fechaNacimiento={
                cliente.fechaNacimiento
                  ? cliente.fechaNacimiento.toISOString().slice(0, 10)
                  : null
              }
              ciudad={cliente.ciudad ?? null}
              genero={cliente.genero ?? null}
              notifPromos={cliente.notifPromos}
              notifRecordatorios={cliente.notifRecordatorios}
            />
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-h4">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Seguridad
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-h4">
              <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
              Mi ubicación
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UbicacionViviendaForm zonaActual={zonaActual} />
          </CardContent>
        </Card>
        {isCarwash && (
          <Card className="border-border/60 shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-h4">
                <Car className="h-4 w-4 text-muted-foreground" aria-hidden />
                Mis vehículos
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-small text-muted-foreground">
                {cliente.vehiculos.length === 0
                  ? 'Todavía no has añadido ninguno.'
                  : cliente.vehiculos
                      .slice(0, 2)
                      .map((v) => `${v.marca} ${v.modelo}`)
                      .join(', ') +
                    (cliente.vehiculos.length > 2
                      ? ` y ${cliente.vehiculos.length - 2} más`
                      : '')}
              </p>
              <Button asChild variant="outline">
                <Link href="/cliente/vehiculos">
                  {cliente.vehiculos.length === 0 ? 'Añadir vehículo' : 'Gestionar'}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
        <Card className="border-border/60 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-h4">
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
              Privacidad
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-small text-muted-foreground">
              Qué datos guardamos y para qué los usamos.
            </p>
            <Button asChild variant="outline">
              <Link href="/privacy">Ver política</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
