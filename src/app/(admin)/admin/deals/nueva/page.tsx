import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { opcionesParaOfertaEnTx } from '@/modules/deals/queries'
import { OfertaForm } from '@/components/deals/OfertaForm'

export const dynamic = 'force-dynamic'

export default async function NuevaOfertaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  if (!(await puedeFuncion('deals', 'crear'))) redirect('/admin/deals')

  const opciones = await conEmpresa(companyId, (tx) => opcionesParaOfertaEnTx(tx, companyId))

  return (
    <div className="space-y-6">
      <Link href="/admin/deals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />
        Ofertas
      </Link>
      <PageHeader title="Nueva oferta" description="Elige qué ofreces, cuánto descuentas y cuánto estás dispuesto a pagar por traer clientes. Queda como borrador hasta que la publiques." />
      {opciones.suspendida && (
        <Alert variant="destructive">
          <AlertDescription>Tu cuenta Membego está suspendida: no puedes crear ofertas hasta ponerte al día.</AlertDescription>
        </Alert>
      )}
      <OfertaForm productos={opciones.productos} cuota={opciones.cuota} moneda={opciones.currency ?? 'DOP'} />
    </div>
  )
}
