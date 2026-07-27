import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { getRecientes } from '@/modules/carwash/mostrador'
import { getTiposVehiculo } from '@/modules/carwash/catalogo'
import { MostradorPanel, type ClienteReciente } from '@/components/carwash/MostradorPanel'
import { PageHeader } from '@/components/ui/page-header'
import { ArrowLeft, TriangleAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clientes de la pista' }

/**
 * App Car Wash — CLIENTES, registrados y de mostrador.
 *
 * Sin capacidad propia: poder anotar quién trajo el carro es parte de operar
 * la pista, no un módulo opcional que se pueda apagar.
 */
export default async function ClientesCarwashPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const [recientes, tipos] = await Promise.all([
    getRecientes(companyId),
    getTiposVehiculo(companyId).catch(() => []),
  ])

  return (
    <div className="space-y-6">
      <Link
        href="/admin/app/carwash"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Car Wash
      </Link>

      <PageHeader
        title="Clientes de la pista"
        description="Todos: los que tienen cuenta en la plataforma y los que solo vienen a lavar. Búscalos por placa, que es lo que tienes delante."
      />

      {recientes === null ? (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
          <div>
            <p className="font-bold text-foreground">Falta correr la migración</p>
            <p className="mt-1 text-muted-foreground">
              Corre{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                prisma/migrations/20260766_cliente_mostrador/migration.sql
              </code>{' '}
              en Supabase y vuelve a entrar. Es una sola columna y no toca ningún dato existente.
            </p>
          </div>
        </div>
      ) : (
        <MostradorPanel
          recientes={recientes.map(
            (c): ClienteReciente => ({
              id: c.id,
              nombre: c.nombre,
              telefono: c.telefono,
              createdAt: c.createdAt,
              placas: c.vehiculos.map((v) => v.placa),
              visitas: c._count.colaVehiculos,
            })
          )}
          tipos={tipos.map((t) => ({ id: t.id, nombre: t.nombre }))}
        />
      )}
    </div>
  )
}
