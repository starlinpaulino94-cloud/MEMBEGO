import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { planPrefill } from '@/modules/admin/plantillas'
import { PlanForm } from '@/components/admin/PlanForm'
import { PageHeader } from '@/components/ui/page-header'
import { valoresDePlanNuevo, valoresDePlantilla } from '@/modules/planes/formulario'
import { LayoutTemplate } from 'lucide-react'

export default async function NuevoPlanEmpresaPage({
  searchParams,
}: {
  searchParams: Promise<{ plantilla?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  // La subida de la imagen ocurre antes de guardar, así que la empresa tiene
  // que llegar al formulario: es el primer segmento de la ruta del archivo.
  const companyId = await requireCompanyContext(user)
  const { plantilla } = await searchParams

  // Fase E3: al llegar desde la galería, se copia la configuración de la
  // plantilla como valores iniciales. El plan creado es independiente.
  const prefill = plantilla ? planPrefill(plantilla) : null

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/planes" className="text-muted-foreground hover:text-foreground">
            ‹ Planes
          </Link>
        }
        title="Nuevo plan"
        description="Define un plan de membresía para tus clientes (ej. Silver, Gold, Premium, VIP)."
      />

      {prefill && (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <LayoutTemplate className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-info">
              Basado en la plantilla &laquo;{prefill.plantillaNombre}&raquo;
            </p>
            <p className="text-info">
              Es una copia tuya: ajusta precio, beneficios y condiciones antes de
              guardar. La plantilla original no se modifica.{' '}
              <Link href="/admin/planes/plantillas" className="underline">
                Elegir otra plantilla
              </Link>
            </p>
          </div>
        </div>
      )}

      <PlanForm
        modo="crear"
        redirectTo="/admin/planes"
        companyId={companyId}
        inicial={prefill ? valoresDePlantilla(prefill) : valoresDePlanNuevo()}
      />
    </div>
  )
}
