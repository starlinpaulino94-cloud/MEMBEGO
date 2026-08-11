import Link from 'next/link'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getActiveCategories } from '@/modules/empresas/queries'
import { getAdminsVinculables } from '@/modules/empresas/accesos'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmpresaCreateForm } from '@/components/superadmin/EmpresaCreateForm'
import { verticalesElegibles } from '@/modules/empresas/verticales'

export const dynamic = 'force-dynamic'

export default async function NuevaEmpresaDemoPage() {
  await requireRole('SUPERADMIN')
  const [categories, admins, verticales] = await Promise.all([
    getActiveCategories(),
    getAdminsVinculables(),
    verticalesElegibles(),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-4 animate-fade-up">
      <Link
        href="/superadmin/demo"
        className="inline-flex items-center gap-1.5 text-small text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a demostración
      </Link>

      <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-small text-foreground">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Esta empresa nace marcada como <strong>de práctica</strong>: no cobrará con tarjeta, no
          enviará correos, no saldrá en el directorio público y sus números no contarán en las
          estadísticas de la plataforma. Todo lo demás funciona igual que en una empresa real.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nueva empresa de práctica</CardTitle>
        </CardHeader>
        <CardContent>
          <EmpresaCreateForm categories={categories} admins={admins} demo verticales={verticales} />
        </CardContent>
      </Card>
    </div>
  )
}
