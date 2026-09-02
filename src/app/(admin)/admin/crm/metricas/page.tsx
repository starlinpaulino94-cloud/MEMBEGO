'use client'

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Users,
  Clock,
  TrendingUp,
  BarChart3,
  AlertTriangle,
} from 'lucide-react'

// ── Stat cards data ──────────────────────────────────────────────────────────

const STATS = [
  { label: 'Leads Hoy', value: '12', icon: Users, accent: 'text-primary' },
  { label: 'En Pipeline', value: '24', icon: Clock, accent: 'text-warning' },
  { label: 'Ganados Este Mes', value: '8', icon: TrendingUp, accent: 'text-success' },
  { label: 'Tasa de Conversión', value: '32%', icon: BarChart3, accent: 'text-primary' },
] as const

// ── Leads por fuente ─────────────────────────────────────────────────────────

const FUENTES = [
  { nombre: 'WhatsApp', pct: 45 },
  { nombre: 'Instagram', pct: 25 },
  { nombre: 'Referido', pct: 15 },
  { nombre: 'Teléfono', pct: 8 },
  { nombre: 'Otro', pct: 7 },
]

// ── Tiempo por etapa ─────────────────────────────────────────────────────────

const TIEMPO_ETAPA = [
  { etapa: 'Nuevo → Contactado', dias: '1.2 días' },
  { etapa: 'Contactado → Cotización', dias: '2.5 días' },
  { etapa: 'Cotización → Negociación', dias: '3.1 días' },
  { etapa: 'Negociación → Cerrado', dias: '2.8 días' },
]

const TOTAL_PIPELINE = '9.6 días'

// ── Leads por asignado ───────────────────────────────────────────────────────

const ASIGNADOS = [
  { nombre: 'María', leads: 5 },
  { nombre: 'Pedro', leads: 3 },
  { nombre: 'Ana', leads: 2 },
]

const MAX_LEADS = Math.max(...ASIGNADOS.map((a) => a.leads))

// ── Requieren atención ──────────────────────────────────────────────────────

const ATENCION = [
  { lead: 'Juan P.', motivo: 'Sin seguimiento por 3 días' },
  { lead: 'María L.', motivo: 'Oferta pendiente por 5 días' },
  { lead: 'Carlos R.', motivo: 'En etapa "Cotización" por 7 días' },
]

// ── Page ────────────────────────────────────────────────────────────────────

export default function MetricasPage() {
  return (
    <div className="space-y-5">

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label}>
              <CardContent className="flex items-center gap-4 p-4">
                <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted/50')}>
                  <Icon className={cn('h-6 w-6', stat.accent)} />
                </span>
                <div>
                  <p className="text-overline">{stat.label}</p>
                  <p className="text-h2 mt-0.5">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ── Grid: two columns ─────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Leads por Fuente */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Leads por Fuente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {FUENTES.map((f) => (
              <div key={f.nombre}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-small text-foreground">{f.nombre}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">{f.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-primary/20">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${f.pct}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Tiempo Promedio por Etapa */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Tiempo Promedio por Etapa</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {TIEMPO_ETAPA.map((t) => (
                <div key={t.etapa} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <span className="text-small text-foreground">{t.etapa}</span>
                  <span className="text-small font-medium text-muted-foreground tabular-nums">{t.dias}</span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <span className="text-small font-medium text-foreground">Total pipeline</span>
                <span className="text-small font-semibold text-primary tabular-nums">{TOTAL_PIPELINE}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Leads por Asignado */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Leads por Asignado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {ASIGNADOS.map((a) => (
              <div key={a.nombre}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-small text-foreground">{a.nombre}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">{a.leads} leads</span>
                </div>
                <div className="h-2 rounded-full bg-primary/20">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(a.leads / MAX_LEADS) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Requieren Atención */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h4">Requieren Atención</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ATENCION.map((a) => (
              <div
                key={a.lead}
                className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <p className="text-small font-medium text-foreground">{a.lead}</p>
                  <p className="text-caption text-muted-foreground mt-0.5">{a.motivo}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
