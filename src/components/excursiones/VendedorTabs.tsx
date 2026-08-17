'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TabsNav } from '@/components/ui/tabs-nav'

/** Las tres cosas que un vendedor mira: su QR, sus ventas y su dinero. */
const TABS = [
  { href: '/vendedor', label: 'Mi QR', exacto: true },
  { href: '/vendedor/reservas', label: 'Mis reservas', exacto: false },
  { href: '/vendedor/comisiones', label: 'Mi dinero', exacto: false },
]

export function VendedorTabs() {
  const pathname = usePathname()
  return (
    <TabsNav
      aria-label="Secciones de mi panel"
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
