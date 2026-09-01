'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const tabs = [
  { href: '/admin/crm', label: 'Pipeline', exact: true },
  { href: '/admin/crm/seguimientos', label: 'Seguimientos' },
  { href: '/admin/crm/configuracion', label: 'Configuración' },
]

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="text-overline">Gestión de prospectos</p>
        <h1 className="text-h1 mt-1">CRM</h1>
      </div>

      {/* Tab navigation */}
      <nav className="flex gap-1 rounded-xl border border-border bg-card p-1">
        {tabs.map((tab) => {
          const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'rounded-lg px-4 py-2 text-small font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {children}
    </div>
  )
}
