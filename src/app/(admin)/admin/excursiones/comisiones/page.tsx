import Link from 'next/link'
import { Coins, SlidersHorizontal } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  listadoComisiones,
  resumenComisiones,
  vendedoresParaFiltro,
} from '@/modules/excursiones/comisiones/queries'
import {
  ESTADO_COMISION_LABEL,
  type EstadoComision,
} from '@/modules/excursiones/comisiones/nucleo'
import { getExcursionesConfig } from '@/modules/excursiones/config'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ComisionesLista } from '@/components/excursiones/ComisionesLista'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comisiones' }

export default async function ComisionesPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las comisiones de excursiones" />

  const [comisiones, resumen, config, vendedores] = await Promise.all([
    listadoComisiones(companyId),
    resumenComisiones(companyId),
    getExcursionesConfig(companyId),
    vendedoresParaFiltro(companyId),
  ])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cada comisión guarda dentro la regla con la que nació. Cambiar una regla afecta a lo
          que venga, nunca a lo que ya se generó.
        </p>
        <Button asChild variant="outline">
          <Link href="/admin/excursiones/comisiones/reglas">
            <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Reglas de comisión
          </Link>
        </Button>
      </div>

      {resumen.porEstado.length > 0 ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {resumen.porEstado.map((r) => (
            <div key={r.estado} className="rounded-xl border border-border bg-card p-3 text-center">
              <dd className="text-h3 text-foreground">{formatMoney(r.total, { moneda: config.monedaDefecto }, 2)}</dd>
              <dt className="text-caption text-muted-foreground">
                {ESTADO_COMISION_LABEL[r.estado as EstadoComision] ?? r.estado} · {r.cantidad}
              </dt>
            </div>
          ))}
        </dl>
      ) : null}

      {comisiones.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="Todavía no hay comisiones"
          description="Una comisión nace cuando se confirma la venta de una reserva saldada, y solo si hay una regla que diga cuánto se paga. Define tus reglas para empezar."
          action={
            <Button asChild size="lg">
              <Link href="/admin/excursiones/comisiones/reglas">Definir reglas</Link>
            </Button>
          }
        />
      ) : (
        <ComisionesLista
          comisiones={comisiones}
          vendedores={vendedores}
          monedaDefecto={config.monedaDefecto}
        />
      )}
    </div>
  )
}
