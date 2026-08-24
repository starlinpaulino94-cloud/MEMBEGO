import { PublicNav } from '@/components/public/PublicNav'
import { PublicFooter } from '@/components/public/PublicFooter'
import { ExcursionCarritoWrapper } from '@/components/excursiones/ExcursionCarritoWrapper'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'MembeGo - Descubre Beneficios Exclusivos',
  description: 'Accede a promociones y beneficios exclusivos de las mejores empresas',
}

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="theme-landing flex min-h-screen flex-col bg-background text-foreground">
      <ExcursionCarritoWrapper>
        <PublicNav />
        <main className="flex-1">
          {children}
        </main>
        <PublicFooter />
      </ExcursionCarritoWrapper>
    </div>
  )
}
