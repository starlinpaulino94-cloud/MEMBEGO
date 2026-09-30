import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipAcuerdo, ChipOrden, ChipProveedor } from '@/components/supply-v2/chips'
import { DialogoFormulario } from '@/components/supply-v2/dialogo'
import { FormProducto, type VinculoExistente } from '@/components/supply-v2/form-producto'
import { FormAcuerdo } from '@/components/supply-v2/form-acuerdo'
import { fichaProveedor } from '@/modules/supply-v2/suppliers/queries'
import { perfilFinancieroProveedor } from '@/modules/supply-v2/finance/queries'
import { TimelineFinanciero } from '@/components/supply-v2/finanzas/timeline-financiero'
import { dineroSupplyV2, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'
import { AGREEMENT_TYPE_LABELS, CATALOG_ITEM_TYPE_LABELS, SUPPLIER_SOURCE_LABELS } from '@/modules/supply-v2/core/catalogo'
import { sinEmpresa } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY 2.0 · perfil del proveedor (§28–§31; Slice 4 §34): datos,
 * catálogo, acuerdos, compras, supply adquirido y su perfil financiero.
 */
export default async function ProveedorDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [p, fin] = await Promise.all([fichaProveedor(id), perfilFinancieroProveedor(id)])
  if (!p) notFound()

  // Lo que la empresa ya vende en Membego, para el vínculo opcional del producto.
  const existentes: VinculoExistente[] = p.companyId
    ? await sinEmpresa('Supply 2.0: catálogo Core de la empresa proveedora', async (tx) => {
        const [servicios, productos] = await Promise.all([
          tx.servicio.findMany({ where: { companyId: p.companyId!, activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
          tx.productoInventario.findMany({ where: { companyId: p.companyId!, activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
        ])
        return [
          ...servicios.map((s) => ({ id: s.id, nombre: s.nombre, tipo: 'SERVICIO' as const })),
          ...productos.map((x) => ({ id: x.id, nombre: x.nombre, tipo: 'PRODUCTO' as const })),
        ]
      })
    : []

  const productosParaAcuerdo = p.catalogItems.map((i) => ({ id: i.id, name: i.name }))
  const dinero = (n: { toString(): string } | null, moneda: string) =>
    n == null ? '—' : `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.commercialName}
        description={[SUPPLIER_SOURCE_LABELS[p.source], p.city, p.contactName, p.whatsapp ?? p.phone, p.email].filter(Boolean).join(' · ')}
        eyebrow={
          <Link href="/superadmin/supply-v2/proveedores" className="hover:underline">
            Proveedores
          </Link>
        }
        nav={<NavSupplyV2 activa="proveedores" />}
        action={<ChipProveedor estado={p.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Supply disponible" value={p.resumen.disponibles.toLocaleString('es-DO')} sub={`${p.resumen.recibidas.toLocaleString('es-DO')} recibidas`} />
        <StatCard label="Valor disponible" value={formatMoneyRD(p.resumen.valorDisponible)} accent="brand" />
        <StatCard label="Compras" value={p.purchaseOrders.length.toLocaleString('es-DO')} sub={`${p.agreements.filter((a) => a.status === 'ACTIVE').length} acuerdos vigentes`} />
      </div>

      {fin && (
        <Card data-testid="perfil-financiero">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Finanzas con este proveedor</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm"><Link href={`${RUTA_FINANZAS}/pagos/nuevo?proveedor=${p.id}&destino=DEPOSITO`}>+ Anticipo</Link></Button>
              <Button asChild variant="outline" size="sm"><Link href={`${RUTA_FINANZAS}/facturas/nueva?proveedor=${p.id}`} data-testid="btn-factura-proveedor">+ Factura</Link></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="Saldo a pagar" value={<span data-testid="fin-saldo">{dineroSupplyV2(fin.saldoAPagar, fin.currency)}</span>} accent={Number(fin.saldoAPagar) > 0 ? 'warning' : 'success'} />
              <StatCard label="Facturas pendientes" value={<span data-testid="fin-facturas">{fin.facturasPendientes.toLocaleString('es-DO')}</span>} sub={dineroSupplyV2(fin.facturasPendientesMonto, fin.currency)} href={`${RUTA_FINANZAS}/facturas?proveedor=${p.id}`} hrefLabel="Ver facturas" />
              <StatCard label="Depósito disponible" value={<span data-testid="fin-deposito">{dineroSupplyV2(fin.depositoDisponible, fin.currency)}</span>} href={`${RUTA_FINANZAS}/depositos?proveedor=${p.id}`} hrefLabel="Ver depósitos" />
              <StatCard label="Pagado histórico" value={<span data-testid="fin-pagado">{dineroSupplyV2(fin.pagadoHistorico, fin.currency)}</span>} href={`${RUTA_FINANZAS}/pagos?proveedor=${p.id}`} hrefLabel="Ver pagos" />
              <StatCard label="Supply adquirido" value={dineroSupplyV2(fin.supplyAdquirido, fin.currency)} sub={`${fin.unidadesAdquiridas.toLocaleString('es-DO')} unidades a costo real`} />
            </div>
            <div>
              <p className="mb-2 text-caption font-medium uppercase text-muted-foreground">Recorrido financiero</p>
              <TimelineFinanciero hitos={fin.timeline} moneda={fin.currency} vacio="Sin movimientos financieros todavía." testId="timeline-proveedor" />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Catálogo</CardTitle>
          <DialogoFormulario etiqueta="+ Agregar producto" titulo="Agregar producto" descripcion={`Lo que ${p.commercialName} puede vender o entregar a Membego.`} variant="outline" testId="btn-agregar-producto">
            <FormProducto supplierId={p.id} moneda={p.currency} existentes={existentes} />
          </DialogoFormulario>
        </CardHeader>
        <CardContent>
          {p.catalogItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin productos todavía. Agrega el primero para poder comprarle.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-catalogo">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Producto</th>
                    <th className="py-1 pr-3">Tipo</th>
                    <th className="py-1 pr-3">SKU</th>
                    <th className="py-1 pr-3 text-right">Precio público</th>
                    <th className="py-1">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {p.catalogItems.map((i) => (
                    <tr key={i.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">
                        <Link href={`/superadmin/supply-v2/supply/${i.id}`} className="underline-offset-4 hover:underline">
                          {i.name}
                        </Link>
                        {i.category && <span className="block text-caption text-muted-foreground">{i.category}</span>}
                      </td>
                      <td className="py-2 pr-3">{CATALOG_ITEM_TYPE_LABELS[i.type]}</td>
                      <td className="py-2 pr-3 font-mono text-caption">{i.sku ?? '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dinero(i.publicPrice, i.currency)}</td>
                      <td className="py-2">{i.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Acuerdos</CardTitle>
          {productosParaAcuerdo.length > 0 && (
            <DialogoFormulario etiqueta="+ Crear acuerdo" titulo="Crear acuerdo" descripcion="Las condiciones bajo las que Membego compra a este proveedor." variant="outline" testId="btn-crear-acuerdo">
              <FormAcuerdo supplierId={p.id} proveedorNombre={p.commercialName} productos={productosParaAcuerdo} moneda={p.currency} />
            </DialogoFormulario>
          )}
        </CardHeader>
        <CardContent>
          {p.agreements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {productosParaAcuerdo.length === 0 ? 'Primero agrega un producto; el acuerdo dice a qué costo se compra.' : 'Sin acuerdos todavía.'}
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="lista-acuerdos">
              {p.agreements.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {a.code} · {AGREEMENT_TYPE_LABELS[a.type]} · v{a.version}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {a.catalogItem?.name ?? a.category ?? 'Todo el catálogo'} · {a.negotiatedUnitCost ? `${dinero(a.negotiatedUnitCost, a.currency)} / unidad` : 'sin costo fijo'} · desde {formatDate(a.startsAt)}
                      {a.endsAt ? ` hasta ${formatDate(a.endsAt)}` : ''}
                      {a.paymentTermsDays != null ? ` · ${a.paymentTermsDays} días de pago` : ''}
                    </p>
                  </div>
                  <ChipAcuerdo estado={a.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Compras</CardTitle>
          <Button asChild variant="outline">
            <Link href="/superadmin/supply-v2/compras/nueva">+ Nueva compra</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {p.purchaseOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin compras todavía.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {p.purchaseOrders.map((o) => {
                const compradas = o.lines.reduce((t, l) => t + l.quantity, 0)
                const recibidas = o.lines.reduce((t, l) => t + l.receivedQuantity, 0)
                return (
                  <li key={o.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/superadmin/supply-v2/compras/${o.id}`} className="font-medium underline-offset-4 hover:underline">
                      {o.number}
                      <span className="ml-2 text-caption text-muted-foreground">
                        {recibidas.toLocaleString('es-DO')} / {compradas.toLocaleString('es-DO')} · {formatDate(o.createdAt)}
                      </span>
                    </Link>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums">{dinero(o.total, o.currency)}</span>
                      <ChipOrden estado={o.status} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
