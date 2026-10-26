import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Tabla, type Columna } from '@/components/ui/tabla'
import type { FilaDeAsiento, FilaDeCorte } from '@/modules/billing/queries'
import { ETIQUETA_TIPO_ASIENTO, etiquetaDePeriodo, formatearFechaHora, formatoMonto } from '@/modules/billing/formato'

/**
 * El historial de la cuenta (libro) y sus estados de cuenta, en la `Tabla` del sistema (auditoría admin · fase 7, tarea 7.1).
 * Presentación pura, sin runtime de cliente: lo usan la vista de la empresa y la del superadmin. Positivo = la empresa debe;
 * negativo = a su favor.
 *
 * Ninguna columna se oculta en pantallas estrechas, a propósito: son cifras de una cuenta y quien las lee quiere verlas todas; la
 * tabla se desliza de lado dentro de su marco y deja fija la primera columna.
 */

const TONO: Record<string, string> = { positivo: 'text-foreground', negativo: 'text-success' }

export function TablaDeAsientos({ filas, pedidoHref }: { filas: FilaDeAsiento[]; pedidoHref?: (pedidoId: string) => string }) {
  if (filas.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay movimientos en la cuenta.</p>
  const columnas: Columna<FilaDeAsiento>[] = [
    {
      clave: 'movimiento',
      encabezado: 'Movimiento',
      celda: (a) => (
        <>
          <span className="font-medium">{ETIQUETA_TIPO_ASIENTO[a.type]}</span>
          {a.pedidoCodigo && (
            <span className="font-normal text-muted-foreground">
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
          {a.referenceType === 'PAYMENT' && <span className="font-normal text-muted-foreground"> · ref. {a.referenceId}</span>}
          {a.reason && <span className="block text-caption font-normal text-muted-foreground">{a.reason}</span>}
        </>
      ),
    },
    {
      clave: 'fecha',
      encabezado: 'Fecha',
      celda: (a) => <span className="whitespace-nowrap text-muted-foreground">{formatearFechaHora(a.createdAt)}</span>,
    },
    {
      clave: 'monto',
      encabezado: 'Monto',
      alineacion: 'derecha',
      celda: (a) => <span className={`whitespace-nowrap ${a.amount.startsWith('-') ? TONO.negativo : TONO.positivo}`}>{formatoMonto(a.amount, a.currency)}</span>,
    },
    {
      clave: 'saldo',
      encabezado: 'Saldo',
      alineacion: 'derecha',
      celda: (a) => <span className="whitespace-nowrap text-muted-foreground">{formatoMonto(a.balance, a.currency)}</span>,
    },
  ]
  return <Tabla caption="Movimientos de la cuenta, del más reciente al más antiguo" columnas={columnas} filas={filas} claveDe={(a) => a.id} className="border-0 shadow-none" />
}

export function TablaDeCortes({ cortes }: { cortes: FilaDeCorte[] }) {
  if (cortes.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay estados de cuenta. Se emiten al cerrar cada periodo.</p>
  const columnas: Columna<FilaDeCorte>[] = [
    {
      clave: 'periodo',
      encabezado: 'Periodo',
      celda: (c) => (
        <span className="whitespace-nowrap">
          {etiquetaDePeriodo(c.periodStart, c.periodEnd)}
          {Number(c.openingBalance) !== 0 && <span className="block text-caption font-normal text-muted-foreground">Abrió con {formatoMonto(c.openingBalance, c.currency)}</span>}
        </span>
      ),
    },
    { clave: 'pedidos', encabezado: 'Pedidos', tipo: 'numero', valor: (c) => c.totalOrders },
    { clave: 'ventas', encabezado: 'Ventas', alineacion: 'derecha', celda: (c) => formatoMonto(c.totalGmv, c.currency) },
    {
      clave: 'comisiones',
      encabezado: 'Comisiones',
      alineacion: 'derecha',
      celda: (c) => {
        const neto = Number(c.totalCommissions) + Number(c.reversals) + Number(c.adjustments)
        return <span title="Comisiones menos reversos más ajustes">{formatoMonto(neto.toFixed(2), c.currency)}</span>
      },
    },
    {
      clave: 'abonos',
      encabezado: 'Pagos y créditos',
      alineacion: 'derecha',
      celda: (c) => <span className="text-success">{formatoMonto((Number(c.payments) + Number(c.credits)).toFixed(2), c.currency)}</span>,
    },
    {
      clave: 'debe',
      encabezado: 'Debe al cierre',
      alineacion: 'derecha',
      celda: (c) => (
        <span className="font-semibold">
          {formatoMonto(c.amountDue, c.currency)} {Number(c.amountDue) === 0 && <Badge variant="success">Al día</Badge>}
        </span>
      ),
    },
  ]
  return <Tabla caption="Estados de cuenta por periodo" columnas={columnas} filas={cortes} claveDe={(c) => c.id} className="border-0 shadow-none" />
}
