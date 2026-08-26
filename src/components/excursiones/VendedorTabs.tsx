'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TabsNav } from '@/components/ui/tabs-nav'

/** Las cuatro cosas que un vendedor mira: su QR, sus reservas, su dinero y sus metas. */
const TABS = [
  { href: '/vendedor', label: 'Mi QR & Enlace', exacto: true },
  { href: '/vendedor/reservas', label: 'Mis reservas', exacto: false },
  { href: '/vendedor/comisiones', label: 'Mi dinero', exacto: false },
  { href: '/vendedor/metas', label: 'Mis metas', exacto: false },
]

export function VendedorTabs() {
  const pathname = usePathname()
  return (
    <div className="overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
      <TabsNav
        aria-label="Secciones de mi panel"
        items={TABS.map((t) => ({
          label: t.label,
          active: t.exacto ? pathname === t.href : pathname.startsWith(t.href),
          render: ({ className, children }) => (
            <Link key={t.href} href={t.href} className={`${className} whitespace-nowrap text-xs sm:text-sm font-semibold`}>
              {children}
            </Link>
          ),
        }))}
      />
    </div>
  )
}
