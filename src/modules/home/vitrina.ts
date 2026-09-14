import { unstable_cache } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { formatMoney } from '@/lib/format'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'

/**
 * LOS HECHOS QUE LA TARJETA DE EMPRESA ENSEÑA, Y NO ESTABAN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * El diseño pide, junto a cada empresa destacada, su valoración con el NÚMERO
 * de reseñas —«★ 4.9 (120 reseñas)»— y cuántos planes ofrece —«2 planes»—.
 * `CompanyPublic` trae la media pero no el conteo, y no trae los planes.
 *
 * No se amplía `getCompaniesPublic` para esto: su forma la comparten el
 * marketplace, el explorador y la landing, y va cacheada. Un conteo más ahí
 * son dos agregados extra en cada una de esas pantallas, la mayoría sin
 * enseñarlos.
 *
 * Aquí se piden solo para las empresas que el Inicio va a pintar (seis como
 * mucho), en dos agregados por lote en vez de dos consultas por empresa.
 *
 * Cross-empresa a propósito: la vitrina pública muestra negocios de toda la
 * plataforma, igual que el resto de `modules/marketplace`.
 */

export interface HechosEmpresa {
  /** Reseñas visibles. 0 = no se pinta el paréntesis, no se inventa. */
  readonly resenas: number
  /** Planes activos. 0 = no se pinta la etiqueta. */
  readonly planes: number
}

export async function hechosDeEmpresas(
  ids: readonly string[]
): Promise<Map<string, HechosEmpresa>> {
  const mapa = new Map<string, HechosEmpresa>()
  if (ids.length === 0) return mapa

  const unicos = [...new Set(ids)]
  const [resenas, planes] = await sinEmpresa(
    'inicio: reseñas y planes de las empresas destacadas',
    (tx) =>
      Promise.all([
        tx.companyRating.groupBy({
          by: ['companyId'],
          where: { companyId: { in: unicos }, visible: true },
          _count: { _all: true },
        }),
        tx.plan.groupBy({
          by: ['companyId'],
          where: { companyId: { in: unicos }, activo: true },
          _count: { _all: true },
        }),
      ])
  ).catch(() => [[], []] as const)

  for (const id of unicos) {
    mapa.set(id, {
      resenas: resenas.find((r) => r.companyId === id)?._count._all ?? 0,
      planes: planes.find((p) => p.companyId === id)?._count._all ?? 0,
    })
  }
  return mapa
}

/**
 * «4 horas», «Full Day». El diseño lo pone como sello sobre la miniatura de
 * cada experiencia, y sale de `duracionMin`, que ya existe.
 *
 * A partir de siete horas se dice «Full Day» porque es como lo vende el
 * negocio: nadie reserva «una excursión de 480 minutos».
 */
export function duracionLegible(minutos: number | null | undefined): string | null {
  if (minutos == null || !Number.isFinite(minutos) || minutos <= 0) return null
  if (minutos >= 420) return 'Full Day'
  if (minutos < 60) return `${Math.round(minutos)} min`
  const horas = minutos / 60
  const enteras = Math.floor(horas)
  const resto = Math.round(minutos - enteras * 60)
  if (resto === 0) return `${enteras} ${enteras === 1 ? 'hora' : 'horas'}`
  return `${enteras}.${Math.round((resto / 60) * 10)} horas`
}

/**
 * «Explorar más de 45 empresas asociadas» · «Ver todas las 28 membresías».
 *
 * El diseño pone números en esos dos botones, y tienen que ser los de verdad.
 * Van cacheados diez minutos, con la etiqueta del marketplace: cambian cuando
 * se publica una empresa o un plan, no en cada visita al Inicio.
 */
export const totalesVitrina = unstable_cache(
  async (): Promise<{ empresas: number; planes: number }> =>
    sinEmpresa('inicio: totales de la vitrina', (tx) =>
      Promise.all([
        tx.company.count({ where: { isActive: true, isPublished: true, esDemo: false } }),
        tx.plan.count({
          where: {
            activo: true,
            company: { isActive: true, isPublished: true, esDemo: false },
          },
        }),
      ])
    ).then(([empresas, planes]) => ({ empresas, planes }))
      .catch(() => ({ empresas: 0, planes: 0 })),
  ['home-totales-vitrina'],
  { revalidate: 600, tags: [MARKETPLACE_TAG] }
)

/**
 * Ciudad y «Planes desde …» para el hero POR DEFECTO.
 *
 * Cuando la empresa no ha compuesto su Inicio, el hero sale de las
 * promociones destacadas del marketplace — y el diseño le pone a cada
 * diapositiva la ciudad del negocio y el gancho de su plan más barato.
 * `PromotionPublic` no trae ninguna de las dos, así que se piden aquí en un
 * solo lote para las empresas que se van a pintar (tres como mucho).
 */
export async function contextoHeroPorDefecto(
  ids: readonly string[]
): Promise<Map<string, { ciudad: string | null; planDesde: string | null; color: string | null; valoracion: number | null }>> {
  const mapa = new Map<string, { ciudad: string | null; planDesde: string | null; color: string | null; valoracion: number | null }>()
  if (ids.length === 0) return mapa
  const unicos = [...new Set(ids)]
  const [empresas, baratos] = await sinEmpresa(
    'inicio: ciudad y plan más barato para el hero por defecto',
    (tx) =>
      Promise.all([
        tx.company.findMany({
          where: { id: { in: unicos } },
          select: { id: true, ciudad: true, moneda: true, idioma: true, colorPrimario: true, averageRating: true },
        }),
        // `distinct` tras ordenar por precio: la primera fila de cada empresa
        // es su plan activo más barato.
        tx.plan.findMany({
          where: { companyId: { in: unicos }, activo: true },
          orderBy: { precio: 'asc' },
          distinct: ['companyId'],
          select: { companyId: true, precio: true, vigenciaDias: true },
        }),
      ])
  ).catch(() => [[], []] as const)

  for (const e of empresas) {
    const barato = baratos.find((b) => b.companyId === e.id)
    mapa.set(e.id, {
      ciudad: e.ciudad,
      // Number(): Decimal en el borde — serializado tras la caché es string.
      valoracion: e.averageRating != null ? Number(e.averageRating) : null,
      color: e.colorPrimario && /^#[0-9a-fA-F]{6}$/.test(e.colorPrimario) ? e.colorPrimario : null,
      planDesde: barato
        ? `Planes desde ${formatMoney(Number(barato.precio), e)} / ${barato.vigenciaDias} días`
        : null,
    })
  }
  return mapa
}
