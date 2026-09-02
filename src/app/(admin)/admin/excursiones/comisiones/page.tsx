import Link from 'next/link'
import { Coins, SlidersHorizontal } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  listadoComisiones,
  resumenComisiones,
} from '@/modules/excursiones/comisiones/queries'
import {
  ESTADO_COMISION_LABEL,
  TONO_COMISION,
  type EstadoComision,
} from '@/modules/excursiones/comisiones/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ComisionAcciones } from '@/components/excursiones/ComisionAcciones'
import { StatusChip } from '@/components/ui/status-chip'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import { formatDate, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comisiones' }

export default async function ComisionesPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las comisiones de excursiones" />

  const [comisiones, resumen] = await Promise.all([
    listadoComisiones(companyId),
    resumenComisiones(companyId),
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

      {resumen.length > 0 ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {resumen.map((r) => (
            <div key={r.estado} className="rounded-xl border border-border bg-card p-3 text-center">
              <dd className="text-h3 text-foreground">{formatMoney(r.total, { moneda: r.moneda }, 2)}</dd>
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
        <div className="space-y-3">
          {comisiones.map((c) => (
            <article key={c.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">
                    {c.vendedor}{' '}
                    {c.vendedorCodigo ? (
                      <span className="font-mono text-caption text-muted-foreground">
                        {c.vendedorCodigo}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    Venta{' '}
                    {c.venta ? (
                      <Link href={`/admin/excursiones/ventas/${c.venta.id}`} className="font-mono text-foreground underline-offset-2 hover:underline">
                        {c.venta.numero}
                      </Link>
                    ) : (
                      <span className="font-mono">—</span>
                    )}{' '}
                    {formatDate(c.createdAt)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{c.desglose}</p>
                </div>
                <div className="text-right">
                  <p className="text-h3 text-foreground">
                    {formatMoney(c.neto, { moneda: c.moneda }, 2)}
                  </p>
                  {c.neto !== c.monto ? (
                    <p className="text-caption text-muted-foreground">
                      Generada: {formatMoney(c.monto, { moneda: c.moneda }, 2)}
                    </p>
                  ) : null}
                  <StatusChip tone={TONO_COMISION[c.estado as EstadoComision] ?? 'neutral'}>
                    {ESTADO_COMISION_LABEL[c.estado as EstadoComision] ?? c.estado}
                  </StatusChip>
                </div>
              </div>

              {c.ajustes.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-border pt-2">
                  {c.ajustes.map((a, i) => (
                    <li key={i} className="text-caption text-muted-foreground">
                      Ajuste {a.monto > 0 ? '+' : ''}
                      {formatMoney(a.monto, { moneda: c.moneda }, 2)} · {a.motivo}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 border-t border-border pt-3">
                <ComisionAcciones comisionId={c.id} estado={c.estado as EstadoComision} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
