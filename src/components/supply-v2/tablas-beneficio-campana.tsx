import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { formatDate, formatDateTime } from '@/lib/format'
import { BENEFIT_MOVEMENT_LABELS, CAMPAIGN_EVENT_LABELS, dineroSupplyV2, RUTA_COMPRAS_CLIENTE } from '@/modules/supply-v2/core/catalogo'
import { CancelarAsignacion, ReversarAplicacion } from './acciones-beneficio'
import { CancelarCupon } from './acciones-campana'
import { ChipAsignacion, ChipCupon, ChipReservaBeneficio, ChipTipoCupon } from './chips'

/**
 * LAS TABLAS DE LA FICHA DE UN BENEFICIO, DE UNA CAMPAÑA Y DE LA PREVISTA DE UNA LIQUIDACIÓN, EN LA `Tabla` DEL SISTEMA
 * (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-15).
 *
 * Las celdas con botones (cancelar una asignación, reversar una aplicación, cancelar un cupón) siguen siendo componentes de
 * cliente dentro de la celda; la tabla es de servidor. Los `data-testid` que leen las pruebas de extremo a extremo se conservan.
 */

const enlace = 'underline-offset-4 hover:underline'
const sub = (texto: ReactNode, clase = 'text-muted-foreground') => <span className={`block text-caption ${clase}`}>{texto}</span>
type Dinero = string | number | { toString(): string }

// ── Beneficio ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AsignacionDeBeneficio {
  id: string
  cliente: string
  email: string | null
  status: Parameters<typeof ChipAsignacion>[0]['estado']
  usesConsumed: number
  usesAllowed: number
  expiresAt: Date | string | null
  note: string | null
  grantedAt: Date | string
  otorgadoPor: string | null
}

export function TablaAsignaciones({ asignaciones, benefitId, puedeCancelar }: { asignaciones: AsignacionDeBeneficio[]; benefitId: string; puedeCancelar: boolean }) {
  const columnas: Columna<AsignacionDeBeneficio>[] = [
    {
      clave: 'cliente',
      encabezado: 'Cliente',
      celda: (g) => (
        <>
          {g.cliente}
          {g.email && sub(g.email)}
        </>
      ),
    },
    { clave: 'estado', encabezado: 'Estado', celda: (g) => <ChipAsignacion estado={g.status} /> },
    { clave: 'usos', encabezado: 'Usos', alineacion: 'derecha', celda: (g) => `${g.usesConsumed} / ${g.usesAllowed}` },
    { clave: 'vence', encabezado: 'Vence', prioridad: 2, celda: (g) => (g.expiresAt ? formatDate(g.expiresAt) : '—') },
    { clave: 'nota', encabezado: 'Nota', prioridad: 3, celda: (g) => <span className="text-muted-foreground">{g.note ?? '—'}</span> },
    {
      clave: 'otorgado',
      encabezado: 'Otorgado',
      prioridad: 2,
      celda: (g) => (
        <>
          {formatDate(g.grantedAt)}
          {g.otorgadoPor && sub(g.otorgadoPor)}
        </>
      ),
    },
    {
      clave: 'acciones',
      encabezado: 'Acciones',
      soloLector: true,
      celda: (g) => (puedeCancelar && g.status === 'AVAILABLE' ? <CancelarAsignacion benefitId={benefitId} customerBenefitId={g.id} /> : null),
    },
  ]
  return <Tabla caption="Clientes que tienen este beneficio" columnas={columnas} filas={asignaciones} claveDe={(g) => g.id} testId="tabla-asignaciones" />
}

export interface UsoDeBeneficio {
  id: string
  orderId: string
  orderNumber: string
  cliente: string
  status: string
  quantity: number
  supplierAmount: string
  membegoAmount: string
  createdAt: Date | string
  appliedAt: Date | string | null
  reversedReason: string | null
}

export function TablaUsosBeneficio({ usos, benefitId, moneda, puedeCancelar }: { usos: UsoDeBeneficio[]; benefitId: string; moneda: string; puedeCancelar: boolean }) {
  const columnas: Columna<UsoDeBeneficio>[] = [
    {
      clave: 'compra',
      encabezado: 'Compra',
      celda: (u) => (
        <Link href={`${RUTA_COMPRAS_CLIENTE}/${u.orderId}`} className={`font-mono text-caption ${enlace}`}>
          {u.orderNumber}
        </Link>
      ),
    },
    { clave: 'cliente', encabezado: 'Cliente', prioridad: 2, celda: (u) => u.cliente },
    { clave: 'estado', encabezado: 'Estado', celda: (u) => <ChipReservaBeneficio estado={u.status as Parameters<typeof ChipReservaBeneficio>[0]['estado']} /> },
    { clave: 'unidades', encabezado: 'Unid.', tipo: 'numero', prioridad: 3, valor: (u) => u.quantity },
    { clave: 'proveedor', encabezado: 'Descuento del proveedor', alineacion: 'derecha', prioridad: 2, celda: (u) => dineroSupplyV2(u.supplierAmount, moneda) },
    { clave: 'membego', encabezado: 'Bono de Membego', alineacion: 'derecha', prioridad: 2, celda: (u) => dineroSupplyV2(u.membegoAmount, moneda) },
    {
      clave: 'cuando',
      encabezado: 'Cuándo',
      celda: (u) => (
        <>
          {formatDateTime(u.createdAt)}
          {u.appliedAt && sub(`Aplicado ${formatDateTime(u.appliedAt)}`)}
          {u.reversedReason && sub(`Reversado: ${u.reversedReason}`, 'text-destructive')}
        </>
      ),
    },
    {
      clave: 'acciones',
      encabezado: 'Acciones',
      soloLector: true,
      celda: (u) => (puedeCancelar && u.status === 'APPLIED' ? <ReversarAplicacion benefitId={benefitId} reservationId={u.id} /> : null),
    },
  ]
  return <Tabla caption="Compras en las que se usó el beneficio" columnas={columnas} filas={usos} claveDe={(u) => u.id} testId="tabla-usos-beneficio" />
}

export interface MovimientoDeBeneficio {
  id: string
  createdAt: Date | string
  type: string
  reservedDelta: string
  consumedDelta: string
  reservedAfter: string
  consumedAfter: string
  reason: string | null
  actor: string | null
}

export function TablaMovimientosBeneficio({ movimientos, moneda }: { movimientos: MovimientoDeBeneficio[]; moneda: string }) {
  const d = (n: string) => dineroSupplyV2(n, moneda)
  const columnas: Columna<MovimientoDeBeneficio>[] = [
    { clave: 'cuando', encabezado: 'Cuándo', celda: (m) => formatDateTime(m.createdAt) },
    { clave: 'movimiento', encabezado: 'Movimiento', celda: (m) => BENEFIT_MOVEMENT_LABELS[m.type as keyof typeof BENEFIT_MOVEMENT_LABELS] ?? m.type },
    { clave: 'reservado', encabezado: 'Reservado', alineacion: 'derecha', celda: (m) => d(m.reservedDelta) },
    { clave: 'consumido', encabezado: 'Consumido', alineacion: 'derecha', celda: (m) => d(m.consumedDelta) },
    { clave: 'reservadoDespues', encabezado: 'Reservado después', alineacion: 'derecha', prioridad: 3, celda: (m) => d(m.reservedAfter) },
    { clave: 'consumidoDespues', encabezado: 'Consumido después', alineacion: 'derecha', prioridad: 3, celda: (m) => d(m.consumedAfter) },
    { clave: 'motivo', encabezado: 'Motivo', prioridad: 2, celda: (m) => <span className="text-muted-foreground">{m.reason ?? '—'}</span> },
    { clave: 'quien', encabezado: 'Quién', prioridad: 2, celda: (m) => m.actor ?? 'Sistema' },
  ]
  return <Tabla caption="Movimientos del presupuesto del beneficio" columnas={columnas} filas={movimientos} claveDe={(m) => m.id} testId="tabla-movimientos-beneficio" />
}

// ── Campaña ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CuponDeCampana {
  id: string
  code: string
  kind: Parameters<typeof ChipTipoCupon>[0]['kind']
  cliente: string | null
  promocion: string
  timesRedeemed: number
  maxRedemptions: number | null
  maxPerCustomer: number
  minPurchase: string | null
  expiresAt: Date | string | null
  status: Parameters<typeof ChipCupon>[0]['estado']
}

export function TablaCupones({ cupones, campaignId, moneda, puedeCupones }: { cupones: CuponDeCampana[]; campaignId: string; moneda: string; puedeCupones: boolean }) {
  const columnas: Columna<CuponDeCampana>[] = [
    { clave: 'codigo', encabezado: 'Código', celda: (k) => <span className="font-mono font-medium" data-testid="cupon-codigo">{k.code}</span> },
    { clave: 'tipo', encabezado: 'Tipo', prioridad: 2, celda: (k) => <ChipTipoCupon kind={k.kind} /> },
    { clave: 'cliente', encabezado: 'Cliente', prioridad: 2, celda: (k) => k.cliente ?? '—' },
    { clave: 'promocion', encabezado: 'Promoción', prioridad: 3, celda: (k) => k.promocion },
    {
      clave: 'usos',
      encabezado: 'Usos',
      alineacion: 'derecha',
      celda: (k) => (
        <span data-testid="cupon-usos">
          {k.timesRedeemed} / {k.maxRedemptions ?? '∞'}
          {sub(`${k.maxPerCustomer} por cliente`)}
        </span>
      ),
    },
    { clave: 'minima', encabezado: 'Compra mínima', alineacion: 'derecha', prioridad: 3, celda: (k) => (k.minPurchase ? dineroSupplyV2(k.minPurchase, moneda) : '—') },
    { clave: 'vence', encabezado: 'Vence', prioridad: 2, celda: (k) => (k.expiresAt ? formatDate(k.expiresAt) : '—') },
    { clave: 'estado', encabezado: 'Estado', celda: (k) => <ChipCupon estado={k.status} /> },
    {
      clave: 'acciones',
      encabezado: 'Acciones',
      soloLector: true,
      celda: (k) => (puedeCupones && k.status === 'ACTIVE' ? <CancelarCupon campaignId={campaignId} couponId={k.id} /> : null),
    },
  ]
  return <Tabla caption="Cupones de la campaña" columnas={columnas} filas={cupones} claveDe={(k) => k.id} columnaIdentificadora="codigo" testId="tabla-cupones" />
}

export interface EventoDeCampana {
  id: string
  createdAt: Date | string
  type: string
  detail: string | null
  actor: string | null
}

export function TablaHistorialCampana({ eventos }: { eventos: EventoDeCampana[] }) {
  const columnas: Columna<EventoDeCampana>[] = [
    { clave: 'cuando', encabezado: 'Cuándo', celda: (e) => formatDateTime(e.createdAt) },
    { clave: 'que', encabezado: 'Qué pasó', celda: (e) => CAMPAIGN_EVENT_LABELS[e.type as keyof typeof CAMPAIGN_EVENT_LABELS] ?? e.type },
    { clave: 'detalle', encabezado: 'Detalle', prioridad: 2, celda: (e) => <span className="text-muted-foreground">{e.detail ?? '—'}</span> },
    { clave: 'quien', encabezado: 'Quién', prioridad: 2, celda: (e) => e.actor ?? 'Sistema' },
  ]
  return <Tabla caption="Historial de la campaña" columnas={columnas} filas={eventos} claveDe={(e) => e.id} testId="historial-campana" />
}

// ── Liquidación: lo que se va a generar ─────────────────────────────────────────────────────────────────────────────

export interface EntregaPrevista {
  id: string
  redemptionNumber: string | null
  number: string
  producto: string
  cliente: string
  redeemedAt: Date | string
  gross: Dinero
  commission: Dinero
  net: Dinero
}

export function TablaPrevistaLiquidacion({
  entregas,
  moneda,
  bruto,
  comision,
  neto,
}: {
  entregas: EntregaPrevista[]
  moneda: string
  bruto: Dinero
  comision: Dinero
  neto: Dinero
}) {
  const columnas: Columna<EntregaPrevista>[] = [
    { clave: 'entrega', encabezado: 'Entrega', celda: (e) => e.redemptionNumber ?? e.number },
    {
      clave: 'producto',
      encabezado: 'Producto · cliente',
      celda: (e) => (
        <>
          {e.producto}
          {sub(e.cliente)}
        </>
      ),
    },
    { clave: 'fecha', encabezado: 'Fecha', prioridad: 2, celda: (e) => formatDate(e.redeemedAt) },
    { clave: 'bruto', encabezado: 'Bruto', alineacion: 'derecha', prioridad: 2, celda: (e) => dineroSupplyV2(e.gross, moneda) },
    { clave: 'comision', encabezado: 'Comisión', alineacion: 'derecha', prioridad: 2, celda: (e) => dineroSupplyV2(e.commission, moneda) },
    { clave: 'neto', encabezado: 'Neto', alineacion: 'derecha', celda: (e) => dineroSupplyV2(e.net, moneda) },
  ]
  return (
    <Tabla
      caption="Entregas que entrarían en la liquidación, con su bruto, su comisión y su neto"
      columnas={columnas}
      filas={entregas}
      claveDe={(e) => e.id}
      testId="preview-liquidacion"
      pie={
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-medium text-foreground">
          <span>{entregas.length} entrega(s)</span>
          <span className="tabular-nums">Bruto {dineroSupplyV2(bruto, moneda)}</span>
          <span className="tabular-nums">Comisión {dineroSupplyV2(comision, moneda)}</span>
          <span className="tabular-nums" data-testid="preview-neto">
            {dineroSupplyV2(neto, moneda)}
          </span>
        </div>
      }
    />
  )
}
