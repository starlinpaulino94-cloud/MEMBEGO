import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { CompanyProfile } from '@/components/marketplace/CompanyProfile'
import {
  getCompanyPublic,
  getCompanyStats,
  getCompanyPlanesPublic,
  getCompanyPostsPublic,
  getPromotionsPublic,
  getSucursalesPublic,
} from '@/modules/marketplace/cached'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { getCompanyResenas, getMiResena } from '@/modules/resenas/queries'
import { ResenaForm } from '@/components/marketplace/ResenaForm'
import { requisitosPara } from '@/modules/elegibilidad'
import { decisionCtaPlanes } from '@/modules/marketplace/conversion'

export const dynamic = 'force-dynamic'

interface ClienteEmpresaPageProps {
  params: Promise<{ companySlug: string }>
  searchParams: Promise<{ sucursal?: string; origen?: string }>
}

/**
 * Perfil de empresa INTERNO. Misma información que el perfil público pero
 * renderizado dentro del AppShell: el cliente autenticado nunca sale a la
 * Landing. Reutiliza <CompanyProfile mode="app" />.
 *
 * Fase 4 · conversión desde el mapa: el detalle es sucursal-consciente
 * (`?sucursal=<id>&origen=cerca`). Se resalta la sucursal elegida en el mapa,
 * se indica que las ofertas/membresías son canjeables en ella (en el modelo
 * actual son de la empresa completa, sin acotación por sucursal), el botón
 * volver regresa al mapa, y el CTA de planes respeta la elegibilidad del
 * negocio (car wash sin vehículo → onboarding → regreso).
 */
export default async function ClienteEmpresaPage({
  params,
  searchParams,
}: ClienteEmpresaPageProps) {
  const user = await requireRole('CLIENTE')
  const { companySlug } = await params
  const { sucursal: sucursalParam, origen } = await searchParams
  const esDeCerca = origen === 'cerca'

  const company = await getCompanyPublic(companySlug)
  if (!company) notFound()

  const [stats, planes, promotions, posts, prefs, resenas, miResena, sucursales] =
    await Promise.all([
      getCompanyStats(companySlug),
      getCompanyPlanesPublic(company.id),
      getPromotionsPublic({ company: companySlug, limit: 12 }),
      getCompanyPostsPublic(company.id),
      getRegionalPrefs(company.id),
      getCompanyResenas(company.id),
      getMiResena(company.id, user.supabaseId),
      getSucursalesPublic(company.id),
    ])

  // Solo clientes de la empresa pueden opinar (su ficha Cliente existe allí).
  const puedeOpinar = miResena.esCliente

  // ── Fase 4 · contexto de sucursal y conversión ─────────────────────────────
  const esMiEmpresa = company.id === user.metadata.companyId
  const sucursalActiva =
    sucursales.find((s) => s.id === sucursalParam) ?? null

  const qp: string[] = []
  if (sucursalActiva) qp.push(`sucursal=${sucursalActiva.id}`)
  if (esDeCerca) qp.push('origen=cerca')
  const detailUrl = `/cliente/empresas/${company.slug}${qp.length ? `?${qp.join('&')}` : ''}`

  // Ofertas y membresías de la empresa: canjeables en cualquiera de sus
  // sucursales (el modelo no las acota por sucursal), por eso no se filtran.

  // Elegibilidad por tipo de negocio: solo en la empresa del usuario (la
  // compra es multi-tenant; las empresas ajenas quedan informativas).
  let requisitos = null
  if (esMiEmpresa && user.metadata.companyId && user.metadata.clienteId) {
    requisitos = await requisitosPara({
      accion: 'COMPRAR_PLAN',
      companyId: user.metadata.companyId,
      clienteId: user.metadata.clienteId,
    }).catch(() => null)
  }

  const rutaVehiculo = `/cliente/vehiculos/nuevo?next=${encodeURIComponent(detailUrl)}`
  const rutaPlanes = esDeCerca
    ? `/cliente/planes?retorno=${encodeURIComponent(detailUrl)}`
    : '/cliente/planes'
  const planesCta = decisionCtaPlanes({
    esMiEmpresa,
    requisitos,
    rutaVehiculo,
    rutaPlanes,
  })

  return (
    <CompanyProfile
      mode="app"
      company={company}
      stats={stats}
      planes={planes}
      promotions={promotions}
      posts={posts}
      prefs={prefs}
      planesCta={planesCta}
      sucursales={sucursales}
      sucursalActiva={sucursalActiva}
      promoRetorno={esDeCerca ? detailUrl : undefined}
      backHref={esDeCerca ? '/cliente/cerca' : undefined}
      backLabel={esDeCerca ? 'Cerca de mí' : undefined}
      resenas={resenas}
      resenaFormSlot={
        puedeOpinar ? (
          <ResenaForm
            companyId={company.id}
            companyName={company.name}
            miResena={miResena.resena}
          />
        ) : undefined
      }
    />
  )
}
