'use client'

import {
  Users,
  CreditCard,
  Store,
  Package,
  Megaphone,
  Gift,
  DollarSign,
  Clock,
  CheckCircle2,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoneyRD } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'

interface Stats {
  totalClientes: number
  totalUsuarios: number
  totalSucursales: number
  totalPlanes: number
  planesActivos: number
  totalPromociones: number
  promocionesActivas: number
  totalReferidos: number
  membresiasActivas: number
  membresiasPendientes: number
  membresiasTotal: number
  pagosConfirmados: number
  ingresosTotales: number
  ingresosEsteMes: number
}

interface Actividad {
  id: string
  accion: string
  detalle: string | null
  createdAt: string
  userName: string | null
}

interface TopPlan {
  id: string
  nombre: string
  precio: number
  membresiaCount: number
}

interface MembresiaEstado {
  estado: string
  count: number
}

const ESTADO_LABELS: Record<string, string> = {
  ACTIVA: 'Activas',
  PENDIENTE: 'Pendientes',
  PENDIENTE_PAGO: 'Pago pendiente',
  RECHAZADA: 'Rechazadas',
  VENCIDA: 'Vencidas',
  CANCELADA: 'Canceladas',
}

const ESTADO_COLORS: Record<string, string> = {
  ACTIVA: 'bg-success',
  PENDIENTE: 'bg-warning',
  PENDIENTE_PAGO: 'bg-warning',
  RECHAZADA: 'bg-destructive/100',
  VENCIDA: 'bg-muted-foreground/50',
  CANCELADA: 'bg-muted-foreground/30',
}

function fmtMoney(n: number) {
  return formatMoneyRD(n)
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function EmpresaDashboard({
  stats,
  actividadReciente,
  topPlanes,
  membresiasPorEstado,
}: {
  companyId: string
  stats: Stats
  actividadReciente: Actividad[]
  topPlanes: TopPlan[]
  membresiasPorEstado: MembresiaEstado[]
}) {
  const maxMembresias = Math.max(...membresiasPorEstado.map((m) => m.count), 1)

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ingresos totales"
          value={fmtMoney(stats.ingresosTotales)}
          sub={`RD$${stats.ingresosEsteMes.toLocaleString()} este mes`}
          icon={DollarSign}
          accent="green"
        />
        <StatCard
          label="Clientes"
          value={stats.totalClientes}
          sub={`${stats.totalUsuarios} usuarios del sistema`}
          icon={Users}
          accent="sky"
        />
        <StatCard
          label="Membresías activas"
          value={stats.membresiasActivas}
          sub={`${stats.membresiasTotal} totales`}
          icon={CreditCard}
          accent="indigo"
        />
        <StatCard
          label="Pagos pendientes"
          value={stats.membresiasPendientes}
          sub={stats.membresiasPendientes > 0 ? 'Requieren revisión' : 'Todo al día'}
          icon={Clock}
          accent={stats.membresiasPendientes > 0 ? 'amber' : 'green'}
        />
      </div>

      {/* Second row - smaller stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Sucursales', value: stats.totalSucursales, icon: Store },
          { label: 'Planes', value: `${stats.planesActivos}/${stats.totalPlanes}`, icon: Package },
          { label: 'Promociones', value: `${stats.promocionesActivas}/${stats.totalPromociones}`, icon: Megaphone },
          { label: 'Referidos', value: stats.totalReferidos, icon: Gift },
          { label: 'Pagos OK', value: stats.pagosConfirmados, icon: CheckCircle2 },
          { label: 'Total membresías', value: stats.membresiasTotal, icon: CreditCard },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold tabular-nums leading-tight">{s.value}</p>
              <p className="truncate text-[11px] text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Membresías por estado */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Membresías por estado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {membresiasPorEstado.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos aún.</p>
            ) : (
              membresiasPorEstado
                .sort((a, b) => b.count - a.count)
                .map((m) => (
                  <div key={m.estado} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{ESTADO_LABELS[m.estado] ?? m.estado}</span>
                      <span className="font-semibold tabular-nums">{m.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted/50">
                      <div
                        className={cn('h-full rounded-full transition-all', ESTADO_COLORS[m.estado] ?? 'bg-primary')}
                        style={{ width: `${(m.count / maxMembresias) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
            )}
          </CardContent>
        </Card>

        {/* Top planes */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Planes populares</CardTitle>
          </CardHeader>
          <CardContent>
            {topPlanes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin planes creados.</p>
            ) : (
              <div className="space-y-3">
                {topPlanes.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <div className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                      i === 0 ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'
                    )}>
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtMoney(p.precio)}/mes
                      </p>
                    </div>
                    <Badge variant="secondary" className="tabular-nums">
                      {p.membresiaCount} memb.
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actividad reciente */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4" /> Actividad reciente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {actividadReciente.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin actividad registrada.</p>
            ) : (
              <div className="space-y-3">
                {actividadReciente.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex gap-3">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{a.accion}</span>
                        {a.detalle && (
                          <span className="text-muted-foreground"> — {a.detalle}</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.userName && `${a.userName} · `}
                        {fmtDate(a.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
