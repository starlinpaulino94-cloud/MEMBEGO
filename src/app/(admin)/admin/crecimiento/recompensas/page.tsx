import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getGrowthAdminData } from '@/modules/growth/queries'
import { resumirRegla } from '@/modules/growth/reglas'
import {
  toggleGrowthRuleAction,
  eliminarGrowthRuleAction,
} from '@/modules/growth/actions'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ArrowLeft, Gift, Pencil, Plus, Trash2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reglas de recompensa' }

/**
 * Reglas de recompensa del programa de crecimiento, con página propia.
 *
 * Antes vivían en un formulario embebido al final de /admin/crecimiento: la
 * lista y el formulario de alta competían por la misma pantalla y no había
 * forma de EDITAR una regla — solo crearla de nuevo y borrar la vieja.
 */
export default async function ReglasRecompensaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) return <SinEmpresaActiva seccion="tus reglas de recompensa" />

  const { rules } = await getGrowthAdminData(companyId)
  const activas = rules.filter((r) => r.activo).length

  return (
    <div className="space-y-6">
      <Link
        href="/admin/crecimiento"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Crecimiento
      </Link>

      <PageHeader
        title="Reglas de recompensa"
        description="Qué se entrega, cuándo y a quién. Puedes pausar una regla sin borrarla: deja de premiar pero conserva su historial."
        action={
          <Button asChild>
            <Link href="/admin/crecimiento/recompensas/nueva">
              <Plus className="mr-2 h-4 w-4" /> Nueva regla
            </Link>
          </Button>
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={<Gift className="h-7 w-7" />}
          title="Aún no hay reglas"
          description="Crea la primera para empezar a premiar: por ejemplo, «Se registra → 50 puntos para quien invita»."
          action={
            <Button asChild>
              <Link href="/admin/crecimiento/recompensas/nueva">Crear la primera</Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {rules.length} regla{rules.length === 1 ? '' : 's'} · {activas} activa
            {activas === 1 ? '' : 's'}
          </p>

          <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{r.nombre}</p>
                  <p className="text-xs text-muted-foreground">{resumirRegla(r)}</p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Badge variant={r.activo ? 'default' : 'secondary'}>
                    {r.activo ? 'Activa' : 'Pausada'}
                  </Badge>

                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/admin/crecimiento/recompensas/${r.id}/editar`}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
                    </Link>
                  </Button>

                  <form action={toggleGrowthRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      {r.activo ? 'Pausar' : 'Activar'}
                    </Button>
                  </form>

                  <form action={eliminarGrowthRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button
                      type="submit"
                      size="icon"
                      variant="ghost"
                      aria-label={`Eliminar ${r.nombre}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
