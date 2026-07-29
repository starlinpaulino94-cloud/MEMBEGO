import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'
import { SIN_DEMO } from '@/modules/demo'

/**
 * Modo MARCA ÚNICA.
 *
 * De cara al cliente, la app se presenta como la app de UNA empresa (la
 * principal): el registro entra directo a ella y la landing no habla de
 * "muchas empresas" ni de categorías. Por dentro la plataforma sigue siendo
 * multi-tenant: cuando entren más empresas, el superadmin crea su categoría
 * y el marketplace (rutas /empresas, /promociones) ya está listo para crecer
 * sin migraciones.
 *
 * Empresa principal = la destacada con menor `featuredOrder`; si no hay
 * destacadas, la más antigua activa y publicada.
 */
export interface EmpresaPrincipal {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  ciudad: string | null
}

/**
 * true mientras el marketplace tenga UNA sola empresa publicada (modo marca
 * única). Las pantallas multi-empresa (explorar, etc.) se saltan solas y
 * reaparecen automáticamente cuando entre la segunda empresa.
 */
export const esMarcaUnica = unstable_cache(
  async (): Promise<boolean> => {
    try {
      // Sin las de práctica: crear una empresa de entrenamiento no puede
      // sacar a la plataforma del modo marca única y cambiarle la portada al
      // negocio real.
      const total = await prisma.company.count({
        where: { isActive: true, isPublished: true, ...SIN_DEMO },
      })
      return total <= 1
    } catch (e) {
      console.error('[marcaUnica] count', e)
      return false
    }
  },
  ['marca-unica'],
  { revalidate: 300, tags: [MARKETPLACE_TAG] }
)

export const getEmpresaPrincipal = unstable_cache(
  async (): Promise<EmpresaPrincipal | null> => {
    try {
      const company = await prisma.company.findFirst({
        where: { isActive: true, isPublished: true, ...SIN_DEMO },
        orderBy: [
          { isFeatured: 'desc' },
          { featuredOrder: 'asc' },
          { createdAt: 'asc' },
        ],
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          logoUrl: true,
          ciudad: true,
        },
      })
      return company
    } catch (e) {
      console.error('[marcaUnica]', e)
      return null
    }
  },
  ['empresa-principal'],
  { revalidate: 300, tags: [MARKETPLACE_TAG] }
)
