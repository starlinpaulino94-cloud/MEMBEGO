import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
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
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { CreditCard, HeartHandshake } from 'lucide-react'
import { Tabla } from '@/components/ui/tabla'
import { EstadoChip, type TonoEstado } from '@/components/ui/estado-chip'

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

const TONO_GIFTCARD: Record<string, TonoEstado> = {
  PENDIENTE_PAGO: 'aviso',
  ACTIVA: 'exito',
  AGOTADA: 'neutro',
  CANCELADA: 'peligro',
}

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Regalos P2P' }

const TONO_REGALO: Record<string, TonoEstado> = {
  PENDIENTE: 'aviso',
  ACEPTADO: 'exito',
  RECHAZADO: 'peligro',
  EXPIRADO: 'neutro',
  CANCELADO: 'peligro',
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

  const empresa = await conEmpresa(companyId,
    (tx) => tx.company.findUnique({
      where: { id: companyId },
      select: { zonaHoraria: true },
    })
  )
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const fmtFecha = (d: Date) =>
    new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(d)

  const hayFiltro = Boolean(sp.estado || sp.tipo)
  const paginacion = leerPaginacion(sp)
  const [{ items, kpis, totalFiltrado }, config, giftCards] = await Promise.all([
    getRegalosAdmin(
      companyId,
      { estado: sp.estado, tipo: sp.tipo },
      { saltar: paginacion.saltar, tomar: paginacion.tomar }
    ),
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
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</dt>
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
          aria-label="Tipo de regalo"
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
          aria-label="Estado"
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
        <p className="ml-auto text-xs text-muted-foreground">
          {totalFiltrado.toLocaleString('es-DO')} regalo{totalFiltrado === 1 ? '' : 's'}
          {hayFiltro ? ' con estos filtros' : ''}
        </p>
      </Form>

      {items.length === 0 ? (
        <EmptyState
          icon={<HeartHandshake className="h-7 w-7" />}
          title={hayFiltro ? 'Sin regalos para el filtro' : 'Aún no hay regalos entre clientes'}
          description="Cuando un cliente transfiera usos o regale una promoción o membresía a otro, aparecerá aquí con todo su recorrido."
        />
      ) : (
        <Tabla
          caption="Regalos"
          claveDe={(r) => r.id}
          filas={items}
          columnas={[
            {
              clave: 'regalo',
              encabezado: 'Regalo',
              celda: (r) => (
                <div className="max-w-56">
                  <p className="truncate font-medium text-foreground">{r.beneficio}</p>
                  <p className="truncate text-caption font-normal text-muted-foreground">
                    {TIPO_REGALO_LABEL[r.tipo] ?? r.tipo}
                    {r.tipo === 'TRANSFERENCIA_USOS' ? ` · ${r.usos} uso${r.usos !== 1 ? 's' : ''}` : ''}
                    {r.mensaje ? ` · “${r.mensaje}”` : ''}
                  </p>
                  <p className="truncate text-caption font-normal text-muted-foreground">De {r.remitente}</p>
                </div>
              ),
            },
            {
              clave: 'para',
              encabezado: 'Para',
              prioridad: 2,
              celda: (r) => (
                <div className="max-w-40">
                  <p className="truncate text-foreground">{r.destinatario}</p>
                  {r.sinCuenta && <p className="text-caption text-muted-foreground">aún sin cuenta</p>}
                </div>
              ),
            },
            {
              clave: 'estado',
              encabezado: 'Estado',
              celda: (r) => (
                <>
                  {/* "Pendiente" a secas no dice si hay que cobrar algo o si solo falta que el destinatario responda. Lo primero es trabajo del
                      negocio; lo segundo no. */}
                  <EstadoChip tono={TONO_REGALO[r.estado] ?? 'neutro'}>
                    {r.espera === 'PAGO' ? 'Por cobrar' : r.espera === 'RESPUESTA' ? 'Esperando respuesta' : (ESTADO_REGALO_LABEL[r.estado] ?? r.estado)}
                  </EstadoChip>
                  {r.espera === 'PAGO' && (
                    <Link href="/admin/pagos" className="mt-1 block text-caption font-medium text-primary hover:underline">
                      {r.pago?.referencia ? `Cobrar ${r.pago.referencia}` : 'Ver en Pagos'}
                    </Link>
                  )}
                </>
              ),
            },
            {
              clave: 'fechas',
              encabezado: 'Enviado y expira',
              prioridad: 2,
              celda: (r) => (
                <span className="whitespace-nowrap text-caption text-muted-foreground">
                  <span className="block">Enviado {fmtFecha(r.createdAt)}</span>
                  <span className="block">
                    {r.estado === 'PENDIENTE' ? `Expira ${fmtFecha(r.expiraAt)}` : r.resueltoAt ? `Resuelto ${fmtFecha(r.resueltoAt)}` : ''}
                  </span>
                </span>
              ),
            },
            {
              clave: 'cancelar',
              encabezado: 'Cancelar',
              soloLector: true,
              alineacion: 'derecha',
              celda: (r) =>
                r.estado === 'PENDIENTE' ? (
                  <CancelarRegaloAdminButton regaloId={r.id} descripcion={`${r.beneficio} de ${r.remitente} para ${r.destinatario}`} />
                ) : null,
            },
          ]}
        />
      )}

      {/* Paginación: sin ella los regalos más viejos que la primera página
          quedaban fuera del alcance del negocio. */}
      {items.length > 0 && (
        <TablaPaginacion
          paginacion={paginacion}
          total={totalFiltrado}
          params={sp}
          etiqueta="regalos"
        />
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
          <Tabla
            caption="Tarjetas de regalo"
            claveDe={(g) => g.id}
            filas={giftCards.items}
            columnas={[
              {
                clave: 'codigo',
                encabezado: 'Código',
                celda: (g) => (
                  <>
                    <span className="block font-mono font-semibold text-foreground">{g.codigo}</span>
                    {g.mensaje && <span className="block max-w-44 truncate text-caption font-normal text-muted-foreground">“{g.mensaje}”</span>}
                    <span className="block whitespace-nowrap text-caption font-normal text-muted-foreground">Creada {fmtFecha(g.createdAt)}</span>
                    <span className="block max-w-44 truncate text-caption font-normal text-muted-foreground">De {g.comprador}</span>
                  </>
                ),
              },
              {
                clave: 'para',
                encabezado: 'Para',
                prioridad: 2,
                celda: (g) => (
                  <div className="max-w-40">
                    <p className="truncate text-foreground">{g.destinatario}</p>
                    {g.sinCuenta && <p className="text-caption text-muted-foreground">aún sin cuenta</p>}
                  </div>
                ),
              },
              { clave: 'monto', encabezado: 'Monto', alineacion: 'derecha', celda: (g) => <span className="font-semibold text-foreground">{fmtRD(g.monto)}</span> },
              { clave: 'saldo', encabezado: 'Saldo', alineacion: 'derecha', celda: (g) => (g.estado === 'PENDIENTE_PAGO' ? '—' : fmtRD(g.saldo)) },
              {
                clave: 'estado',
                encabezado: 'Estado',
                celda: (g) => <EstadoChip tono={TONO_GIFTCARD[g.estado] ?? 'neutro'}>{ESTADO_GIFTCARD_LABEL[g.estado] ?? g.estado}</EstadoChip>,
              },
              {
                clave: 'acciones',
                encabezado: 'Acciones',
                soloLector: true,
                celda: (g) => <GiftCardAdminActions giftCardId={g.id} codigo={g.codigo} estado={g.estado} monto={g.monto} saldo={g.saldo} />,
              },
            ]}
          />
        )}
      </section>
    </div>
  )
}

