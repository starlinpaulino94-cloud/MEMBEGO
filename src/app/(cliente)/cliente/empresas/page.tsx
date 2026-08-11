import Link from 'next/link'
import { Store, AlertCircle, Search } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getMisEmpresas } from '@/modules/social/queries'
import { MisEmpresasList } from '@/components/cliente/MisEmpresasList'
import { EmptyState } from '@/components/system/EmptyState'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function MisEmpresasPage() {
  const user = await requireRole('CLIENTE')

  let empresas: Awaited<ReturnType<typeof getMisEmpresas>> = []
  let loadError = false
  try {
    empresas = await getMisEmpresas(user.metadata.dbUserId)
  } catch (e) {
    loadError = true
    console.error('[cliente-empresas]', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis empresas"
        description="Donde eres cliente y las que sigues. Sus promociones y novedades te llegan solas."
        action={
          <Button asChild variant="outline">
            <Link href="/cliente/explorar">
              <Search aria-hidden /> Descubrir empresas
            </Link>
          </Button>
        }
      />

      {loadError ? (
        <EmptyState
          icon={AlertCircle}
          title="No pudimos cargar tus empresas"
          description="Hubo un problema de conexión. Vuelve a intentarlo en unos segundos."
          action={
            <Button asChild variant="outline">
              <Link href="/cliente/empresas">Reintentar</Link>
            </Button>
          }
        />
      ) : empresas.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Todavía no tienes negocios"
          description="Aquí aparecerán los negocios donde eres cliente y los que sigas para recibir sus promociones."
          action={
            <Button asChild size="lg">
              <Link href="/cliente/explorar">Explorar empresas</Link>
            </Button>
          }
        />
      ) : (
        <MisEmpresasList empresas={empresas} />
      )}
    </div>
  )
}
