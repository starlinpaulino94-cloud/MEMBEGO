import { requireRole } from '@/lib/auth/guards'
import { getNovedadesInicio } from '@/modules/social/queries'
import { FeedNovedades } from '@/components/cliente/FeedNovedades'
import { EmptyState } from '@/components/system/EmptyState'
import { Bell } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Novedades',
  description: 'Lo último de los negocios que sigues',
}

/**
 * NOVEDADES — pantalla propia (rediseño violeta, 2026-09-10).
 *
 * El feed de las empresas seguidas vivía al fondo del Inicio; el diseño
 * nuevo no lo trae ahí y la campana de la cabecera necesitaba un destino
 * real. Misma pieza (`FeedNovedades`, filas densas), misma consulta.
 */
export default async function NovedadesPage() {
  const user = await requireRole('CLIENTE')
  const novedades = user.metadata.dbUserId
    ? await getNovedadesInicio(user.metadata.dbUserId, 12).catch(() => [])
    : []

  if (novedades.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="Sin novedades por ahora"
        description="Sigue a tus negocios favoritos y aquí verás sus promociones, eventos y noticias."
        action={
          <Link
            href="/cliente/explorar"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-label-lg text-primary-foreground transition-colors duration-fast hover:bg-brand-primary-hover"
          >
            Explorar empresas
          </Link>
        }
      />
    )
  }

  return (
    <div className="animate-fade-up">
      <FeedNovedades novedades={[...novedades]} />
    </div>
  )
}
