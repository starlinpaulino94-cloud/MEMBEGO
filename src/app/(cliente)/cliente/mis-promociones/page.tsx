import Link from 'next/link'
import { ChevronRight, Ticket, Clock, History, Sparkles, Gift } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { getRegalosCliente } from '@/modules/ofertas/queries'
import { PERIODO_LABEL } from '@/modules/ofertas/periodo'
import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { EmptyState } from '@/components/system/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { compraEstadoVisual } from '@/components/cliente/compra-estado'

export const dynamic = 'force-dynamic'

const PENDIENTES = ['SOLICITADA', 'PENDIENTE_PAGO', 'EN_VALIDACION', 'APROBADA', 'RECHAZADA']

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(d)
}

interface CompraItem {
  id: string
  estado: string
  usosRestantes: number
  usosIncluidos: number
  createdAt: Date
  promocion: { titulo: string; imagenUrl: string | null; tipo: string } | null
  company: { name: string }
}

function Item({ compra }: { compra: CompraItem }) {
  const ui = compraEstadoVisual(compra.estado, {
    usosRestantes: compra.usosRestantes,
    usosTotales: compra.usosIncluidos,
  })
  const Icon = ui.icon
  return (
    <Link
      href={`/cliente/mis-promociones/${compra.id}`}
      className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50"
    >
      {compra.promocion?.imagenUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={compra.promocion.imagenUrl}
          alt=""
          className="h-12 w-12 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Ticket className="h-5 w-5 text-primary" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-foreground">
          {compra.promocion?.titulo ?? 'Promoción'}
        </p>
        <p className="text-caption">
          {compra.company.name} · {fmtFecha(compra.createdAt)}
          {compra.estado === 'ACTIVA' && (
            <> · {compra.usosRestantes} de {compra.usosIncluidos} uso{compra.usosIncluidos !== 1 ? 's' : ''} disponible{compra.usosRestantes !== 1 ? 's' : ''}</>
          )}
        </p>
      </div>
      <Badge variant={ui.badge} className="shrink-0 gap-1">
        <Icon className="h-3 w-3" />
        {ui.label}
      </Badge>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function Section({
  titulo,
  icon: Icon,
  items,
}: {
  titulo: string
  icon: typeof Ticket
  items: CompraItem[]
}) {
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-2 text-overline">
        <Icon className="h-4 w-4" aria-hidden /> {titulo}
      </h2>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60">
            {items.map((c) => (
              <Item key={c.id} compra={c} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default async function MisPromocionesPage() {
  const user = await requireRole('CLIENTE')
  const clienteId = user.metadata.clienteId
  if (!clienteId) return <p className="text-muted-foreground">No autorizado.</p>

  const regalos = await getRegalosCliente(clienteId).catch(() => [])
  const compras = await prisma.productoCompra
    .findMany({
      where: { clienteId },
      select: {
        id: true,
        estado: true,
        usosRestantes: true,
        usosIncluidos: true,
        createdAt: true,
        promocion: { select: { titulo: true, imagenUrl: true, tipo: true } },
        company: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    .catch(() => [])

  const activas = compras.filter((c) => c.estado === 'ACTIVA')
  const pendientes = compras.filter((c) => PENDIENTES.includes(c.estado))
  const historial = compras.filter(
    (c) => !PENDIENTES.includes(c.estado) && c.estado !== 'ACTIVA'
  )

  // CX2 · Centro de recompensas: el resumen responde de un vistazo
  // "¿qué tengo listo para usar?" antes de cualquier lista.
  const usosDisponibles = activas.reduce((s, c) => s + c.usosRestantes, 0)

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 text-foreground">Mis beneficios</h1>
          <p className="text-small text-muted-foreground">
            Tu centro de recompensas: lo que puedes usar hoy, lo que está en camino y lo que ya disfrutaste.
          </p>
        </div>
        {/* Regalos P2P · R2: transferir usos propios a otro usuario. */}
        <Link
          href="/cliente/regalos/enviar"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
        >
          <Gift className="h-4 w-4 text-primary" /> Transferir a un amigo
        </Link>
      </div>

      {/* Regalos VIP reclamados (ofertas privadas) */}
      {regalos.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Gift className="h-5 w-5 text-primary" /> Mis regalos
          </h2>
          {regalos.map((r) => (
            <Link
              key={r.invitadoId}
              href={`/oferta/${r.codigo}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 transition hover:-translate-y-0.5 hover:shadow-premium"
            >
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{r.titulo}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {Math.max(0, r.usosPorPeriodo - r.usosPeriodo)} de {r.usosPorPeriodo} usos{' '}
                  {PERIODO_LABEL[r.periodo]} disponibles
                  {r.vigenciaHasta ? ` · hasta ${fmtFecha(r.vigenciaHasta)}` : ''}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </section>
      )}

      {compras.length === 0 && regalos.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Aún no tienes beneficios"
          description="Cuando adquieras una promoción o recibas un regalo, aparecerán aquí listos para usar con tu QR."
          action={
            <Button asChild size="lg">
              <Link href="/cliente/promociones">Ver ofertas</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Resumen del centro de recompensas */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard accent="success" icon={Ticket} label="Listos para usar" value={activas.length} />
            <StatCard accent="brand" icon={Sparkles} label="Usos disponibles" value={usosDisponibles} />
            <StatCard accent="warning" icon={Clock} label="En proceso" value={pendientes.length} />
          </div>

          <Section titulo="Listos para usar" icon={Ticket} items={activas} />
          <Section titulo="Por reclamar · en proceso" icon={Clock} items={pendientes} />
          <Section titulo="Ya utilizados y vencidos" icon={History} items={historial} />
        </>
      )}
    </div>
  )
}
