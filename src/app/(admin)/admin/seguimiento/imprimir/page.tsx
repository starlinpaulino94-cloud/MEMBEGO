import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { Button } from '@/components/ui/button'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import {
  getSeguimiento,
  getConversionPorPromo,
  SEGUIMIENTO_ESTADO_LABEL,
  type SeguimientoFiltro,
} from '@/modules/seguimiento/queries'
import { getSeguimientoConfig } from '@/modules/seguimiento/config'
import { ArrowLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reporte de recompensas' }

/**
 * Seguimiento · Fase S3: reporte imprimible (por promoción y por período).
 * Mismos filtros que la pantalla principal; layout limpio para papel con
 * conversión otorgadas → usadas por recompensa.
 */
export default async function SeguimientoImprimirPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const sp = await searchParams
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const empresa = await conEmpresaOTodas(
    companyId,
    'seguimiento · imprimir: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => tx.company.findUnique({
      where: { id: companyId },
      select: { name: true, zonaHoraria: true },
    })
  )
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const fmtFecha = (d: Date | null) =>
    d ? new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'medium' }).format(d) : '—'
  const fmtFechaHora = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(d)
      : '—'

  const filtro: SeguimientoFiltro = {
    estado: sp.estado,
    promocionId: sp.promo,
    q: sp.q,
    desde: sp.desde,
    hasta: sp.hasta,
  }
  const config = await getSeguimientoConfig(companyId)
  const [{ items, kpis }, conversion] = await Promise.all([
    getSeguimiento(companyId, filtro, config, 1000),
    getConversionPorPromo(companyId, { desde: sp.desde, hasta: sp.hasta }, config),
  ])

  const periodo =
    sp.desde || sp.hasta
      ? `Período: ${sp.desde ?? 'inicio'} → ${sp.hasta ?? 'hoy'}`
      : 'Período: todo el historial'
  const generado = new Intl.DateTimeFormat('es-DO', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date())
  const qs = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => !!v) as [string, string][]
  ).toString()

  return (
    <ReporteImprimible
      titulo={`Reporte de recompensas gratis · ${empresa?.name ?? ''}`}
      subtitulo={periodo}
      generadoEn={generado}
      controles={<BotonImprimir variant="outline" />}
    >
      {/* El `@media print` ya no vive aquí: lo pone `ReporteImprimible`, que es
          el único sitio del panel donde está escrito. Eran cinco copias del
          mismo truco de CSS, cada una con su propia variante. */}
      <div className="print:hidden">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href={`/admin/seguimiento${qs ? `?${qs}` : ''}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Volver al seguimiento
          </Link>
        </Button>
      </div>

      {/* Resumen */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Resumen
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 print:grid-cols-5">
          {[
            ['Otorgadas', kpis.total],
            ['Sin usar', kpis.sinUsar],
            ['Por vencer', kpis.porVencer],
            ['Usadas', kpis.usados],
            ['Perdidas (vencidas)', kpis.vencidos],
          ].map(([label, valor]) => (
            <div key={String(label)} className="rounded-xl border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">{label}</p>
              <p className="text-lg font-bold tabular-nums">{valor}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Tasa de uso global: <strong className="text-foreground">{kpis.tasaUso == null ? '—' : `${kpis.tasaUso}%`}</strong>
          {kpis.antiguedadPromedioSinUsar != null &&
            ` · Las sin usar llevan en promedio ${kpis.antiguedadPromedioSinUsar} días esperando.`}
        </p>
      </section>

      {/* Conversión por promoción */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Conversión por recompensa (otorgadas → usadas)
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-2">Recompensa</th>
              <th className="py-2 pr-2 text-right">Otorgadas</th>
              <th className="py-2 pr-2 text-right">Sin usar</th>
              <th className="py-2 pr-2 text-right">Usadas</th>
              <th className="py-2 pr-2 text-right">Vencidas</th>
              <th className="py-2 text-right">Tasa de uso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {conversion.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-muted-foreground">
                  Sin datos en el período.
                </td>
              </tr>
            ) : (
              conversion.map((c) => (
                <tr key={c.promocionId}>
                  <td className="py-2 pr-2 font-medium text-foreground">{c.titulo}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{c.total}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{c.sinUsar}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{c.usados}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{c.vencidos}</td>
                  <td className="py-2 text-right tabular-nums">
                    {c.tasaUso == null ? '—' : `${c.tasaUso}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Detalle */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Detalle ({items.length} recompensa{items.length !== 1 ? 's' : ''})
        </h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left uppercase text-muted-foreground">
              <th className="py-1.5 pr-2">Cliente</th>
              <th className="py-1.5 pr-2">Recompensa</th>
              <th className="py-1.5 pr-2">Estado</th>
              <th className="py-1.5 pr-2">Otorgado</th>
              <th className="py-1.5 pr-2">Vence</th>
              <th className="py-1.5">Usado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {items.map((r) => (
              <tr key={r.compraId} className="break-inside-avoid">
                <td className="py-1.5 pr-2">
                  <span className="font-medium text-foreground">{r.cliente}</span>
                  {(r.telefono || r.email) && (
                    <span className="text-muted-foreground"> · {r.telefono ?? r.email}</span>
                  )}
                </td>
                <td className="py-1.5 pr-2">{r.promocion}</td>
                <td className="py-1.5 pr-2">
                  {SEGUIMIENTO_ESTADO_LABEL[r.estado]}
                  {r.canjeInterno ? ' (interno)' : ''}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2">{fmtFecha(r.otorgadoAt)}</td>
                <td className="whitespace-nowrap py-1.5 pr-2">{fmtFecha(r.venceAt)}</td>
                <td className="whitespace-nowrap py-1.5">
                  {r.usadoAt ? `${fmtFechaHora(r.usadoAt)}${r.usadoPor ? ` · ${r.usadoPor}` : ''}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </ReporteImprimible>
  )
}
