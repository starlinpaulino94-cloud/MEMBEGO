import Link from 'next/link'
import { ArrowRight, KeyRound, ScrollText, Webhook } from 'lucide-react'
import { appUrl } from '@/lib/site'
import { Card, CardContent } from '@/components/ui/card'
import { GuiaDesarrolladores } from '@/components/connect/GuiaDesarrolladores'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Desarrolladores' }

/**
 * RESUMEN del hub: por dónde se empieza, y la referencia de la API.
 *
 * Antes de la Fase 11 este hub era una sola página que apilaba cuatro bloques
 * en vertical — exactamente el problema que la Fase 10 vino a corregir en el
 * catálogo, solo que mudado de sitio. Ahora cada herramienta tiene su ruta y
 * esta pantalla es lo que faltaba: la orientación.
 *
 * La base de la API sale de `appUrl()`, el único dueño de las URLs de la
 * aplicación. Escrita a mano, apuntaría al dominio equivocado el día que la
 * aplicación se mude.
 */

const CAMINOS = [
  {
    href: '/admin/integraciones/desarrolladores/claves',
    icono: KeyRound,
    titulo: 'Claves de API',
    texto: 'Para que tu sistema consulte tus datos: clientes, membresías, citas.',
  },
  {
    href: '/admin/integraciones/desarrolladores/webhooks',
    icono: Webhook,
    titulo: 'Webhooks',
    texto: 'Para que te avisemos a ti en el momento en que algo pasa.',
  },
  {
    href: '/admin/integraciones/desarrolladores/registros',
    icono: ScrollText,
    titulo: 'Registros',
    texto: 'Qué hizo el sistema, con su código y su nivel. Para cuando algo falla.',
  },
]

export default function DesarrolladoresResumenPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CAMINOS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <c.icono className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="mt-2 font-semibold">{c.titulo}</p>
            <p className="mt-1 text-caption text-muted-foreground">{c.texto}</p>
            <span className="mt-3 flex items-center gap-1 text-sm font-semibold text-primary">
              Abrir
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Toda la API vive bajo <code className="break-all font-mono">{appUrl()}/api/platform/v1</code>. La
            especificación completa, en formato OpenAPI, está en{' '}
            <code className="break-all font-mono">/api/platform/v1/openapi</code> y se genera del
            mismo inventario que sirve las rutas, así que no puede quedarse vieja.
          </p>
        </CardContent>
      </Card>

      <GuiaDesarrolladores base={appUrl()} />
    </div>
  )
}
