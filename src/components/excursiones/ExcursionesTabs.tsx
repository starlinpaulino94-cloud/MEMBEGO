'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TabsNav } from '@/components/ui/tabs-nav'

/**
 * Navegación secundaria del módulo de Excursiones (§4: UNA entrada en el
 * sidebar; las vistas internas viven aquí). Las pestañas aparecen según las
 * fases publicadas — nada de puertas pintadas a pantallas que no existen.
 */
const TABS = [
  { href: '/admin/excursiones', label: 'Resumen', exacto: true },
  { href: '/admin/excursiones/catalogo', label: 'Catálogo', exacto: false },
  { href: '/admin/excursiones/vendedores', label: 'Vendedores', exacto: false },
]

export function ExcursionesTabs() {
  const pathname = usePathname()
  return (
    <TabsNav
      aria-label="Secciones de Excursiones"
      items={TABS.map((t) => ({
        label: t.label,
        active: t.exacto ? pathname === t.href : pathname.startsWith(t.href),
        render: ({ className, children }) => (
          <Link key={t.href} href={t.href} className={className}>
            {children}
          </Link>
        ),
      }))}
    />
  )
}
