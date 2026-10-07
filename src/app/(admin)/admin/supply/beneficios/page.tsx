import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { ChipBeneficio, ChipFinanciacion } from '@/components/supply-v2/chips'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { beneficiosDelProveedor } from '@/modules/supply-v2/benefits/queries'
import { BENEFIT_VALUE_TYPE_LABELS, dineroSupplyV2, RUTA_PORTAL_PROVEEDOR, RUTA_PORTAL_VENTAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Beneficios Membego · proveedor' }

/**
 * MEMBEGO SUPPLY · SLICE 6 · BENEFICIOS vistos por el PROVEEDOR (§32).
 *
 * Lo que el proveedor necesita saber y nada más: qué beneficio afecta a sus
 * ofertas, cuánto pone él, cuánto pone Membego y qué valor contractual se le
 * reconoce. El bono de Membego se nombra como de Membego: nunca se presenta
 * como un descuento suyo ni se le resta del neto. El presupuesto de la
 * campaña y la economía interna de Membego no aparecen aquí.
 */
export default async function BeneficiosProveedorPage() {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect('/admin/dashboard')
  const beneficios = await beneficiosDelProveedor(proveedor.supplierId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beneficios Membego"
        description={`Promociones que afectan a las ofertas de ${proveedor.supplierName}. Lo que financia Membego no sale de tu neto; lo que financias tú se descuenta del valor contractual.`}
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Entregas Membego</Link>}
      />
      <Card>
        <CardHeader><CardTitle>Beneficios vigentes y pasados</CardTitle></CardHeader>
        <CardContent>
          {beneficios.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="beneficios-proveedor-vacios">
              Ninguna promoción de Membego afecta a tus ofertas ahora mismo.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="beneficios-proveedor">
              {beneficios.map((b) => (
                <li key={b.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="beneficio-proveedor">
                  <span>
                    <span className="block font-medium">{b.name}</span>
                    <span className="block font-mono text-caption text-muted-foreground">{b.code} · {b.alcance}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <ChipFinanciacion funding={b.funding} />
                      <ChipBeneficio estado={b.status} />
                    </span>
                    <span className="block text-caption text-muted-foreground">
                      {formatDate(b.startsAt)}{b.endsAt ? ` → ${formatDate(b.endsAt)}` : ' → sin vencimiento'} · {BENEFIT_VALUE_TYPE_LABELS[b.valueType]}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block font-medium" data-testid="beneficio-prov-aporte">
                      {b.funding === 'MEMBEGO'
                        ? 'No pones nada'
                        : `Pones ${b.valueType === 'PERCENTAGE' ? `${b.miAporte} %` : dineroSupplyV2(b.miAporte, b.currency)}`}
                    </span>
                    {b.funding !== 'SUPPLIER' && (
                      <span className="block text-caption text-muted-foreground" data-testid="beneficio-prov-membego">
                        Membego pone {b.valueType === 'PERCENTAGE' ? `${b.aporteMembego} %` : dineroSupplyV2(b.aporteMembego, b.currency)}
                      </span>
                    )}
                    <span className="block text-caption text-muted-foreground">
                      {b.ventas.toLocaleString('es-DO')} venta(s) · valor contractual {dineroSupplyV2(b.valorContractual, b.currency)}
                    </span>
                    {Number(b.descuentoAsumido) > 0 && (
                      <span className="block text-caption text-muted-foreground">Descuento que asumiste: {dineroSupplyV2(b.descuentoAsumido, b.currency)}</span>
                    )}
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
