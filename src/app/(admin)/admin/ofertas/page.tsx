import Link from 'next/link'
import { Plus } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole, seccionesAbribles } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { ADMIN_SECTIONS } from '@/lib/auth/permissions'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { contarBeneficios, listarBeneficios, tipoActivo, tiposDisponibles } from '@/modules/ofertas/beneficios'
import { PageHeader } from '@/components/ui/page-header'
import { NavSeccion } from '@/components/ui/nav-seccion'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelDs } from '@/components/layout/PanelDs'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { TablaBeneficios } from '@/components/admin/beneficios/TablaBeneficios'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Beneficios y regalos' }

/**
 * BENEFICIOS Y REGALOS (auditoría admin · fase 5, tarea 5.4; antes, el «hub de Ofertas», Auditoría · Fase D).
 *
 * El hub mostraba cuatro tarjetas, cada una con su propio «Nueva …» y su «Ver todas»: el dueño tenía que decidir DÓNDE crear
 * antes de saber QUÉ quería hacer. Ahora es una vista con una pestaña por tipo —promociones públicas, relámpago, regalos VIP y,
 * si el módulo está encendido, ofertas sobre el catálogo— y UN solo «Crear beneficio» arriba, que pregunta el tipo.
 *
 * Los cuatro modelos de datos siguen siendo independientes y cada tipo conserva su panel de gestión (filtros, paginación,
 * edición): esta pantalla los junta en una puerta y en una lista corta, no los fusiona. Cada pestaña solo aparece si la persona
 * puede abrir su sección.
 */
export default async function BeneficiosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  if (!companyId) return <SinEmpresaActiva seccion="tus beneficios" />

  const sp = await searchParams
  const [abribles, conDeals, regional] = await Promise.all([
    seccionesAbribles(user, ADMIN_SECTIONS),
    // La oferta sobre el catálogo solo se ofrece a quien tiene el módulo encendido.
    tieneCapacidad(companyId, 'DEALS_MARKETPLACE').catch(() => false),
    getRegionalPrefs(companyId),
  ])
  const tipos = tiposDisponibles((s) => abribles.has(s), conDeals)
  const activo = tipoActivo(typeof sp.tipo === 'string' ? sp.tipo : undefined, tipos)

  if (!activo) {
    return (
      <PanelDs>
        <PageHeader title="Beneficios y regalos" description="Todo lo que ofreces a tus clientes en un solo lugar." />
        <EmptyState title="No tienes acceso a ningún tipo de beneficio" description="Pídele a quien administra tu equipo que te dé acceso." />
      </PanelDs>
    )
  }

  // UNA transacción: los totales de cada pestaña y la lista de la que está abierta.
  const [conteos, filas] = await conEmpresa(companyId, async (tx) => [
    await contarBeneficios(tx, companyId, tipos),
    await listarBeneficios(tx, companyId, activo),
  ] as const)
  const tipo = tipos.find((t) => t.key === activo)!

  return (
    <PanelDs className="space-y-6">
      <PageHeader
        title="Beneficios y regalos"
        description="Todo lo que ofreces a tus clientes en un solo lugar. Elige una pestaña para ver cada tipo."
        action={
          <Button asChild>
            <Link href="/admin/ofertas/crear">
              <Plus className="size-4" aria-hidden /> Crear beneficio
            </Link>
          </Button>
        }
        nav={
          <NavSeccion
            aria-label="Tipos de beneficio"
            items={tipos.map((t) => ({ etiqueta: t.pestana, href: `/admin/ofertas?tipo=${t.key}`, activa: t.key === activo, cuenta: conteos[t.key] }))}
            enlace={({ href, ...resto }) => <Link href={href} {...resto} />}
          />
        }
      />

      {filas === null ? (
        <EmptyState title="No se pudo cargar la lista" description="Es un problema temporal; recarga la página en unos segundos." />
      ) : (
        <TablaBeneficios tipo={tipo} filas={filas} total={conteos[activo]} regional={regional} />
      )}
    </PanelDs>
  )
}
