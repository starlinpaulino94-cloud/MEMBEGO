import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, BookOpen, KeyRound, ScrollText, Webhook } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { appUrl } from '@/lib/site'
import { clavesDeEmpresa } from '@/modules/connect/clavesApi'
import { suscripcionesDeEmpresa } from '@/modules/connect/webhooks'
import { plural } from '@/lib/plural'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { GuiaDesarrolladores } from '@/components/connect/GuiaDesarrolladores'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Desarrolladores' }

/**
 * RESUMEN del hub de desarrolladores: en qué estado están tus herramientas y
 * por dónde se empieza.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS NÚMEROS SON REALES O NO ESTÁN
 *
 * «Claves activas» y «Webhooks» cuentan filas de esta empresa. No hay ningún
 * indicador de disponibilidad ni porcentaje de tiempo en línea, aunque la
 * referencia visual lleve uno: MembeGo no mide hoy esa señal, y un «99.9 %»
 * pintado a mano es una afirmación falsa sobre el servicio que alguien va a
 * usar para decidir si integra o no.
 *
 * Cuando exista una medición de verdad, entra aquí y se dice de dónde sale.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA BASE DE LA API SALE DE `appUrl()`
 *
 * Es el único dueño de las URLs de la aplicación. Escrita a mano, apuntaría al
 * dominio equivocado el día que la aplicación se mude, y quien copie el
 * ejemplo se llevaría el error a su código.
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

export default async function DesarrolladoresResumenPage() {
  // El layout ya exige la sección, pero un layout de Next NO es una frontera
  // de seguridad: cada página vuelve a exigirla. Ver la nota del layout.
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  // Si una de las dos consultas falla, su tarjeta lo dice; no se inventa un
  // cero, que se leería como «no tienes ninguna».
  const [claves, webhooks] = await Promise.all([
    clavesDeEmpresa(companyId).catch(() => null),
    suscripcionesDeEmpresa(companyId).catch(() => null),
  ])

  const clavesActivas = claves?.filter((c) => c.estado === 'ACTIVE') ?? null
  const ultimoUso = clavesActivas
    ?.map((c) => c.lastUsedAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  const webhooksActivos = webhooks?.filter((w) => w.estado === 'ACTIVE') ?? null
  const conFallos = webhooksActivos?.filter((w) => w.fallosSeguidos > 0).length ?? 0

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* Columna izquierda: el estado de tus herramientas, de un vistazo. */}
      <div className="space-y-3">
        <StatCard
          label="Claves activas"
          value={clavesActivas === null ? '—' : clavesActivas.length}
          sub={
            clavesActivas === null
              ? 'No se pudo consultar'
              : ultimoUso
                ? `Último uso: ${ultimoUso.toLocaleDateString('es-DO')}`
                : 'Sin uso registrado'
          }
          icon={KeyRound}
          accent="brand"
          href="/admin/integraciones/desarrolladores/claves"
          hrefLabel="Administrar claves de API"
        />
        <StatCard
          label="Webhooks activos"
          value={webhooksActivos === null ? '—' : webhooksActivos.length}
          sub={
            webhooksActivos === null
              ? 'No se pudo consultar'
              : conFallos > 0
                ? `${plural(conFallos, 'endpoint acumula fallos', 'endpoints acumulan fallos')}`
                : 'Sin fallos acumulados'
          }
          icon={Webhook}
          accent={conFallos > 0 ? 'warning' : 'success'}
          href="/admin/integraciones/desarrolladores/webhooks"
          hrefLabel="Administrar webhooks"
        />
      </div>

      {/* Columna derecha: por dónde se empieza y la referencia completa. */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Primeros pasos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {CAMINOS.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="group rounded-xl border border-border/60 p-3 outline-none transition-colors duration-fast hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <c.icono className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="mt-2 text-sm font-semibold">{c.titulo}</p>
                  <p className="mt-1 text-caption text-muted-foreground">{c.texto}</p>
                  <span className="mt-3 flex items-center gap-1 text-sm font-semibold text-primary">
                    Abrir
                    <ArrowRight
                      className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              ))}
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-3">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Toda la API vive bajo{' '}
                <code className="break-all font-mono">{appUrl()}/api/platform/v1</code>. La
                especificación completa, en formato OpenAPI, está en{' '}
                <code className="break-all font-mono">/api/platform/v1/openapi</code> y se genera
                del mismo inventario que sirve las rutas, así que no puede quedarse vieja.
              </p>
            </div>
          </CardContent>
        </Card>

        <GuiaDesarrolladores base={appUrl()} />
      </div>
    </div>
  )
}
