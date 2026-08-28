import { requireRole } from '@/lib/auth/guards'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import Form from 'next/form'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EnlacesPromocion } from '@/components/adquisicion/EnlacesPromocion'
import { getAdquisicion, type AdquisicionFiltro } from '@/modules/adquisicion/queries'
import { landingUrl } from '@/lib/site'
import { Compass, Share2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Origen de clientes' }

/**
 * Atribución de marketing (docs/ADQUISICION.md): ¿de dónde llegan los
 * clientes? Compara Facebook, Instagram, tarjetas en la calle, invitaciones
 * y registros directos para saber qué método funciona mejor.
 */
export default async function AdquisicionPage({
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
    'adquisicion: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => tx.company.findUnique({
      where: { id: companyId },
      select: { zonaHoraria: true },
    })
  )
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const fmtFecha = (d: Date) =>
    new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'medium' }).format(d)

  const filtro: AdquisicionFiltro = { desde: sp.desde, hasta: sp.hasta }
  const hayFiltro = Boolean(sp.desde || sp.hasta)
  const data = await getAdquisicion(companyId, filtro)
  const topCanal = data.porCanal[0]
  const maxRegistros = topCanal?.registros ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Origen de clientes"
        description="De dónde llegan los que se registran: redes, tarjetas en la calle, invitaciones… para saber qué método funciona mejor."
      />

      {/* Filtro por período */}
      <Form
        action="/admin/adquisicion"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4"
      >
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Desde</span>
          <Input type="date" name="desde" defaultValue={sp.desde ?? ''} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Hasta</span>
          <Input type="date" name="hasta" defaultValue={sp.hasta ?? ''} />
        </label>
        <Button type="submit" variant="secondary">Aplicar</Button>
        {hayFiltro && (
          <Button asChild variant="ghost">
            <a href="/admin/adquisicion">Ver todo</a>
          </Button>
        )}
      </Form>

      {/* KPIs */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Registros en el período', valor: String(data.total) },
          { label: 'Canal que más trae', valor: topCanal ? topCanal.label : '—' },
          {
            label: 'Con canal de marketing',
            valor: data.total > 0 ? `${Math.round((data.conCanal / data.total) * 100)}%` : '—',
          },
          { label: 'Canales distintos', valor: String(data.porCanal.length) },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 truncate text-lg font-bold text-foreground">{k.valor}</dd>
          </div>
        ))}
      </dl>

      {/* Ranking por canal */}
      <section className="rounded-2xl border border-border/70 bg-card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Registros por canal
        </h2>
        {data.porCanal.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay registros en el período.</p>
        ) : (
          <ul className="space-y-2.5">
            {data.porCanal.map((c) => (
              <li key={c.canal}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {c.registros} · {c.porcentaje}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${maxRegistros > 0 ? Math.max(4, (c.registros / maxRegistros) * 100) : 0}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Enlaces para promocionar */}
      <section className="rounded-2xl border border-border/70 bg-card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          <Share2 className="h-4 w-4" /> Enlaces para promocionar
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Usa el enlace del canal donde publiques: el de Facebook en tus posts de Facebook, el QR
          de &quot;Tarjeta en la calle&quot; impreso en las tarjetas… Cualquiera que se registre
          después de abrirlo (hasta 30 días) queda contado en ese canal.
        </p>
        <EnlacesPromocion baseUrl={landingUrl()} />
      </section>

      {/* Últimos registros */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Últimos registros
        </h2>
        {data.recientes.length === 0 ? (
          <EmptyState
            icon={<Compass className="h-7 w-7" />}
            title="Sin registros en el período"
            description="Cuando alguien se registre con tus enlaces de promoción, aquí verás por cuál canal llegó."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-4 py-3 font-semibold">Canal</th>
                  <th className="px-4 py-3 font-semibold">Registrado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.recientes.map((r) => (
                  <tr key={r.clienteId}>
                    <td className="max-w-56 px-4 py-3">
                      <p className="truncate font-medium text-foreground">{r.nombre}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.contacto ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                          r.canal === 'directo'
                            ? 'bg-muted text-muted-foreground'
                            : r.canal === 'invitacion'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-success/10 text-success'
                        }`}
                      >
                        {r.canalLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {fmtFecha(r.fecha)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
