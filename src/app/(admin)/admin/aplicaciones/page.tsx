import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/ui/page-header'
import { getCapacidadesEmpresa } from '@/modules/capacidades/resolver'
import { CATEGORIA_LABELS } from '@/modules/capacidades/catalogo'
import { appDeCategoria, type IconoApp } from '@/modules/apps/catalogo'
import { Car, Scissors, Sparkles, ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Aplicaciones' }

/** Iconos de portada de app (el catálogo guarda solo el nombre). */
const ICONOS: Partial<Record<IconoApp, LucideIcon>> = { Car, Scissors, Sparkles }

/**
 * Plataforma modular · E2 (+ E6) — LAUNCHPAD.
 *
 * La puerta al segundo nivel: MembeGo administra la relación con el cliente;
 * cada APLICACIÓN administra la operación del negocio. Desde E6 las apps salen
 * del catálogo (`modules/apps/catalogo.ts`): agregar una categoría no toca
 * esta pantalla.
 */
export default async function AplicacionesPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined

  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const [empresa, capacidades] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, colorPrimario: true },
    }),
    getCapacidadesEmpresa(companyId).catch(() => null),
  ])
  const categoria = capacidades?.categoria ?? 'CAR_WASH'
  const app = appDeCategoria(categoria)
  const color = empresa?.colorPrimario || '#0D9488'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aplicaciones"
        description={`Los sistemas de ${empresa?.name ?? 'tu negocio'}. MembeGo administra a tus clientes; cada aplicación administra la operación.`}
      />

      {!app ? (
        <p className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          Tu categoría ({CATEGORIA_LABELS[categoria]}) aún no tiene una aplicación
          especializada. Muy pronto.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(() => {
            const Icon = ICONOS[app.icon] ?? Sparkles
            return (
              <Link
                href={`/admin/app/${app.slug}`}
                className="group rounded-2xl border border-border/70 bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-foreground/30"
              >
                <span
                  className="flex h-14 w-14 items-center justify-center rounded-2xl text-white"
                  style={{ backgroundColor: color }}
                >
                  <Icon className="h-7 w-7" />
                </span>
                <p className="mt-4 text-lg font-bold text-foreground">{app.nombre}</p>
                <p className="mt-1 text-sm text-muted-foreground">{app.descripcion}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Abrir <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            )
          })()}
        </div>
      )}
    </div>
  )
}
