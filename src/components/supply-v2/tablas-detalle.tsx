import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { formatDate, formatDateTime } from '@/lib/format'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'
import { SIN_INFORMACION_DEL_PROVEEDOR } from '@/modules/supply-v2/finance/domain'
import { ChipObligacion } from './finanzas/chips'

/**
 * LAS TABLAS DE DETALLE DE SUPPLY EN LA `Tabla` DEL SISTEMA (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-15).
 *
 * Son las líneas y los movimientos que se ven al abrir una conciliación, una factura, una liquidación, un depósito, una compra,
 * una oferta, un lote o un proveedor: se muestran COMPLETOS (no hay paginación en un comprobante), ahora con título para el
 * lector de pantalla, `scope` y las cifras a la derecha. Los totales que iban en un `<tfoot>` van en el pie de la tabla.
 * Los `data-testid` que leen las pruebas de extremo a extremo se conservan todos.
 */

type Dinero = string | number | { toString(): string }
const dinero = (n: Dinero, moneda: string) => dineroSupplyV2(n, moneda)
/** Cómo se escribe un monto: cada pantalla de detalle tiene el suyo (con o sin decimales), y se respeta. */
type Formato = (n: Dinero, moneda: string) => string
const enlace = 'underline-offset-4 hover:underline'
const sub = (texto: ReactNode) => <span className="block text-caption text-muted-foreground">{texto}</span>
const numero = (n: number) => n.toLocaleString('es-DO')
const quien = (a: { name?: string | null; email?: string | null } | null | undefined, vacio: string) => a?.name ?? a?.email ?? vacio

// ── Conciliación: líneas ────────────────────────────────────────────────────────────────────────────────────────────

export interface LineaConciliacion {
  id: string
  occurredAt: Date | string
  type: string
  description: string
  internalAmount: Dinero
  supplierAmount: Dinero | null
}

export function TablaLineasConciliacion({ lineas, moneda, tipos }: { lineas: LineaConciliacion[]; moneda: string; tipos: Record<string, string> }) {
  const columnas: Columna<LineaConciliacion>[] = [
    { clave: 'fecha', encabezado: 'Fecha', celda: (l) => formatDate(l.occurredAt) },
    { clave: 'tipo', encabezado: 'Tipo', prioridad: 2, celda: (l) => tipos[l.type] ?? l.type },
    { clave: 'detalle', encabezado: 'Detalle', celda: (l) => l.description },
    { clave: 'membego', encabezado: 'Membego', alineacion: 'derecha', celda: (l) => dinero(l.internalAmount, moneda) },
    {
      clave: 'proveedor',
      encabezado: 'Proveedor',
      alineacion: 'derecha',
      celda: (l) => <span className="text-muted-foreground">{l.supplierAmount ? dinero(l.supplierAmount, moneda) : SIN_INFORMACION_DEL_PROVEEDOR}</span>,
    },
  ]
  return <Tabla caption="Líneas de la conciliación: lo de Membego frente a lo del proveedor" columnas={columnas} filas={lineas} claveDe={(l) => l.id} testId="conciliacion-lineas" />
}

// ── Factura: líneas ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface LineaFactura {
  id: string
  descriptionSnapshot: string
  quantity: number
  unitCost: Dinero
  taxes: Dinero
  total: Dinero
}

export function TablaLineasFactura({ lineas, moneda }: { lineas: LineaFactura[]; moneda: string }) {
  const columnas: Columna<LineaFactura>[] = [
    { clave: 'concepto', encabezado: 'Concepto', celda: (l) => l.descriptionSnapshot },
    { clave: 'cantidad', encabezado: 'Cantidad', alineacion: 'derecha', celda: (l) => numero(l.quantity) },
    { clave: 'costo', encabezado: 'Costo', alineacion: 'derecha', prioridad: 2, celda: (l) => dinero(l.unitCost, moneda) },
    { clave: 'impuestos', encabezado: 'Impuestos', alineacion: 'derecha', prioridad: 3, celda: (l) => dinero(l.taxes, moneda) },
    { clave: 'total', encabezado: 'Total', alineacion: 'derecha', celda: (l) => dinero(l.total, moneda) },
  ]
  return <Tabla caption="Líneas de la factura del proveedor" columnas={columnas} filas={lineas} claveDe={(l) => l.id} />
}

// ── Oferta y lote: el libro de movimientos de inventario ────────────────────────────────────────────────────────────

interface Actor {
  name?: string | null
  email?: string | null
}

export interface MovimientoOferta {
  id: string
  type: string
  lot: { code: string }
  sourceBucket: string | null
  destinationBucket: string | null
  quantity: number
  actor: Actor | null
  createdAt: Date | string
}

export function TablaLedgerOferta({ movimientos }: { movimientos: MovimientoOferta[] }) {
  const columnas: Columna<MovimientoOferta>[] = [
    { clave: 'tipo', encabezado: 'Tipo', celda: (e) => e.type },
    { clave: 'lote', encabezado: 'Lote', celda: (e) => e.lot.code },
    { clave: 'movimiento', encabezado: 'Movimiento', prioridad: 2, celda: (e) => <span className="text-caption text-muted-foreground">{e.sourceBucket ?? 'fuera'} → {e.destinationBucket ?? 'fuera'}</span> },
    { clave: 'cantidad', encabezado: 'Cantidad', alineacion: 'derecha', celda: (e) => numero(e.quantity) },
    { clave: 'usuario', encabezado: 'Usuario', prioridad: 2, celda: (e) => quien(e.actor, 'sistema') },
    { clave: 'fecha', encabezado: 'Fecha', celda: (e) => formatDateTime(e.createdAt) },
  ]
  return <Tabla caption="Movimientos de inventario de la oferta" columnas={columnas} filas={movimientos} claveDe={(e) => e.id} testId="oferta-ledger" />
}

export interface MovimientoLote {
  id: string
  type: string
  sourceBucket: string | null
  destinationBucket: string | null
  reason: string | null
  quantity: number
  balanceBefore: number
  balanceAfter: number
  actor: Actor | null
  createdAt: Date | string
}

export function TablaLedgerLote({ movimientos }: { movimientos: MovimientoLote[] }) {
  const columnas: Columna<MovimientoLote>[] = [
    { clave: 'tipo', encabezado: 'Tipo', celda: (a) => a.type },
    {
      clave: 'movimiento',
      encabezado: 'Movimiento',
      prioridad: 2,
      celda: (a) => (
        <span className="text-caption text-muted-foreground">
          {a.sourceBucket ?? 'fuera'} → {a.destinationBucket ?? 'fuera'}
          {a.reason ? ` · ${a.reason}` : ''}
        </span>
      ),
    },
    {
      clave: 'cantidad',
      encabezado: 'Cantidad',
      alineacion: 'derecha',
      celda: (a) => `${a.destinationBucket === 'AVAILABLE' && !a.sourceBucket ? '+' : ''}${numero(a.quantity)}`,
    },
    { clave: 'saldo', encabezado: 'Disponible antes → después', alineacion: 'derecha', celda: (a) => `${numero(a.balanceBefore)} → ${numero(a.balanceAfter)}` },
    { clave: 'usuario', encabezado: 'Usuario', prioridad: 2, celda: (a) => quien(a.actor, '—') },
    { clave: 'fecha', encabezado: 'Fecha', celda: (a) => formatDateTime(a.createdAt) },
  ]
  return <Tabla caption="Movimientos de inventario del lote" columnas={columnas} filas={movimientos} claveDe={(a) => a.id} testId="tabla-ledger" />
}

// ── Proveedor: su catálogo ──────────────────────────────────────────────────────────────────────────────────────────

export interface ProductoDeProveedor {
  id: string
  name: string
  category: string | null
  type: string
  sku: string | null
  publicPrice: Dinero | null
  currency: string
  status: string
}

export function TablaCatalogoProveedor({ productos, tipos, formato = dinero }: { productos: ProductoDeProveedor[]; tipos: Record<string, string>; formato?: Formato }) {
  const columnas: Columna<ProductoDeProveedor>[] = [
    {
      clave: 'producto',
      encabezado: 'Producto',
      celda: (i) => (
        <>
          <Link href={`/superadmin/supply/supply/${i.id}`} className={enlace}>
            {i.name}
          </Link>
          {i.category && sub(i.category)}
        </>
      ),
    },
    { clave: 'tipo', encabezado: 'Tipo', prioridad: 2, celda: (i) => tipos[i.type] ?? i.type },
    { clave: 'sku', encabezado: 'SKU', prioridad: 3, celda: (i) => <span className="font-mono text-caption">{i.sku ?? '—'}</span> },
    { clave: 'precio', encabezado: 'Precio público', alineacion: 'derecha', celda: (i) => (i.publicPrice == null ? '—' : formato(i.publicPrice, i.currency)) },
    { clave: 'estado', encabezado: 'Estado', celda: (i) => (i.status === 'ACTIVE' ? 'Activo' : 'Inactivo') },
  ]
  return <Tabla caption="Catálogo del proveedor" columnas={columnas} filas={productos} claveDe={(i) => i.id} testId="tabla-catalogo" />
}

// ── Producto: sus lotes ─────────────────────────────────────────────────────────────────────────────────────────────

export interface LoteDeProducto {
  id: string
  code: string
  quantityReceived: number
  quantityAvailable: number
  quantityAllocated: number
  quantityReserved: number
  quantityIssued: number
  quantityRedeemed: number
  unitCost: Dinero
  currency: string
  expiresAt: Date | string | null
  purchaseOrder: { id: string; number: string }
  receipt: { number: string }
  status: ReactNode
}

export function TablaLotesDelProducto({ lotes, formato = dinero }: { lotes: LoteDeProducto[]; formato?: Formato }) {
  const columnas: Columna<LoteDeProducto>[] = [
    {
      clave: 'lote',
      encabezado: 'Lote',
      celda: (l) => (
        <Link href={`/superadmin/supply/supply/lotes/${l.id}`} className={enlace}>
          {l.code}
        </Link>
      ),
    },
    { clave: 'recibidas', encabezado: 'Recibidas', alineacion: 'derecha', prioridad: 2, celda: (l) => numero(l.quantityReceived) },
    { clave: 'disponibles', encabezado: 'Disponibles', alineacion: 'derecha', celda: (l) => numero(l.quantityAvailable) },
    {
      clave: 'reparto',
      encabezado: 'Asig. · Res. · Emit. · Red.',
      alineacion: 'derecha',
      prioridad: 3,
      celda: (l) => `${l.quantityAllocated} · ${l.quantityReserved} · ${l.quantityIssued} · ${l.quantityRedeemed}`,
    },
    { clave: 'costo', encabezado: 'Costo', alineacion: 'derecha', prioridad: 3, celda: (l) => formato(l.unitCost, l.currency) },
    { clave: 'vence', encabezado: 'Vence', prioridad: 2, celda: (l) => (l.expiresAt ? formatDate(l.expiresAt) : '—') },
    {
      clave: 'orden',
      encabezado: 'Orden',
      prioridad: 2,
      celda: (l) => (
        <>
          <Link href={`/superadmin/supply/compras/${l.purchaseOrder.id}`} className={enlace}>
            {l.purchaseOrder.number}
          </Link>
          {sub(l.receipt.number)}
        </>
      ),
    },
    { clave: 'estado', encabezado: 'Estado', celda: (l) => l.status },
  ]
  return <Tabla caption="Lotes del producto" columnas={columnas} filas={lotes} claveDe={(l) => l.id} testId="tabla-lotes" />
}

// ── Liquidación: las entregas liquidadas ────────────────────────────────────────────────────────────────────────────

export interface LineaLiquidacion {
  id: string
  redemptionId: string | null
  descripcion: string
  obligationNumber: string
  grossAmount: Dinero
  contractualAmount: Dinero
  membegoSubsidyAmount: Dinero
  customerPaidAmount: Dinero
  commissionAmount: Dinero
  alreadyPaidAmount: Dinero
  supplierNet: Dinero
  paidAmount: Dinero
  obligationStatus: Parameters<typeof ChipObligacion>[0]['estado']
}

export function TablaLineasLiquidacion({ lineas, moneda }: { lineas: LineaLiquidacion[]; moneda: string }) {
  const derecha = (clave: string, encabezado: string, valor: (x: LineaLiquidacion) => Dinero, prioridad?: 2 | 3, negrita = false): Columna<LineaLiquidacion> => ({
    clave,
    encabezado,
    alineacion: 'derecha',
    prioridad,
    celda: (x) => <span className={negrita ? 'font-medium' : undefined}>{dinero(valor(x), moneda)}</span>,
  })
  const columnas: Columna<LineaLiquidacion>[] = [
    {
      clave: 'entrega',
      encabezado: 'Entrega',
      celda: (x) =>
        x.redemptionId ? (
          <Link href={`/superadmin/supply/redenciones/${x.redemptionId}`} className={enlace}>
            {x.descripcion}
          </Link>
        ) : (
          x.descripcion
        ),
    },
    { clave: 'obligacion', encabezado: 'Obligación', prioridad: 2, celda: (x) => <span className="font-mono text-caption">{x.obligationNumber}</span> },
    derecha('bruto', 'Bruto', (x) => x.grossAmount),
    derecha('contractual', 'Contractual', (x) => x.contractualAmount, 3),
    derecha('bono', 'Bono Membego', (x) => x.membegoSubsidyAmount, 3),
    derecha('cliente', 'Pagó el cliente', (x) => x.customerPaidAmount, 3),
    derecha('comision', 'Comisión', (x) => x.commissionAmount, 2),
    derecha('adelantado', 'Ya adelantado', (x) => x.alreadyPaidAmount, 3),
    derecha('neto', 'Neto', (x) => x.supplierNet, undefined, true),
    derecha('pagado', 'Pagado', (x) => x.paidAmount, 2),
    { clave: 'estado', encabezado: 'Estado', celda: (x) => <ChipObligacion estado={x.obligationStatus} /> },
  ]
  return <Tabla caption="Entregas incluidas en la liquidación, con lo que se le debe al proveedor" columnas={columnas} filas={lineas} claveDe={(x) => x.id} testId="liq-lineas" testIdFila="liq-linea" />
}

// ── Depósito: sus movimientos ───────────────────────────────────────────────────────────────────────────────────────

export interface MovimientoDeposito {
  id: string
  createdAt: Date | string
  type: string
  reason: string | null
  actor: Actor | null
  amount: { isNegative(): boolean; abs(): Dinero }
  balanceAfter: Dinero
  application: { invoice: { id: string; number: string } | null; obligation: { number: string } | null } | null
}

export function TablaMovimientosDeposito({
  movimientos,
  moneda,
  etiquetas,
  suma,
  rutaFacturas,
}: {
  movimientos: MovimientoDeposito[]
  moneda: string
  etiquetas: Record<string, string>
  /** La suma de los movimientos, que tiene que cuadrar con el saldo. */
  suma: Dinero
  rutaFacturas: string
}) {
  const columnas: Columna<MovimientoDeposito>[] = [
    { clave: 'fecha', encabezado: 'Fecha', celda: (m) => formatDateTime(m.createdAt) },
    { clave: 'movimiento', encabezado: 'Movimiento', celda: (m) => <span className="font-medium">{etiquetas[m.type] ?? m.type}</span> },
    {
      clave: 'detalle',
      encabezado: 'Detalle',
      prioridad: 2,
      celda: (m) => (
        <span className="text-caption text-muted-foreground">
          {m.application?.invoice && (
            <Link href={`${rutaFacturas}/${m.application.invoice.id}`} className={enlace}>
              {m.application.invoice.number}
            </Link>
          )}
          {m.application?.obligation && <span>{m.application.obligation.number}</span>}
          {m.reason ? ` ${m.reason}` : ''}
          {m.actor ? ` · ${m.actor.name ?? m.actor.email}` : ''}
        </span>
      ),
    },
    {
      clave: 'monto',
      encabezado: 'Monto',
      alineacion: 'derecha',
      celda: (m) => (
        <span className={m.amount.isNegative() ? 'text-destructive' : 'text-success'}>
          {m.amount.isNegative() ? '−' : '+'}
          {dinero(m.amount.abs(), moneda)}
        </span>
      ),
    },
    { clave: 'saldo', encabezado: 'Saldo después', alineacion: 'derecha', celda: (m) => dinero(m.balanceAfter, moneda) },
  ]
  return (
    <Tabla
      caption="Movimientos del depósito; su suma reconstruye el saldo"
      columnas={columnas}
      filas={movimientos}
      claveDe={(m) => m.id}
      testId="deposito-movimientos"
      pie={
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Suma de movimientos</span>
          <span className="font-medium tabular-nums text-foreground" data-testid="deposito-suma">
            {dinero(suma, moneda)}
          </span>
        </div>
      }
    />
  )
}

// ── Compra: sus líneas y totales ────────────────────────────────────────────────────────────────────────────────────

export interface LineaCompra {
  id: string
  descriptionSnapshot: string
  quantity: number
  receivedQuantity: number
  unitCost: Dinero
  subtotal: Dinero
}

export function TablaLineasCompra({
  lineas,
  moneda,
  subtotal,
  impuestos,
  porcentajeImpuesto,
  total,
  formato = dinero,
}: {
  lineas: LineaCompra[]
  formato?: Formato
  moneda: string
  subtotal: Dinero
  impuestos: Dinero
  porcentajeImpuesto: string
  total: Dinero
}) {
  const columnas: Columna<LineaCompra>[] = [
    { clave: 'producto', encabezado: 'Producto', celda: (l) => l.descriptionSnapshot },
    { clave: 'cantidad', encabezado: 'Cantidad', alineacion: 'derecha', prioridad: 2, celda: (l) => numero(l.quantity) },
    {
      clave: 'recibidas',
      encabezado: 'Recibidas',
      alineacion: 'derecha',
      celda: (l) => (
        <span data-testid="recibidas-linea">
          {numero(l.receivedQuantity)} / {numero(l.quantity)}
        </span>
      ),
    },
    { clave: 'costo', encabezado: 'Costo unitario', alineacion: 'derecha', prioridad: 3, celda: (l) => formato(l.unitCost, moneda) },
    { clave: 'subtotal', encabezado: 'Subtotal', alineacion: 'derecha', celda: (l) => formato(l.subtotal, moneda) },
  ]
  const fila = (texto: string, valor: ReactNode, fuerte = false) => (
    <div className={`flex items-baseline justify-between gap-6 py-0.5 ${fuerte ? 'text-foreground' : 'text-muted-foreground'}`}>
      <span>{texto}</span>
      <span className={fuerte ? 'text-h4 tabular-nums' : 'tabular-nums text-foreground'}>{valor}</span>
    </div>
  )
  return (
    <Tabla
      caption="Líneas de la orden de compra, con lo recibido de cada una"
      columnas={columnas}
      filas={lineas}
      claveDe={(l) => l.id}
      pie={
        <div className="ml-auto max-w-xs font-medium">
          {fila('Subtotal', formato(subtotal, moneda))}
          {fila(`Impuestos (${porcentajeImpuesto} %)`, formato(impuestos, moneda))}
          {fila('Total', <span data-testid="orden-total">{formato(total, moneda)}</span>, true)}
        </div>
      }
    />
  )
}
