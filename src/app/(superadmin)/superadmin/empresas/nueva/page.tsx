import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getActiveCategories } from '@/modules/empresas/queries'
import { getAdminsVinculables } from '@/modules/empresas/accesos'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmpresaCreateForm } from '@/components/superadmin/EmpresaCreateForm'
import { verticalesElegibles } from '@/modules/empresas/verticales'

export const dynamic = 'force-dynamic'

export default async function NuevaEmpresaPage() {
  await requireRole('SUPERADMIN')
  const [categories, admins, verticales] = await Promise.all([
    getActiveCategories(),
    getAdminsVinculables(),
    verticalesElegibles(),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-4 animate-fade-up">
      <Link
        href="/superadmin/empresas"
        className="inline-flex items-center gap-1.5 text-small text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a empresas
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Nueva empresa</CardTitle>
        </CardHeader>
        <CardContent>
          <EmpresaCreateForm categories={categories} admins={admins} verticales={verticales} />
        </CardContent>
      </Card>
    </div>
  )
}
