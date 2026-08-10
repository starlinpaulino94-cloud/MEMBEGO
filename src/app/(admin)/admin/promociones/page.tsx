import Link from 'next/link'
import type { CompraEstado } from '@prisma/client'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { prisma } from '@/lib/prisma'
import { rutaPublicaPromo } from '@/modules/promociones/slug'
import { PROMO_TIPO_LABEL } from '@/lib/promociones'
import { formatDate, formatMoney } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { TabsNav } from '@/components/ui/tabs-nav'
import { EmptyState } from '@/components/system/EmptyState'
import { Badge } from '@/components/ui/badge'
import { DeletePromocionButton } from '@/components/admin/DeletePromocionButton'
import { PromoControls } from '@/components/admin/PromoControls'
import { CompartirOfertaButton } from '@/components/admin/CompartirOfertaButton'
import { Gift, Plus, Pencil, Lock, Globe, Eye, Share2, Heart, LayoutTemplate } from 'lucide-react'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date | null) {
  if (!d) return null
  return formatDate(d, undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

type PromoRow = Awaited<ReturnType<typeof fetchPromos>>[number]

const ESTADOS_PROMO = ['todas', 'activas', 'programadas', 'finalizadas', 'borradores'] as const
type EstadoPromo = (typeof ESTADOS_PROMO)[number]
const ETIQUETA_ESTADO: Record<EstadoPromo, string> = {
  todas: 'Todas',
  activas: 'Activas',
  programadas: 'Programadas',
  finalizadas: 'Finalizadas',
  borradores: 'Borradores',
}

async function fetchPromos(companyId: string | null) {
  return prisma.promocion.findMany({
    where: companyId ? { companyId } : {},
    include: {
      company: { select: { name: true } },
      _count: { select: { guardadaPor: true } },
    },
    orderBy: [{ archivada: 'asc' }, { prioridad: 'desc' }, { createdAt: 'desc' }],
  })
}

function PromoCard({ p, showCompany }: { p: PromoRow; showCompany: boolean }) {
  return (
    <Card className={p.activo && !p.archivada ? '' : 'opacity-60'}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/15 p-2">
              <Gift className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="font-semibold text-foreground">{p.titulo}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-info">
                  {PROMO_TIPO_LABEL[p.tipo] ?? p.tipo}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                    p.visibilidad === 'privada'
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-success/10 text-success'
                  }`}
                >
                  {p.visibilidad === 'privada' ? (
                    <>
                      <Lock className="h-3 w-3" /> Privada
                    </>
                  ) : (
                    <>
                      <Globe className="h-3 w-3" /> Pública
                    </>
                  )}
                </span>
                {showCompany && (
                  <span className="text-muted-foreground">{p.company.name}</span>
                )}
              </div>
            </div>
          </div>
          <Badge variant={p.activo && !p.archivada ? 'default' : 'secondary'}>
            {p.archivada ? 'Archivada' : p.activo ? 'Activa' : 'Pausada'}
          </Badge>
        </div>

        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.descripcion}</p>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {p.vigenciaHasta && <span>Hasta {fmtDate(p.vigenciaHasta)}</span>}
          {p.maxCanjes != null && (
            <span>
              Canjes: {p.canjes}/{p.maxCanjes}
            </span>
          )}
          {p.codigo && <span>Código: {p.codigo}</span>}
          {p.prioridad !== 0 && <span>Prioridad {p.prioridad}</span>}
        </div>

        {/* Indicadores */}
        <div className="mt-3 flex gap-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" /> {p.viewCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Share2 className="h-3.5 w-3.5" /> {p.shareCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" /> {p._count.guardadaPor}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <CompartirOfertaButton
              path={rutaPublicaPromo(p)}
              titulo={p.titulo}
              texto={`${p.titulo} — promoción de ${p.company.name} en MembeGo.`}
              advertencia={
                p.archivada || !p.activo
                  ? 'La promoción no está activa: el enlace no será visible hasta que la actives.'
                  : p.vigenciaHasta && new Date(p.vigenciaHasta) < new Date()
                    ? 'La promoción ya venció: el enlace no será visible.'
                    : p.visibilidad === 'privada'
                      ? 'Es privada: solo la verán clientes de tu empresa con sesión iniciada.'
                      : null
              }
            />
            <PromoControls
              id={p.id}
              titulo={p.titulo}
              activo={p.activo}
              archivada={p.archivada}
            />
            <Link href={`/admin/promociones/${p.id}/editar`}>
              <Button size="icon" variant="ghost" title="Editar" aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <DeletePromocionButton id={p.id} titulo={p.titulo} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Fase E5/E8: métricas del ciclo de beneficios digitales. Todo se calcula
 * desde el dato real (ProductoCompra) — sin estimaciones:
 *   ventas · conversión · abandonos · QR usados · clientes nuevos/recurrentes.
 */
async function fetchVentas(companyId: string | null) {
  const where = companyId ? { companyId } : {}
  const activadas: CompraEstado[] = ['ACTIVA', 'CONSUMIDA', 'EXPIRADA']
  const [porEstado, ingresos, usos, porCliente] = await Promise.all([
    prisma.productoCompra.groupBy({ by: ['estado'], where, _count: { _all: true } }),
    prisma.productoCompra.aggregate({
      where: { ...where, pagoConfirmado: true },
      _sum: { montoPagado: true },
    }),
    // QR usados = usos consumidos = usosIncluidos − usosRestantes en las que
    // llegaron a activarse (mismo cálculo que ve el cliente).
    prisma.productoCompra.aggregate({
      where: { ...where, estado: { in: activadas } },
      _sum: { usosIncluidos: true, usosRestantes: true },
    }),
    // Clientes distintos que adquirieron: nuevos (1 compra) vs recurrentes (>1).
    prisma.productoCompra.groupBy({ by: ['clienteId'], where, _count: { _all: true } }),
  ])
  const count = (estados: string[]) =>
    porEstado.filter((r) => estados.includes(r.estado)).reduce((s, r) => s + r._count._all, 0)

  const total = porEstado.reduce((s, r) => s + r._count._all, 0)
  const vendidas = count(activadas)
  // Abandonos: solicitudes que se cancelaron o quedaron sin pagar (no vendidas).
  const abandonos = count(['CANCELADA', 'RECHAZADA'])
  const qrUsados = Number(usos._sum?.usosIncluidos ?? 0) - Number(usos._sum?.usosRestantes ?? 0)
  const clientes = porCliente.length
  const recurrentes = porCliente.filter((c) => c._count._all > 1).length
  return {
    total,
    vendidas,
    activas: count(['ACTIVA']),
    pendientes: count(['SOLICITADA', 'PENDIENTE_PAGO', 'APROBADA', 'RECHAZADA']),
    porValidar: count(['EN_VALIDACION']),
    consumidas: count(['CONSUMIDA']),
    vencidas: count(['EXPIRADA']),
    conversion: total > 0 ? Math.round((vendidas / total) * 100) : 0,
    ingresos: Number(ingresos._sum.montoPagado ?? 0),
    abandonos,
    tasaAbandono: total > 0 ? Math.round((abandonos / total) * 100) : 0,
    qrUsados: Math.max(0, qrUsados),
    clientes,
    clientesNuevos: clientes - recurrentes,
    clientesRecurrentes: recurrentes,
  }
}

export default async function PromocionesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)

  const { estado: estadoRaw } = await searchParams
  const estadoActivo: EstadoPromo = ESTADOS_PROMO.includes(estadoRaw as EstadoPromo)
    ? (estadoRaw as EstadoPromo)
    : 'activas'

  let promociones: PromoRow[] = []
  let ventas: Awaited<ReturnType<typeof fetchVentas>> | null = null
  try {
    ;[promociones, ventas] = await Promise.all([
      fetchPromos(companyId ?? null),
      fetchVentas(companyId ?? null),
    ])
  } catch (e) {
    console.error('[admin-promociones]', e)
  }

  /**
   * ESTADOS DEL §48. Antes solo había dos cubos: "no archivada" y
   * "archivada", así que una promoción programada para el mes que viene se
   * mezclaba con las que están corriendo ahora, y una vencida seguía en la
   * lista principal como si nada. Los cinco estados salen de datos que ya
   * existían —`archivada`, `activo`, `vigenciaDesde`, `vigenciaHasta`—, solo
   * que nadie los combinaba.
   */
  const ahora = new Date()
  const estadoDe = (p: PromoRow): EstadoPromo => {
    if (p.archivada) return 'finalizadas'
    if (!p.activo) return 'borradores'
    if (p.vigenciaHasta && new Date(p.vigenciaHasta) < ahora) return 'finalizadas'
    if (p.vigenciaDesde && new Date(p.vigenciaDesde) > ahora) return 'programadas'
    return 'activas'
  }

  const porEstadoPromo = {
    todas: promociones,
    activas: promociones.filter((x) => estadoDe(x) === 'activas'),
    programadas: promociones.filter((x) => estadoDe(x) === 'programadas'),
    finalizadas: promociones.filter((x) => estadoDe(x) === 'finalizadas'),
    borradores: promociones.filter((x) => estadoDe(x) === 'borradores'),
  }
  const visibles = porEstadoPromo[estadoActivo]

  // Destacados calculados desde el dato real (contadores de la promoción).
  const publicadas = promociones.filter(
    (p) => p.activo && !p.archivada && p.visibilidad === 'publica'
  ).length
  const masCompartida = promociones.reduce<PromoRow | null>(
    (best, p) => (p.shareCount > (best?.shareCount ?? -1) ? p : best),
    null
  )
  const masCanjeada = promociones.reduce<PromoRow | null>(
    (best, p) => (p.canjes > (best?.canjes ?? -1) ? p : best),
    null
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Promociones"
        description="Crea, programa y controla tus ofertas. Tus seguidores se notifican automáticamente."
        action={
          <div className="flex gap-2">
            <Link href="/admin/promociones/plantillas">
              <Button variant="outline">
                <LayoutTemplate className="mr-2 h-4 w-4" />
                Plantillas
              </Button>
            </Link>
            <Link href="/admin/promociones/nuevo">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva promoción
              </Button>
            </Link>
          </div>
        }
        nav={
          <TabsNav
            aria-label="Estado de las promociones"
            items={ESTADOS_PROMO.map((e) => ({
              label: ETIQUETA_ESTADO[e],
              badge: porEstadoPromo[e].length,
              active: estadoActivo === e,
              render: ({ className, children }) => (
                <Link href={`/admin/promociones?estado=${e}`} className={className}>
                  {children}
                </Link>
              ),
            }))}
          />
        }
      />

      {/* RESUMEN · Cuatro cifras, no diez.
          Había DIEZ tarjetas de métrica repartidas en dos rejillas, todas del
          mismo tamaño y peso: ingresos, vendidas, por validar, conversión,
          publicadas, QR usados, abandonos, clientes, más compartida y más
          canjeada. Con todo igual de importante hay que leerlas todas para
          enterarse de algo — el mismo defecto que tenía el dashboard.
          Arriba quedan las cuatro que responden "¿cómo va esto?"; el resto
          baja a una franja de referencia. */}
      {ventas && ventas.total > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              accent="brand"
              label="Ingresos por promociones"
              value={formatMoney(ventas.ingresos)}
              sub="Pagos confirmados"
            />
            <StatCard
              accent="success"
              label="Vendidas"
              value={ventas.vendidas}
              sub={`${ventas.activas} activas · ${ventas.consumidas} consumidas`}
            />
            <StatCard
              accent={ventas.porValidar > 0 ? 'warning' : 'brand'}
              label="Pagos por validar"
              value={ventas.porValidar}
              sub={ventas.porValidar > 0 ? 'Requiere tu atención' : 'Nada pendiente'}
            />
            <StatCard
              accent="brand"
              label="Conversión"
              value={`${ventas.conversion}%`}
              sub={`${ventas.vendidas} de ${ventas.total} solicitudes`}
            />
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: 'Publicadas', valor: String(publicadas) },
              { label: 'QR usados', valor: String(ventas.qrUsados) },
              {
                label: 'Abandonos',
                valor: `${ventas.tasaAbandono}% (${ventas.abandonos})`,
              },
              {
                label: 'Clientes',
                valor: `${ventas.clientes} · ${ventas.clientesNuevos} nuevos`,
              },
              ...(masCanjeada && masCanjeada.canjes > 0
                ? [{ label: 'Más canjeada', valor: `${masCanjeada.titulo} (${masCanjeada.canjes})` }]
                : []),
              ...(masCompartida && masCompartida.shareCount > 0
                ? [
                    {
                      label: 'Más compartida',
                      valor: `${masCompartida.titulo} (${masCompartida.shareCount})`,
                    },
                  ]
                : []),
            ].map((m) => (
              <div key={m.label} className="min-w-0">
                <dt className="truncate text-caption">{m.label}</dt>
                <dd className="truncate text-h4 tabular-nums text-foreground" title={m.valor}>
                  {m.valor}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {visibles.length === 0 ? (
        <EmptyState
          icon={Gift}
          title={
            promociones.length === 0
              ? 'Sin promociones todavía'
              : `Sin promociones ${ETIQUETA_ESTADO[estadoActivo].toLowerCase()}`
          }
          description={
            promociones.length === 0
              ? 'Crea tu primera promoción para empezar a atraer clientes.'
              : 'Cambia de pestaña para ver las que están en otro estado.'
          }
          action={
            promociones.length === 0 ? (
              <>
                <Button asChild size="lg">
                  <Link href="/admin/promociones/nuevo">Crear promoción</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/admin/promociones/plantillas">Empezar desde plantilla</Link>
                </Button>
              </>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visibles.map((p) => (
            <PromoCard key={p.id} p={p} showCompany={!companyId} />
          ))}
        </div>
      )}
    </div>
  )
}
