import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getActiveCategories } from '@/modules/empresas/queries'
import { getAdminsVinculables } from '@/modules/empresas/accesos'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmpresaCreateForm } from '@/components/superadmin/EmpresaCreateForm'

export const dynamic = 'force-dynamic'

export default async function NuevaEmpresaPage() {
  await requireRole('SUPERADMIN')
  const [categories, admins] = await Promise.all([
    getActiveCategories(),
    getAdminsVinculables(),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-4 animate-fade-up">
      <Link
        href="/superadmin/empresas"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a empresas
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Nueva empresa</CardTitle>
        </CardHeader>
        <CardContent>
          <EmpresaCreateForm categories={categories} admins={admins} />
        </CardContent>
      </Card>
    </div>
  )
}
