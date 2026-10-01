import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { ChipCampana, ChipFinanciacion } from '@/components/supply-v2/chips'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { campanasDelProveedor } from '@/modules/supply-v2/campaigns/queries'
import { dineroSupplyV2, RUTA_PORTAL_PROVEEDOR, RUTA_PORTAL_VENTAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Campañas Membego · proveedor' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · CAMPAÑAS vistas por el PROVEEDOR (§22).
 *
 * Lo que el proveedor necesita y nada más: en qué campañas participa, cuánto
 * pone él y cuánto pone Membego —por separado, nunca mezclado—, sus ventas
 * atribuibles, el descuento que asumió, su neto contractual y el estado de las
 * entregas. El presupuesto de Membego y la economía interna no aparecen, y
 * desde aquí no se puede cambiar ninguna condición financiera.
 */
export default async function CampanasProveedorPage() {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect('/admin/dashboard')
  const campanas = await campanasDelProveedor(proveedor.supplierId)
  const propuestas = campanas.filter((c) => c.esPropuestaMia)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas Membego"
        description={`Campañas en las que participan las ofertas de ${proveedor.supplierName}. Lo que financia Membego no sale de tu neto; lo que financias tú se descuenta del valor contractual.`}
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Entregas Membego</Link>}
      />

      {propuestas.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Tus propuestas</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm" data-testid="propuestas-proveedor">
              {propuestas.map((c) => (
                <li key={c.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="block font-mono text-caption text-muted-foreground">{c.code}</span>
                    {c.reviewNotes && <span className="block text-caption text-warning" data-testid="propuesta-revision">Membego pide corregir: {c.reviewNotes}</span>}
                  </span>
                  <ChipCampana estado={c.status} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-muted-foreground">
              Una propuesta queda pendiente de revisión cuando necesita que Membego la publique o la financie. Membego decide si se publica y con qué condiciones.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Campañas que afectan a tus ofertas</CardTitle></CardHeader>
        <CardContent>
          {campanas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="campanas-proveedor-vacias">
              Ninguna campaña de Membego afecta a tus ofertas ahora mismo.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="campanas-proveedor">
              {campanas.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="campana-proveedor">
                  <span>
                    <span className="block font-medium">{c.name}</span>
                    <span className="block font-mono text-caption text-muted-foreground">{c.code} · {c.misOfertas} oferta(s) tuya(s)</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <ChipFinanciacion funding={c.funding} />
                      <ChipCampana estado={c.status} />
                    </span>
                    <span className="block text-caption text-muted-foreground">
                      {formatDate(c.startsAt)}{c.endsAt ? ` → ${formatDate(c.endsAt)}` : ' → sin fin'}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block font-medium" data-testid="campana-prov-aporte">
                      {c.funding === 'MEMBEGO' ? 'No pones nada' : `Pones hasta ${c.aporteEsPorcentaje ? `${c.miAporte} %` : dineroSupplyV2(c.miAporte, c.currency)} por venta`}
                    </span>
                    {c.funding !== 'SUPPLIER' && (
                      <span className="block text-caption text-muted-foreground" data-testid="campana-prov-membego">
                        Membego pone hasta {c.aporteEsPorcentaje ? `${c.aporteMembego} %` : dineroSupplyV2(c.aporteMembego, c.currency)} por venta
                      </span>
                    )}
                    <span className="block text-caption text-muted-foreground" data-testid="campana-prov-ventas">
                      {c.ventasConfirmadas} venta(s) · valor contractual {dineroSupplyV2(c.valorContractual, c.currency)}
                    </span>
                    {Number(c.descuentoAsumido) > 0 && (
                      <span className="block text-caption text-muted-foreground">Descuento que asumiste: {dineroSupplyV2(c.descuentoAsumido, c.currency)}</span>
                    )}
                    <span className="block text-caption text-muted-foreground" data-testid="campana-prov-neto">
                      Neto contractual: {dineroSupplyV2(c.netoContractual, c.currency)}
                    </span>
                    <span className="block text-caption text-muted-foreground">
                      {c.entregasPendientes} por entregar · {c.entregasHechas} entregada(s)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-caption text-muted-foreground">
            Tu neto se calcula sobre el valor contractual de cada venta. Un bono de Membego baja lo que paga el cliente, no lo que Membego te debe. Ver <Link href={RUTA_PORTAL_VENTAS} className="underline underline-offset-4">tus ventas</Link>.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
