import { EstadoBadge } from '@/components/EstadoBadge'
import {
  ConfirmarPagoButton,
  RechazarPagoButton,
  SolicitarEvidenciaButton,
  NotaInternaForm,
} from '@/components/admin/ValidarPagoActions'
import type { MembershipEstado } from '@/types'
import type { FilaTransferencia } from '@/modules/pagos/colasLectura'
import { descuentoDeBienvenidaVigente, montoEsperado } from '@/modules/pagos/colasMezcla'
import { ComprobanteAdjunto, NotaDelCliente, TarjetaPago, fmtFecha } from './TarjetaPago'

/**
 * Una TRANSFERENCIA por validar (cola «Transferencias»): lo que el cliente declaró, su comprobante y las cuatro acciones de
 * siempre —confirmar, rechazar, pedir más evidencia y dejar una nota interna—. Es la tarjeta de `pagos/page.tsx`, movida sin
 * cambiar lo que dice ni lo que hace; el monto esperado sale de `montoEsperado` (O-13: neto del descuento de bienvenida).
 */
export function TarjetaPagoPendiente({
  m,
  fmtMoney,
  esSuperadmin,
}: {
  m: FilaTransferencia
  fmtMoney: (n: number) => string
  esSuperadmin: boolean
}) {
  const desc = descuentoDeBienvenidaVigente(m.descuentoBienvenida, m.fechaInicio)
  return (
    <TarjetaPago
      claseCabecera="bg-info/5"
      clienteId={m.clienteId}
      nombre={m.cliente.nombre}
      email={m.cliente.email}
      empresa={esSuperadmin ? m.cliente.company.name : undefined}
      insignia={<EstadoBadge estado={m.estado as MembershipEstado} />}
    >
      <div className="rounded-lg bg-muted p-3 text-sm">
        <p>
          <span className="text-muted-foreground">Plan:</span> <strong>{m.plan.nombre}</strong>
        </p>
        {desc <= 0 ? (
          <p>
            <span className="text-muted-foreground">Precio:</span> <strong>{fmtMoney(Number(m.plan.precio))}</strong>
          </p>
        ) : (
          <>
            <p>
              <span className="text-muted-foreground">Precio:</span>{' '}
              <span className="line-through">{fmtMoney(Number(m.plan.precio))}</span>{' '}
              <span className="text-success">−{fmtMoney(desc)} bienvenida</span>
            </p>
            <p>
              <span className="text-muted-foreground">Monto esperado:</span>{' '}
              <strong>{fmtMoney(montoEsperado(m.plan.precio, m.descuentoBienvenida, m.fechaInicio))}</strong>
            </p>
          </>
        )}
        {m.metodoPago && (
          <p>
            <span className="text-muted-foreground">Método:</span> {m.metodoPago.nombre}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Enviado: {fmtFecha(m.updatedAt)}</p>
      </div>

      {m.comprobanteUrl && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Comprobante:</p>
          <ComprobanteAdjunto url={m.comprobanteUrl} alt="Comprobante" />
        </div>
      )}

      {m.comprobanteNota && <NotaDelCliente texto={m.comprobanteNota} />}

      {m.adminNota && (
        <div className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Nota interna</p>
          <p>{m.adminNota}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <ConfirmarPagoButton membershipId={m.id} />
        <RechazarPagoButton membershipId={m.id} />
        <SolicitarEvidenciaButton membershipId={m.id} />
      </div>

      <div className="border-t pt-3">
        <NotaInternaForm membershipId={m.id} notaActual={m.adminNota ?? null} />
      </div>
    </TarjetaPago>
  )
}
