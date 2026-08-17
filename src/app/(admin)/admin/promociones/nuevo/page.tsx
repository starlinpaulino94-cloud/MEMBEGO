import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { promocionPrefill } from '@/modules/admin/plantillas'
import { PromocionForm } from '@/components/admin/PromocionForm'
import { LayoutTemplate } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function NuevaPromocionPage({
  searchParams,
}: {
  searchParams: Promise<{ plantilla?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  // Empresa activa del selector (respeta la selección del superadmin), para que
  // el selector de campañas se llene con las campañas de esa empresa.
  const companyId = await resolveCompanyId(user)
  const { plantilla } = await searchParams

  // Fase E3: al llegar desde la galería, se copia la configuración de la
  // plantilla como valores iniciales. El recurso creado es independiente.
  const prefill = plantilla ? promocionPrefill(plantilla) : null

  const campanas = companyId
    ? await conEmpresaOTodas(
      companyId,
      'promociones · nuevo: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.campana.findMany({
          where: { companyId, activo: true },
          select: { id: true, nombre: true },
          orderBy: { createdAt: 'desc' },
        })
    )
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Nueva promoción</h1>
        <p className="text-muted-foreground">
          Se notificará automáticamente a tus seguidores al publicarla.
        </p>
      </div>

      {prefill && (
        <div className="flex max-w-2xl items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
          <LayoutTemplate className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-info">
              Basada en la plantilla &laquo;{prefill.plantillaNombre}&raquo;
            </p>
            <p className="text-info">
              Es una copia tuya: puedes editar todos los campos antes de publicar.
              La plantilla original no se modifica.{' '}
              <Link href="/admin/promociones/plantillas" className="underline">
                Elegir otra plantilla
              </Link>
            </p>
          </div>
        </div>
      )}

      <PromocionForm campanas={campanas} prefill={prefill ?? undefined} companyId={companyId} />
    </div>
  )
}
