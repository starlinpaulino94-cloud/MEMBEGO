import { ComprobantePreview } from '@/components/pagos/ComprobanteLink'
import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney, formatDate, formatDateTime } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { EstadoBadge } from '@/components/EstadoBadge'
import {
  ConfirmPaymentForm,
  RenewForm,
  CancelForm,
  NewMembershipForm,
} from '@/components/admin/MembershipActions'
import { ConfirmarPagoButton, RechazarPagoButton } from '@/components/admin/ValidarPagoActions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotasCliente } from '@/components/admin/NotasCliente'
import { AnularTransaccionesClienteButton } from '@/components/registros/AnularTransaccionesClienteButton'
import { EliminarCuentaButton } from '@/components/superadmin/EliminarCuentaButton'
import { FileText, MessageCircle, Mail, StickyNote } from 'lucide-react'
import type { MembershipEstado } from '@/types'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date | null) {
  if (!d) return '—'
  return formatDate(d)
}

/**
 * Para lo que OCURRIÓ (visitas, canjes): fecha Y hora. `fmtDate` queda para
 * los límites del período de la membresía, que son de día completo.
 */
function fmtFechaHora(d: Date | null) {
  if (!d) return '—'
  return formatDateTime(d)
}

export default async function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params
  const companyId = companyFilter(user)

  const fetchCliente = () =>
    prisma.cliente.findUnique({
      where: { id },
      include: {
        company: true,
        qrTokens: { where: { activo: true }, take: 1 },
        vehiculos: true,
        memberships: {
          include: { plan: true, metodoPago: true },
          orderBy: { createdAt: 'desc' },
        },
        visits: {
          orderBy: { fechaVisita: 'desc' },
          take: 10,
          include: { vehiculo: true },
        },
        notas: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { autor: { select: { name: true } } },
        },
      },
    })

  let cliente: Awaited<ReturnType<typeof fetchCliente>> = null
  try {
    cliente = await fetchCliente()
  } catch (e) {
    console.error('[admin-cliente-detail]', e)
    return (
      <p className="text-muted-foreground">
        No pudimos cargar este cliente en este momento. Intenta de nuevo más tarde.
      </p>
    )
  }

  if (!cliente) notFound()
  if (companyId && cliente.companyId !== companyId) notFound()

  const prefs = await getRegionalPrefs(cliente.companyId)

  let planes: { id: string; nombre: string; precio: string }[] = []
  try {
    const rows = await prisma.plan.findMany({
      where: { companyId: cliente.companyId, activo: true },
      orderBy: { precio: 'asc' },
    })
    planes = rows.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: String(Number(p.precio)),
    }))
  } catch (e) {
    console.error('[admin-cliente-detail] planes', e)
  }

  const membership = cliente.memberships[0]
  const token = cliente.qrTokens[0]?.token

  return (
    <div className="space-y-6">
      <Link
        href="/admin/clientes"
        className="text-sm text-primary hover:underline"
      >
        ← Volver a clientes
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {cliente.nombre}
          </h1>
          <p className="text-muted-foreground">
            {cliente.email}
            {cliente.telefono ? ` · ${cliente.telefono}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Contacto rápido */}
          {cliente.telefono && (
            <a
              href={`https://wa.me/${cliente.telefono.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-success/25 bg-success/10 px-3 py-1.5 text-sm font-medium text-success transition hover:bg-success/15"
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {cliente.email && (
            <a
              href={`mailto:${cliente.email}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
            >
              <Mail className="h-4 w-4" /> Correo
            </a>
          )}
          {membership && (
            <EstadoBadge estado={membership.estado as MembershipEstado} />
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* QR + info */}
        <Card>
          <CardHeader>
            <CardTitle>Código QR</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            {token ? (
              <QRDisplay token={token} size={200} />
            ) : (
              <p className="text-muted-foreground">Sin código.</p>
            )}
            <p className="break-all text-center text-xs text-muted-foreground">
              {token}
            </p>
          </CardContent>
        </Card>

        {/* Membership detail + actions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Membresía</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!membership ? (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  El cliente aún no ha seleccionado un plan.
                </p>
                <NewMembershipForm
                  clienteId={cliente.id}
                  companyId={cliente.companyId}
                  planes={planes}
                />
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Info label="Plan" value={membership.plan.nombre} />
                  <Info
                    label="Precio"
                    value={formatMoney(Number(membership.plan.precio), prefs)}
                  />
                  <Info
                    label="Usos restantes"
                    value={
                      membership.plan.esIlimitado
                        ? 'Ilimitado'
                        : String(membership.lavadosRestantes)
                    }
                  />
                  <Info label="Inicio" value={fmtDate(membership.fechaInicio)} />
                  <Info
                    label="Vencimiento"
                    value={fmtDate(membership.fechaVencimiento)}
                  />
                  <Info
                    label="Pago"
                    value={membership.pagoConfirmado ? 'Confirmado' : 'Pendiente'}
                  />
                </div>

                {/* Comprobante de pago */}
                {membership.comprobanteUrl && (
                  <div className="rounded-lg border border-warning/30 bg-warning/15 p-4 space-y-3">
                    <p className="text-sm font-medium text-warning-foreground flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Comprobante enviado por el cliente
                    </p>
                    {membership.comprobanteNota && (
                      <p className="text-sm text-muted-foreground italic">"{membership.comprobanteNota}"</p>
                    )}
                    <ComprobantePreview
                      tipo="membresia"
                      id={membership.id}
                      valor={membership.comprobanteUrl}
                    />
                  </div>
                )}

                {/* Motivo de rechazo */}
                {membership.rechazadoReason && (
                  <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
                    <p className="text-sm font-medium text-destructive">Motivo de rechazo</p>
                    <p className="text-sm text-destructive">{membership.rechazadoReason}</p>
                  </div>
                )}

                <div className="space-y-4 border-t pt-4">
                  {membership.estado === 'PENDIENTE' && (
                    <ConfirmPaymentForm
                      membershipId={membership.id}
                      precio={String(Number(membership.plan.precio))}
                    />
                  )}
                  {membership.estado === 'PENDIENTE_PAGO' && (
                    <div className="flex gap-3">
                      <ConfirmarPagoButton membershipId={membership.id} />
                      <RechazarPagoButton membershipId={membership.id} />
                    </div>
                  )}
                  {(membership.estado === 'ACTIVA' ||
                    membership.estado === 'VENCIDA' ||
                    membership.estado === 'CANCELADA') && (
                    <RenewForm
                      membershipId={membership.id}
                      precio={String(Number(membership.plan.precio))}
                    />
                  )}
                  {membership.estado === 'ACTIVA' && (
                    <CancelForm membershipId={membership.id} />
                  )}
                  {(membership.estado === 'CANCELADA' ||
                    membership.estado === 'VENCIDA') && (
                    <div className="border-t pt-4">
                      <p className="mb-3 text-sm text-muted-foreground">
                        Crear una nueva membresía para este cliente:
                      </p>
                      <NewMembershipForm
                        clienteId={cliente.id}
                        companyId={cliente.companyId}
                        planes={planes}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vehicles */}
      {cliente.vehiculos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Vehículos</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {cliente.vehiculos.map((v) => (
              <div key={v.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {v.marca} {v.modelo} ({v.anio})
                </p>
                <p className="text-muted-foreground">
                  {v.color}
                  {v.placa ? ` · ${v.placa}` : ''}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Notas internas (CRM) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-warning-foreground" /> Notas internas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NotasCliente
            clienteId={cliente.id}
            notas={cliente.notas.map((n) => ({
              id: n.id,
              texto: n.texto,
              autorNombre: n.autor?.name ?? null,
              createdAt: n.createdAt,
            }))}
          />
        </CardContent>
      </Card>

      {/* Visits */}
      <Card>
        <CardHeader>
          <CardTitle>Visitas recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {cliente.visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin visitas.</p>
          ) : (
            <ul className="divide-y">
              {cliente.visits.map((v) => (
                <li key={v.id} className="flex justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium">{v.servicio}</p>
                    {v.vehiculo && (
                      <p className="text-muted-foreground">
                        {v.vehiculo.marca} {v.vehiculo.modelo}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground">{fmtFechaHora(v.fechaVisita)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Limpieza contable: anulación masiva de sus transacciones (cuentas de
          prueba, montos erróneos). Disponible para el admin de la empresa. */}
      <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
        <h2 className="text-sm font-semibold text-foreground">Limpieza contable</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Si este cliente es una cuenta de <strong>prueba</strong> (o sus cobros
          se registraron por error), anula aquí todas sus transacciones de un
          golpe: los montos dejan de sumar en ganancias, cierres y reportes.
          Nada se elimina — cada transacción queda ANULADA con su motivo y
          auditoría.
        </p>
        <AnularTransaccionesClienteButton clienteId={cliente.id} nombre={cliente.nombre} />
      </div>

      {/* Zona de peligro: eliminación definitiva, SOLO superadmin. Los admins
          de empresa no pueden borrar clientes (protección de datos/historial). */}
      {user.metadata.role === 'SUPERADMIN' && (
        <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-5">
          <h2 className="text-sm font-semibold text-foreground">Zona de peligro</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Elimina al cliente con sus membresías, QR, visitas y datos
            personales. Las facturas y transacciones de la empresa se
            conservan. Si no es cliente de otra empresa, también se elimina su
            cuenta de acceso.
          </p>
          <EliminarCuentaButton
            tipo="cliente"
            id={cliente.id}
            nombre={cliente.nombre}
            redirectTo="/admin/clientes"
          />
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  )
}
