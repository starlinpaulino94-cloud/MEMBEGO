import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AprobarCambioButton, RechazarCambioButton } from '@/components/admin/CambioPlanActions'
import { AprobarCompraButton, RechazarCompraButton } from '@/components/admin/ValidarCompraActions'
import type { FilaCambio, FilaCompra } from '@/modules/pagos/colasLectura'
import { ComprobanteAdjunto, NotaDelCliente, TarjetaPago, fmtFecha } from './TarjetaPago'

/**
 * Las dos tarjetas que quedan de Pagos: una COMPRA de promoción por validar y un CAMBIO DE PLAN solicitado. Movidas de
 * `pagos/page.tsx` sin cambiar lo que dicen ni lo que hacen.
 */

export function TarjetaCompraPendiente({
  c,
  fmtMoney,
  esSuperadmin,
}: {
  c: FilaCompra
  fmtMoney: (n: number) => string
  esSuperadmin: boolean
}) {
  return (
    <TarjetaPago
      claseTarjeta="border-primary/25" claseCabecera="bg-primary/5"
      clienteId={c.clienteId}
      nombre={c.cliente.nombre}
      email={c.cliente.email}
      empresa={esSuperadmin ? c.cliente.company.name : undefined}
      insignia={<Badge variant="info">Promoción</Badge>}
    >
      <div className="rounded-lg bg-muted p-3 text-sm">
        <p>
          <span className="text-muted-foreground">Promoción:</span> <strong>{c.promocion?.titulo ?? '—'}</strong>
        </p>
        <p>
          <span className="text-muted-foreground">Monto esperado:</span> <strong>{fmtMoney(Number(c.precioCongelado ?? 0))}</strong>
        </p>
        {c.metodoPago && (
          <p>
            <span className="text-muted-foreground">Método:</span> {c.metodoPago.nombre}
          </p>
        )}
        {c.transferenciaFecha && (
          <p>
            <span className="text-muted-foreground">Transferencia declarada:</span> {fmtFecha(c.transferenciaFecha)}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Enviado: {fmtFecha(c.updatedAt)}</p>
      </div>

      {c.comprobanteUrl && <ComprobanteAdjunto url={c.comprobanteUrl} alt="Comprobante de la compra" />}
      {c.comprobanteNota && <NotaDelCliente texto={c.comprobanteNota} />}

      <div className="flex flex-wrap gap-2 pt-1">
        <AprobarCompraButton compraId={c.id} />
        <RechazarCompraButton compraId={c.id} />
      </div>
    </TarjetaPago>
  )
}

export function TarjetaCambioPlan({
  c,
  fmtMoney,
  esSuperadmin,
}: {
  c: FilaCambio
  fmtMoney: (n: number) => string
  esSuperadmin: boolean
}) {
  return (
    <TarjetaPago
      claseTarjeta="border-info/30" claseCabecera="bg-info/5"
      clienteId={c.clienteId}
      nombre={c.cliente.nombre}
      email={c.cliente.email}
      empresa={esSuperadmin ? c.cliente.company.name : undefined}
      insignia={<Badge variant="info">Cambio de plan</Badge>}
    >
      <div className="flex items-center justify-center gap-3 rounded-lg bg-muted p-3 text-sm">
        <span className="font-medium text-muted-foreground">{c.plan.nombre}</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold text-foreground">
          {c.planSolicitado?.nombre}
          {c.planSolicitado != null && (
            <span className="ml-1 text-muted-foreground">· {fmtMoney(Number(c.planSolicitado.precio))}</span>
          )}
        </span>
      </div>

      {c.comprobanteUrl ? (
        <ComprobanteAdjunto url={c.comprobanteUrl} alt="Comprobante del cambio" />
      ) : (
        <p className="rounded-lg bg-warning/15 p-3 text-xs text-warning">El cliente aún no ha subido el comprobante del nuevo plan.</p>
      )}

      {c.comprobanteNota && <NotaDelCliente texto={c.comprobanteNota} />}

      <div className="flex flex-wrap gap-2 pt-1">
        <AprobarCambioButton membershipId={c.id} />
        <RechazarCambioButton membershipId={c.id} />
      </div>
    </TarjetaPago>
  )
}
