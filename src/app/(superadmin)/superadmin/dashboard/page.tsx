import Link from 'next/link'
import Image from 'next/image'
import {
  Building2,
  Users,
  CheckCircle2,
  Clock,
  ArrowRight,
  UserPlus,
  Activity,
  LifeBuoy,
  EyeOff,
  FlaskConical,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { COLAS_TICKET } from '@/lib/soporte'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

const ACCION_LABEL: Record<string, string> = {
  VISITA_CONFIRMADA: 'Visita confirmada',
  PAGO_APROBADO: 'Pago aprobado',
  PAGO_RECHAZADO: 'Pago rechazado',
  MEMBRESIA_CANCELADA: 'Membresía cancelada',
  MEMBRESIA_RENOVADA: 'Membresía renovada',
  QR_GENERADO: 'QR generado',
  QR_USADO: 'QR usado',
  COMPROBANTE_IMPRESO: 'Comprobante impreso',
  REFERIDO_COMPLETADO: 'Referido completado',
  RECOMPENSA_OTORGADA: 'Recompensa otorgada',
  NOTA_INTERNA: 'Nota interna',
  EMPRESA_DEMO_CAMBIADA: 'Marca de demostración cambiada',
  EMPRESA_DEMO_REINICIADA: 'Empresa de demostración reiniciada',
}

/**
 * Hora de la actividad, vía `formatDate`.
 *
 * Antes construía su propio `Intl.DateTimeFormat` con el locale y la zona
 * clavados. Es el panel de la PLATAFORMA, así que los valores por defecto son
 * los correctos — pero escribirlos a mano significa que el día que la
 * plataforma opere en otra zona haya que acordarse de este archivo. El
 * formateador del sistema ya tiene esos mismos defaults.
 */
function fmtHora(d: Date) {
  return formatDate(d, null, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const SELECT_EMPRESA = {
  id: true, name: true, slug: true, type: true,
  isActive: true, isPublished: true, logoUrl: true,
  _count: { select: { clientes: true, plans: true } },
} as const

/**
 * Empresas con su marca de demostración.
 *
 * Doble camino a propósito: si la columna `esDemo` todavía no está migrada, la
 * consulta con `esDemo` revienta y se reintenta sin ella. El centro de control
 * no puede quedarse en blanco por una columna que aún no existe; sin la columna
 * simplemente no hay empresas demo todavía, que es la verdad.
 */
async function empresasDelPanel() {
  try {
    return await prisma.company.findMany({
      orderBy: { name: 'asc' },
      select: { ...SELECT_EMPRESA, esDemo: true },
    })
  } catch {
    const filas = await prisma.company
      .findMany({ orderBy: { name: 'asc' }, select: SELECT_EMPRESA })
      .catch(() => [])
    return filas.map((f) => ({ ...f, esDemo: false }))
  }
}

/** Clientes nuevos SIN contar los de las empresas de práctica. */
async function nuevosReales(desde: Date) {
  try {
    return await prisma.cliente.count({
      where: { createdAt: { gte: desde }, company: { esDemo: false } },
    })
  } catch {
    return prisma.cliente.count({ where: { createdAt: { gte: desde } } }).catch(() => 0)
  }
}

interface EmpresaPanel {
  id: string
  name: string
  logoUrl: string | null
  isActive: boolean
  isPublished: boolean
  esDemo: boolean
  activas: number
  pendientes: number
  _count: { clientes: number; plans: number }
}

/** La misma tarjeta para las reales y para las de práctica: se distinguen por
 *  el apartado donde salen y por la etiqueta, no por verse distinto. */
function TarjetaEmpresa({ c }: { c: EmpresaPanel }) {
  return (
    <Card className="card-interactive border-border/60 shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {c.logoUrl ? (
              <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-border/60">
                <Image src={c.logoUrl} alt="" fill className="object-cover" />
              </span>
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-overline text-white">
                {c.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <CardTitle className="truncate text-base">{c.name}</CardTitle>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {c.esDemo ? (
              <Badge variant="warning">Demo</Badge>
            ) : !c.isActive ? (
              <Badge variant="destructive">Inactiva</Badge>
            ) : !c.isPublished ? (
              <Badge variant="warning">Sin publicar</Badge>
            ) : (
              <Badge variant="success">Publicada</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Clientes', value: c._count.clientes },
            { label: 'Planes', value: c._count.plans },
            { label: 'Activas', value: c.activas },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-muted/40 py-3">
              <p className="text-h2 tabular-nums text-foreground">{s.value}</p>
              <p className="text-caption text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {c.pendientes > 0 && (
          <Link
            href="/superadmin/operaciones"
            className="mt-3 flex items-center justify-end gap-1 text-caption font-medium text-warning-foreground hover:underline"
          >
            {c.pendientes} pago{c.pendientes !== 1 ? 's' : ''} pendiente
            {c.pendientes !== 1 ? 's' : ''} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </CardContent>
    </Card>
  )
}

export default async function SuperadminDashboard() {
  await requireRole('SUPERADMIN')

  const hace30d = new Date()
  hace30d.setDate(hace30d.getDate() - 30)

  // Conteos agregados en pocas queries: los de membresías salen de un solo
  // groupBy por companyId/estado.
  const [companies, membershipCounts, clientesNuevos30d, ticketsAbiertos, actividad] =
    await Promise.all([
      empresasDelPanel(),
      prisma.membership
        .groupBy({
          by: ['companyId', 'estado'],
          where: { estado: { in: ['ACTIVA', 'PENDIENTE_PAGO'] } },
          _count: { _all: true },
        })
        .catch(() => []),
      nuevosReales(hace30d),
      // Cuenta la cola "Te toca a ti", no "todo lo no cerrado". El enlace lleva
      // a /admin/tickets, que desde la Fase 15 abre en esa cola: si aquí se
      // contara también ESPERANDO_CLIENTE, el panel diría "7" y la bandeja
      // enseñaría 5 — el aviso y su destino tienen que hablar del mismo
      // trabajo. Y un ticket esperando al cliente no es trabajo pendiente de
      // la plataforma.
      prisma.supportTicket
        .count({ where: { estado: { in: [...COLAS_TICKET.pendientes] } } })
        .catch(() => 0),
      prisma.auditLog
        .findMany({
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            accion: true,
            entidadTipo: true,
            createdAt: true,
            company: { select: { name: true } },
            user: { select: { name: true } },
          },
        })
        .catch(() => []),
    ])

  const countFor = (companyId: string, estado: string) =>
    membershipCounts.find((g) => g.companyId === companyId && g.estado === estado)
      ?._count._all ?? 0

  const perCompany = companies.map((c) => ({
    ...c,
    activas: countFor(c.id, 'ACTIVA'),
    pendientes: countFor(c.id, 'PENDIENTE_PAGO'),
  }))

  // Los números de arriba son los del NEGOCIO. Las empresas de práctica se
  // apartan: si los 40 clientes inventados de un entrenamiento suman a
  // "clientes totales", el número deja de servir para decidir nada — y lo peor
  // es que nadie se entera de que dejó de servir. Las demo siguen visibles más
  // abajo, en su propio apartado, porque ocultarlas del todo sería peor.
  const reales = perCompany.filter((c) => !c.esDemo)
  const demos = perCompany.filter((c) => c.esDemo)

  const totalClientes = reales.reduce((s, c) => s + c._count.clientes, 0)
  const totalActivas = reales.reduce((s, c) => s + c.activas, 0)
  // Pendientes y sin publicar SÍ cuentan solo lo real: son avisos de trabajo
  // por hacer, y nadie tiene que ir a validar el pago de mentira de un
  // entrenamiento ni a publicar una empresa que no debe publicarse nunca.
  const totalPendientes = reales.reduce((s, c) => s + c.pendientes, 0)
  const sinPublicar = reales.filter((c) => !c.isPublished).length

  return (
    <div className="space-y-8 animate-fade-up">
      <div>
        <p className="text-overline">Plataforma</p>
        <h1 className="text-h1 mt-1 text-foreground">Centro de control</h1>
      </div>

      {/* Estadísticas globales */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Empresas" value={companies.length} icon={Building2} accent="sky" />
        <StatCard label="Clientes totales" value={totalClientes} icon={Users} accent="indigo" />
        <StatCard label="Membresías activas" value={totalActivas} icon={CheckCircle2} accent="green" />
        <StatCard
          label="Clientes nuevos"
          value={clientesNuevos30d}
          icon={UserPlus}
          accent="violet"
          sub="Últimos 30 días"
        />
      </div>

      {/* Salud de la plataforma: cada alerta lleva a donde se resuelve */}
      <div>
        <h2 className="text-h4 mb-3 text-foreground">Salud de la plataforma</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/superadmin/operaciones"
            className={`card-interactive flex items-center justify-between rounded-xl border p-4 ${
              totalPendientes > 0
                ? 'border-warning/30 bg-warning/10'
                : 'border-border/60 bg-card shadow-card'
            }`}
          >
            <span className="flex items-center gap-2.5 text-small font-medium text-foreground">
              <Clock className={`h-4 w-4 ${totalPendientes > 0 ? 'text-warning' : 'text-muted-foreground'}`} />
              Pagos por validar
            </span>
            <span className="inline-flex items-center gap-1 text-h3 tabular-nums text-foreground">
              {totalPendientes} <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </Link>
          <Link
            href="/superadmin/empresas"
            className={`card-interactive flex items-center justify-between rounded-xl border p-4 ${
              sinPublicar > 0
                ? 'border-info/30 bg-info/10'
                : 'border-border/60 bg-card shadow-card'
            }`}
          >
            <span className="flex items-center gap-2.5 text-small font-medium text-foreground">
              <EyeOff className={`h-4 w-4 ${sinPublicar > 0 ? 'text-info' : 'text-muted-foreground'}`} />
              Empresas sin publicar
            </span>
            <span className="inline-flex items-center gap-1 text-h3 tabular-nums text-foreground">
              {sinPublicar} <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </Link>
          <Link
            href="/admin/tickets"
            className={`card-interactive flex items-center justify-between rounded-xl border p-4 ${
              ticketsAbiertos > 0
                ? 'border-destructive/30 bg-destructive/10'
                : 'border-border/60 bg-card shadow-card'
            }`}
          >
            <span className="flex items-center gap-2.5 text-small font-medium text-foreground">
              <LifeBuoy className={`h-4 w-4 ${ticketsAbiertos > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
              Tickets abiertos
            </span>
            <span className="inline-flex items-center gap-1 text-h3 tabular-nums text-foreground">
              {ticketsAbiertos} <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Empresas */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h4 text-foreground">Empresas</h2>
            <Link
              href="/superadmin/empresas"
              className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
            >
              Administrar <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {reales.map((c) => (
              <TarjetaEmpresa key={c.id} c={c} />
            ))}
          </div>

          {/* Empresas de práctica: aparte y etiquetadas. Sus números no suman
              arriba, pero siguen a la vista — una empresa demo que no se ve es
              una empresa demo que alguien deja encendida y olvida. */}
          {demos.length > 0 && (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-h4 flex items-center gap-2 text-foreground">
                  <FlaskConical className="h-4 w-4 text-warning" />
                  Empresas de demostración
                </h2>
                <Link
                  href="/superadmin/demo"
                  className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
                >
                  Administrar <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <p className="mb-3 text-caption text-muted-foreground">
                Son para entrenar al personal. Sus clientes, cobros y números no cuentan en las
                estadísticas de la plataforma.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {demos.map((c) => (
                  <TarjetaEmpresa key={c.id} c={c} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actividad global */}
        <div>
          <h2 className="text-h4 mb-3 text-foreground">Actividad reciente</h2>
          <Card className="border-border/60 shadow-card">
            <CardContent className="pt-5">
              {actividad.length === 0 ? (
                <p className="py-6 text-center text-small text-muted-foreground">
                  La actividad de todas las empresas aparecerá aquí.
                </p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {actividad.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-primary">
                        <Activity className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {ACCION_LABEL[a.accion] ?? a.accion}
                        </p>
                        <p className="truncate text-caption text-muted-foreground">
                          {a.company?.name ?? 'Plataforma'}
                          {a.user?.name ? ` · ${a.user.name}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-caption text-muted-foreground/70">
                        {fmtHora(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
