import Link from 'next/link'
import { TabsNav } from '@/components/ui/tabs-nav'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · navegación (§25, §42, §63; Slice 4 §33, §68): diez pestañas.
 * Los reportes avanzados esperan a slices posteriores.
 */
export const SECCIONES_SUPPLY_V2 = [
  { slug: '', label: 'Resumen' },
  { slug: 'compras', label: 'Compras' },
  { slug: 'proveedores', label: 'Proveedores' },
  { slug: 'supply', label: 'Supply' },
  { slug: 'ofertas', label: 'Ofertas' },
  { slug: 'redenciones', label: 'Redenciones' },
  // Slice 6
  { slug: 'beneficios', label: 'Beneficios' },
  // Slice 7
  { slug: 'campanas', label: 'Campañas' },
  // Slice 4
  { slug: 'finanzas', label: 'Finanzas' },
  { slug: 'economia', label: 'Economía' },
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
