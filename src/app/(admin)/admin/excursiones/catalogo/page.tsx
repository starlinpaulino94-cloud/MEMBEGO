import Link from 'next/link'
import { Plus, Map } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listadoExcursiones } from '@/modules/excursiones/catalogo/queries'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import { CatalogoLista } from '@/components/excursiones/CatalogoLista'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Catálogo de excursiones' }

export default async function CatalogoPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el catálogo de excursiones" />

  const excursionesRaw = await listadoExcursiones(companyId)
  const excursiones = excursionesRaw.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    variantes: e.variantes.map((v) => ({ ...v, precioAdulto: Number(v.precioAdulto) })),
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Lo que tu empresa vende: cada excursión con sus variantes, precios y horarios.
        </p>
        <Button asChild>
          <Link href="/admin/excursiones/catalogo/nueva">
            <Plus className="mr-1.5 h-4 w-4" /> Nueva excursión
          </Link>
        </Button>
      </div>

      {excursiones.length === 0 ? (
        <EmptyState
          icon={Map}
          title="Todavía no tienes excursiones"
          description="Crea tu primera excursión con su precio y sus horarios: es el catálogo sobre el que venderán tus vendedores."
          action={
            <Button asChild size="lg">
              <Link href="/admin/excursiones/catalogo/nueva">Crear excursión</Link>
            </Button>
          }
        />
      ) : (
        <CatalogoLista excursiones={excursiones} />
      )}
    </div>
  )
}
