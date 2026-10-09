import { companyIdPorSlug, excursionPublica } from '@/modules/excursiones/catalogo/public-queries'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { getExcursionesConfig } from '@/modules/excursiones/config'

/**
 * LOS DATOS DE LA FICHA DE UNA EXCURSIÓN — UNA SOLA VEZ.
 *
 * La ficha se pinta en dos espacios: la landing (consulta, SEO, enlaces compartidos) y la app del cliente (donde se
 * reserva). Las dos leen lo mismo, con las mismas reglas de visibilidad, y por eso se cargan aquí y no en cada página:
 * «no existe» y «no es pública» se ven EXACTAMENTE igual en ambos.
 *
 * Nada de esto es una operación: es lectura. Quien reserva es la app.
 */
export async function cargarFichaDeExcursion(companySlug: string, excursionSlug: string) {
  const company = await getCompanyPublic(companySlug)
  if (!company) return null
  const companyId = await companyIdPorSlug(companySlug)
  if (!companyId) return null
  const exc = await excursionPublica(companyId, excursionSlug)
  if (!exc) return null
  const config = await getExcursionesConfig(companyId)
  const precioDesde = exc.variantes[0]?.precioAdulto
  // Normalizar galería: JSON crudo → string[]
  const galeria: string[] = Array.isArray(exc.galeria) ? (exc.galeria as string[]).filter((u) => typeof u === 'string' && u.trim()) : []
  return { company, companyId, exc, config, precioDesde, galeria }
}

export type FichaDeExcursionDatos = NonNullable<Awaited<ReturnType<typeof cargarFichaDeExcursion>>>
