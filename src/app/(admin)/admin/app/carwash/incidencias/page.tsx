import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { normalizarRango } from '@/modules/apps/reportes'
import { utcDesdeLocal, sumarDias } from '@/modules/citas/disponibilidad'
import {
  getPanelIncidencias,
  getEntregadosRecientes,
  INCIDENCIA_TIPOS,
  INCIDENCIA_TIPO_LABELS,
  INCIDENCIA_ESTADOS,
  INCIDENCIA_ESTADO_LABELS,
  type IncidenciaTipo,
  type IncidenciaEstado,
} from '@/modules/carwash/incidencias'
import { IncidenciasPanel, type EntregadoOpcion } from '@/components/carwash/IncidenciasPanel'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, ShieldAlert, TriangleAlert } from 'lucide-react'
import { anotarFallo } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Incidencias y rewash' }

/**
 * App Car Wash · Fase 2 — INCIDENCIAS Y REWASH.
 * Capacidad INCIDENCIAS (nace apagada).
 */
export default async function IncidenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; estado?: string; tipo?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const sp = await searchParams
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const volver = (
    <Link
      href="/admin/app/carwash"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Car Wash
    </Link>
  )

  if (!(await tieneCapacidad(companyId, 'INCIDENCIAS'))) {
    return (
      <div className="space-y-6">
        {volver}
        <EmptyState
          icon={<ShieldAlert className="h-7 w-7" />}
          title="Las incidencias están apagadas"
          description="Este módulo se activa por empresa desde el panel de capacidades (superadmin)."
        />
      </div>
    )
  }

  const empresa = await conEmpresaOTodas(
    companyId,
    'app · carwash · incidencias: sin empresa activa es el superadmin',
    (tx) => tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(anotarFallo('carwash:incidencias:company'))
  )
  const tz = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const { rango } = normalizarRango(sp.desde, sp.hasta, tz)
  const inicio = utcDesdeLocal(rango.desde, '00:00', tz)
  const fin = utcDesdeLocal(sumarDias(rango.hasta, 1), '00:00', tz)

  const [panel, entregados] = await Promise.all([
    getPanelIncidencias(companyId, inicio, fin, { estado: sp.estado, tipo: sp.tipo }),
    // Solo los últimos 3 días: una queja llega horas después, no semanas, y una
    // lista larga es inusable en el selector.
    getEntregadosRecientes(companyId, 3),
  ])

  const opciones: EntregadoOpcion[] = entregados.map((e) => ({
    id: e.id,
    placa: e.placa ?? e.vehiculo?.placa ?? null,
    descripcion:
      e.descripcion ?? ([e.vehiculo?.marca, e.vehiculo?.modelo].filter(Boolean).join(' ') || null),
    cliente: e.cliente?.nombre ?? null,
    entregadoAt: e.entregadoAt,
  }))

  const select =
    'h-10 rounded-xl border border-input bg-background px-3 text-sm'

  return (
    <div className="space-y-6">
      {volver}
      <PageHeader
        title="Incidencias y rewash"
        description="Daños, quejas, faltantes y trabajos que hubo que repetir. La tasa de rewash es el costo escondido de la pista."
      />

      <Form
        action="/admin/app/carwash/incidencias"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4"
      >
        <label className="text-xs text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={rango.desde} className="mt-1" />
        </label>
        <label className="text-xs text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={rango.hasta} className="mt-1" />
        </label>
        <select name="tipo" defaultValue={sp.tipo ?? ''} className={select}>
          <option value="">Todos los tipos</option>
          {INCIDENCIA_TIPOS.map((t) => (
            <option key={t} value={t}>
              {INCIDENCIA_TIPO_LABELS[t as IncidenciaTipo]}
            </option>
          ))}
        </select>
        <select name="estado" defaultValue={sp.estado ?? ''} className={select}>
          <option value="">Todos los estados</option>
          {INCIDENCIA_ESTADOS.map((e) => (
            <option key={e} value={e}>
              {INCIDENCIA_ESTADO_LABELS[e as IncidenciaEstado]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Aplicar
        </Button>
      </Form>

      {panel === null ? (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-bold text-foreground">Falta correr la migración</p>
            <p className="mt-1 text-muted-foreground">
              La tabla de incidencias todavía no existe. Corre{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                prisma/migrations/20260764_carwash_fase2/migration.sql
              </code>{' '}
              en Supabase y vuelve a entrar.
            </p>
          </div>
        </div>
      ) : (
        <IncidenciasPanel panel={panel} entregados={opciones} />
      )}
    </div>
  )
}
