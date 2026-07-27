import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import Form from 'next/form'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { CancelarRegaloAdminButton } from '@/components/regalos/CancelarRegaloAdminButton'
import { RegalosConfigCard } from '@/components/regalos/RegalosConfigCard'
import { GiftCardAdminActions } from '@/components/regalos/GiftCardAdminActions'
import { getRegalosConfig } from '@/modules/regalos/config'
import { getGiftCardsAdmin, ESTADO_GIFTCARD_LABEL } from '@/modules/regalos/giftcards'
import {
  getRegalosAdmin,
  TIPO_REGALO_LABEL,
  ESTADO_REGALO_LABEL,
} from '@/modules/regalos/queries'
import { CreditCard, HeartHandshake } from 'lucide-react'

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

const GIFTCARD_CHIP: Record<string, string> = {
  PENDIENTE_PAGO: 'bg-warning/15 text-warning-foreground',
  ACTIVA: 'bg-success/15 text-success',
  AGOTADA: 'bg-muted text-muted-foreground',
  CANCELADA: 'bg-destructive/10 text-destructive',
}

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Regalos P2P' }

const ESTADO_CHIP: Record<string, string> = {
  PENDIENTE: 'bg-warning/15 text-warning-foreground',
  ACEPTADO: 'bg-success/15 text-success',
  RECHAZADO: 'bg-destructive/10 text-destructive',
  EXPIRADO: 'bg-muted text-muted-foreground',
  CANCELADO: 'bg-destructive/10 text-destructive',
}

/**
 * Regalos P2P · Fase R4 — vista del negocio: quién regaló qué a quién, salud
 * del programa (KPIs) y cancelación de pendientes (soporte/anti-abuso).
 */
export default async function RegalosAdminPage({
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

  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: { zonaHoraria: true },
  })
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const fmtFecha = (d: Date) =>
    new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(d)

  const hayFiltro = Boolean(sp.estado || sp.tipo)
  const [{ items, kpis, truncado }, config, giftCards] = await Promise.all([
    getRegalosAdmin(companyId, { estado: sp.estado, tipo: sp.tipo }),
    getRegalosConfig(companyId),
    getGiftCardsAdmin(companyId).catch(() => ({
      items: [],
      kpis: { porCobrar: 0, activas: 0, saldoVigente: 0 },
    })),
  ])

  const tarjetas = [
    { label: 'Regalos totales', valor: String(kpis.total) },
    { label: 'Pendientes', valor: String(kpis.pendientes) },
    { label: 'Aceptados', valor: String(kpis.aceptados) },
    {
      label: 'Tasa de aceptación',
      valor: kpis.tasaAceptacion == null ? '—' : `${kpis.tasaAceptacion}%`,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regalos entre clientes"
        description="Transferencias de usos y regalos pagados entre tus clientes: quién envió qué a quién, en qué quedó cada uno, y cancelación de pendientes si hace falta."
      />

      {/* KPIs */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tarjetas.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 truncate text-lg font-bold tabular-nums text-foreground">{k.valor}</dd>
          </div>
        ))}
      </dl>

      {/* Configuración del programa */}
      <RegalosConfigCard config={config} />

      {/* Filtros */}
      <Form
        action="/admin/regalos"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-4"
      >
        <select
          name="tipo"
          defaultValue={sp.tipo ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_REGALO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          name="estado"
          defaultValue={sp.estado ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_REGALO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary">Aplicar</Button>
        {hayFiltro && (
          <Button asChild variant="ghost">
            <a href="/admin/regalos">Limpiar</a>
          </Button>
        )}
        {truncado && (
          <p className="ml-auto text-xs text-muted-foreground">
            Mostrando los {items.length} más recientes.
          </p>
        )}
      </Form>

      {items.length === 0 ? (
        <EmptyState
          icon={<HeartHandshake className="h-7 w-7" />}
          title={hayFiltro ? 'Sin regalos para el filtro' : 'Aún no hay regalos entre clientes'}
          description="Cuando un cliente transfiera usos o regale una promoción o membresía a otro, aparecerá aquí con todo su recorrido."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Regalo</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 font-semibold">De</th>
                <th className="px-4 py-3 font-semibold">Para</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Enviado</th>
                <th className="px-4 py-3 font-semibold">Expira</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map((r) => (
                <tr key={r.id} className="align-middle">
                  <td className="max-w-56 px-4 py-3">
                    <p className="truncate font-medium text-foreground">{r.beneficio}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.tipo === 'TRANSFERENCIA_USOS'
                        ? `${r.usos} uso${r.usos !== 1 ? 's' : ''}`
                        : ''}
                      {r.mensaje ? `${r.tipo === 'TRANSFERENCIA_USOS' ? ' · ' : ''}“${r.mensaje}”` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {TIPO_REGALO_LABEL[r.tipo] ?? r.tipo}
                    </span>
                  </td>
                  <td className="max-w-40 truncate px-4 py-3 text-foreground">{r.remitente}</td>
                  <td className="max-w-40 px-4 py-3">
                    <p className="truncate text-foreground">{r.destinatario}</p>
                    {r.sinCuenta && (
                      <p className="text-[11px] text-muted-foreground">aún sin cuenta</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ESTADO_CHIP[r.estado] ?? 'bg-muted text-muted-foreground'}`}
                    >
                      {/* "Pendiente" a secas no dice si hay que cobrar algo o
                          si solo falta que el destinatario responda. Lo
                          primero es trabajo del negocio; lo segundo no. */}
                      {r.espera === 'PAGO'
                        ? 'Por cobrar'
                        : r.espera === 'RESPUESTA'
                          ? 'Esperando respuesta'
                          : (ESTADO_REGALO_LABEL[r.estado] ?? r.estado)}
                    </span>
                    {r.espera === 'PAGO' && (
                      <Link
                        href="/admin/pagos"
                        className="mt-1 block text-[11px] font-medium text-primary hover:underline"
                      >
                        {r.pago?.referencia ? `Cobrar ${r.pago.referencia}` : 'Ver en Pagos'}
                      </Link>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {fmtFecha(r.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {r.estado === 'PENDIENTE' ? fmtFecha(r.expiraAt) : r.resueltoAt ? fmtFecha(r.resueltoAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.estado === 'PENDIENTE' && (
                      <CancelarRegaloAdminButton
                        regaloId={r.id}
                        descripcion={`${r.beneficio} de ${r.remitente} para ${r.destinatario}`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Gift cards ─────────────────────────────────────────────────────── */}
      <section className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CreditCard className="h-4 w-4" aria-hidden /> Gift cards
          </h2>
          <p className="text-xs text-muted-foreground">
            {giftCards.kpis.porCobrar} por cobrar · {giftCards.kpis.activas} activa
            {giftCards.kpis.activas !== 1 ? 's' : ''} · saldo vigente{' '}
            {fmtRD(giftCards.kpis.saldoVigente)}
          </p>
        </div>

        {giftCards.items.length === 0 ? (
          <p className="rounded-2xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">
            Cuando un cliente compre una gift card aparecerá aquí para cobrarla,
            activarla y redimir sus consumos.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Código</th>
                  <th className="px-4 py-3 font-semibold">De</th>
                  <th className="px-4 py-3 font-semibold">Para</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto</th>
                  <th className="px-4 py-3 text-right font-semibold">Saldo</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Creada</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {giftCards.items.map((g) => (
                  <tr key={g.id} className="align-middle">
                    <td className="px-4 py-3">
                      <p className="font-mono font-semibold text-foreground">{g.codigo}</p>
                      {g.mensaje && (
                        <p className="max-w-44 truncate text-xs text-muted-foreground">“{g.mensaje}”</p>
                      )}
                    </td>
                    <td className="max-w-40 truncate px-4 py-3 text-foreground">{g.comprador}</td>
                    <td className="max-w-40 px-4 py-3">
                      <p className="truncate text-foreground">{g.destinatario}</p>
                      {g.sinCuenta && (
                        <p className="text-[11px] text-muted-foreground">aún sin cuenta</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                      {fmtRD(g.monto)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {g.estado === 'PENDIENTE_PAGO' ? '—' : fmtRD(g.saldo)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${GIFTCARD_CHIP[g.estado] ?? 'bg-muted text-muted-foreground'}`}
                      >
                        {ESTADO_GIFTCARD_LABEL[g.estado] ?? g.estado}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {fmtFecha(g.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <GiftCardAdminActions
                        giftCardId={g.id}
                        codigo={g.codigo}
                        estado={g.estado}
                        monto={g.monto}
                        saldo={g.saldo}
                      />
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
