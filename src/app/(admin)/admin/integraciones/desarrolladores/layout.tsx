import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { NavDesarrolladores } from '@/components/connect/NavDesarrolladores'

/**
 * EL HUB DE DESARROLLADORES · marco común (Connect · Fase 11).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN LAYOUT Y NO CUATRO CABECERAS
 *
 * Las migas de pan, el título y las pestañas viven aquí una sola vez. Repetirlos
 * en cada página los habría dejado desincronizarse a la tercera semana, que es
 * exactamente lo que le pasó a la página anterior: se llegaba por un botón, sin
 * camino de vuelta y sin saber en qué parte de la aplicación se estaba.
 *
 * LA GUARDIA TAMBIÉN VIVE AQUÍ, y además en cada página. No es redundancia
 * inútil: un layout de Next.js no es una frontera de seguridad —no se ejecuta
 * antes que todo en cada navegación— así que cada página vuelve a exigir
 * `requireSection`. Esto es comodidad; la autorización real está abajo.
 */
export default async function DesarrolladoresLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')

  return (
    <div className="space-y-6">
      <nav aria-label="Ruta" className="flex flex-wrap items-center gap-1 text-caption">
        <Link href="/admin/integraciones" className="text-muted-foreground hover:text-foreground">
          Integraciones
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">Desarrolladores</span>
      </nav>

      <PageHeader
        title="Desarrolladores"
        description="Conecta Membego con tu propio sistema: consulta tus datos con una clave de API y recibe avisos cuando algo pasa."
      />

      <NavDesarrolladores />

      {children}
    </div>
  )
}
