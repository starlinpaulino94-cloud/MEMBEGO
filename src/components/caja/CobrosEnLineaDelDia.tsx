import { CreditCard } from 'lucide-react'
import { FacturaPrintDialog } from '@/components/facturas/FacturaPrintDialog'
import type { CobrosEnLineaDelDia as Datos } from '@/modules/pagos/cobros-en-linea'

/**
 * Cobros con tarjeta hechos en la app o la web ese día (y las renovaciones automáticas).
 *
 * Se enseñan APARTE de la gaveta a propósito: el dinero entró a la pasarela, no a la caja, así que no suman al efectivo
 * esperado ni al arqueo. Existen aquí para que el personal vea qué se pagó con tarjeta fuera del mostrador y pueda
 * imprimir cada comprobante para el cuadre. Componente de servidor: solo el botón de imprimir es de cliente.
 */

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

export function CobrosEnLineaDelDia({ datos, timeZone }: { datos: Datos; timeZone: string }) {
  const fmtHora = (d: Date) => new Intl.DateTimeFormat('es-DO', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d)
  const { items, resumen } = datos

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5" data-testid="cobros-en-linea">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CreditCard className="h-4 w-4 text-primary" aria-hidden /> Cobros con tarjeta en línea de hoy
          </h2>
          <p className="mt-0.5 text-caption text-muted-foreground">
            Pagados en la app o la web. No pasan por la gaveta: no suman al efectivo ni al arqueo.
          </p>
        </div>
        {resumen.cantidad > 0 && (
          <p className="text-right text-sm font-bold tabular-nums text-foreground" data-testid="cobros-en-linea-total">
            {fmtRD(resumen.total)}
            <span className="block text-overline font-normal text-muted-foreground">
              {resumen.cantidad} {resumen.cantidad === 1 ? 'cobro' : 'cobros'}
            </span>
          </p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Todavía no hay cobros en línea hoy.</p>
      ) : (
        <div className="mt-3 divide-y divide-border/50">
          {items.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{c.cliente}</p>
                <p className="truncate text-caption text-muted-foreground">
                  {c.detalle} · <code className="font-mono">{c.ticketNumero}</code>
                </p>
                <p className="truncate text-overline text-muted-foreground">
                  {c.formaDePago}
                  {c.autorizacion ? ` · Aut. ${c.autorizacion}` : ''} · {c.sucursal}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="font-semibold tabular-nums text-foreground">{fmtRD(c.monto)}</p>
                  <p className="text-overline text-muted-foreground">{fmtHora(c.creadoAt)}</p>
                </div>
                <FacturaPrintDialog transactionId={c.id} yaImpresa={c.impresa} triggerLabel={c.impresa ? 'Reimprimir' : 'Imprimir'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
