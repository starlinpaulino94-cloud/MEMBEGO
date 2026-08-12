import Link from 'next/link'
import { conEmpresa } from '@/lib/tenant'
import {
  MessageCircle,
  Mail,
  HelpCircle,
  Clock,
  Ticket as TicketIcon,
  ChevronRight,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getFaqs, listTicketsCliente, getComunicacionConfig } from '@/modules/soporte/queries'
import { getOnboardingCliente } from '@/modules/social/queries'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import {
  renderPlantilla,
  buildWaLink,
  horarioLegible,
  estadoLabel,
  estadoBadgeClass,
  SOPORTE_PLATAFORMA,
} from '@/lib/soporte'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'
import { OnboardingClienteCard } from '@/components/cliente/OnboardingClienteCard'
import { ReportarProblemaForm } from '@/components/cliente/ReportarProblemaForm'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'

export default async function AyudaPage() {
  const user = await requireRole('CLIENTE')
  const companyId = user.metadata.companyId
  const clienteId = user.metadata.clienteId
  // Una cuenta de Membego que todavía no es cliente de ningún negocio. No
  // es un error ni una falta de permiso: es el primer día. Ver
  // `SinEmpresaTodavia`.
  if (!clienteId) {
    return <SinEmpresaTodavia que="tickets de ayuda"
      detalle="Cuando abras una consulta con un negocio, la verás aquí." />
  }

  const dbUserId = user.metadata.dbUserId
  const supabaseId = user.supabaseId

  let config: Awaited<ReturnType<typeof getComunicacionConfig>> = null
  let cliente: { nombre: string; company: { name: string } } | null = null
  let faqs: Awaited<ReturnType<typeof getFaqs>> = []
  let tickets: Awaited<ReturnType<typeof listTicketsCliente>> = []
  let onboarding: Awaited<ReturnType<typeof getOnboardingCliente>> | null = null

  try {
    const [c, cl, f, t, ob] = await Promise.all([
      companyId ? getComunicacionConfig(companyId).catch(() => null) : null,
      clienteId && companyId
        ? conEmpresa(companyId, (tx) =>
            tx.cliente.findUnique({
              where: { id: clienteId },
              select: { nombre: true, company: { select: { name: true } } },
            })
          ).catch(() => null)
        : null,
      getFaqs(companyId ?? null, { activeOnly: true }).catch(() => []),
      // La PERSONA, no la ficha activa: un hilo abierto con otro negocio
      // desaparecía de la vista y con él la respuesta que estaba esperando.
      misClienteIds(supabaseId)
        .then((ids) => listTicketsCliente(ids))
        .catch(() => []),
      dbUserId && supabaseId
        ? getOnboardingCliente(dbUserId, supabaseId).catch(() => null)
        : null,
    ])
    config = c
    cliente = cl
    faqs = f
    tickets = t
    onboarding = ob
  } catch (e) {
    console.error('[cliente-ayuda]', e)
  }

  const empresaNombre = cliente?.company.name ?? 'la empresa'
  const mensajeWa = config
    ? renderPlantilla(config.mensajePlantilla, {
        cliente: cliente?.nombre,
        empresa: empresaNombre,
      })
    : `Hola, soy ${cliente?.nombre ?? 'cliente de MembeGo'}. Necesito ayuda con mi cuenta de ${empresaNombre}.`
  // Contacto del negocio si lo configuró; si no, el soporte de la plataforma
  // (los botones de ayuda nunca quedan "no disponibles").
  const waLink =
    config?.activo && config.numero
      ? buildWaLink(config.codigoPais, config.numero, mensajeWa)
      : buildWaLink(
          SOPORTE_PLATAFORMA.whatsappCodigoPais,
          SOPORTE_PLATAFORMA.whatsappNumero,
          mensajeWa
        )
  const waNumero =
    config?.activo && config.numero
      ? `+${config.codigoPais.replace(/\D/g, '')} ${config.numero}`
      : SOPORTE_PLATAFORMA.whatsappDisplay
  const horario = horarioLegible(config?.horaInicio, config?.horaCierre, config?.diasLaborales)
  const correoSoporte = config?.correoSoporte || SOPORTE_PLATAFORMA.email
  const mailto = `mailto:${correoSoporte}?subject=${encodeURIComponent('Soporte · ' + empresaNombre)}`

  return (
    <div className="space-y-6 animate-fade-up">
      {/* `PageHeader` como el resto del área de cliente: el `h1` a mano usaba
          `text-2xl` (24px), fuera de la escala, y no llevaba el espaciado del
          sistema. */}
      <PageHeader
        title="Centro de ayuda"
        description={`Contáctanos o encuentra respuestas rápidas · ${empresaNombre}`}
      />

      {/* Primeros pasos (onboarding) */}
      {onboarding && onboarding.completados < onboarding.total && (
        <OnboardingClienteCard onboarding={onboarding} />
      )}

      {/* Contacto rápido */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* El botón de WhatsApp era `bg-success hover:bg-success`: el verde
            semántico de "salió bien" usado como color de una marca ajena, y con
            un hover que repetía el mismo tono, así que no daba respuesta al
            pasar por encima. Es la acción principal de la pantalla, así que va
            en el azul de marca; el icono y la etiqueta ya dicen que es
            WhatsApp. */}
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageCircle className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-foreground">WhatsApp</p>
                <p className="text-caption text-muted-foreground">{waNumero}</p>
              </div>
            </div>
            <Button asChild className="w-full">
              <a href={waLink} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" /> Contactar por WhatsApp
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Mail className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-foreground">Correo</p>
                <p className="text-caption text-muted-foreground">{correoSoporte}</p>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full">
              <a href={mailto}>
                <Mail className="mr-2 h-4 w-4" /> Enviar correo
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      {horario && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-4 py-3 text-small">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Horario de atención:</span>
          <span className="font-medium text-foreground">{horario}</span>
        </div>
      )}

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-4 w-4" /> Preguntas frecuentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {faqs.length === 0 ? (
            <p className="text-small text-muted-foreground">
              Aún no hay preguntas frecuentes publicadas.
            </p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((f) => (
                <AccordionItem key={f.id} value={f.id}>
                  <AccordionTrigger className="text-left">{f.pregunta}</AccordionTrigger>
                  <AccordionContent className="whitespace-pre-wrap text-muted-foreground">
                    {f.respuesta}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Reportar un problema */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reportar un problema</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportarProblemaForm />
        </CardContent>
      </Card>

      {/* Mis tickets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TicketIcon className="h-4 w-4" /> Mis reportes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <EmptyState
              icon={<TicketIcon className="h-6 w-6" />}
              title="Sin reportes"
              description="Cuando envíes un reporte, aparecerá aquí con su estado."
            />
          ) : (
            <div className="space-y-2">
              {tickets.map((t) => {
                // ESPERANDO_CLIENTE significa que el negocio ya contestó y
                // espera respuesta. Al cliente se le enseñaba como una insignia
                // más entre otras cuatro —"Esperando cliente", escrito desde el
                // punto de vista de quien atiende—, así que lo único accionable
                // de la lista pasaba desapercibido y el ticket se quedaba ahí.
                const teToca = t.estado === 'ESPERANDO_CLIENTE'
                return (
                  <Link
                    key={t.id}
                    href={`/cliente/ayuda/${t.id}`}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-4 py-3 transition hover:bg-muted/50',
                      teToca ? 'border-primary/40 bg-primary/5' : 'border-border/60'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{t.asunto}</p>
                      {/* CON QUIÉN. Con hilos de varios negocios en la misma
                          lista, un asunto sin destinatario no dice a quién se
                          le preguntó. */}
                      <p className="truncate text-caption text-muted-foreground">
                        {t.company.name} · {t._count.mensajes} mensaje
                        {t._count.mensajes !== 1 ? 's' : ''}
                      </p>
                    </div>
                    {teToca ? (
                      <Badge className="bg-primary/10 text-primary">Te toca contestar</Badge>
                    ) : (
                      <Badge className={estadoBadgeClass(t.estado)}>{estadoLabel(t.estado)}</Badge>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
