import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Code2 } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { catalogoDeEmpresa } from '@/modules/connect/catalogo'
import { ESTADOS_QUE_PIDEN_ATENCION } from '@/modules/connect/proveedores/tipos'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { StatusBanner } from '@/components/ui/status-banner'
import { CatalogoIntegraciones } from '@/components/connect/CatalogoIntegraciones'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Integraciones' }

/**
 * INTEGRACIONES · el centro de aplicaciones (Membego Connect · Fase 10).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CAMBIÓ Y POR QUÉ
 *
 * Hasta la Fase 9 esta página apilaba seis bloques en vertical: canales,
 * aplicaciones, claves de API, webhooks, la guía para desarrolladores y la
 * bitácora. Mezclaba dos personas distintas —la dueña de un negocio que quiere
 * conectar WhatsApp y el programador que quiere consumir /v1/customers— y le
 * enseñaba a la primera cosas que no le sirven de nada.
 *
 * Ahora esto es un catálogo, y las herramientas de programador viven en
 * `/admin/integraciones/desarrolladores`. Ningún backend se retiró: lo que se
 * movió, se movió entero.
 *
 * TODO lo que se ve aquí sale de `catalogoDeEmpresa`, que es también de donde
 * saldrán la página de detalle y el bloque que aparecerá dentro de Citas. Una
 * sola verdad, tres pantallas.
 */
export default async function IntegracionesPage() {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')

  const entradas = await catalogoDeEmpresa(user.metadata.companyId)
  const atencion = entradas.filter((e) =>
    (ESTADOS_QUE_PIDEN_ATENCION as readonly string[]).includes(e.estado)
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones"
        description="Conecta Membego con las herramientas que ya usa tu negocio."
        action={
          <Button variant="outline" asChild>
            <Link href="/admin/integraciones/desarrolladores">
              <Code2 className="mr-2 h-4 w-4" aria-hidden />
              Desarrolladores
            </Link>
          </Button>
        }
      />

      {/* Lo que pide que alguien mire va arriba del todo: quien entra aquí con
          una integración rota no debería tener que buscarla en la rejilla. */}
      {atencion.length > 0 && (
        <StatusBanner variant="warning" title="Hay integraciones que necesitan tu atención">
          {atencion.map((e) => e.nombre).join(', ')}.{' '}
          {atencion.length === 1
            ? 'Ábrela para ver qué pasa.'
            : 'Ábrelas para ver qué pasa en cada una.'}
        </StatusBanner>
      )}

      <CatalogoIntegraciones entradas={entradas} />
    </div>
  )
}
