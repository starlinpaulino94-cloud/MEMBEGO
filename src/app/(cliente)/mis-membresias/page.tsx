import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CreditCard, AlertCircle, WalletCards, Gauge, CalendarClock } from 'lucide-react'
import { differenceInDays } from 'date-fns'
import { getUser } from '@/lib/auth'
import { membresiaEstadoUi } from '@/lib/estados'
import { getClienteAllMemberships } from '@/modules/cliente/queries'
import { esMarcaUnica } from '@/modules/marketplace/marcaUnica'
import { WalletStack, type WalletStackItem } from '@/components/wallet/WalletStack'
import { AnimatedCounter } from '@/components/system/AnimatedCounter'
import { EmptyState } from '@/components/system/EmptyState'
import { PageHeader } from '@/components/ui/page-header'
import { SectionHeader } from '@/components/ui/section-header'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'

export const metadata = {
  title: 'Mis membresías',
  description: 'Tus tarjetas de membresía y sus códigos QR',
}

/** A partir de aquí, una membresía activa se considera "por vencer". */
const DIAS_POR_VENCER = 7

/**
 * Mis membresías = SOLO la wallet. Una idea por pantalla: tus tarjetas, su
 * estado y su QR. Todo lo demás (campañas, beneficios, novedades, prueba
 * social) vive en el Inicio (/cliente/inicio).
 */
export default async function MisMembresias() {
  const user = await getUser()
  if (!user || !user.supabaseId) {
    redirect('/login')
  }

  // Marca única: la wallet vacía invita a los planes del negocio, no a
  // "explorar empresas" (ese lenguaje vuelve cuando haya más de una).
  const marcaUnica = await esMarcaUnica().catch(() => false)

  let memberships: Awaited<ReturnType<typeof getClienteAllMemberships>> = []
  let loadError = false
  try {
    memberships = await getClienteAllMemberships(user.supabaseId, user.metadata.clienteId)
  } catch (error) {
    loadError = true
    console.error(
      '[mis-membresias] Error loading memberships:',
      error instanceof Error ? error.message : String(error)
    )
  }

  const now = new Date()

  const aItem = (m: (typeof memberships)[number]): WalletStackItem => {
    const vencimiento = m.fechaVencimiento ? new Date(m.fechaVencimiento) : null
    const activa = m.estado === 'ACTIVA' && (!vencimiento || vencimiento > now)
    const vencida = m.estado === 'VENCIDA' || (vencimiento !== null && vencimiento <= now)
    let expiryText: string | null = null
    if (vencimiento) {
      const dias = differenceInDays(vencimiento, now)
      expiryText =
        dias > 0
          ? `Vence en ${dias} día${dias !== 1 ? 's' : ''}`
          : dias === 0
            ? 'Vence hoy'
            : `Venció hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`
    }
    return {
      id: m.id,
      card: {
        company: {
          name: m.company.name,
          logoUrl: m.company.logoUrl,
          colorPrimario: m.company.colorPrimario,
        },
        planNombre: m.plan.nombre,
        estadoLabel: membresiaEstadoUi(m.estado).labelCliente,
        tone: activa ? ('active' as const) : vencida ? ('expired' as const) : ('pending' as const),
        expiryText,
        esIlimitado: m.plan.esIlimitado,
        usosRestantes: m.lavadosRestantes,
        usosTotales: m.plan.lavadosIncluidos ?? null,
      },
      qrToken: m.qrToken?.token ?? null,
      isActive: activa,
    }
  }

  /**
   * TRES GRUPOS EXCLUYENTES (§40).
   *
   * "Por vencer" sale de "activas", no se superpone: una tarjeta que apareciera
   * en dos grupos obligaría a mirar dos veces para saber cuántas tienes, y el
   * QR sería el mismo en los dos sitios. Sigue siendo utilizable — por eso va
   * ARRIBA del todo, que es lo que pide una fecha límite.
   */
  const activas = memberships.filter((m) => {
    const v = m.fechaVencimiento ? new Date(m.fechaVencimiento) : null
    return m.estado === 'ACTIVA' && (!v || v > now)
  })
  const porVencer = activas.filter((m) => {
    if (!m.fechaVencimiento) return false
    return differenceInDays(new Date(m.fechaVencimiento), now) <= DIAS_POR_VENCER
  })
  const porVencerIds = new Set(porVencer.map((m) => m.id))
  const vigentes = activas.filter((m) => !porVencerIds.has(m.id))
  const inactivas = memberships.filter((m) => !activas.some((a) => a.id === m.id))

  const usosDisponibles = activas.reduce(
    (s, m) => s + (m.plan.esIlimitado ? 0 : m.lavadosRestantes),
    0
  )
  const tieneIlimitado = activas.some((m) => m.plan.esIlimitado)
  const proximoVencimiento = activas
    .map((m) => (m.fechaVencimiento ? new Date(m.fechaVencimiento) : null))
    .filter((d): d is Date => !!d && d > now)
    .sort((a, b) => a.getTime() - b.getTime())[0]
  const diasProximo = proximoVencimiento ? differenceInDays(proximoVencimiento, now) : null

  return (
    <div>
      <PageHeader
        title="Mis membresías"
        description="Tus tarjetas y sus QR. Toca una para girarla y mostrar tu llave de acceso."
      />

      {loadError ? (
        <EmptyState
          icon={AlertCircle}
          title="No pudimos cargar tus membresías"
          description="Hubo un problema al conectar con el servidor. Intenta de nuevo en unos momentos."
          action={
            <Button asChild variant="outline">
              <Link href="/mis-membresias">Reintentar</Link>
            </Button>
          }
        />
      ) : memberships.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="Tu wallet está lista"
          description={
            marcaUnica
              ? 'Activa tu primera membresía para empezar a disfrutar beneficios con tu QR.'
              : 'Explora las empresas disponibles y activa tu primera membresía para empezar a disfrutar beneficios con tu QR.'
          }
          action={
            <>
              <Button asChild size="lg">
                {marcaUnica ? (
                  <Link href="/cliente/planes">Ver membresías</Link>
                ) : (
                  <Link href="/cliente/explorar">Explorar empresas</Link>
                )}
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/cliente/promociones">Ver ofertas</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="space-y-10">
          {/* Vistazo de la wallet */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={WalletCards}
              accent="success"
              label={`Membresía${activas.length !== 1 ? 's' : ''} activa${activas.length !== 1 ? 's' : ''}`}
              value={<AnimatedCounter value={activas.length} />}
            />
            <StatCard
              icon={Gauge}
              accent="brand"
              label="Usos disponibles"
              value={tieneIlimitado ? 'Ilimitados' : <AnimatedCounter value={usosDisponibles} />}
            />
            <StatCard
              icon={CalendarClock}
              accent={diasProximo !== null && diasProximo <= DIAS_POR_VENCER ? 'warning' : 'brand'}
              label="Próximo vencimiento"
              value={
                diasProximo === null
                  ? '—'
                  : diasProximo === 0
                    ? 'Hoy'
                    : `${diasProximo} día${diasProximo !== 1 ? 's' : ''}`
              }
            />
          </div>

          {porVencer.length > 0 && (
            <section>
              <SectionHeader
                title="Por vencer"
                description={`Se ${porVencer.length === 1 ? 'agota' : 'agotan'} en los próximos ${DIAS_POR_VENCER} días. Renuévala${porVencer.length === 1 ? '' : 's'} para no quedarte sin beneficios.`}
              />
              <WalletStack items={porVencer.map(aItem)} />
            </section>
          )}

          {vigentes.length > 0 && (
            <section>
              {/* Sin cabecera cuando es el único grupo: el título de la página
                  ya lo dice, y repetirlo es ruido. */}
              {(porVencer.length > 0 || inactivas.length > 0) && (
                <SectionHeader title="Activas" />
              )}
              <WalletStack items={vigentes.map(aItem)} />
            </section>
          )}

          {inactivas.length > 0 && (
            <section>
              <SectionHeader
                title="Vencidas"
                description="Ya no dan acceso. Puedes volver a activarlas desde su detalle."
              />
              <WalletStack items={inactivas.map(aItem)} />
            </section>
          )}
        </div>
      )}
    </div>
  )
}
