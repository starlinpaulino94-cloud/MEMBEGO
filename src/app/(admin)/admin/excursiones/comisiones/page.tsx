import Link from 'next/link'
import { Coins, SlidersHorizontal, ArrowLeftRight, AlertCircle } from 'lucide-react'
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

      {/* ── BANNER / RESUMEN DE TASAS PREDETERMINADAS ── */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Tasas de Cambio & Moneda Predeterminada</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Moneda base:</span>
            <span className="font-mono font-bold text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-md">
              {config.monedaDefecto}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Tasas configuradas */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Tasas activas:</span>
            {Object.keys(config.tasasCambio).length > 0 ? (
              Object.entries(config.tasasCambio).map(([k, v]) => (
                <span key={k} className="font-mono bg-muted px-2 py-0.5 rounded border border-border text-foreground">
                  {k.replace('_', ' → ')}: {v}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground italic">Ninguna tasa configurada (asumiendo 1:1)</span>
            )}
          </div>

          {/* Estadísticas de comisiones con tasa */}
          <div className="flex flex-wrap items-center gap-2">
            {resumen.comisionesConConversion > 0 ? (
              <span className="font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                💱 {resumen.comisionesConConversion} de {resumen.totalComisiones} comisiones convertidas con tasa
              </span>
            ) : (
              <span className="text-muted-foreground">
                Todas las comisiones están en moneda base ({config.monedaDefecto})
              </span>
            )}

            {resumen.comisionesReglaGeneral > 0 && (
              <span className="font-medium bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-md">
                {resumen.comisionesReglaGeneral} con regla general predeterminada
              </span>
            )}
          </div>
        </div>

        {resumen.comisionesSinTasaConfigurada > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p>
              Hay <strong>{resumen.comisionesSinTasaConfigurada} comisiones</strong> en divisas sin tasa de cambio registrada en la empresa (se asumió 1:1 provisionalmente).
            </p>
          </div>
        )}

        {/* Desglose por moneda original si hay multi-moneda */}
        {resumen.desgloseMonedas.length > 1 && (
          <div className="pt-2 border-t border-border/50 text-xs">
            <span className="text-muted-foreground font-semibold block mb-1.5">Desglose por divisa de origen:</span>
            <div className="flex flex-wrap gap-2">
              {resumen.desgloseMonedas.map((m) => (
                <div key={m.moneda} className="rounded-lg bg-muted/40 border border-border/60 px-2.5 py-1 text-xs">
                  <span className="font-semibold text-foreground">{m.moneda}</span>: {formatMoney(m.totalOriginal, { moneda: m.moneda }, 2)}
                  {m.moneda !== config.monedaDefecto && (
                    <span className="text-muted-foreground ml-1">
                      → {formatMoney(m.totalConvertido, { moneda: config.monedaDefecto }, 2)} ({m.tasaLabel})
                    </span>
                  )}
                  <span className="text-muted-foreground ml-1">({m.cantidad} comisi{m.cantidad === 1 ? 'ón' : 'ones'})</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
