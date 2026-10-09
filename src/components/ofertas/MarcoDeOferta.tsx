import type { ReactNode } from 'react'

/** El marco de las pantallas del regalo de una empresa (`/oferta/<código>`), igual en la landing y en la app. */
export function MarcoDeOferta({ children }: { children: ReactNode }) {
  return (
    <main className="container flex min-h-[70vh] max-w-lg items-center py-10">
      <div className="w-full rounded-2xl border border-border/70 bg-card p-8 text-center shadow-premium">
        {children}
      </div>
    </main>
  )
}
