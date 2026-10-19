import type { MetadataRoute } from 'next'
import { landingUrl } from '@/lib/site'

/**
 * Sitemap de rutas de la LANDING de MembeGo. Solo páginas indexables
 * (marketing + marketplace); nunca paneles privados ni entradas de app
 * (/login, /registro), que además `robots.ts` marca como Disallow.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = landingUrl()
  const now = new Date()

  // Prioridad alta: home + marketplace. Media: marketing. Baja: legal.
  const alta = ['', '/empresas', '/promociones']
  const media = ['/caracteristicas', '/registro-empresa', '/faq', '/descargar', '/blog', '/contact']
  const baja = ['/terms', '/privacy']

  const build = (paths: string[], priority: number) =>
    paths.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: path === '' ? 1 : priority,
    }))

  return [...build(alta, 0.8), ...build(media, 0.6), ...build(baja, 0.3)]
}
