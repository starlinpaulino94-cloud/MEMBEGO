import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'
import { ChipRedencion } from '@/components/supply-v2/chips'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { entregasDelProveedor, type VentanaDias } from '@/modules/supply-v2/redemption/queries'
import { RUTA_PORTAL_CANJES, RUTA_PORTAL_ESCANER, RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Canjes · Proveedor Membego' }

const VENTANAS: { dias: VentanaDias; label: string }[] = [
  { dias: 0, label: 'Hoy' },
  { dias: 7, label: '7 días' },
  { dias: 30, label: '30 días' },
]

/** SUPPLIER & FULFILLMENT COMMERCE · Canjes del proveedor: las entregas hechas (§6). */
export default async function CanjesProveedorPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const sp = await searchParams
  const dias = (([0, 7, 30] as VentanaDias[]).find((d) => String(d) === sp.dias) ?? 7) as VentanaDias
  const entregas = await entregasDelProveedor(proveedor.supplierId, dias)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Canjes"
        description="Cada beneficio de Membego que entregaste: quién, qué, dónde y cuándo."
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Proveedor Membego</Link>}
        action={<Button asChild><Link href={RUTA_PORTAL_ESCANER}>Escanear</Link></Button>}
      />
      <nav className="flex gap-1 text-sm" aria-label="Periodo">
        {VENTANAS.map((v) => (
          <Link
            key={v.dias}
            href={`${RUTA_PORTAL_CANJES}?dias=${v.dias}`}
            className={`rounded-full px-3 py-1 ${v.dias === dias ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            aria-current={v.dias === dias ? 'page' : undefined}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent className="pt-6">
          {entregas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin canjes en este periodo.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="canjes">
              {entregas.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="canje">
                  <span>
                    <span className="font-mono text-caption text-muted-foreground">{formatDateTime(e.redeemedAt)} · {e.number}</span>
                    <span className="block font-medium">{e.producto}</span>
                    <span className="block text-caption text-muted-foreground">
                      {e.cliente} · entregado por {e.empleado}
                      {e.sucursal ? ` · ${e.sucursal}` : ''}
                    </span>
                  </span>
                  <ChipRedencion reversada={e.reversada} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
