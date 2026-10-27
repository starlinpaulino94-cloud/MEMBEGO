import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import Form from 'next/form'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BotonExportar } from '@/components/ui/boton-exportar'
import {
  getSeguimiento,
  getPromosGratisConEntregas,
  SEGUIMIENTO_ESTADO_LABEL,
  type SeguimientoFiltro,
} from '@/modules/seguimiento/queries'
import { Gift, Search, Printer } from 'lucide-react'
import { SeguimientoAcciones } from '@/components/seguimiento/SeguimientoAcciones'
import { SeguimientoConfigCard } from '@/components/seguimiento/SeguimientoConfigCard'
import { getSeguimientoConfig, renderMensajeSeguimiento } from '@/modules/seguimiento/config'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { Tabla } from '@/components/ui/tabla'
import { EstadoChip, type TonoEstado } from '@/components/ui/estado-chip'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Seguimiento de recompensas' }

const TONO_SEGUIMIENTO: Record<string, TonoEstado> = {
  SIN_USAR: 'aviso',
  USADO: 'exito',
  VENCIDO: 'peligro',
}

/**
 * Seguimiento de beneficios gratis (Fase S1 · docs/SEGUIMIENTO-BENEFICIOS.md):
 * control de los lavados gratis y recompensas entregadas — quién no ha usado
 * su QR, quién sí (y quién se lo canjeó), con filtros y KPIs.
 */
export default async function SeguimientoPage({
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
      select: { zonaHoraria: true, name: true },
    })
  )
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const empresaNombre = empresa?.name ?? 'la empresa'
  const fmtFecha = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat('es-DO', { timeZone, dateStyle: 'medium' }).format(d)
      : '—'
  const fmtFechaHora = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat('es-DO', {
          timeZone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(d)
      : '—'

  const filtro: SeguimientoFiltro = {
    estado: sp.estado,
    promocionId: sp.promo,
    q: sp.q,
    desde: sp.desde,
    hasta: sp.hasta,
  }
  const hayFiltro = Boolean(sp.estado || sp.promo || sp.q || sp.desde || sp.hasta)
  const qs = new URLSearchParams(
    Object.entries({ q: sp.q, estado: sp.estado, promo: sp.promo, desde: sp.desde, hasta: sp.hasta })
      .filter(([, v]) => !!v) as [string, string][]
  ).toString()

  const config = await getSeguimientoConfig(companyId)
  const paginacion = leerPaginacion(sp)
  const [{ items, kpis, truncado, total }, promos] = await Promise.all([
    getSeguimiento(companyId, filtro, config, 200, {
      saltar: paginacion.saltar,
      tomar: paginacion.tomar,
    }),
    getPromosGratisConEntregas(companyId),
  ])

  const tarjetas = [
    { label: 'Recompensas otorgadas', valor: String(kpis.total) },
    { label: 'Sin usar', valor: String(kpis.sinUsar) },
    { label: `Por vencer (≤${config.umbralPorVencerDias}d)`, valor: String(kpis.porVencer) },
    { label: 'Usadas', valor: String(kpis.usados) },
    {
      label: 'Tasa de uso',
      valor: kpis.tasaUso == null ? '—' : `${kpis.tasaUso}%`,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Seguimiento de recompensas"
        description="Control de los lavados gratis y recompensas entregadas: quién no ha usado su QR, quién sí, y a quién contactar para que venga."
      />

      {/* Reportes (Fase S3) */}
      <div className="flex flex-wrap items-center gap-2">
        <BotonExportar
          href={`/admin/seguimiento/export${qs ? `?${qs}` : ''}`}
          variant="outline"
          size="sm"
        />
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a href={`/admin/seguimiento/imprimir${qs ? `?${qs}` : ''}`}>
            <Printer className="h-3.5 w-3.5" /> Reporte imprimible
          </a>
        </Button>
      </div>

      {/* KPIs */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tarjetas.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 truncate text-lg font-bold tabular-nums text-foreground">{k.valor}</dd>
          </div>
        ))}
      </dl>
      {kpis.sinUsar > 0 && kpis.antiguedadPromedioSinUsar != null && (
        <p className="text-xs text-muted-foreground">
          Las recompensas sin usar llevan en promedio{' '}
          <strong className="text-foreground">{kpis.antiguedadPromedioSinUsar} días</strong>{' '}
          esperando. {kpis.vencidos > 0 && `Ya se perdieron ${kpis.vencidos} sin usarse.`}
        </p>
      )}

      {/* Filtros */}
      <Form
        action="/admin/seguimiento"
        className="grid grid-cols-1 gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="relative sm:col-span-2 lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="Cliente, teléfono o correo…" className="pl-9" />
        </div>
        <select
          name="estado"
          defaultValue={sp.estado ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los estados</option>
          {Object.entries(SEGUIMIENTO_ESTADO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
          <option value="POR_VENCER">Por vencer (≤{config.umbralPorVencerDias} días)</option>
        </select>
        <select
          name="promo"
          defaultValue={sp.promo ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas las recompensas</option>
          {promos.map((p) => (
            <option key={p.id} value={p.id}>{p.titulo}</option>
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
              <a href="/admin/seguimiento">Limpiar</a>
            </Button>
          )}
        </div>
      </Form>

      <p className="text-xs text-muted-foreground">
        {total} recompensa{total !== 1 ? 's' : ''}
        {truncado ? ' (tope de análisis alcanzado; afina los filtros)' : ''}.
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon={<Gift className="h-7 w-7" />}
          title={hayFiltro ? 'Sin recompensas para el filtro' : 'Aún no hay recompensas gratis entregadas'}
          description="Cuando un cliente reciba un lavado gratis, un premio de la ruleta o una recompensa de campaña, aparecerá aquí con su estado."
        />
      ) : (
        <Tabla
          caption="Recompensas entregadas"
          claveDe={(r) => r.compraId}
          filas={items}
          columnaIdentificadora="cliente"
          columnas={[
            {
              clave: 'cliente',
              encabezado: 'Cliente',
              celda: (r) => (
                <div className="max-w-52">
                  <p className="truncate font-medium text-foreground">{r.cliente}</p>
                  <p className="truncate text-caption font-normal text-muted-foreground">{r.telefono ?? r.email ?? '—'}</p>
                </div>
              ),
            },
            {
              clave: 'recompensa',
              encabezado: 'Recompensa',
              prioridad: 2,
              celda: (r) => (
                <div className="max-w-48">
                  <p className="truncate text-foreground">{r.promocion}</p>
                  {r.usosIncluidos > 1 && (
                    <p className="text-caption text-muted-foreground">
                      {r.usosRestantes}/{r.usosIncluidos} usos disponibles
                    </p>
                  )}
                </div>
              ),
            },
            {
              clave: 'estado',
              encabezado: 'Estado',
              celda: (r) => (
                <>
                  <EstadoChip tono={TONO_SEGUIMIENTO[r.estado] ?? 'neutro'}>{SEGUIMIENTO_ESTADO_LABEL[r.estado]}</EstadoChip>
                  {r.estado === 'SIN_USAR' && (
                    <span className="mt-0.5 block text-caption text-muted-foreground">
                      hace {r.diasDesdeOtorgado} día{r.diasDesdeOtorgado !== 1 ? 's' : ''}
                    </span>
                  )}
                </>
              ),
            },
            {
              clave: 'fechas',
              encabezado: 'Otorgado y vence',
              prioridad: 3,
              celda: (r) => (
                <span className="whitespace-nowrap text-caption text-muted-foreground">
                  <span className="block">Otorgado {fmtFecha(r.otorgadoAt)}</span>
                  <span className="block">Vence {fmtFecha(r.venceAt)}</span>
                </span>
              ),
            },
            {
              clave: 'usado',
              encabezado: 'Usado',
              prioridad: 2,
              celda: (r) =>
                r.usadoAt ? (
                  <span className="whitespace-nowrap text-caption">
                    <span className="block text-foreground">{fmtFechaHora(r.usadoAt)}</span>
                    <span className="block text-muted-foreground">
                      {r.usadoPor ? `por ${r.usadoPor}` : ''}
                      {r.canjeInterno && <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-overline text-primary">interno</span>}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            {
              clave: 'acciones',
              encabezado: 'Acciones',
              alineacion: 'derecha',
              celda: (r) => (
                <SeguimientoAcciones
                  compraId={r.compraId}
                  qrTokenId={r.qrTokenId}
                  estado={r.estado}
                  cliente={r.cliente}
                  telefono={r.telefono}
                  email={r.email}
                  promocion={r.promocion}
                  empresa={empresaNombre}
                  mensaje={renderMensajeSeguimiento(config.plantillaMensaje, {
                    cliente: r.cliente,
                    empresa: empresaNombre,
                    recompensa: r.promocion,
                    vence: r.venceAt ? fmtFecha(r.venceAt) : null,
                  })}
                />
              ),
            },
          ]}
        />
      )}

      {items.length > 0 && (
        <TablaPaginacion
          paginacion={paginacion}
          total={total}
          params={sp}
          etiqueta="recompensas"
        />
      )}

      {/* Parametrización (Fase S3) */}
      <SeguimientoConfigCard config={config} promos={promos} />
    </div>
  )
}

