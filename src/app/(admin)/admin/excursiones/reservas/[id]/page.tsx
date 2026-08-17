import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { reservaDetalle } from '@/modules/excursiones/reservas/queries'
import { ventaDeReserva } from '@/modules/excursiones/comisiones/queries'
import {
  ESTADO_RESERVA_LABEL,
  TONO_RESERVA,
  type EstadoReserva,
} from '@/modules/excursiones/reservas/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReservaPagos } from '@/components/excursiones/ReservaPagos'
import { ReservaEstadoBotones } from '@/components/excursiones/ReservaEstadoBotones'
import { VentaAcciones } from '@/components/excursiones/VentaAcciones'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reserva' }

export default async function ReservaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las reservas de excursiones" />

  const { id } = await params
  const detalle = await reservaDetalle(companyId, id)
  if (!detalle) notFound()
  const { reserva, saldo, cliente, excursion, vendedor } = detalle
  const venta = await ventaDeReserva(companyId, reserva.id)

  const moneda = reserva.moneda
  const estado = reserva.estado as EstadoReserva
  const dinero = (n: number | string) => formatMoney(n, { moneda }, 2)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/excursiones/reservas"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Reservas
          </Link>
          <h2 className="mt-1 font-mono text-h2 text-foreground">{reserva.numero}</h2>
          <p className="text-sm text-muted-foreground">
            {cliente?.nombre ?? 'Cliente'}
            {cliente?.telefono ? ` · ${cliente.telefono}` : ''}
          </p>
        </div>
        <StatusChip tone={TONO_RESERVA[estado] ?? 'neutral'}>
          {ESTADO_RESERVA_LABEL[estado] ?? reserva.estado}
        </StatusChip>
      </div>

      <ReservaEstadoBotones reservaId={reserva.id} estado={estado} />

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-h3 text-foreground">La excursión</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-muted-foreground">Excursión</dt>
            <dd className="text-foreground">{excursion?.nombre ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Fecha de salida</dt>
            <dd className="text-foreground">
              {formatDate(reserva.fecha)}
              {reserva.hora ? ` · ${reserva.hora}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Pasajeros</dt>
            <dd className="text-foreground">
              {reserva.adultos} adulto{reserva.adultos === 1 ? '' : 's'}
              {reserva.ninos > 0 ? ` · ${reserva.ninos} niño${reserva.ninos === 1 ? '' : 's'}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Vendedor atribuido</dt>
            <dd className="text-foreground">
              {vendedor ? (
                <Link
                  href={`/admin/excursiones/vendedores/${vendedor.id}`}
                  className="hover:text-primary hover:underline"
                >
                  {vendedor.nombre} <span className="font-mono text-caption">{vendedor.codigo}</span>
                </Link>
              ) : (
                'Venta directa'
              )}
            </dd>
          </div>
        </dl>

        <dl className="mt-4 border-t border-border pt-3 text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-foreground">{dinero(String(reserva.subtotal))}</dd>
          </div>
          {Number(reserva.descuento) > 0 ? (
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Descuento</dt>
              <dd className="text-foreground">−{dinero(String(reserva.descuento))}</dd>
            </div>
          ) : null}
          {Number(reserva.impuestos) > 0 ? (
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Impuestos</dt>
              <dd className="text-foreground">{dinero(String(reserva.impuestos))}</dd>
            </div>
          ) : null}
          <div className="mt-1 flex justify-between border-t border-border pt-2">
            <dt className="font-semibold text-foreground">Total</dt>
            <dd className="text-h3 text-foreground">{dinero(String(reserva.total))}</dd>
          </div>
        </dl>

        {reserva.notas ? (
          <p className="mt-3 whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
            {reserva.notas}
          </p>
        ) : null}
      </section>

      <ReservaPagos
        reservaId={reserva.id}
        moneda={moneda}
        total={Number(reserva.total)}
        pagado={saldo.pagado}
        saldo={saldo.saldo}
        admitePagos={estado !== 'CANCELADA'}
        pagos={reserva.pagos.map((p) => ({
          id: p.id,
          monto: String(p.monto),
          metodo: p.metodo,
          referencia: p.referencia,
          estado: p.estado,
          notas: p.notas,
          createdAt: p.createdAt,
        }))}
      />

      <VentaAcciones
        reservaId={reserva.id}
        saldo={saldo.saldo}
        venta={venta ? { id: venta.id, numero: venta.numero, estado: venta.estado } : null}
      />
    </div>
  )
}
