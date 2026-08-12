import { ComprobantePreview } from '@/components/pagos/ComprobanteLink'
import { conEmpresaOTodas } from '@/lib/tenant'
import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney, formatDate, formatDateTime } from '@/lib/format'
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
import { PageHeader } from '@/components/ui/page-header'
import { TabsNav } from '@/components/ui/tabs-nav'
import { SemaforoCliente } from '@/components/admin/SemaforoCliente'
import { HistorialCliente } from '@/components/admin/HistorialCliente'
import { getHistorialCliente } from '@/modules/cliente/historial'
import { semaforoDeFila } from '@/modules/riesgo/clasificar'
import { getUmbralesRetencion } from '@/modules/riesgo/umbrales'
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

/**
 * Vistas de la ficha del cliente (§45).
 *
 * Van por URL —no por estado de cliente— para que un enlace a "las visitas de
 * Juan" siga siendo un enlace: se comparte por WhatsApp con el equipo y abre
 * donde debe. La consulta es la MISMA para todas: los datos ya venían en un
 * solo `include` y separarlos por pestaña sería reescribir la carga de datos
 * para ahorrar poco en una ficha que se abre de una en una.
 */
const VISTAS = ['resumen', 'historial', 'visitas', 'notas', 'ajustes'] as const
type Vista = (typeof VISTAS)[number]

export default async function ClienteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ vista?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params
  const { vista: vistaRaw } = await searchParams
  const vista: Vista = VISTAS.includes(vistaRaw as Vista) ? (vistaRaw as Vista) : 'resumen'
  const companyId = companyFilter(user)

  const fetchCliente = () =>
    conEmpresaOTodas(
      companyId,
      'ficha del cliente: sin empresa activa es el superadmin',
      (tx) => tx.cliente.findUnique({
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
    )

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

  // El semáforo se calcula en el servidor con los umbrales de ESTA empresa,
  // igual que en la tabla: dos pantallas no pueden llegar a conclusiones
  // distintas del mismo cliente.
  const umbrales = await getUmbralesRetencion(cliente.companyId)
  const semaforo = semaforoDeFila(
    {
      memberships: cliente.memberships,
      visits: cliente.visits.length > 0 ? [{ fechaVisita: cliente.visits[0].fechaVisita }] : [],
    },
    umbrales
  )

  // La línea de tiempo solo se consulta cuando se está mirando: son siete
  // consultas y la ficha se abre casi siempre por el resumen.
  const historial =
    vista === 'historial' ? await getHistorialCliente(cliente.companyId, cliente.id) : []

  let planes: { id: string; nombre: string; precio: string }[] = []
  try {
    const rows = await conEmpresaOTodas(
      companyId,
      'clientes · [id]: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.plan.findMany({
        where: { companyId: cliente.companyId, activo: true },
        orderBy: { precio: 'asc' },
      })
    )
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
      <PageHeader
        eyebrow={
          <Link href="/admin/clientes" className="hover:underline">
            Clientes
          </Link>
        }
        title={cliente.nombre}
        description={[cliente.email, cliente.telefono].filter(Boolean).join(' · ')}
        action={
          <>
            {cliente.telefono && (
              <a
                href={`https://wa.me/${cliente.telefono.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 text-small font-medium text-success transition hover:bg-success/15"
              >
                <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
              </a>
            )}
            {cliente.email && (
              <a
                href={`mailto:${cliente.email}`}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-small font-medium text-muted-foreground transition hover:bg-muted"
              >
                <Mail className="h-4 w-4" aria-hidden /> Correo
              </a>
            )}
            {membership && <EstadoBadge estado={membership.estado as MembershipEstado} />}
            {/* El semáforo va junto al estado de la membresía a propósito:
                dicen cosas distintas y verlos juntos es lo que evita
                confundirlos. «Activa» habla del contrato; «en riesgo», de la
                relación. */}
            <SemaforoCliente estado={semaforo.estado} motivo={semaforo.motivo} />
          </>
        }
        nav={
          <TabsNav
            aria-label="Secciones del cliente"
            items={[
              { clave: 'resumen', label: 'Resumen' },
              { clave: 'historial', label: 'Historial' },
              { clave: 'visitas', label: 'Visitas', badge: cliente.visits.length },
              { clave: 'notas', label: 'Notas', badge: cliente.notas.length },
              { clave: 'ajustes', label: 'Ajustes' },
            ].map((t) => ({
              label: t.label,
              badge: t.badge,
              active: vista === t.clave,
              render: ({ className, children }) => (
                <Link
                  href={`/admin/clientes/${cliente.id}${t.clave === 'resumen' ? '' : `?vista=${t.clave}`}`}
                  className={className}
                >
                  {children}
                </Link>
              ),
            }))}
          />
        }
      />

      {vista === 'resumen' && (
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

                {/* El cliente programó su cancelación desde la app: el negocio
                    tiene que verlo ANTES de renovar a mano por costumbre. */}
                {membership.canceladaAlVencimiento && (
                  <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
                    El cliente canceló esta membresía el{' '}
                    {fmtDate(membership.canceladaAlVencimiento)}: sigue activa hasta su
                    vencimiento y no debe renovarse.
                  </p>
                )}

                {/* Comprobante de pago */}
                {membership.comprobanteUrl && (
                  <div className="rounded-lg border border-warning/30 bg-warning/15 p-4 space-y-3">
                    <p className="text-sm font-medium text-warning flex items-center gap-2">
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
      )}

      {/* Vehicles */}
      {vista === 'resumen' && cliente.vehiculos.length > 0 && (
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

      {/* Línea de tiempo: qué ha pasado con esta persona, en orden. Antes esta
          información existía repartida en seis pantallas y había que
          reconstruirla de cabeza mientras se hablaba por teléfono. */}
      {vista === 'historial' && (
        <Card>
          <CardHeader>
            <CardTitle>Todo lo que ha pasado</CardTitle>
          </CardHeader>
          <CardContent>
            <HistorialCliente
              eventos={historial}
              formatearFecha={(d) => formatDateTime(d, prefs)}
              formatearMonto={(n) => formatMoney(n, prefs)}
            />
          </CardContent>
        </Card>
      )}

      {/* Notas internas (CRM) */}
      {vista === 'notas' && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-warning" /> Notas internas
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
      )}

      {/* Visits */}
      {vista === 'visitas' && (
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
      )}

      {/* AJUSTES · Las operaciones destructivas viven en su propia pestaña.
          Antes estaban en el mismo scroll que el teléfono del cliente: anular
          todas sus transacciones o borrar su cuenta quedaba a un gesto de
          distancia de leer un dato. Separarlas no las esconde —siguen a un
          clic— pero deja de ponerlas en el camino de lectura. */}
      {vista === 'ajustes' && (
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-5">
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
      )}

      {/* Zona de peligro: eliminación definitiva, SOLO superadmin. Los admins
          de empresa no pueden borrar clientes (protección de datos/historial). */}
      {vista === 'ajustes' && user.metadata.role === 'SUPERADMIN' && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
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
