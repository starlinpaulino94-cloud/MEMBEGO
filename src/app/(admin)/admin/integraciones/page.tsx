import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CircleCheck, Code2, Hourglass, Plug, TriangleAlert } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { catalogoDeEmpresa } from '@/modules/connect/catalogo'
import { ESTADOS_QUE_PIDEN_ATENCION } from '@/modules/connect/proveedores/tipos'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { StatusBanner } from '@/components/ui/status-banner'
import { StatCard } from '@/components/ui/stat-card'
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

  /**
   * LOS CUATRO NÚMEROS DE ARRIBA SALEN DEL MISMO CATÁLOGO QUE LA REJILLA.
   *
   * Se cuentan sobre `entradas`, que ya está en memoria: ni una consulta más.
   * Y como es la MISMA lista que se pinta debajo, es imposible que la cabecera
   * diga «3 conectadas» y la rejilla enseñe dos — que es exactamente lo que
   * pasa cuando un resumen se calcula por su cuenta.
   */
  const cuenta = (fn: (e: (typeof entradas)[number]) => boolean) => entradas.filter(fn).length
  const conectadas = cuenta((e) => e.estado === 'CONECTADA')
  const disponibles = cuenta((e) => e.estado === 'DISPONIBLE')
  const enPreparacion = cuenta((e) => e.estado === 'PROXIMAMENTE')

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Conectadas"
          value={conectadas}
          sub="Funcionando ahora mismo"
          icon={Plug}
          accent="success"
        />
        <StatCard
          label="Disponibles"
          value={disponibles}
          sub="Listas para conectar"
          icon={CircleCheck}
          accent="brand"
        />
        <StatCard
          label="Requieren atención"
          value={atencion.length}
          sub={atencion.length === 0 ? 'Todo en orden' : 'Ábrelas para ver qué pasa'}
          icon={TriangleAlert}
          accent={atencion.length > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="En preparación"
          value={enPreparacion}
          sub="Hacia dónde va Membego"
          icon={Hourglass}
          accent="warning"
        />
      </div>

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
