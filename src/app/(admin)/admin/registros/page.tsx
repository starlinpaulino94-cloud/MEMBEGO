import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import Form from 'next/form'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FacturaPrintDialog } from '@/components/facturas/FacturaPrintDialog'
import { ImprimirReporteButton } from '@/components/registros/ImprimirReporteButton'
import { AnularTransaccionButton } from '@/components/registros/AnularTransaccionButton'
import {
  getRegistros,
  TIPO_LABEL,
  ESTADO_LABEL,
  METODO_LABEL,
  type RegistroFiltro,
} from '@/modules/registros/queries'
import { FileText, Search, Download } from 'lucide-react'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Registros' }

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

const ESTADO_CHIP: Record<string, string> = {
  APPLIED: 'bg-success/15 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
  REVERTED: 'bg-warning/15 text-warning',
  ERROR: 'bg-destructive/10 text-destructive',
}

/**
 * Registros / Comprobantes (Control de comprobantes · Fase 3 · G7+G10).
 *
 * Vista unificada de TODAS las transacciones (ventas, usos de membresía,
 * promociones, beneficios, canjes, referidos…), con filtros por tipo, estado,
 * método y rango de fechas, resumen agregado, reimpresión de cualquier
 * comprobante, exportación a CSV e impresión del reporte.
 */
export default async function RegistrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const sp = await searchParams

  const empresa = companyId
    ? await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, zonaHoraria: true },
      })
    : null
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'

  const filtro: RegistroFiltro = {
    q: sp.q,
    tipo: sp.tipo,
    estado: sp.estado,
    metodo: sp.metodo,
    desde: sp.desde,
    hasta: sp.hasta,
  }
  const hayFiltro = Boolean(sp.q || sp.tipo || sp.estado || sp.metodo || sp.desde || sp.hasta)

  // Paginación del servidor: con el total real se puede alcanzar CUALQUIER
  // comprobante para reimprimirlo, no solo los más recientes.
  const paginacion = leerPaginacion(sp)
  const { items, resumen, total } = await getRegistros(companyId, filtro, timeZone, {
    saltar: paginacion.saltar,
    tomar: paginacion.tomar,
  })

  const fmtFecha = (iso: string) =>
    new Intl.DateTimeFormat('es-DO', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))

  // Query string para el enlace de exportación (mismos filtros).
  const exportQs = new URLSearchParams(
    Object.entries(filtro).filter(([, v]) => v) as [string, string][]
  ).toString()

  const kpis = [
    { label: 'Ingresos (aplicados)', valor: fmtRD(resumen.total) },
    { label: 'Operaciones con monto', valor: String(resumen.cantidad) },
    { label: 'Efectivo', valor: fmtRD(resumen.porMetodo.efectivo) },
    { label: 'Transferencia', valor: fmtRD(resumen.porMetodo.transferencia) },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registros y comprobantes"
        description="Todo lo que pasa por la empresa, en un solo lugar: ventas, usos, promociones, beneficios y canjes. Filtra, reimprime, exporta."
      />

      {/* Filtros */}
      <Form action="/admin/registros" className="grid gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="Nº, código TX o cliente…" className="pl-9" />
        </div>
        <select
          name="tipo"
          defaultValue={sp.tipo ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          name="estado"
          defaultValue={sp.estado ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          name="metodo"
          defaultValue={sp.metodo ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los métodos</option>
          {Object.entries(METODO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">Desde</span>
          <Input type="date" name="desde" defaultValue={sp.desde ?? ''} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">Hasta</span>
          <Input type="date" name="hasta" defaultValue={sp.hasta ?? ''} />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" variant="secondary" className="flex-1">Aplicar</Button>
          {hayFiltro && (
            <Button asChild variant="ghost">
              <a href="/admin/registros">Limpiar</a>
            </Button>
          )}
        </div>
      </Form>

      {/* Resumen (KPIs) */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 truncate text-lg font-bold tabular-nums text-foreground">{k.valor}</dd>
          </div>
        ))}
      </dl>

      {/* Acciones del reporte */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString('es-DO')} registro{total !== 1 ? 's' : ''}
          {hayFiltro ? ' con estos filtros' : ''}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`/admin/registros/export${exportQs ? `?${exportQs}` : ''}`}>
              <Download className="h-3.5 w-3.5" /> Exportar CSV
            </a>
          </Button>
          {items.length > 0 && <ImprimirReporteButton />}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-7 w-7" />}
          title={hayFiltro ? 'Sin registros para el filtro' : 'Aún no hay registros'}
          description="Cada operación (venta, uso, promoción, beneficio o canje) queda aquí con su comprobante, para siempre."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Comprobante</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Detalle</th>
                <th className="px-4 py-3 font-semibold">Empleado</th>
                <th className="px-4 py-3 text-right font-semibold">Monto</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map((r) => (
                <tr key={r.id} className="align-middle">
                  <td className="px-4 py-3">
                    <p className="font-mono font-semibold text-foreground">{r.ticketNumero}</p>
                    <p className="font-mono text-xs text-muted-foreground">{r.codigo}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {r.tipoLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground">{r.cliente ?? '—'}</td>
                  <td className="max-w-52 px-4 py-3">
                    <p className="truncate text-foreground">{r.detalle ?? '—'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.metodoCobro ? METODO_LABEL[r.metodoCobro] ?? r.metodoCobro : (r.esEntrega ? 'Sin costo' : '')}
                      {r.sucursal ? ` · ${r.sucursal}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-foreground">{r.empleado ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                    {r.monto == null ? '—' : fmtRD(r.monto)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ESTADO_CHIP[r.estado] ?? 'bg-muted text-muted-foreground'}`}
                    >
                      {r.estadoLabel}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {fmtFecha(r.fecha)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <FacturaPrintDialog transactionId={r.id} yaImpresa={r.impresiones > 0} />
                      {r.estado === 'APPLIED' && (
                        <AnularTransaccionButton transactionId={r.id} referencia={r.ticketNumero} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación: los filtros activos viajan en cada enlace. Sin esto, los
          comprobantes más viejos que la primera página eran inalcanzables. */}
      {items.length > 0 && (
        <TablaPaginacion
          paginacion={paginacion}
          total={total}
          params={sp}
          etiqueta="registros"
        />
      )}

      {/* Reporte imprimible (aislado por @media print) */}
      {items.length > 0 && (
        <div className="registros-print hidden" aria-hidden>
          <style>{`
            @media print {
              @page { margin: 12mm; }
              body * { visibility: hidden !important; }
              .registros-print, .registros-print * { visibility: visible !important; }
              .registros-print { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
            }
          `}</style>
          <div className="text-black">
            <h1 className="text-lg font-bold">{empresa?.name ?? 'MembeGo'} · Reporte de registros</h1>
            <p className="text-xs">
              Generado {fmtFecha(new Date().toISOString())} · {items.length} de {total} registros
            </p>
            <div className="my-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span><strong>Ingresos:</strong> {fmtRD(resumen.total)}</span>
              <span><strong>Operaciones:</strong> {resumen.cantidad}</span>
              <span><strong>Efectivo:</strong> {fmtRD(resumen.porMetodo.efectivo)}</span>
              <span><strong>Transferencia:</strong> {fmtRD(resumen.porMetodo.transferencia)}</span>
              <span><strong>Otro:</strong> {fmtRD(resumen.porMetodo.otro)}</span>
            </div>
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="py-1 pr-2">Fecha</th>
                  <th className="py-1 pr-2">Comprobante</th>
                  <th className="py-1 pr-2">Tipo</th>
                  <th className="py-1 pr-2">Cliente</th>
                  <th className="py-1 pr-2">Empleado</th>
                  <th className="py-1 pr-2 text-right">Monto</th>
                  <th className="py-1 pr-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-black/20">
                    <td className="py-0.5 pr-2 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                    <td className="py-0.5 pr-2 font-mono">{r.ticketNumero}</td>
                    <td className="py-0.5 pr-2">{r.tipoLabel}</td>
                    <td className="py-0.5 pr-2">{r.cliente ?? '—'}</td>
                    <td className="py-0.5 pr-2">{r.empleado ?? '—'}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{r.monto == null ? '—' : fmtRD(r.monto)}</td>
                    <td className="py-0.5 pr-2">{r.estadoLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
