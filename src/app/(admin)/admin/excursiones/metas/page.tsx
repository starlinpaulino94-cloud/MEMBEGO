import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  metasActivas,
  realesDeVendedor,
} from '@/modules/excursiones/metricas/queries'
import {
  rangoDePeriodo,
  progresoMeta,
  PERIODO_META_LABEL,
  type PeriodoMeta,
} from '@/modules/excursiones/metricas/nucleo'
import { vendedoresParaSupervisor } from '@/modules/excursiones/vendedores/queries'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { MetaForm } from '@/components/excursiones/MetaForm'
import { MetaProgreso } from '@/components/excursiones/MetaProgreso'
import { ArchivarMetaBoton } from '@/components/excursiones/ArchivarMetaBoton'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Metas' }

export default async function MetasPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las metas de excursiones" />

  const [metas, vendedores] = await Promise.all([
    metasActivas(companyId),
    vendedoresParaSupervisor(companyId),
  ])

  // El progreso se calcula ahora, sobre el período que le toca a cada meta.
  const ahora = new Date()
  const conProgreso = await Promise.all(
    metas.map(async (m) => {
      const rango = rangoDePeriodo(m.periodo as PeriodoMeta, ahora, {
        desde: m.desde,
        hasta: m.hasta,
      })
      const reales = await realesDeVendedor(companyId, m.vendedorId, rango)
      return { meta: m, rango, lineas: progresoMeta(m, reales) }
    })
  )

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="text-sm text-muted-foreground">
        Una meta dice qué se espera de cada vendedor en un período. El avance se calcula al
        abrir esta pantalla, sobre sus registros, reservas y ventas reales.
      </p>

      <MetaForm
        vendedores={vendedores.map((v) => ({
          id: v.id,
          nombre: `${v.nombre} ${v.apellido ?? ''}`.trim(),
          codigo: v.codigo,
        }))}
      />

      {conProgreso.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-h3 text-foreground">Metas activas</h2>
          {conProgreso.map(({ meta, rango, lineas }) => (
            <article key={meta.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">
                    {meta.vendedor}{' '}
                    {meta.codigo ? (
                      <span className="font-mono text-caption text-muted-foreground">
                        {meta.codigo}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {PERIODO_META_LABEL[meta.periodo as PeriodoMeta] ?? meta.periodo} ·{' '}
                    {formatDate(rango.desde)} → {formatDate(rango.hasta)}
                  </p>
                </div>
                <ArchivarMetaBoton metaId={meta.id} />
              </div>
              <div className="mt-3">
                <MetaProgreso lineas={lineas} moneda="DOP" />
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  )
}
