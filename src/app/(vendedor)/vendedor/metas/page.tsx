import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Target } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { vendedorDeUsuario, misComisiones } from '@/modules/excursiones/panel/queries'
import { metasDeVendedor, realesDeVendedor } from '@/modules/excursiones/metricas/queries'
import {
  rangoDePeriodo,
  progresoMeta,
  PERIODO_META_LABEL,
  type PeriodoMeta,
} from '@/modules/excursiones/metricas/nucleo'
import { MetaProgreso } from '@/components/excursiones/MetaProgreso'
import { formatDate } from '@/lib/format'
import { EmptyState } from '@/components/system/EmptyState'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis Metas' }

export default async function VendedorMetasPage() {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  const [metas, comisiones] = await Promise.all([
    metasDeVendedor(vendedor.companyId, vendedor.id),
    misComisiones(vendedor.companyId, vendedor.id),
  ])

  const ahora = new Date()
  const misMetas = await Promise.all(
    metas.map(async (m) => {
      const rango = rangoDePeriodo(m.periodo as PeriodoMeta, ahora, {
        desde: m.desde,
        hasta: m.hasta,
      })
      const reales = await realesDeVendedor(vendedor.companyId, vendedor.id, rango, m.excursionId)
      return {
        id: m.id,
        periodo: m.periodo,
        rango,
        excursionNombre: m.excursionNombre,
        excursionTipoItem: m.excursionTipoItem,
        lineas: progresoMeta(m, reales),
      }
    })
  )

  return (
    <div className="space-y-6">
      <div className="border-b border-border/60 pb-3">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          Metas & Objetivos de Venta
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Da seguimiento en tiempo real al cumplimiento de tus objetivos comerciales asignados por la empresa.
        </p>
      </div>

      {misMetas.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No tienes metas asignadas actualmente"
          description="Tu supervisor o la administración no ha establecido metas específicas para tu cuenta o tu categoría en este período."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 items-start">
          {misMetas.map((m) => (
            <article key={m.id} className="rounded-2xl border border-border/80 bg-card p-5 space-y-3 shadow-sm hover:border-primary/30 transition-all">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-foreground">
                    {PERIODO_META_LABEL[m.periodo as PeriodoMeta] ?? m.periodo}
                  </span>
                  {m.excursionNombre ? (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                      {m.excursionTipoItem === 'COMBO' ? '📦 Combo: ' : '🎯 '}
                      {m.excursionNombre}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground font-medium">
                  {formatDate(m.rango.desde)} → {formatDate(m.rango.hasta)}
                </span>
              </div>

              <MetaProgreso lineas={m.lineas} moneda={comisiones.moneda ?? 'DOP'} />
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
