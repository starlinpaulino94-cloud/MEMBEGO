import Link from 'next/link'
import Form from 'next/form'
import { requireSection } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { getAuditoria, ACCION_LABEL } from '@/modules/auditoria/queries'
import { BitacoraTabla } from '@/components/auditoria/BitacoraTabla'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Download, History, Search } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Actividad' }

/**
 * Bitácora de actividad del negocio: TODAS las acciones registradas con su
 * fecha y HORA exactas (hasta el segundo), quién las hizo y desde qué IP.
 * Los datos ya existían en `audit_logs`; esta pantalla los hace visibles.
 */
export default async function ActividadPage({
  searchParams,
}: {
  searchParams: Promise<{ accion?: string; q?: string; desde?: string; hasta?: string }>
}) {
  const user = await requireSection('actividad')
  if (!user) {
    return <p className="text-muted-foreground">No tienes permisos para ver la actividad.</p>
  }
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  const { accion, q, desde, hasta } = await searchParams

  const empresa = await prisma.company
    .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
    .catch(() => null)
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'

  let items: Awaited<ReturnType<typeof getAuditoria>> = []
  let error = false
  try {
    items = await getAuditoria(companyId, { accion, q, desde, hasta })
  } catch (e) {
    console.error('[actividad]', e)
    error = true
  }

  const exportQs = new URLSearchParams(
    Object.entries({ accion, q, desde, hasta }).filter(([, v]) => v) as [string, string][]
  ).toString()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Actividad"
        description="Todo lo que pasa en tu negocio, con la fecha y la hora exactas de cada acción."
      />

      <Form
        action="/admin/actividad"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4"
      >
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q ?? ''} placeholder="Buscar por usuario o entidad…" className="pl-9" />
        </div>
        <select
          name="accion"
          defaultValue={accion ?? ''}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="">Todas las acciones</option>
          {Object.entries(ACCION_LABEL).map(([valor, label]) => (
            <option key={valor} value={valor}>
              {label}
            </option>
          ))}
        </select>
        <label className="text-xs text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={desde ?? ''} className="mt-1" />
        </label>
        <label className="text-xs text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={hasta ?? ''} className="mt-1" />
        </label>
        <Button type="submit" variant="secondary">Filtrar</Button>
        {(q || accion || desde || hasta) && (
          <Button asChild variant="ghost">
            <Link href="/admin/actividad">Limpiar</Link>
          </Button>
        )}
        <Button asChild variant="ghost" className="gap-1.5">
          <Link href={`/admin/actividad/export${exportQs ? `?${exportQs}` : ''}`}>
            <Download className="h-4 w-4" /> CSV
          </Link>
        </Button>
      </Form>

      {error ? (
        <EmptyState
          icon={<History className="h-7 w-7" />}
          title="No se pudo cargar la actividad"
          description="Intenta de nuevo en unos momentos."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History className="h-7 w-7" />}
          title="Sin actividad registrada"
          description="Aquí aparecerán los cobros, canjes, aperturas de caja, notas y demás acciones con su hora exacta."
        />
      ) : (
        <>
          <BitacoraTabla items={items} timeZone={timeZone} />
          <p className="text-xs text-muted-foreground">
            {items.length === 200
              ? 'Mostrando las 200 acciones más recientes — afina con los filtros o exporta a CSV.'
              : `${items.length} acción${items.length !== 1 ? 'es' : ''} registrada${items.length !== 1 ? 's' : ''}.`}
          </p>
        </>
      )}
    </div>
  )
}
