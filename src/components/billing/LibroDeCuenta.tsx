import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { FilaDeAsiento, FilaDeCorte } from '@/modules/billing/queries'
import { ETIQUETA_TIPO_ASIENTO, etiquetaDePeriodo, formatearFechaHora, formatoMonto } from '@/modules/billing/formato'

/**
 * El historial de la cuenta (libro) y sus estados de cuenta. Presentación pura, sin
 * runtime de cliente: lo usan la vista de la empresa y la del superadmin. Positivo =
 * la empresa debe; negativo = a su favor.
 */

const TONO: Record<string, string> = { positivo: 'text-foreground', negativo: 'text-success' }

export function TablaDeAsientos({ filas, pedidoHref }: { filas: FilaDeAsiento[]; pedidoHref?: (pedidoId: string) => string }) {
  if (filas.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay movimientos en la cuenta.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Movimientos de la cuenta, del más reciente al más antiguo</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">Fecha</th>
            <th scope="col" className="py-2 pr-3 font-medium">Movimiento</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Monto</th>
            <th scope="col" className="py-2 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((a) => {
            const negativo = a.amount.startsWith('-')
            return (
              <tr key={a.id} className="border-b last:border-0 align-top">
                <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{formatearFechaHora(a.createdAt)}</td>
                <td className="py-2 pr-3">
                  <span className="font-medium">{ETIQUETA_TIPO_ASIENTO[a.type]}</span>
                  {a.pedidoCodigo && (
                    <span className="text-muted-foreground">
                      {' · '}
                      {pedidoHref && a.pedidoId ? (
                        <Link href={pedidoHref(a.pedidoId)} className="underline">
                          {a.pedidoCodigo}
                        </Link>
                      ) : (
                        a.pedidoCodigo
                      )}
                    </span>
                  )}
                  {a.referenceType === 'PAYMENT' && <span className="text-muted-foreground"> · ref. {a.referenceId}</span>}
                  {a.reason && <p className="text-xs text-muted-foreground">{a.reason}</p>}
                </td>
                <td className={`whitespace-nowrap py-2 pr-3 text-right tabular-nums ${negativo ? TONO.negativo : TONO.positivo}`}>{formatoMonto(a.amount, a.currency)}</td>
                <td className="whitespace-nowrap py-2 text-right tabular-nums text-muted-foreground">{formatoMonto(a.balance, a.currency)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function TablaDeCortes({ cortes }: { cortes: FilaDeCorte[] }) {
  if (cortes.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay estados de cuenta. Se emiten al cerrar cada periodo.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Estados de cuenta por periodo</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">Periodo</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Pedidos</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Ventas</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Comisiones</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Pagos y créditos</th>
            <th scope="col" className="py-2 text-right font-medium">Debe al cierre</th>
          </tr>
        </thead>
        <tbody>
          {cortes.map((c) => {
            const abonos = Number(c.payments) + Number(c.credits)
            const neto = Number(c.totalCommissions) + Number(c.reversals) + Number(c.adjustments)
            return (
              <tr key={c.id} className="border-b last:border-0">
                <td className="whitespace-nowrap py-2 pr-3">
                  {etiquetaDePeriodo(c.periodStart, c.periodEnd)}
                  {Number(c.openingBalance) !== 0 && <p className="text-xs text-muted-foreground">Abrió con {formatoMonto(c.openingBalance, c.currency)}</p>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{c.totalOrders}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatoMonto(c.totalGmv, c.currency)}</td>
                <td className="py-2 pr-3 text-right tabular-nums" title="Comisiones menos reversos más ajustes">{formatoMonto(neto.toFixed(2), c.currency)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-success">{formatoMonto(abonos.toFixed(2), c.currency)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  {formatoMonto(c.amountDue, c.currency)} {Number(c.amountDue) === 0 && <Badge variant="success">Al día</Badge>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
