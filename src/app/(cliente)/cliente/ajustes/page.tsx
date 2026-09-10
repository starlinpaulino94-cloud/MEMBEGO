import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { logout } from '@/modules/auth/actions'
import { getClientePerfil } from '@/modules/cliente/queries'
import { ProfileForm } from '@/components/cliente/ProfileForm'
import { IdMembegoCard } from '@/components/cliente/IdMembegoCard'
import { ensureCodigoCorto } from '@/lib/referidos'
import { ChangePasswordForm } from '@/components/cliente/ChangePasswordForm'
import { UbicacionViviendaForm } from '@/components/cliente/UbicacionViviendaForm'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  Car,
  ChevronRight,
  CreditCard,
  Headset,
  Lock,
  LogOut,
  MapPin,
  ScrollText,
  ShieldCheck,
  User,
} from 'lucide-react'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Configuración' }

/**
 * CONFIGURACIÓN — pantalla propia, separada de Cuenta (decisión del usuario,
 * 2026-09-09).
 *
 * Antes los formularios vivían al fondo de Cuenta, detrás de un ancla
 * `#configuracion`: la pantalla del día a día (membresías, beneficios)
 * cargaba con el peso de la administración de la cuenta. Ahora Cuenta enseña
 * lo que la persona USA y este lugar guarda lo que la persona CONFIGURA:
 * datos, seguridad, ubicación, vehículos, soporte, legal y la sesión. Se
 * llega desde el engranaje de la cabecera de Cuenta.
 */
export default async function AjustesPage() {
  const user = await requireRole('CLIENTE')

  if (!user.metadata.clienteId) {
    return (
      <SinEmpresaTodavia
        que="ficha en ningún negocio"
        detalle="Tu cuenta de Membego está lista. Los datos de contacto se completan al unirte a tu primer negocio."
      />
    )
  }

  let cliente = null
  let loadError = false
  try {
    cliente = await getClientePerfil(user.metadata.clienteId)
  } catch (e) {
    const { logErrorBd } = await import('@/lib/prisma-errors')
    logErrorBd('cliente-ajustes', e, { clienteId: user.metadata.clienteId })
    loadError = true
  }

  if (loadError)
    return <p className="text-muted-foreground">No pudimos cargar tu información. Intenta de nuevo más tarde.</p>
  if (!cliente) return <p className="text-muted-foreground">No se encontró tu información.</p>

  const isCarwash = cliente.company.type === 'carwash'

  const [ubicacion, idMembego] = await Promise.all([
    user.metadata.dbUserId
      ? LocationService.primaria(user.metadata.dbUserId).catch(() => null)
      : Promise.resolve(null),
    ensureCodigoCorto(cliente.id).catch(() => null),
  ])
  const zonaActual = ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <section className="flex items-center gap-2">
        <Link
          href="/cliente/perfil"
          aria-label="Volver a Cuenta"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-fast hover:bg-retail-mist hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-h2 text-foreground">Configuración</h1>
          <p className="text-small text-muted-foreground">Tus datos, seguridad y soporte.</p>
        </div>
      </section>

      {/* ── Soporte y cuenta rápida (filas del contrato Stitch) ────────── */}
      <ul className="space-y-2">
        {[
          { href: '/cliente/ayuda', icon: Headset, label: 'Servicio al cliente y soporte 24/7' },
          { href: '/cliente/pagos', icon: CreditCard, label: 'Métodos de pago y facturas' },
          { href: '/privacy', icon: ScrollText, label: 'Términos legales y privacidad' },
        ].map((r) => (
          <li key={r.href + r.label}>
            <Link
              href={r.href}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 elevation-1 outline-none transition-colors duration-fast hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
                <r.icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-h4 text-foreground">{r.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      {/* ── Identidad para regalos y transferencias ────────────────────── */}
      {idMembego && <IdMembegoCard codigo={idMembego} />}

      {/* ── Formularios (lógica intacta, movidos desde Cuenta) ─────────── */}
      <Card className="border-border/60 shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <User className="h-4 w-4 text-muted-foreground" />
            Perfil
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

      {/* ── Sesión (al fondo, en rojo, como en el diseño) ──────────────── */}
      <form
        action={logout}
        className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 elevation-1"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <LogOut className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-h4 text-destructive">Cerrar sesión</span>
        <button
          type="submit"
          aria-label="Cerrar sesión"
          className="rounded-lg p-1 text-muted-foreground outline-none transition-colors duration-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  )
}
