import Image from 'next/image'
import Link from 'next/link'
import { Gift, Users, Clock, Trophy, Send, Ticket, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { requireRole } from '@/lib/auth/guards'
import { absoluteUrl } from '@/lib/site'
import { ensureCodigoCorto } from '@/lib/referidos'
import {
  misCampanasDisponibles,
  getInvitadosPorCliente,
  getInvitaYGanaStats,
} from '@/modules/invitaciones/queries'
import { InvitaShareButton } from '@/components/invitaciones/InvitaShareButton'
import { MilestoneConfetti } from '@/components/invitaciones/MilestoneConfetti'
import { AnimatedCounter } from '@/components/system/AnimatedCounter'
import { EmptyState } from '@/components/system/EmptyState'
import {
  normalizeInvitaContenido,
  mensajeCompartirConRegalo,
} from '@/lib/invitaContenido'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Invita y Gana',
}

/** "Hoy", "Ayer", "hace 2 días", "hace 3 meses" — para el historial. */
function tiempoRelativo(fecha: Date): string {
  const dias = Math.round((fecha.getTime() - Date.now()) / 86400000)
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
  const texto =
    Math.abs(dias) < 30 ? rtf.format(dias, 'day') : rtf.format(Math.round(dias / 30), 'month')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * 🎁 Invita y Gana — ÚNICO módulo de invitaciones del cliente (unifica el
 * antiguo módulo Referidos). El cliente no ve el concepto técnico de
 * "referidos": solo invita amigos y obtiene beneficios.
 *
 * Contenido: campaña activa (imagen, título, beneficios), botón Compartir
 * ahora, Mi progreso e Historial. Las metas/niveles/gamificación llegan en
 * la fase Growth Engine; el backend ya registra toda la auditoría.
 */
/**
 * INVITAR ES DE UN NEGOCIO CONCRETO, PERO NO NECESARIAMENTE DEL ACTIVO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PASABA
 *
 * La pantalla miraba `metadata.companyId`: la campaña de la empresa ACTIVA y
 * ninguna más. Alguien cliente de tres negocios solo podía invitar al que
 * tuviera abierto; las campañas de los otros dos no existían para él, aunque
 * su ficha allí sí y su código de invitación también.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ NO SE HACE GLOBAL, Y POR QUÉ
 *
 * El premio lo pone UN negocio: la recompensa, el progreso y el historial son
 * suyos. Mezclar las campañas de varias empresas en una sola pantalla
 * juntaría cuentas que no se suman. Lo que se hace es dejar ELEGIR de cuál se
 * invita —`?empresa=<slug>`, en la URL como el resto de la fase— y enseñar
 * arriba los negocios donde tiene una campaña disponible.
 */
export default async function InvitaYGanaPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>
}) {
  const user = await requireRole(['CLIENTE'])
  const { empresa: empresaParam } = await searchParams

  // Una cuenta de Membego que todavía no es cliente de ningún negocio. No
  // es un error ni una falta de permiso: es el primer día. Ver
  // `SinEmpresaTodavia`.
  if (!user.metadata.clienteId) {
    return <SinEmpresaTodavia que="campañas para invitar"
      detalle="Las campañas de «Invita y gana» las publica cada negocio. Únete a uno para participar." />
  }

  // Sus negocios con campaña viva, cada uno con SU ficha: el código de
  // invitación es de la ficha, no de la persona, y la atribución del premio va
  // con él.
  const opciones = await misCampanasDisponibles(user.supabaseId)

  const elegida =
    opciones.find((o) => o.company.slug === empresaParam) ??
    opciones.find((o) => o.company.id === user.metadata.companyId) ??
    opciones[0]

  if (!elegida) {
    const t = normalizeInvitaContenido(null)
    return (
      <div className="mx-auto max-w-2xl py-8">
        <EmptyState icon={Gift} title={t.sinCampanaTitulo} description={t.sinCampanaTexto} />
      </div>
    )
  }

  const { campana, clienteId, company } = elegida
  const companyId = company.id

  // Textos editables del módulo (superadmin/admin). Ausente = valores por defecto.
  const t = normalizeInvitaContenido(campana.contenido)

  const [codigoCorto, invitados, stats] = await Promise.all([
    ensureCodigoCorto(clienteId),
    getInvitadosPorCliente(clienteId),
    getInvitaYGanaStats(clienteId, companyId),
  ])

  /**
   * Enlace corto personal: membego.com/invitar/CODIGO?c=…&v=…
   *
   * `c` es LA CAMPAÑA que este enlace promete. Sin ella, el enlace servía «la
   * que esté activa cuando lo abran»: el negocio cambiaba de campaña y todos
   * los enlaces ya repartidos cambiaban con él — la tarjeta que la gente vio
   * en WhatsApp ofrecía una cosa y la landing, otra.
   *
   * `v` cambia cuando el admin edita la campaña: WhatsApp/Facebook cachean la
   * vista previa por URL exacta durante días, y sin esto seguirían mostrando
   * la tarjeta vieja tras actualizar la imagen o los textos.
   */
  const version = campana.updatedAt.getTime().toString(36)
  const inviteUrl = absoluteUrl(
    `/invitar/${codigoCorto}?c=${encodeURIComponent(campana.slug)}&v=${version}`
  )

  const beneficioInvitado = campana.beneficioInvitado as { descripcion?: string } | null
  const regalo = beneficioInvitado?.descripcion || 'un regalo de bienvenida'
  // El admin puede escribir un párrafo como descripción; para el mensaje de
  // WhatsApp y los chips basta la primera frase (recortada).
  const regaloCorto = regalo.split(/[.!\n]/)[0].trim().slice(0, 80) || 'un regalo de bienvenida'

  const mensajeCompartir = mensajeCompartirConRegalo(t.mensajeCompartir, regaloCorto)

  const statCards = [
    { label: t.statInvitaciones, valor: stats.invitacionesEnviadas, icon: Send },
    { label: t.statRegistradas, valor: stats.personasRegistradas, icon: Users },
    { label: t.statRecompensas, valor: stats.recompensasObtenidas, icon: Trophy },
    { label: t.statBeneficios, valor: stats.beneficiosActivos, icon: Ticket },
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Confeti al desbloquear una recompensa nueva desde la última visita */}
      <MilestoneConfetti recompensas={stats.recompensasObtenidas} />

      {/* De qué negocio se invita. Solo aparece si hay más de uno: con uno
          solo, un selector de una opción es ruido. El premio, el progreso y el
          historial son de ESE negocio, así que la elección cambia la pantalla
          entera — y por eso va en la URL y no en un estado invisible. */}
      {opciones.length > 1 && (
        <nav aria-label="Negocio" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {opciones.map((o) => {
            const activa = o.company.id === companyId
            return (
              <Link
                key={o.company.id}
                href={`/cliente/invita-y-gana?empresa=${o.company.slug}`}
                aria-current={activa ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-small font-semibold transition-colors',
                  activa
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                {o.company.name}
              </Link>
            )
          })}
        </nav>
      )}

      {/* Campaña activa: protagonismo del arte + mínimo texto + animación. */}
      <Card className="animate-slide-up overflow-hidden border-success shadow-premium">
        {(campana.bannerUrl || campana.imagenUrl) && (
          <div className="relative h-44 w-full sm:h-60">
            <Image
              src={(campana.bannerUrl || campana.imagenUrl)!}
              alt={campana.titulo}
              fill
              className="object-cover"
              sizes="(max-width: 672px) 100vw, 672px"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
          </div>
        )}
        <CardContent className="relative space-y-5 bg-gradient-to-br from-emerald-50 to-white pb-6 pt-0 text-center">
          {/* Regalo flotante que "sale" del banner */}
          <div className="-mt-9 flex justify-center">
            <span className="animate-float flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-glow ring-4 ring-card">
              <Gift className="h-9 w-9 text-white" />
            </span>
          </div>

          <div className="animate-fade-up space-y-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              {campana.titulo}
            </h1>
            <p className="text-sm font-medium text-success">{t.subtitulo}</p>
          </div>

          {/* Beneficio: un solo mensaje claro, sin límites ni condiciones. */}
          <div className="animate-fade-up delay-100 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-success/80 bg-white p-4 text-left shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success">
              <Gift className="h-5.5 w-5.5 text-success" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-success">
                {t.beneficioEtiqueta}
              </p>
              <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                {regaloCorto}
              </p>
            </div>
          </div>

          <p className="animate-fade-up delay-150 text-xs font-medium text-muted-foreground">
            {t.notaSinLimite}
          </p>

          <div className="animate-fade-up delay-200">
            <InvitaShareButton
              campanaId={campana.id}
              url={inviteUrl}
              titulo={campana.titulo}
              descripcion={mensajeCompartir}
              ctaCompartir={t.ctaCompartir}
              ctaCopiar={t.ctaCopiar}
            />
          </div>
        </CardContent>
      </Card>

      {/* Mi progreso */}
      <div className="animate-fade-up delay-300">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
          <Trophy className="h-4.5 w-4.5 text-muted-foreground" />
          {t.progresoTitulo}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statCards.map((s) => (
            <Card key={s.label}>
              <CardContent className="flex flex-col items-center gap-1 py-4 text-center">
                <s.icon className="h-5 w-5 text-success" />
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  <AnimatedCounter value={s.valor} />
                </p>
                <p className="text-xs leading-tight text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Historial */}
      <Card className="animate-fade-up delay-500">
        <CardContent className="py-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold text-foreground">{t.historialTitulo}</span>
            {invitados.length > 0 && (
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {invitados.length}
              </span>
            )}
          </div>

          {invitados.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t.historialVacio}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {invitados.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {(inv.referidoCliente.nombre || '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {inv.referidoCliente.nombre}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tiempoRelativo(inv.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={inv.estado === 'COMPLETADO' ? 'default' : 'secondary'}>
                      {inv.estado === 'COMPLETADO' ? 'Cliente activo' : 'Registrado'}
                    </Badge>
                    {inv.recompensaAplicada && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        Recompensa obtenida
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Vigencia */}
      <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
        <Clock className="h-3.5 w-3.5" />
        Vigente hasta{' '}
        {new Intl.DateTimeFormat('es-DO', {
          dateStyle: 'long',
          timeZone: 'America/Santo_Domingo',
        }).format(campana.fechaFin)}
      </div>
    </div>
  )
}
