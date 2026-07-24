import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Ticket,
  Landmark,
  CheckCircle2,
  Clock,
  XCircle,
  FileText,
  CalendarDays,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
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
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole('CLIENTE')
  const { id } = await params

  const compra = await prisma.productoCompra.findUnique({
    where: { id },
    include: {
      promocion: true,
      company: { select: { name: true, zonaHoraria: true } },
      metodoPago: true,
      transiciones: { orderBy: { createdAt: 'asc' } },
      qrTokens: { where: { activo: true }, orderBy: { createdAt: 'desc' }, take: 1 },
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

  // Cita antes del QR: las recompensas GRATIS exigen agendar una cita para
  // habilitar el QR (docs/SEGUIMIENTO-BENEFICIOS.md), si la empresa tiene la
  // agenda de citas activa. Tolerante a la migración 20260756 pendiente.
  const esGratis = compra.promocionId != null && precio <= 0
  let citaCanje: { inicio: Date; estado: string } | null = null
  let requiereCita = false
  if (esGratis && compra.estado === 'ACTIVA' && qr) {
    // E4: la regla "cita antes del QR" ahora es una capacidad apagable por
    // empresa (fail-open: sin configurar = activa, como hasta ahora).
    const { tieneCapacidad } = await import('@/modules/capacidades/resolver')
    const reglaActiva = await tieneCapacidad(compra.companyId, 'CITA_ANTES_DEL_QR')
    const agenda = reglaActiva ? await getAgendaConfig(compra.companyId).catch(() => null) : null
    if (agenda?.activa) {
      try {
        citaCanje = await prisma.cita.findFirst({
          where: { compraId: compra.id, estado: { notIn: ['CANCELADA', 'NO_ASISTIO'] } },
          orderBy: { inicio: 'desc' },
          select: { inicio: true, estado: true },
        })
        requiereCita = !citaCanje
      } catch (e) {
        // Columna citas.compraId sin migrar: no bloquear el QR.
        console.error('[mis-promociones] cita del canje:', e)
      }
    }
  }
  const fmtCita = (d: Date) =>
    new Intl.DateTimeFormat('es-DO', {
      timeZone: compra.company.zonaHoraria,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(d)

  // Cuentas bancarias activas de la empresa (transferencia).
  const metodosPago = ESPERA_PAGO.includes(compra.estado)
    ? await prisma.metodoPago.findMany({
        where: { companyId: compra.companyId, activo: true, tipo: 'TRANSFERENCIA' },
        select: { id: true, nombre: true, titular: true, numeroCuenta: true, tipoCuenta: true, instrucciones: true },
      })
    : []

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/cliente/mis-promociones"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Mis promociones
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

      {/* Recompensa gratis sin cita: agendar ANTES de recibir el QR */}
      {compra.estado === 'ACTIVA' && qr && requiereCita && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" /> Agenda tu cita para
              recibir tu QR
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            <p className="text-sm text-muted-foreground">
              Tu <strong className="text-foreground">{promo?.titulo ?? 'recompensa'}</strong>{' '}
              gratis está reservada a tu nombre. Para usarla, primero elige el día y la
              hora en que vendrás; al confirmar la cita, tu QR aparecerá aquí listo para
              presentarlo en el local.
            </p>
            <Button asChild className="w-full gap-2 font-bold sm:w-auto">
              <Link href={`/cliente/citas?compra=${compra.id}`}>
                <CalendarDays className="h-4 w-4" /> Agendar mi cita
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* QR activo */}
      {compra.estado === 'ACTIVA' && qr && !requiereCita && (
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

      {/* Pago pendiente: instrucciones + comprobante */}
      {ESPERA_PAGO.includes(compra.estado) && (
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
              {compra.comprobanteUrl && (
                <a
                  href={compra.comprobanteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" /> Ver comprobante enviado
                </a>
              )}
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
