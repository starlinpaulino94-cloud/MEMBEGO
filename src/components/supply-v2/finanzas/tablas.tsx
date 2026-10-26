import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SupplyV2DepositStatus } from '@prisma/client'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { formatDate } from '@/lib/format'
import {
  dineroSupplyV2,
  RECOGNITION_BASIS_LABELS,
  RECONCILIATION_KIND_LABELS,
  RUTA_FINANZAS,
  RUTA_LIQUIDACIONES,
  SETTLEMENT_FREQUENCY_LABELS,
  SUPPLIER_PAYMENT_METHOD_LABELS,
} from '@/modules/supply-v2/core/catalogo'
import { SIN_INFORMACION_DEL_PROVEEDOR } from '@/modules/supply-v2/finance/domain'
import type {
  DepositoFila,
  FacturaFila,
  LiquidacionFila,
  ObligacionFila,
  PagoFila,
  listarConciliaciones,
} from '@/modules/supply-v2/finance/queries'
import { ChipConciliacion, ChipDeposito, ChipFactura, ChipLiquidacion, ChipObligacion, ChipPagoProveedor } from './chips'
import { ConfirmarPago } from './acciones-pago'

/**
 * LAS SEIS LISTAS DE FINANZAS DE SUPPLY EN LA `Tabla` DEL SISTEMA (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-15).
 *
 * Eran tablas HTML sueltas, sin título para el lector de pantalla ni `scope`. Ahora tienen `caption`, el identificador de cada fila
 * como `<th scope="row">`, el dinero a la derecha y lo menos importante se oculta en pantalla estrecha. Los `data-testid` que usan
 * las pruebas de extremo a extremo se conservan TODOS (la tabla, la fila y las cifras que se leen); una prueba lo comprueba.
 */

const enlace = 'underline-offset-4 hover:underline'
const sub = (texto: ReactNode) => <span className="block text-caption text-muted-foreground">{texto}</span>
const dinero = (n: string | number | { toString(): string }, moneda: string) => dineroSupplyV2(n, moneda)

type SinResultados = { titulo: string }
const VACIO: SinResultados = { titulo: 'Sin resultados' }

function Base<F>({
  caption,
  columnas,
  filas,
  claveDe,
  columnaIdentificadora,
  testId,
  testIdFila,
  pie,
}: {
  caption: string
  columnas: Columna<F>[]
  filas: F[]
  claveDe: (f: F) => string
  columnaIdentificadora: string
  testId: string
  testIdFila: string
  pie?: ReactNode
}) {
  return (
    <Tabla
      caption={caption}
      columnas={columnas}
      filas={filas}
      claveDe={claveDe}
      columnaIdentificadora={columnaIdentificadora}
      testId={testId}
      testIdFila={testIdFila}
      vacio={VACIO}
      pie={pie}
    />
  )
}

// ── Facturas ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function TablaFacturas({ filas, pie }: { filas: FacturaFila[]; pie?: ReactNode }) {
  const columnas: Columna<FacturaFila>[] = [
    {
      clave: 'factura',
      encabezado: 'Factura',
      celda: (f) => (
        <>
          <Link href={`${RUTA_FINANZAS}/facturas/${f.id}`} className={enlace} data-testid="link-factura">
            {f.number}
          </Link>
          {f.supplierInvoiceNumber && sub(f.supplierInvoiceNumber)}
          {f.purchaseOrder && sub(f.purchaseOrder.number)}
        </>
      ),
    },
    { clave: 'proveedor', encabezado: 'Proveedor' },
    { clave: 'fecha', encabezado: 'Fecha', prioridad: 2, celda: (f) => formatDate(f.documentDate) },
    { clave: 'vence', encabezado: 'Vencimiento', prioridad: 2, celda: (f) => (f.dueDate ? formatDate(f.dueDate) : '—') },
    { clave: 'total', encabezado: 'Total', alineacion: 'derecha', celda: (f) => dinero(f.total, f.currency) },
    { clave: 'aplicado', encabezado: 'Aplicado', alineacion: 'derecha', prioridad: 3, celda: (f) => dinero(f.amountApplied, f.currency) },
    { clave: 'pagado', encabezado: 'Pagado', alineacion: 'derecha', prioridad: 3, celda: (f) => dinero(f.amountPaid, f.currency) },
    {
      clave: 'pendiente',
      encabezado: 'Pendiente',
      alineacion: 'derecha',
      celda: (f) => <span data-testid="factura-pendiente">{dinero(f.amountDue, f.currency)}</span>,
    },
    { clave: 'estado', encabezado: 'Estado', celda: (f) => <ChipFactura estado={f.status} /> },
  ]
  return <Base caption="Facturas de proveedores" columnas={columnas} filas={filas} claveDe={(f) => f.id} columnaIdentificadora="factura" testId="tabla-facturas" testIdFila="factura" pie={pie} />
}

// ── Depósitos ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function TablaDepositos({ filas, pie }: { filas: DepositoFila[]; pie?: ReactNode }) {
  const columnas: Columna<DepositoFila>[] = [
    {
      clave: 'deposito',
      encabezado: 'Depósito',
      celda: (d) => (
        <>
          <Link href={`${RUTA_FINANZAS}/depositos/${d.id}`} className={enlace}>
            {d.number}
          </Link>
          {d.paymentNumber && sub(`de ${d.paymentNumber}`)}
        </>
      ),
    },
    { clave: 'proveedor', encabezado: 'Proveedor' },
    { clave: 'original', encabezado: 'Original', alineacion: 'derecha', prioridad: 2, celda: (d) => dinero(d.originalAmount, d.currency) },
    {
      clave: 'disponible',
      encabezado: 'Disponible',
      alineacion: 'derecha',
      celda: (d) => <span data-testid="deposito-disponible">{dinero(d.availableAmount, d.currency)}</span>,
    },
    { clave: 'aplicado', encabezado: 'Aplicado', alineacion: 'derecha', prioridad: 3, celda: (d) => dinero(d.appliedAmount, d.currency) },
    { clave: 'estado', encabezado: 'Estado', celda: (d) => <ChipDeposito estado={d.status as SupplyV2DepositStatus} /> },
    { clave: 'fecha', encabezado: 'Fecha', prioridad: 2, celda: (d) => formatDate(d.createdAt) },
  ]
  return <Base caption="Depósitos a proveedores" columnas={columnas} filas={filas} claveDe={(d) => d.id} columnaIdentificadora="deposito" testId="tabla-depositos" testIdFila="deposito" pie={pie} />
}

// ── Obligaciones ────────────────────────────────────────────────────────────────────────────────────────────────────

export function TablaObligaciones({ filas, pie }: { filas: ObligacionFila[]; pie?: ReactNode }) {
  const columnas: Columna<ObligacionFila>[] = [
    {
      clave: 'proveedor',
      encabezado: 'Proveedor',
      celda: (o) => (
        <>
          <Link href={`/superadmin/supply/proveedores/${o.proveedorId}`} className={enlace}>
            {o.proveedor}
          </Link>
          {sub(o.number)}
        </>
      ),
    },
    {
      clave: 'origen',
      encabezado: 'Origen',
      prioridad: 2,
      celda: (o) => (
        <>
          {o.invoice ? (
            <Link href={`${RUTA_FINANZAS}/facturas/${o.invoice.id}`} className={enlace}>
              {o.origen}
            </Link>
          ) : (
            o.origen
          )}
          {sub(`${RECOGNITION_BASIS_LABELS[o.recognitionBasis as keyof typeof RECOGNITION_BASIS_LABELS]}${o.purchaseOrder ? ` · ${o.purchaseOrder.number}` : ''}`)}
        </>
      ),
    },
    { clave: 'monto', encabezado: 'Monto', alineacion: 'derecha', celda: (o) => dinero(o.grossAmount, o.currency) },
    { clave: 'pagado', encabezado: 'Pagado', alineacion: 'derecha', prioridad: 3, celda: (o) => dinero(o.paidAmount, o.currency) },
    {
      clave: 'pendiente',
      encabezado: 'Pendiente',
      alineacion: 'derecha',
      celda: (o) => <span data-testid="obligacion-pendiente">{dinero(o.outstandingAmount, o.currency)}</span>,
    },
    { clave: 'vence', encabezado: 'Vence', prioridad: 2, celda: (o) => (o.dueAt ? formatDate(o.dueAt) : '—') },
    { clave: 'estado', encabezado: 'Estado', celda: (o) => <ChipObligacion estado={o.status} /> },
  ]
  return <Base caption="Obligaciones con proveedores" columnas={columnas} filas={filas} claveDe={(o) => o.id} columnaIdentificadora="proveedor" testId="tabla-obligaciones" testIdFila="obligacion" pie={pie} />
}

// ── Pagos ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function TablaPagos({ filas, puedoConfirmar, pie }: { filas: PagoFila[]; puedoConfirmar: boolean; pie?: ReactNode }) {
  const columnas: Columna<PagoFila>[] = [
    {
      clave: 'pago',
      encabezado: 'Pago',
      celda: (p) => (
        <>
          <Link href={`${RUTA_FINANZAS}/pagos/${p.id}`} className={enlace} data-testid="link-pago">
            {p.number}
          </Link>
          {p.intendedInvoice && sub(`para ${p.intendedInvoice.number}`)}
          {p.intendedDeposit && sub('anticipo')}
        </>
      ),
    },
    { clave: 'proveedor', encabezado: 'Proveedor', prioridad: 2 },
    {
      clave: 'metodo',
      encabezado: 'Método',
      prioridad: 3,
      celda: (p) => SUPPLIER_PAYMENT_METHOD_LABELS[p.method as keyof typeof SUPPLIER_PAYMENT_METHOD_LABELS],
    },
    {
      clave: 'monto',
      encabezado: 'Monto',
      alineacion: 'derecha',
      celda: (p) => (
        <>
          {dinero(p.amount, p.currency)}
          {sub(`aplicado ${dinero(p.appliedAmount, p.currency)}`)}
        </>
      ),
    },
    { clave: 'fecha', encabezado: 'Fecha', prioridad: 2, celda: (p) => formatDate(p.paidAt) },
    { clave: 'referencia', encabezado: 'Referencia', prioridad: 3, celda: (p) => p.reference ?? '—' },
    { clave: 'aplicaciones', encabezado: 'Aplicaciones', alineacion: 'derecha', prioridad: 3, valor: (p) => p.aplicaciones, tipo: 'numero' },
    {
      clave: 'estado',
      encabezado: 'Estado',
      celda: (p) => (
        <div className="flex flex-wrap items-center gap-2">
          <ChipPagoProveedor estado={p.status} />
          {p.status === 'PENDING' && puedoConfirmar && <ConfirmarPago paymentId={p.id} soyElCreador={false} compacto />}
          {p.status === 'PENDING' && p.creadoPor && <span className="text-caption text-muted-foreground">registró {p.creadoPor}</span>}
        </div>
      ),
    },
  ]
  return <Base caption="Pagos a proveedores" columnas={columnas} filas={filas} claveDe={(p) => p.id} columnaIdentificadora="pago" testId="tabla-pagos" testIdFila="pago" pie={pie} />
}

// ── Liquidaciones ───────────────────────────────────────────────────────────────────────────────────────────────────

export function TablaLiquidaciones({ filas, pie }: { filas: LiquidacionFila[]; pie?: ReactNode }) {
  const columnas: Columna<LiquidacionFila>[] = [
    {
      clave: 'liquidacion',
      encabezado: 'Liquidación',
      celda: (l) => (
        <>
          <Link href={`${RUTA_LIQUIDACIONES}/${l.id}`} className={enlace} data-testid="link-liquidacion">
            {l.number}
          </Link>
          {sub(`${l.lineas} entrega(s) · ${SETTLEMENT_FREQUENCY_LABELS[l.frequency as keyof typeof SETTLEMENT_FREQUENCY_LABELS]}`)}
        </>
      ),
    },
    {
      clave: 'proveedor',
      encabezado: 'Proveedor',
      prioridad: 2,
      celda: (l) => (
        <Link href={`/superadmin/supply/proveedores/${l.proveedorId}`} className={enlace}>
          {l.proveedor}
        </Link>
      ),
    },
    { clave: 'periodo', encabezado: 'Periodo', prioridad: 2, celda: (l) => `${formatDate(l.periodStart)} – ${formatDate(l.periodEnd)}` },
    { clave: 'bruto', encabezado: 'Bruto', alineacion: 'derecha', prioridad: 3, celda: (l) => dinero(l.grossSales, l.currency) },
    { clave: 'comision', encabezado: 'Comisión', alineacion: 'derecha', prioridad: 3, celda: (l) => dinero(l.commissionAmount, l.currency) },
    { clave: 'neto', encabezado: 'Neto', alineacion: 'derecha', celda: (l) => <span className="font-medium">{dinero(l.supplierNet, l.currency)}</span> },
    { clave: 'pagado', encabezado: 'Pagado', alineacion: 'derecha', prioridad: 3, celda: (l) => dinero(l.paidAmount, l.currency) },
    {
      clave: 'pendiente',
      encabezado: 'Pendiente',
      alineacion: 'derecha',
      celda: (l) => <span data-testid="liquidacion-pendiente">{dinero(l.pendiente, l.currency)}</span>,
    },
    { clave: 'estado', encabezado: 'Estado', celda: (l) => <ChipLiquidacion estado={l.status as never} /> },
  ]
  return <Base caption="Liquidaciones a proveedores" columnas={columnas} filas={filas} claveDe={(l) => l.id} columnaIdentificadora="liquidacion" testId="tabla-liquidaciones" testIdFila="liquidacion" pie={pie} />
}

// ── Conciliaciones ──────────────────────────────────────────────────────────────────────────────────────────────────

type ConciliacionFila = Awaited<ReturnType<typeof listarConciliaciones>>['filas'][number]

export function TablaConciliaciones({ filas, pie }: { filas: ConciliacionFila[]; pie?: ReactNode }) {
  const columnas: Columna<ConciliacionFila>[] = [
    {
      clave: 'conciliacion',
      encabezado: 'Conciliación',
      celda: (r) => (
        <>
          <Link href={`${RUTA_FINANZAS}/conciliaciones/${r.id}`} className={enlace}>
            {r.number}
          </Link>
          {sub(`${RECONCILIATION_KIND_LABELS[r.kind]} · ${r.lineas} líneas`)}
        </>
      ),
    },
    { clave: 'proveedor', encabezado: 'Proveedor', prioridad: 2 },
    { clave: 'periodo', encabezado: 'Periodo', prioridad: 2, celda: (r) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` },
    { clave: 'membego', encabezado: 'Membego', alineacion: 'derecha', celda: (r) => dinero(r.internalAmount, r.currency) },
    {
      clave: 'delProveedor',
      encabezado: 'Proveedor',
      alineacion: 'derecha',
      celda: (r) =>
        r.supplierAmount ? dinero(r.supplierAmount, r.currency) : <span className="text-caption text-muted-foreground">{SIN_INFORMACION_DEL_PROVEEDOR}</span>,
    },
    { clave: 'diferencia', encabezado: 'Diferencia', alineacion: 'derecha', celda: (r) => (r.differenceAmount ? dinero(r.differenceAmount, r.currency) : '—') },
    { clave: 'estado', encabezado: 'Estado', celda: (r) => <ChipConciliacion estado={r.status} /> },
  ]
  return <Base caption="Conciliaciones con proveedores" columnas={columnas} filas={filas} claveDe={(r) => r.id} columnaIdentificadora="conciliacion" testId="tabla-conciliaciones" testIdFila="conciliacion" pie={pie} />
}
