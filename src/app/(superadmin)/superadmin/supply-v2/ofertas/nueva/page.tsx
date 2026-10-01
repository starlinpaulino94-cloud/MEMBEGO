import Link from 'next/link'
import { Package, Percent } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { WizardOferta } from '@/components/supply-v2/wizard-oferta'
import { WizardOfertaComision } from '@/components/supply-v2/wizard-oferta-comision'
import { productosParaOferta, productosParaOfertaComision } from '@/modules/supply-v2/offers/queries'
import { OFFER_SOURCE_EXPLICACION, OFFER_SOURCE_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crear oferta · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · crear oferta. Slice 5 (§63): primero se elige la FUENTE:
 * supply adquirido (aparta un lote) o vender a comisión (sin lote; el
 * proveedor sigue siendo dueño del inventario).
 */
export default async function NuevaOfertaPage({ searchParams }: { searchParams: Promise<{ producto?: string; fuente?: string }> }) {
  await requireRole('SUPERADMIN')
  const { producto, fuente } = await searchParams
  if (fuente === 'COMMISSION') {
    const productos = await productosParaOfertaComision()
    return (
      <div className="space-y-6">
        <PageHeader
          title="Vender a comisión"
          description="Producto → disponibilidad → precio → vigencia → reglas → publicar. Sin lote: el acuerdo a comisión del producto fija el reparto."
          eyebrow={<Link href="/superadmin/supply-v2/ofertas/nueva" className="hover:underline">Crear oferta</Link>}
          nav={<NavSupplyV2 activa="ofertas" />}
        />
        <WizardOfertaComision productos={productos} productoInicial={producto} />
      </div>
    )
  }
  if (fuente === 'PREPURCHASED_SUPPLY' || producto) {
    const productos = await productosParaOferta()
    return (
      <div className="space-y-6">
        <PageHeader
          title="Crear oferta con supply adquirido"
          description="Producto → cantidad → precio → vigencia → reglas → publicar. Las unidades se apartan al publicar."
          eyebrow={<Link href="/superadmin/supply-v2/ofertas/nueva" className="hover:underline">Crear oferta</Link>}
          nav={<NavSupplyV2 activa="ofertas" />}
        />
        <WizardOferta productos={productos} productoInicial={producto} />
      </div>
    )
  }
  const opciones = [
    { fuente: 'PREPURCHASED_SUPPLY', icon: Package, testid: 'fuente-supply' },
    { fuente: 'COMMISSION', icon: Percent, testid: 'fuente-comision' },
  ] as const
  return (
    <div className="space-y-6">
      <PageHeader
        title="Crear oferta"
        description="¿De dónde sale lo que vas a vender?"
        eyebrow={<Link href="/superadmin/supply-v2/ofertas" className="hover:underline">Ofertas</Link>}
        nav={<NavSupplyV2 activa="ofertas" />}
      />
      <div className="grid gap-4 sm:grid-cols-2" data-testid="elegir-fuente">
        {opciones.map((o) => (
          <Link key={o.fuente} href={`/superadmin/supply-v2/ofertas/nueva?fuente=${o.fuente}`} className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted/40" data-testid={o.testid}>
            <o.icon className="mb-3 size-6 text-primary" aria-hidden />
            <p className="text-h4">{OFFER_SOURCE_LABELS[o.fuente]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{OFFER_SOURCE_EXPLICACION[o.fuente]}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
