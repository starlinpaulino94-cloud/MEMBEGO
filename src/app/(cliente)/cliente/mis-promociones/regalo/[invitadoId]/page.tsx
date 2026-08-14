import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Gift, Ticket, CalendarDays } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { inicioPeriodo, PERIODO_LABEL } from '@/modules/ofertas/periodo'
import { ofertaVigente } from '@/modules/ofertas/queries'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { StatusChip } from '@/components/ui/status-chip'

export const dynamic = 'force-dynamic'

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(d)
}

/**
 * EL REGALO VIP, DENTRO de la app y con su QR — el mismo proceso de canje que
 * cualquier beneficio: el cliente lo presenta, el staff lo escanea y el uso
 * se descuenta del cupo del período.
 *
 * Antes esta tarjeta mandaba a la página PÚBLICA /oferta/[codigo] (sacaba al
 * cliente de su sesión — contra la regla de producto) y el canje era manual
 * del admin. Los regalos entregados antes de este cambio no tienen QR: aquí
 * se les genera al abrir (perezoso), y si estaba sin reclamar, abrirlo lo
 * completa — su dueño ya lo tiene delante.
 */
export default async function RegaloPage({
  params,
}: {
  params: Promise<{ invitadoId: string }>
}) {
  const user = await requireRole('CLIENTE')
  const { invitadoId } = await params

  // El regalo puede ser de cualquiera de sus empresas: la protección es la
  // pertenencia contra misClienteIds, no el aislamiento por empresa.
  const invitado = await sinEmpresa('regalo VIP: lookup por id (pertenencia validada abajo)', (tx) =>
    tx.ofertaInvitado.findUnique({
      where: { id: invitadoId },
      include: {
        oferta: { include: { company: { select: { name: true, zonaHoraria: true } } } },
        qrTokens: { where: { activo: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
  )
  if (!invitado) notFound()

  const misIds = await misClienteIds(user.supabaseId)
  if (!misIds.includes(invitado.clienteId)) notFound()

  const oferta = invitado.oferta
  const vigente = oferta.estado === 'ACTIVA' && ofertaVigente(oferta)

  // Perezoso: reclamo pendiente se completa y el QR se genera si falta
  // (regalos entregados antes de que el QR existiera). Nunca rompe la página.
  let qr = invitado.qrTokens[0] ?? null
  if (vigente) {
    try {
      if (!invitado.reclamadaAt) {
        await conEmpresa(oferta.companyId, (tx) =>
          tx.ofertaInvitado.updateMany({
            where: { id: invitado.id, reclamadaAt: null },
            data: { reclamadaAt: new Date() },
          })
        )
      }
      if (!qr) {
        qr = await conEmpresa(oferta.companyId, (tx) =>
          tx.qrToken.create({
            data: {
              clienteId: invitado.clienteId,
              ofertaInvitadoId: invitado.id,
              token: nuevoTokenQr(),
              expiraAt: vencimientoQr(),
            },
          })
        )
      }
    } catch (e) {
      console.error('[regalo] aprovisionar QR:', e)
    }
  }

  const usados = await conEmpresa(oferta.companyId, (tx) =>
    tx.ofertaUso.count({
      where: {
        invitadoId: invitado.id,
        createdAt: { gte: inicioPeriodo(oferta.periodo, oferta.company.zonaHoraria) },
      },
    })
  ).catch(() => 0)
  const restantes = Math.max(0, oferta.usosPorPeriodo - usados)

  return (
    <div className="mx-auto max-w-lg space-y-5 animate-fade-up">
      <Link
        href="/cliente/mis-promociones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Mis beneficios
      </Link>

      <Card className="overflow-hidden border-primary/20">
        <CardHeader className="bg-primary/5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
            <Gift className="h-3.5 w-3.5" /> Regalo de {oferta.company.name}
          </p>
          <CardTitle className="text-h2">{oferta.titulo}</CardTitle>
          {oferta.descripcion ? (
            <p className="text-sm text-muted-foreground">{oferta.descripcion}</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusChip tone={vigente ? 'success' : 'neutral'}>
              {vigente ? 'Activo' : 'No disponible'}
            </StatusChip>
            <span className="text-muted-foreground">
              {restantes} de {oferta.usosPorPeriodo} usos {PERIODO_LABEL[oferta.periodo]} disponibles
            </span>
          </div>
          {oferta.vigenciaHasta ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" /> Válido hasta el {fmtFecha(oferta.vigenciaHasta)}
            </p>
          ) : null}

          {vigente && qr && restantes > 0 ? (
            <div className="rounded-2xl border border-success/25 bg-success/5 p-4">
              <p className="mb-3 flex items-center justify-center gap-1.5 text-sm font-semibold text-foreground">
                <Ticket className="h-4 w-4 text-success" /> Tu QR para canjear
              </p>
              <QRDisplay token={qr.token} />
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Preséntalo en el local: el personal lo escanea y el uso se descuenta. El QR se
                renueva solo después de cada canje.
              </p>
            </div>
          ) : vigente && restantes === 0 ? (
            <p className="rounded-xl bg-muted p-3 text-center text-sm text-muted-foreground">
              Agotaste los usos de este período. Se renuevan {PERIODO_LABEL[oferta.periodo]}.
            </p>
          ) : !vigente ? (
            <p className="rounded-xl bg-muted p-3 text-center text-sm text-muted-foreground">
              Este regalo ya no está disponible.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
