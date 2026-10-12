import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { anfitrionDelHost, anfitrionesDelEntorno } from '@/lib/anfitriones'
import { landingUrl } from '@/lib/site'

/**
 * Robots de MembeGo, por host (separación landing/app · F7).
 *
 * Con un solo dominio —o con los dos sin configurar— es el de siempre: permite indexar la Landing y el marketplace,
 * bloquea paneles y rutas de la app, y enlaza el sitemap; y es estático. Con los dos dominios activos, `app.` no se indexa
 * nada (`Disallow: /`, sin sitemap; además el proxy añade `X-Robots-Tag: noindex`) y `membego.com` conserva las reglas de
 * la landing. Solo en ese caso se lee el host, así que solo ahí es dinámico.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const anfitriones = anfitrionesDelEntorno()
  if (anfitriones && anfitrionDelHost((await headers()).get('host'), anfitriones) === 'app') {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }
  const base = landingUrl()
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/superadmin',
          '/cliente',
          '/empleado',
          '/onboarding',
          '/api',
          '/monitoring',
          '/login',
          '/acceso',
          '/recuperar',
          '/actualizar-password',
          '/confirmar',
          '/auth',
          // OJO: /r/, /i/, /invita/ e /invitar/ NO se bloquean: son las
          // landings que la gente comparte y el crawler de Meta (WhatsApp/
          // Facebook) respeta robots.txt — bloquearlas mata la vista previa.
          '/mis-membresias',
          '/membresia',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
