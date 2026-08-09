import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { getCuentas } from '@/modules/carwash/cuentas'
import { CuentasPanel } from '@/components/carwash/CuentasPanel'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowLeft, Building2, TriangleAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cuentas corporativas' }

/**
 * App Car Wash · Fase 2 — CUENTAS CORPORATIVAS (flotillas).
 * Capacidad CUENTAS_CORPORATIVAS (nace apagada).
 */
export default async function CuentasPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const { editar } = await searchParams
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const volver = (
    <Link
      href="/admin/app/carwash"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Car Wash
    </Link>
  )

  if (!(await tieneCapacidad(companyId, 'CUENTAS_CORPORATIVAS'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title="Las cuentas corporativas están apagadas"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  const cuentas = await getCuentas(companyId)

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Cuentas corporativas"
        description="Flotas que pagan a crédito: sus vehículos se atienden y el consumo se carga a la cuenta en vez de cobrarse en caja."
      />

      {cuentas === null ? (
        // Migración sin correr: se DICE, no se finge una lista vacía. Un módulo
        // que parece vacío se abandona; uno que explica qué falta se arregla.
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-bold text-foreground">Falta correr la migración</p>
            <p className="mt-1 text-muted-foreground">
              Las tablas de cuentas corporativas todavía no existen en la base de datos. Corre{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                prisma/migrations/20260764_carwash_fase2/migration.sql
              </code>{' '}
              en Supabase y vuelve a entrar. El resto de la app no se ve afectado.
            </p>
          </div>
        </div>
      ) : (
        <CuentasPanel
          cuentas={cuentas}
          editando={cuentas.find((c) => c.id === editar) ?? null}
        />
      )}
    </div>
  )
}
