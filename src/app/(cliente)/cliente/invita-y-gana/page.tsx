import Image from 'next/image'
import { Gift, Users, Clock, Trophy, Send, Ticket, CheckCircle2 } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { absoluteUrl } from '@/lib/site'
import { ensureCodigoCorto } from '@/lib/referidos'
import {
  getCampanaActiva,
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
export default async function InvitaYGanaPage() {
  const user = await requireRole(['CLIENTE'])
  const clienteId = user.metadata.clienteId
  // Una cuenta de Membego que todavía no es cliente de ningún negocio. No
  // es un error ni una falta de permiso: es el primer día. Ver
  // `SinEmpresaTodavia`.
  if (!clienteId) {
    return <SinEmpresaTodavia que="campañas para invitar"
      detalle="Las campañas de «Invita y gana» las publica cada negocio. Únete a uno para participar." />
  }
  const companyId = user.metadata.companyId as string

  const campana = await getCampanaActiva(companyId)

  if (!campana) {
    const t = normalizeInvitaContenido(null)
    return (
      <div className="mx-auto max-w-2xl py-8">
        <EmptyState icon={Gift} title={t.sinCampanaTitulo} description={t.sinCampanaTexto} />
      </div>
    )
  }

  // Textos editables del módulo (superadmin/admin). Ausente = valores por defecto.
  const t = normalizeInvitaContenido(campana.contenido)

  const [codigoCorto, invitados, stats] = await Promise.all([
    ensureCodigoCorto(clienteId),
    getInvitadosPorCliente(clienteId),
    getInvitaYGanaStats(clienteId, companyId),
  ])

  // Enlace corto personal: membego.com/invitar/CODIGO?v=… El mensaje, la
  // imagen (OG) y el enlace los genera el sistema; el cliente no los modifica.
  // `v` cambia cuando el admin edita la campaña: WhatsApp/Facebook cachean la
  // vista previa por URL exacta durante días, y sin esto seguirían mostrando
  // la tarjeta vieja tras actualizar la imagen o los textos.
  const version = campana.updatedAt.getTime().toString(36)
  const inviteUrl = absoluteUrl(`/invitar/${codigoCorto}?v=${version}`)

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

      {/* Campaña activa: protagonismo del arte + mínimo texto + animación. */}
      <Card className="animate-slide-up overflow-hidden border-emerald-200 shadow-premium">
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
            <span className="animate-float flex h-[72px] w-[72px] items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-glow ring-4 ring-card">
              <Gift className="h-9 w-9 text-white" />
            </span>
          </div>

          <div className="animate-fade-up space-y-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              {campana.titulo}
            </h1>
            <p className="text-sm font-medium text-emerald-700">{t.subtitulo}</p>
          </div>

          {/* Beneficio: un solo mensaje claro, sin límites ni condiciones. */}
          <div className="animate-fade-up delay-100 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-emerald-200/80 bg-white p-4 text-left shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <Gift className="h-5.5 w-5.5 text-emerald-600" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
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
                <s.icon className="h-5 w-5 text-emerald-600" />
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
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
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
