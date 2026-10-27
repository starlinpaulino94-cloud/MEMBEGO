import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole, seccionesAbribles } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { ADMIN_SECTIONS } from '@/lib/auth/permissions'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { tiposDisponibles } from '@/modules/ofertas/beneficios'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelDs } from '@/components/layout/PanelDs'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crear beneficio' }

/**
 * CREAR UN BENEFICIO (auditoría admin · fase 5, tarea 5.4).
 *
 * El único punto de entrada para crear: la persona dice QUÉ quiere ofrecer y la pantalla la lleva al formulario de ese tipo.
 * Antes el hub tenía cuatro botones «Nueva …» repartidos en cuatro tarjetas y había que decidir el sitio antes de saber el tipo.
 * Los formularios no se fusionan —cada tipo tiene reglas propias—; lo que se unifica es la puerta. Solo aparecen los tipos que
 * esta persona puede abrir (`tiposDisponibles`).
 */
export default async function CrearBeneficioPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  if (!companyId) return <SinEmpresaActiva seccion="tus beneficios" />

  const [abribles, conDeals] = await Promise.all([
    seccionesAbribles(user, ADMIN_SECTIONS),
    tieneCapacidad(companyId, 'DEALS_MARKETPLACE').catch(() => false),
  ])
  const tipos = tiposDisponibles((s) => abribles.has(s), conDeals)

  return (
    <PanelDs className="space-y-6">
      <PageHeader
        title="Crear beneficio"
        description="¿Qué quieres ofrecer? Elige el tipo y te llevamos a su formulario."
        action={
          <Link href="/admin/ofertas" className="inline-flex items-center gap-1.5 text-small font-medium text-primary hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> Volver a beneficios
          </Link>
        }
      />

      {tipos.length === 0 ? (
        <EmptyState title="No tienes acceso a ningún tipo de beneficio" description="Pídele a quien administra tu equipo que te dé acceso." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Tipos de beneficio que puedes crear">
          {tipos.map((t) => (
            <li key={t.key}>
              <Link
                href={t.crearHref}
                className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-body">
                      {t.singular}
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
                    </CardTitle>
                    <CardDescription>{t.descripcion}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PanelDs>
  )
}
