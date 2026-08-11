import Link from 'next/link'
import { sinEmpresa } from '@/lib/tenant'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import {
  getActiveCategories,
  getCompanyCategoryIds,
} from '@/modules/empresas/queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmpresaEditForm } from '@/components/superadmin/EmpresaEditForm'
import { verticalesElegibles } from '@/modules/empresas/verticales'

export const dynamic = 'force-dynamic'

export default async function EditarEmpresaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const company = await sinEmpresa(
    'empresas · editar: el superadmin edita cualquier empresa',
    (tx) => tx.company.findUnique({ where: { id } })
  )
  if (!company) notFound()

  const [verticales, categories, selectedCategoryIds] = await Promise.all([
    verticalesElegibles(),
    getActiveCategories(),
    getCompanyCategoryIds(company.id),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-4 animate-fade-up">
      <Link
        href={`/superadmin/empresas/${company.id}`}
        className="inline-flex items-center gap-1.5 text-small text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver al dashboard
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Editar {company.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmpresaEditForm
            verticales={verticales}
            company={{
              id: company.id,
              name: company.name,
              type: company.type,
              tipoNegocioCodigo: company.tipoNegocioCodigo,
              description: company.description,
              logoUrl: company.logoUrl,
              email: company.email,
              telefono: company.telefono,
              direccion: company.direccion,
              ciudad: company.ciudad,
              categoria: company.categoria,
              website: company.website,
            }}
            categories={categories}
            selectedCategoryIds={selectedCategoryIds}
          />
        </CardContent>
      </Card>
    </div>
  )
}
