import { ComprobanteLink } from '@/components/pagos/ComprobanteLink'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Ticket,
  Landmark,
  CheckCircle2,
  Clock,
  XCircle,
  CalendarDays,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { safeInternalPath } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { ComprobanteCompraForm } from '@/components/cliente/ComprobanteCompraForm'
import { CancelarCompraButton } from '@/components/cliente/CancelarCompraButton'
import { SharePromocionMenu } from '@/components/public/SharePromocionMenu'
import { compraEstadoUi, compraEstadoVisual } from '@/components/cliente/compra-estado'
import { Button } from '@/components/ui/button'
import { getAgendaConfig } from '@/modules/citas/queries'
import { getCuentasTransferencia, ofrecerTransferencia } from '@/modules/pagos/metodosDisponibles'

export const dynamic = 'force-dynamic'

const ESPERA_PAGO = ['SOLICITADA', 'PENDIENTE_PAGO', 'RECHAZADA']

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 2 }).format(n)
}

function fmtFechaHora(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

export default async function MiCompraPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ retorno?: string }>
}) {
  const user = await requireRole('CLIENTE')
  const { id } = await params
  const { retorno: retornoParam } = await searchParams
  // Fase 4 · contexto de ubicación: quien adquirió desde el mapa vuelve al
  // detalle de la empresa (sanitizado contra open redirect); el resto a la
  // lista de sus beneficios.
  const retorno = safeInternalPath(retornoParam, '/cliente/mis-promociones')
  const retornoQs = retornoParam ? `&retorno=${encodeURIComponent(retorno)}` : ''

  const compra = await prisma.productoCompra.findUnique({
    where: { id },
    include: {
      promocion: true,
      company: { select: { name: true, zonaHoraria: true } },
      metodoPago: true,
      transiciones: { orderBy: { createdAt: 'asc' } },
      qrTokens: { where: { activo: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      campanaPaso: {
        select: {
          orden: true,
          campanaId: true,
          campana: { select: { nombre: true } },
        },
      },
    },
  })
  if (!compra || compra.clienteId !== user.metadata.clienteId) notFound()

  const ui = compraEstadoVisual(compra.estado, {
    usosRestantes: compra.usosRestantes,
    usosTotales: compra.usosIncluidos,
  })
  const EstadoIcon = ui.icon
  const promo = compra.promocion
  const qr = compra.qrTokens[0] ?? null
  const precio = Number(compra.precioCongelado ?? 0)
  const promoPublica = promo?.visibilidad === 'publica'

  // Cita SUGERIDA, no obligatoria (decisión de producto): agendar ayuda al
  // negocio a organizarse, pero jamás debe impedir que el cliente use lo que
  // ya adquirió. Antes esto era un candado: sin cita no había QR. Ahora el QR
  // se entrega siempre y la cita se OFRECE — el cliente puede omitirla.
  const esGratis = compra.promocionId != null && precio <= 0
  let citaCanje: { inicio: Date; estado: string } | null = null
  let sugiereCita = false
  if (esGratis && compra.estado === 'ACTIVA' && qr) {
    // La capacidad CITA_ANTES_DEL_QR decide si se INVITA a agendar; ya no
    // decide si se entrega el QR. Apagarla oculta la invitación y nada más.
    const { tieneCapacidad } = await import('@/modules/capacidades/resolver')
    const invitar = await tieneCapacidad(compra.companyId, 'CITA_ANTES_DEL_QR')
    const agenda = invitar ? await getAgendaConfig(compra.companyId).catch(() => null) : null
    if (agenda?.activa) {
      try {
        citaCanje = await prisma.cita.findFirst({
          where: { compraId: compra.id, estado: { notIn: ['CANCELADA', 'NO_ASISTIO'] } },
          orderBy: { inicio: 'desc' },
          select: { inicio: true, estado: true },
        })
        sugiereCita = !citaCanje
      } catch (e) {
        // Columna citas.compraId sin migrar: simplemente no se sugiere nada.
        console.error('[mis-promociones] cita del canje:', e)
      }
    }
  }
  // Campaña en cadena: qué beneficio se desbloquea al canjear este.
  const siguienteEnCadena = compra.campanaPaso
    ? await prisma.campanaPaso
        .findFirst({
          where: {
            campanaId: compra.campanaPaso.campanaId,
            orden: { gt: compra.campanaPaso.orden },
          },
          orderBy: { orden: 'asc' },
          select: { titulo: true, company: { select: { name: true } } },
        })
        .catch(() => null)
    : null

  const fmtCita = (d: Date) =>
    new Intl.DateTimeFormat('es-DO', {
      timeZone: compra.company.zonaHoraria,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(d)

  // ── Métodos de pago ────────────────────────────────────────────────────
  // La transferencia se ofrece si la empresa la tiene encendida O si ESTA
  // compra ya se comprometió con ella (eligió cuenta o subió comprobante).
  // Lo segundo es lo que impide que apagar el método deje compras atrapadas:
  // quien ya iba por ese camino puede terminarlo.
  const esperaPago = ESPERA_PAGO.includes(compra.estado)
  const comprometidaConTransferencia = compra.metodoPagoId != null || compra.comprobanteUrl != null
  const transferenciaActiva =
    esperaPago && (await ofrecerTransferencia(compra.companyId, comprometidaConTransferencia))
  const metodosPago = transferenciaActiva ? await getCuentasTransferencia(compra.companyId) : []

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={retorno}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {retornoParam ? 'Volver' : 'Mis promociones'}
      </Link>

      {/* Cabecera */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{promo?.titulo ?? 'Promoción'}</h1>
          <p className="text-muted-foreground">{compra.company.name}</p>
        </div>
        <Badge variant={ui.badge} className="mt-1 shrink-0 gap-1">
          <EstadoIcon className="h-3.5 w-3.5" />
          {ui.label}
        </Badge>
      </div>

      {/* Acciones: compartir la promoción pública */}
      {promo && promoPublica && (
        <div className="flex flex-wrap items-center gap-3">
          <SharePromocionMenu
            promocionId={promo.id}
            slug={promo.slug}
            titulo={promo.titulo}
            companyName={compra.company.name}
            version={promo.updatedAt?.getTime() ?? null}
          />
        </div>
      )}

      {promo?.imagenUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={promo.imagenUrl}
          alt={promo.titulo}
          className="h-44 w-full rounded-2xl object-cover"
        />
      )}

      {/* Resumen de la compra */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm">
          <div>
            <p className="text-[11px] text-muted-foreground">Precio</p>
            <p className="font-semibold text-foreground">{precio > 0 ? fmtRD(precio) : 'Gratis'}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Usos</p>
            <p className="font-semibold text-foreground">
              {compra.estado === 'ACTIVA' || compra.estado === 'CONSUMIDA'
                ? `${compra.usosRestantes} de ${compra.usosIncluidos} restantes`
                : `${compra.usosIncluidos} incluido${compra.usosIncluidos !== 1 ? 's' : ''}`}
            </p>
          </div>
          {compra.fechaActivacion && (
            <div>
              <p className="text-[11px] text-muted-foreground">Activada</p>
              <p className="font-semibold text-foreground">{fmtFechaHora(compra.fechaActivacion)}</p>
            </div>
          )}
          <div>
            <p className="text-[11px] text-muted-foreground">Vence</p>
            <p className="font-semibold text-foreground">
              {compra.fechaVencimiento ? fmtFechaHora(compra.fechaVencimiento) : 'Sin vencimiento'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Campaña en cadena: de dónde vino esto y qué se desbloquea después. */}
      {compra.campanaPaso && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-1.5 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">
              {compra.campanaPaso.campana.nombre} · paso {compra.campanaPaso.orden}
            </p>
            <p className="text-sm text-muted-foreground">
              {siguienteEnCadena
                ? `La primera vez que uses este beneficio se te activa automáticamente «${siguienteEnCadena.titulo}» en ${siguienteEnCadena.company.name}.`
                : 'Este es el último beneficio de la cadena. ¡Disfrútalo!'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Invitación a agendar (opcional): el QR de abajo ya está disponible. */}
      {compra.estado === 'ACTIVA' && qr && sugiereCita && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" /> ¿Quieres agendar tu cita?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            <p className="text-sm text-muted-foreground">
              Tu <strong className="text-foreground">{promo?.titulo ?? 'recompensa'}</strong>{' '}
              ya está lista y su QR está abajo. Si agendas, el local te reserva el turno y
              evitas la espera — pero es <strong className="text-foreground">opcional</strong>:
              puedes ir cuando prefieras.
            </p>
            <Button asChild className="w-full gap-2 font-bold sm:w-auto">
              <Link href={`/cliente/citas?compra=${compra.id}${retornoQs}`}>
                <CalendarDays className="h-4 w-4" /> Agendar mi cita
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* QR activo — se entrega SIEMPRE, con cita o sin ella. */}
      {compra.estado === 'ACTIVA' && qr && (
        <Card className="border-success/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4 text-success" /> Tu QR para canjear
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 pb-6">
            {citaCanje && (
              <p className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <CalendarDays className="h-3.5 w-3.5" /> Tu cita: {fmtCita(citaCanje.inicio)}
              </p>
            )}
            <QRDisplay token={qr.token} />
            <p className="max-w-sm text-center text-xs text-muted-foreground">
              Muestra este código en el local. Es de un solo uso.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Espera pago pero no hay ningún método en línea disponible */}
      {esperaPago && !transferenciaActiva && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4 text-primary" /> Pago pendiente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tu compra de{' '}
              <span className="font-semibold text-foreground">{fmtRD(precio)}</span> está
              reservada. {compra.company.name} está actualizando sus formas de pago; comunícate
              con el negocio para completarla.
            </p>
            <div className="flex justify-center border-t border-border/60 pt-3">
              <CancelarCompraButton compraId={compra.id} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pago pendiente: instrucciones + comprobante */}
      {transferenciaActiva && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4 text-primary" /> Pago por transferencia
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {compra.estado === 'RECHAZADA' && compra.rechazadoReason && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Tu comprobante fue rechazado: {compra.rechazadoReason}. Sube uno
                  nuevo para reintentar.
                </p>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              Transfiere <span className="font-semibold text-foreground">{fmtRD(precio)}</span> a
              una de estas cuentas y sube el comprobante. Un administrador validará
              tu pago para activar la promoción.
            </p>

            {metodosPago.length === 0 ? (
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
                La empresa aún no configuró cuentas de transferencia. Contáctala
                directamente para coordinar el pago.
              </p>
            ) : (
              <div className="space-y-2">
                {metodosPago.map((m) => (
                  <div key={m.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="font-semibold text-foreground">{m.nombre}</p>
                    {m.numeroCuenta && (
                      <p className="text-muted-foreground">
                        {m.numeroCuenta}
                        {m.tipoCuenta ? ` (${m.tipoCuenta})` : ''}
                      </p>
                    )}
                    {m.titular && <p className="text-muted-foreground">Titular: {m.titular}</p>}
                    {m.instrucciones && (
                      <p className="mt-1 text-xs text-muted-foreground">{m.instrucciones}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <ComprobanteCompraForm compraId={compra.id} metodosPago={metodosPago} />

            <div className="flex justify-center border-t border-border/60 pt-3">
              <CancelarCompraButton compraId={compra.id} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* En validación */}
      {compra.estado === 'EN_VALIDACION' && (
        <Card className="border-info/25">
          <CardContent className="flex items-start gap-3 p-5">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-info" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">Comprobante en revisión</p>
              <p className="mt-0.5 text-muted-foreground">
                La empresa está validando tu pago. Te notificaremos al aprobarse y
                aquí aparecerá tu QR.
              </p>
              <ComprobanteLink
                tipo="compra"
                id={compra.id}
                valor={compra.comprobanteUrl}
                etiqueta="Ver comprobante enviado"
                className="mt-2 inline-flex items-center gap-1.5 text-primary hover:underline"
              />
              <div className="mt-3">
                <CancelarCompraButton compraId={compra.id} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Consumida */}
      {compra.estado === 'CONSUMIDA' && (
        <Card className="border-success/25">
          <CardContent className="flex items-start gap-3 p-5 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div>
              <p className="font-semibold text-foreground">Promoción consumida por completo</p>
              <p className="mt-0.5 text-muted-foreground">
                Usaste los {compra.usosIncluidos} uso{compra.usosIncluidos !== 1 ? 's' : ''} incluidos.
                Revisa tu historial de visitas para ver cada operación.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Línea de tiempo de estados */}
      {compra.transiciones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historial de la compra</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {compra.transiciones.map((t) => {
                const tui = compraEstadoUi(t.hacia)
                return (
                  <li key={t.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                    <div>
                      <p className="font-medium text-foreground">{tui.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtFechaHora(t.createdAt)}
                        {t.motivo ? ` · ${t.motivo}` : ''}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
