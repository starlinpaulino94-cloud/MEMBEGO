import { requireRole } from '@/lib/auth/guards'
import { MapaCercaDeMi } from '@/components/geo/MapaCercaDeMi'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Cerca de mí',
  description: 'Descubre negocios y ofertas cerca de ti',
}

export default async function CercaPage() {
  const user = await requireRole('CLIENTE')

  return (
    <main className="container max-w-7xl py-6">
      <header className="animate-fade-up mb-4">
        <h1 className="text-h1 text-foreground">Cerca de mí</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Negocios y ofertas a tu alrededor. Muévete en el mapa para explorar.
        </p>
      </header>
      <MapaCercaDeMi userId={user.metadata.dbUserId} />
    </main>
  )
}
