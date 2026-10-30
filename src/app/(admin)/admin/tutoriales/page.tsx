import { requireSection } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { GaleriaTutoriales } from '@/components/tutoriales/GaleriaTutoriales'
import { TUTORIALES } from '@/modules/tutoriales/catalogo'

export const metadata = { title: 'Tutoriales' }

/**
 * Tutoriales en video del panel: clips cortos, uno por tarea, con buscador y filtro por módulo. Los videos son los
 * mismos para todas las empresas y se sirven desde Storage; aquí no hay datos del negocio.
 */
export default async function TutorialesPage({ searchParams }: { searchParams: Promise<{ q?: string; t?: string }> }) {
  const user = await requireSection('tutoriales')
  if (!user) return <p className="text-sm text-muted-foreground">No tienes permisos para ver esta sección.</p>
  const { q, t } = await searchParams
  const total = TUTORIALES.reduce((s, x) => s + x.duracionS, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tutoriales"
        description={`Cómo se hace cada cosa en el panel, en videos cortos. ${TUTORIALES.length} tutoriales, ${Math.round(total / 60)} minutos en total.`}
      />
      <GaleriaTutoriales consultaInicial={q ?? ''} abiertoInicial={t ?? null} />
    </div>
  )
}
