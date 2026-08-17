import { redirect } from 'next/navigation'
import { Compass } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { ExcursionesTabs } from '@/components/excursiones/ExcursionesTabs'

/**
 * Cáscara del módulo de Excursiones: título + navegación secundaria. La
 * guardia vive aquí una sola vez — capacidad EXCURSIONES y permisos del
 * empleado deciden si el módulo entero se abre.
 */
export default async function ExcursionesLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSection('excursiones')
  if (!user) redirect('/admin/dashboard')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-h1 text-foreground">
          <Compass className="h-7 w-7 text-primary" /> Excursiones
        </h1>
        <ExcursionesTabs />
      </div>
      {children}
    </div>
  )
}
