import { PublicNav } from '@/components/public/PublicNav'
import { PublicFooter } from '@/components/public/PublicFooter'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'MembeGo - Descubre Beneficios Exclusivos',
  description: 'Accede a promociones y beneficios exclusivos de las mejores empresas',
}

/**
 * El layout de la LANDING: barra, contenido, pie. Nada más. La landing informa; no tiene carrito, ni proveedores de
 * estado de compra, ni cajones. Lo que se compra o se reserva vive en la app (`/cliente`).
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="theme-landing flex min-h-screen flex-col bg-background text-foreground">
      <PublicNav />
      <main className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}
