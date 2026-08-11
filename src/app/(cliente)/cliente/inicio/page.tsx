import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Compass, MapPin, WalletCards } from 'lucide-react'
import { differenceInDays } from 'date-fns'
import { getUser } from '@/lib/auth'
import { getClienteAllMemberships, getBeneficioDisponible } from '@/modules/cliente/queries'
import {
  getNovedadesInicio,
  getOnboardingCliente,
  getPromoFeed,
  type PromoFeed,
} from '@/modules/social/queries'
import { getMomentosVivos, type MomentosVivos as MomentosData } from '@/modules/engagement/momentos'
import { getCampanasVivas, type CampanaViva } from '@/modules/engagement/campanas'
import { getPruebaSocial, type PruebaSocial as PruebaSocialData } from '@/modules/engagement/pruebaSocial'
import { getGamificacion, type GamificacionData } from '@/modules/engagement/gamificacion'
import { getEngagementConfig } from '@/modules/engagement/config'
import { normalizeEngagementConfig, type EngagementConfig } from '@/lib/engagementConfig'
import { esMarcaUnica } from '@/modules/marketplace/marcaUnica'
import { getCategoriesPublic } from '@/modules/marketplace/cached'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { PruebaSocial } from '@/components/engagement/PruebaSocial'
import { PopupInteligente } from '@/components/engagement/PopupInteligente'
import { EmptyState } from '@/components/system/EmptyState'
import { CelebracionBienvenida } from '@/components/cliente/CelebracionBienvenida'
import { DescubreMas } from '@/components/cliente/DescubreMas'
import { OnboardingClienteFirstVisit } from '@/components/cliente/OnboardingClienteFirstVisit'
import { BuscadorInicio } from '@/components/cliente/inicio/BuscadorInicio'
import { OfertasParaTi } from '@/components/cliente/inicio/OfertasParaTi'
import { Button } from '@/components/ui/button'
import { SectionHeader } from '@/components/ui/section-header'
import { elegirExperiencias } from '@/modules/experience/engine'
import { ExperienciaHero } from '@/components/engagement/ExperienciaHero'
import { WalletStack, type WalletStackItem } from '@/components/wallet/WalletStack'
import { membresiaEstadoUi } from '@/lib/estados'

export const metadata = {
  title: 'Inicio',
  description: 'Descubre beneficios cerca de ti y consulta tus membresías',
}

const FEED_VACIO: PromoFeed = {
  misEmpresas: [],
  destacadas: [],
  nuevas: [],
  expiranPronto: [],
  recomendadas: [],
  empresasRecomendadas: [],
}

export default async function InicioCliente() {
  const user = await getUser()
  if (!user || !user.supabaseId) {
    redirect('/login')
  }

  // Rendimiento (auditoría Enterprise): TODO el Home se carga en UNA sola ola
  // paralela. Ninguna consulta depende de otra: solo del usuario ya resuelto.
  const cookieStore = await cookies()
  const onboardingSeen = cookieStore.has('membego_onboarding_seen')
  const { clienteId, companyId, dbUserId } = user.metadata

  const [
    beneficio,
    membershipsRes,
    momentos,
    campanas,
    pruebaSocial,
    gamificacion,
    engagement,
    novedades,
    onboarding,
    promoFeed,
    marcaUnica,
    categorias,
    ubicacion,
  ] = await Promise.all([
    // La PERSONA, no la ficha activa: un beneficio reclamado en otro negocio
    // también está listo para usar, y el inicio es donde más se nota que falte.
    getBeneficioDisponible(user.supabaseId),
    getClienteAllMemberships(user.supabaseId, clienteId).catch((error) => {
      console.error(
        '[mis-membresias] Error loading memberships:',
        error instanceof Error ? error.message : String(error)
      )
      return null
    }),
    clienteId && companyId
      ? getMomentosVivos(clienteId, companyId).catch(
          () => ({ nombre: null, momentos: [] }) as MomentosData
        )
      : Promise.resolve({ nombre: null, momentos: [] } as MomentosData),
    companyId ? getCampanasVivas(companyId).catch(() => []) : Promise.resolve([] as CampanaViva[]),
    companyId
      ? getPruebaSocial(companyId).catch(() => null)
      : Promise.resolve(null as PruebaSocialData | null),
    clienteId && companyId
      ? getGamificacion(clienteId, companyId).catch(() => null)
      : Promise.resolve(null as GamificacionData | null),
    companyId
      ? getEngagementConfig(companyId).catch(() => normalizeEngagementConfig(null, null))
      : Promise.resolve<EngagementConfig>(normalizeEngagementConfig(null, null)),
    dbUserId ? getNovedadesInicio(dbUserId) : Promise.resolve([]),
    dbUserId && !onboardingSeen
      ? getOnboardingCliente(dbUserId, user.supabaseId).catch(() => null)
      : Promise.resolve(null),
    // Ofertas del Home: el mismo feed que ya alimenta /cliente/promociones.
    dbUserId ? getPromoFeed(dbUserId).catch(() => FEED_VACIO) : Promise.resolve(FEED_VACIO),
    // Marca única: con un solo negocio publicado no hay marketplace que
    // explorar. Ambas consultas van cacheadas (5 min y 1 h).
    esMarcaUnica().catch(() => true),
    getCategoriesPublic().catch(() => []),
    // Ubicación de la vivienda, para el contexto del saludo.
    dbUserId ? LocationService.primaria(dbUserId).catch(() => null) : Promise.resolve(null),
  ])

  const loadError = membershipsRes === null
  const memberships = membershipsRes ?? []
  const now = new Date()

  // Prueba social: solo si hay masa suficiente (evita "1 miembro" poco creíble).
  const mostrarPruebaSocial =
    !!pruebaSocial &&
    (pruebaSocial.totalMiembros >= 3 || pruebaSocial.recientes.length >= 2)

  // MEE · El motor de experiencias elige el protagonista (beneficios propios,
  // pago pendiente, campaña destacada de la empresa o invitación) — UNA sola
  // escalera de prioridad para el héroe Y el popup, así nunca se duplican.
  const membresiaPendiente = memberships.find((m) =>
    ['PENDIENTE', 'RECHAZADA'].includes(m.estado)
  )
  const experiencias = loadError
    ? []
    : elegirExperiencias({
        momentos: momentos.momentos,
        beneficio,
        pagoPendiente: membresiaPendiente
          ? { membresiaId: membresiaPendiente.id, planNombre: membresiaPendiente.plan.nombre }
          : null,
        campanas: engagement.campanas ? campanas : [],
      })
  const heroExp = experiencias[0] ?? null
  const popupExp = experiencias[1] ?? null

  // Mapeo de membresías para la pila WalletStack (mismo patrón que
  // /mis-membresias, para que ambas pantallas se vean y comporten igual).
  const walletItems: WalletStackItem[] = memberships.map((m) => {
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
  })

  /**
   * ORDEN DEL HOME SEGÚN EL CONTEXTO — la decisión de diseño de esta pantalla.
   *
   * El rediseño pide que el Home priorice el descubrimiento. Pero para quien
   * YA tiene una membresía, la app se abre por una razón concreta: enseñar el
   * QR en el mostrador. Enterrar la wallet bajo tres carriles de ofertas hace
   * más lento justo el gesto más frecuente.
   *
   * Así que el orden depende de lo que esa persona tiene delante:
   *  · Con membresías → wallet primero, ofertas después.
   *  · Sin membresías → ofertas primero: es lo único accionable.
   */
  const tieneMembresias = !loadError && memberships.length > 0
  const hayOfertas =
    promoFeed.misEmpresas.length +
      promoFeed.destacadas.length +
      promoFeed.nuevas.length +
      promoFeed.expiranPronto.length +
      promoFeed.recomendadas.length >
    0

  // El buscador y las categorías solo tienen sentido con marketplace: en marca
  // única `/cliente/explorar` redirige a planes y la búsqueda no llevaría a
  // ninguna respuesta.
  const mostrarDescubrimiento = !marcaUnica
  // `getCategoriesPublic()` ya descarta las categorías sin empresas: aquí solo
  // se recorta a las ocho primeras para que la fila quepa sin desbordarse.
  const chips = categorias.slice(0, 8).map((c) => ({ slug: c.slug, nombre: c.name }))

  /**
   * ¿ESTA PERSONA TODAVÍA NO ES CLIENTE DE NINGÚN NEGOCIO?
   *
   * Desde que un cliente puede existir sin empresa (Fase 1), este es el estado
   * de todo el que acaba de registrarse — y hay que llevarlo a algún sitio DONDE
   * PUEDA HACER ALGO.
   *
   * El botón de «Tu wallet está lista» apuntaba a `/cliente/planes`, que muestra
   * el catálogo de LA EMPRESA ACTIVA. Sin empresa, esa pantalla responde con su
   * propio estado vacío: un callejón sin salida de dos pasos, y lo introdujo la
   * Fase 1 al añadirle la guardia.
   *
   * Las ofertas sí son globales, y reclamar una da de alta a la persona en esa
   * empresa (`asegurarClienteEnEmpresa`). Así que ese es el primer paso que de
   * verdad avanza: de ahí sale su primera ficha, su primer beneficio y su
   * primera membresía posible.
   */
  const sinEmpresa = !companyId
  const destinoPrimerPaso = sinEmpresa
    ? '/cliente/promociones'
    : mostrarDescubrimiento
      ? '/cliente/explorar'
      : '/cliente/planes'

  const zona = ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null
  const nombre = momentos.nombre?.trim().split(' ')[0] ?? null

  const bloqueWallet = loadError ? (
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
      icon={WalletCards}
      title="Tu wallet está lista"
      description={
        sinEmpresa
          ? 'Reclama tu primera recompensa o contrata un plan, y tendrás tu QR aquí para usarlo en el mostrador.'
          : mostrarDescubrimiento
            ? 'Activa tu primera membresía y tendrás tu QR aquí, listo para usar en el mostrador.'
            : 'Activa un plan y tendrás tu QR aquí, listo para usar en el mostrador.'
      }
      action={
        <Button asChild size="lg">
          <Link href={destinoPrimerPaso}>
            {sinEmpresa ? 'Ver ofertas' : mostrarDescubrimiento ? 'Explorar empresas' : 'Ver planes'}
          </Link>
        </Button>
      }
    />
  ) : (
    <section className="space-y-4">
      <SectionHeader
        title="Mis membresías"
        description="Toca una tarjeta para mostrar su QR."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/mis-membresias">Ver todas</Link>
          </Button>
        }
      />
      <WalletStack items={walletItems} />
    </section>
  )

  const bloqueOfertas = hayOfertas ? <OfertasParaTi feed={promoFeed} /> : null

  return (
    <div className="space-y-8">
      {/* Felicitación por encima de la app tras registrarse */}
      <CelebracionBienvenida />

      {/* Popup inteligente: el aviso #2 del motor (el #1 ya es el héroe) */}
      {!loadError && engagement.popups && (
        <PopupInteligente candidato={popupExp} color={engagement.color} />
      )}

      {/* ── Saludo, zona y accesos ─────────────────────────────────────────── */}
      <header className="animate-fade-up">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-h1 text-balance">
              {nombre ? `Hola, ${nombre}` : 'Hola'}
            </h1>
            {zona ? (
              <p className="mt-1 flex items-center gap-1.5 text-small text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="truncate">{zona}</span>
                <Link
                  href="/cliente/perfil"
                  className="shrink-0 text-primary underline-offset-2 hover:underline"
                >
                  Cambiar
                </Link>
              </p>
            ) : (
              <p className="mt-1 text-small text-muted-foreground">
                Tus beneficios y lo que hay cerca de ti.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {gamificacion && (
              <Link
                href="/cliente/ruleta"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-small font-bold text-foreground transition hover:border-primary/40 active:scale-[0.97]"
              >
                <span aria-hidden>🏆</span>
                <span>
                  {gamificacion.puntos.toLocaleString('es-DO')}
                  <span className="sr-only"> puntos</span>
                  <span aria-hidden> pts</span>
                </span>
              </Link>
            )}
            <Button asChild variant="outline">
              <Link href="/cliente/cerca">
                <Compass aria-hidden />
                Cerca de mí
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Buscar y categorías (solo con marketplace) ─────────────────────── */}
      {mostrarDescubrimiento && <BuscadorInicio categorias={chips} />}

      {/* ── La acción principal: la elige el motor de experiencias (MEE) ───── */}
      {heroExp && <ExperienciaHero exp={heroExp} />}

      {/* ── Wallet y ofertas, en el orden que pide el contexto ─────────────── */}
      {tieneMembresias ? (
        <>
          {bloqueWallet}
          {bloqueOfertas}
        </>
      ) : (
        <>
          {bloqueOfertas}
          {bloqueWallet}
        </>
      )}

      {/* ── Prueba social (compacta, solo si hay masa suficiente) ──────────── */}
      {!loadError && engagement.pruebaSocial && mostrarPruebaSocial && pruebaSocial && (
        <PruebaSocial data={pruebaSocial} color={engagement.color} />
      )}

      {/* Onboarding B2C: después de la wallet — una tarjeta real le gana la
          primera mirada a un recordatorio de configuración. */}
      {onboarding && <OnboardingClienteFirstVisit onboarding={onboarding} />}

      {/* ── Descubre más: invita y gana + novedades, al final ──────────────── */}
      {!loadError && (
        <DescubreMas novedades={novedades} mostrarInvitaYGana={heroExp?.tipo !== 'REFERIDOS'} />
      )}
    </div>
  )
}
