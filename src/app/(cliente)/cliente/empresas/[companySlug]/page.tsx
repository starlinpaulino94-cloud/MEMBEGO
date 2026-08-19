import { notFound } from 'next/navigation'
import { BadgeCheck, Check } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { CompanyProfile } from '@/components/marketplace/CompanyProfile'
import { CtaEmpresa } from '@/components/cliente/CtaEmpresa'
import { fichaEnEmpresa } from '@/modules/cliente/afiliacion'
import { getPromocionesDeEmpresaParaMi, getSeguidasIds } from '@/modules/social/queries'
import {
  getCompanyPublic,
  getCompanyStats,
  getCompanyPlanesPublic,
  getCompanyPostsPublic,
  getSucursalesPublic,
} from '@/modules/marketplace/cached'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { getCompanyResenas, getMiResena } from '@/modules/resenas/queries'
import { ResenaForm } from '@/components/marketplace/ResenaForm'
import { requisitosPara } from '@/modules/elegibilidad'
import { decisionCtaPlanes } from '@/modules/marketplace/conversion'
import { companyIdPorSlug, excursionesPublicas } from '@/modules/excursiones/catalogo/public-queries'

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

  /**
   * QUIÉN ES ESTA PERSONA EN ESTE NEGOCIO.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * LO QUE SE PREGUNTABA ANTES
   *
   * `company.id === user.metadata.companyId` — es decir, «¿es este el negocio
   * ACTIVO de su sesión?». No es la misma pregunta. Alguien que es cliente de
   * este negocio desde hace un año, pero con la sesión apuntando a otro, caía
   * en la rama de «empresa ajena»: sin botón, sin elegibilidad, con el perfil
   * convertido en un folleto.
   *
   * La pregunta correcta es si tiene FICHA aquí, y eso lo contesta
   * `fichaEnEmpresa`. Es la misma corrección que la fase 4 hizo en «Mi
   * Membego», ahora del lado del negocio.
   */
  const fichaAqui = await fichaEnEmpresa(user.supabaseId, company.id)
  const esCliente = fichaAqui != null
  const esActiva = company.id === user.metadata.companyId

  const [stats, planes, promotions, posts, prefs, resenas, miResena, sucursales, sigo, excursionesData] =
    await Promise.all([
      getCompanyStats(companySlug),
      getCompanyPlanesPublic(company.id),
      // Sus ofertas PRIVADAS incluidas si esta persona es cliente aquí: son
      // exactamente las que sí puede canjear, y el perfil del negocio es la
      // pantalla que existe para contarle qué ofrece.
      getPromocionesDeEmpresaParaMi(company.id, user.supabaseId, 12),
      getCompanyPostsPublic(company.id),
      getRegionalPrefs(company.id),
      getCompanyResenas(company.id),
      getMiResena(company.id, user.supabaseId),
      getSucursalesPublic(company.id),
      getSeguidasIds(user.metadata.dbUserId).then((s) => s.has(company.id)).catch(() => false),
      companyIdPorSlug(companySlug).then((cid) =>
        cid ? excursionesPublicas(cid) : Promise.resolve([])
      ),
    ])

  const excursiones = excursionesData.map((exc) => ({
    id: exc.id,
    nombre: exc.nombre,
    slug: exc.slug,
    portadaUrl: exc.portadaUrl,
    categoria: exc.categoria,
    moneda: exc.moneda,
    duracionMin: exc.duracionMin,
    ubicacion: exc.ubicacion,
    precioDesde: exc.variantes[0]?.precioAdulto ?? null,
  }))

  // Solo clientes de la empresa pueden opinar (su ficha Cliente existe allí).
  const puedeOpinar = miResena.esCliente

  // ── Fase 4 · contexto de sucursal y conversión ─────────────────────────────
  const sucursalActiva =
    sucursales.find((s) => s.id === sucursalParam) ?? null

  const qp: string[] = []
  if (sucursalActiva) qp.push(`sucursal=${sucursalActiva.id}`)
  if (esDeCerca) qp.push('origen=cerca')
  const detailUrl = `/cliente/empresas/${company.slug}${qp.length ? `?${qp.join('&')}` : ''}`

  // Ofertas y membresías de la empresa: canjeables en cualquiera de sus
  // sucursales (el modelo no las acota por sucursal), por eso no se filtran.

  /**
   * Elegibilidad con la ficha de ESTE negocio.
   *
   * Se calcula solo cuando además es el negocio activo, porque el paso que
   * resuelve (registrar el vehículo) y la compra ocurren en el contexto
   * activo. Siendo cliente de otro negocio, el botón primero cambia de
   * contexto y la pantalla de planes vuelve a pedir lo que falte — con sus
   * propias reglas, que no se tocan.
   */
  let requisitos = null
  if (esCliente && esActiva && fichaAqui) {
    requisitos = await requisitosPara({
      accion: 'COMPRAR_PLAN',
      companyId: company.id,
      clienteId: fichaAqui,
    }).catch(() => null)
  }

  const rutaVehiculo = `/cliente/vehiculos/nuevo?next=${encodeURIComponent(detailUrl)}`
  const rutaPlanes = esDeCerca
    ? `/cliente/planes?retorno=${encodeURIComponent(detailUrl)}`
    : '/cliente/planes'
  const planesCta = decisionCtaPlanes({
    esMiEmpresa: esCliente && esActiva,
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
      ctaSlot={
        <CtaEmpresa
          companySlug={company.slug}
          companyName={company.name}
          esCliente={esCliente}
          esActiva={esActiva}
          hrefDirecto={planesCta?.href ?? null}
          etiquetaDirecta={planesCta?.label}
        />
      }
      relacionSlot={
        esCliente || sigo ? (
          <p className="mt-3 flex flex-wrap items-center gap-2">
            {esCliente && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-sm font-medium text-success">
                <BadgeCheck className="h-4 w-4" aria-hidden /> Eres cliente aquí
              </span>
            )}
            {sigo && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                <Check className="h-4 w-4" aria-hidden /> Sigues este negocio
              </span>
            )}
          </p>
        ) : undefined
      }
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
      excursiones={excursiones}
    />
  )
}
