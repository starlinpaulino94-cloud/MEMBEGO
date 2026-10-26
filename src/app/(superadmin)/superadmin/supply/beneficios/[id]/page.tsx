import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { TablaAsignaciones, TablaUsosBeneficio, TablaMovimientosBeneficio } from '@/components/supply-v2/tablas-beneficio-campana'
import { ChipBeneficio, ChipFinanciacion } from '@/components/supply-v2/chips'
import { AccionesBeneficio } from '@/components/supply-v2/acciones-beneficio'
import { FormAsignarBeneficio } from '@/components/supply-v2/form-asignar-beneficio'
import { fichaBeneficio } from '@/modules/supply-v2/benefits/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import {
  BENEFIT_FUNDING_EXPLICACION,
  BENEFIT_SCOPE_LABELS,
  BENEFIT_VALUE_TYPE_LABELS,
  dineroSupplyV2,
  RUTA_BENEFICIOS,
} from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY · SLICE 6 · ficha de un BENEFICIO (§29).
 *
 * Cuatro cosas en una pantalla: qué es y en qué estado está, qué quedó del
 * presupuesto (con el ledger que lo explica), a quién se le asignó y en qué
 * compras se usó. La economía se lee sin interpretar: lo que Membego
 * subsidió, lo que el proveedor descontó, el valor contractual de esas
 * ventas, lo que se le cobró al cliente y la comisión que entró.
 */
export default async function BeneficioPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [b, puedeAprobar, puedeEditar, puedeCancelar, puedeAsignar] = await Promise.all([
    fichaBeneficio(id),
    puedeSupplyV2('SUPPLY_V2_BENEFIT_APPROVE'),
    puedeSupplyV2('SUPPLY_V2_BENEFIT_CREATE'),
    puedeSupplyV2('SUPPLY_V2_BENEFIT_CANCEL'),
    puedeSupplyV2('SUPPLY_V2_BENEFIT_ASSIGN'),
  ])
  if (!b) notFound()
  const dinero = (n: string) => dineroSupplyV2(n, b.currency)
  const valor =
    b.valueType === 'PERCENTAGE'
      ? `${b.funding !== 'SUPPLIER' ? `Membego ${b.membegoValue} %` : ''}${b.funding === 'SHARED' ? ' · ' : ''}${b.funding !== 'MEMBEGO' ? `Proveedor ${b.supplierValue} %` : ''}`
      : `${b.funding !== 'SUPPLIER' ? `Membego ${dinero(b.membegoValue)}` : ''}${b.funding === 'SHARED' ? ' · ' : ''}${b.funding !== 'MEMBEGO' ? `Proveedor ${dinero(b.supplierValue)}` : ''}`
  const asignable = b.status === 'ACTIVE' || b.status === 'DRAFT' || b.status === 'PAUSED'

  return (
    <div className="space-y-6">
      <PageHeader
        title={b.name}
        description={`${b.code} · ${BENEFIT_SCOPE_LABELS[b.scope]}: ${b.alcance}`}
        eyebrow={
          <Link href={RUTA_BENEFICIOS} className="hover:underline">
            Beneficios
          </Link>
        }
        nav={<NavSupplyV2 activa="beneficios" />}
        action={<ChipBeneficio estado={b.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Qué rebaja y a quién</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ChipFinanciacion funding={b.funding} />
              <span className="text-sm text-muted-foreground">{BENEFIT_FUNDING_EXPLICACION[b.funding]}</span>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="beneficio-ficha">
              <Dato k="Valor" v={valor} />
              <Dato k="Tipo de valor" v={BENEFIT_VALUE_TYPE_LABELS[b.valueType]} />
              {b.maxMembegoAmount && <Dato k="Tope de la parte de Membego" v={dinero(b.maxMembegoAmount)} />}
              {b.maxSupplierAmount && <Dato k="Tope de la parte del proveedor" v={dinero(b.maxSupplierAmount)} />}
              <Dato k="Aplica a" v={`${BENEFIT_SCOPE_LABELS[b.scope]}: ${b.alcance}`} />
              {b.proveedor && <Dato k="Proveedor" v={b.proveedor} />}
              <Dato k="Vigencia" v={`${formatDate(b.startsAt)}${b.endsAt ? ` → ${formatDate(b.endsAt)}` : ' → sin vencimiento'}`} />
              <Dato k="Usos por cliente" v={String(b.perCustomerLimit)} />
              <Dato k="Asignación" v={b.requiresAssignment ? 'Solo clientes asignados' : 'Cualquier cliente'} />
              <Dato k="Moneda" v={b.currency} />
              <Dato k="Creado por" v={b.creadoPor} />
              <Dato k="Aprobado por" v={b.aprobadoPor ? `${b.aprobadoPor}${b.approvedAt ? ` · ${formatDateTime(b.approvedAt)}` : ''}` : 'Pendiente de aprobación'} />
            </dl>
            {b.objective && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Objetivo: </span>{b.objective}</p>}
            {b.description && <p className="text-sm text-muted-foreground">{b.description}</p>}
            {b.cancelledAt && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="beneficio-cancelado">
                Cancelado el {formatDateTime(b.cancelledAt)}. Motivo: {b.cancelledReason ?? '—'}
              </p>
            )}
            <AccionesBeneficio benefitId={b.id} estado={b.status} puedeAprobar={puedeAprobar} puedeEditar={puedeEditar} puedeCancelar={puedeCancelar} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Presupuesto de Membego</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {b.funding === 'SUPPLIER' ? (
              <p className="text-sm text-muted-foreground">Este beneficio lo financia el proveedor: no consume presupuesto de Membego.</p>
            ) : (
              <>
                <dl className="space-y-1 text-sm">
                  <Fila k="Total" v={b.budgetTotal ? dinero(b.budgetTotal) : 'Sin tope'} />
                  <Fila k="Reservado (checkouts en curso)" v={dinero(b.budgetReserved)} testid="ficha-reservado" />
                  <Fila k="Consumido (aplicado)" v={dinero(b.budgetConsumed)} testid="ficha-consumido" />
                  <Fila k="Disponible" v={b.budgetDisponible ? dinero(b.budgetDisponible) : 'Sin tope'} destacado testid="ficha-disponible" />
                </dl>
                <p className={`text-caption ${b.ledger.cuadra ? 'text-muted-foreground' : 'text-destructive'}`} data-testid="beneficio-ledger-cuadra">
                  {b.ledger.cuadra
                    ? `El libro de movimientos cuadra con estas cifras (${dinero(b.ledger.reserved)} reservados y ${dinero(b.ledger.consumed)} consumidos).`
                    : `El libro de movimientos dice ${dinero(b.ledger.reserved)} reservados y ${dinero(b.ledger.consumed)} consumidos: revisa, no cuadra.`}
                </p>
              </>
            )}
            <dl className="space-y-1 border-t border-border pt-2 text-sm" data-testid="beneficio-economia">
              <Fila k="Compras con el beneficio aplicado" v={b.economia.ordenes.toLocaleString('es-DO')} />
              <Fila k="Subsidio de Membego aplicado" v={dinero(b.economia.subsidioAplicado)} />
              <Fila k="Descuento asumido por el proveedor" v={dinero(b.economia.descuentoProveedor)} />
              <Fila k="Valor contractual de esas ventas" v={dinero(b.economia.valorContractual)} />
              <Fila k="Cobrado al cliente" v={dinero(b.economia.cobradoAlCliente)} />
              <Fila k="Comisión de Membego" v={dinero(b.economia.comision)} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {puedeAsignar && asignable && (
        <Card>
          <CardHeader><CardTitle>Asignar a un cliente</CardTitle></CardHeader>
          <CardContent>
            <FormAsignarBeneficio benefitId={b.id} perCustomerLimit={b.perCustomerLimit} hasta={b.endsAt ? b.endsAt.toISOString().slice(0, 10) : null} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Clientes con este beneficio ({b.asignaciones.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {b.asignaciones.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Nadie lo tiene todavía. Mientras no se asigne, nadie puede usarlo.</p>
          ) : (
            <TablaAsignaciones asignaciones={b.asignaciones} benefitId={b.id} puedeCancelar={puedeCancelar} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Usos en compras ({b.usos.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {b.usos.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Ninguna compra lo ha usado todavía.</p>
          ) : (
            <TablaUsosBeneficio usos={b.usos} benefitId={b.id} moneda={b.currency} puedeCancelar={puedeCancelar} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Libro de movimientos del presupuesto</CardTitle></CardHeader>
        <CardContent className="p-0">
          <TablaMovimientosBeneficio movimientos={b.movimientos} moneda={b.currency} />
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  )
}

function Fila({ k, v, destacado = false, testid }: { k: string; v: string; destacado?: boolean; testid?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={`text-right tabular-nums ${destacado ? 'text-h4' : 'font-medium'}`} data-testid={testid}>{v}</dd>
    </div>
  )
}
