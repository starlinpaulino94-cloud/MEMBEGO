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

export default async function NuevaOfertaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  if (!(await puedeFuncion('deals', 'crear'))) redirect('/admin/deals')

  const sp = await searchParams
  const opciones = await conEmpresa(companyId, (tx) => opcionesParaOfertaEnTx(tx, companyId))

  // «Crear promoción» desde la ficha de un producto llega con `?variante=` (o `?item=`):
  // se preselecciona SOLO si la variante es ofertable por esta empresa (lo que llega por
  // la URL es texto libre; una variante ajena o no publicada se ignora sin decir nada).
  const preseleccion =
    opciones.productos.find((p) => p.id === sp.variante)?.id ??
    opciones.productos.find((p) => p.itemId === sp.item)?.id ??
    ''
  const elegido = opciones.productos.find((p) => p.id === preseleccion)

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
      {(sp.variante || sp.item) && !elegido && (
        <Alert>
          <AlertDescription>Ese producto no se puede ofertar todavía: tiene que estar publicado y visible en el marketplace. Elige otro o publícalo primero.</AlertDescription>
        </Alert>
      )}
      <OfertaForm
        productos={opciones.productos}
        cuota={opciones.cuota}
        moneda={opciones.currency ?? 'DOP'}
        inicial={elegido ? { catalogVariantId: elegido.id, title: `Oferta en ${elegido.etiqueta}` } : undefined}
      />
    </div>
  )
}
