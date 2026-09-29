import Link from 'next/link'
import { TabsNav } from '@/components/ui/tabs-nav'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · navegación inicial (§25): solo cuatro pestañas.
 * Ventas, QR, finanzas, campañas y reportes esperan al Slice 2.
 */
export const SECCIONES_SUPPLY_V2 = [
  { slug: '', label: 'Resumen' },
  { slug: 'compras', label: 'Compras' },
  { slug: 'proveedores', label: 'Proveedores' },
  { slug: 'supply', label: 'Supply' },
] as const

export type SeccionSupplyV2 = (typeof SECCIONES_SUPPLY_V2)[number]['slug']

export function hrefSupplyV2(slug: string): string {
  return slug ? `${BASE_SUPPLY_V2}/${slug}` : BASE_SUPPLY_V2
}

export function NavSupplyV2({ activa }: { activa: SeccionSupplyV2 }) {
  return (
    <TabsNav
      aria-label="Secciones de Supply 2.0"
      items={SECCIONES_SUPPLY_V2.map((s) => ({
        label: s.label,
        active: s.slug === activa,
        render: ({ className, children }) => (
          <Link key={s.slug} href={hrefSupplyV2(s.slug)} className={className} aria-current={s.slug === activa ? 'page' : undefined}>
            {children}
          </Link>
        ),
      }))}
    />
  )
}
