'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TabsNav } from '@/components/ui/tabs-nav'

const TABS = [
  { href: '/admin/crm', label: 'Prospectos', exacto: true },
  { href: '/admin/crm/metricas', label: 'Métricas', exacto: false },
  { href: '/admin/crm/seguimientos', label: 'Seguimientos', exacto: false },
  { href: '/admin/crm/configuracion', label: 'Configuración', exacto: false },
]

export function CrmTabs() {
  const pathname = usePathname()
  return (
    <TabsNav
      aria-label="Secciones de CRM"
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
