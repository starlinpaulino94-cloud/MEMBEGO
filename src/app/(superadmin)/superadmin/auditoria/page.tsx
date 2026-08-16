import Link from 'next/link'
import { sinEmpresa } from '@/lib/tenant'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { getAuditoria, ACCION_LABEL } from '@/modules/auditoria/queries'
import { BitacoraTabla } from '@/components/auditoria/BitacoraTabla'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { History, Search } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Auditoría' }

/**
 * Auditoría GLOBAL (superadmin): las acciones de TODAS las empresas con su
 * fecha y hora exactas. Misma bitácora que ve cada negocio, sin el filtro de
 * empresa fijo.
 */
export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{
    accion?: string
    empresa?: string
    q?: string
    desde?: string
    hasta?: string
  }>
}) {
  await requireRole('SUPERADMIN')
  const { accion, empresa, q, desde, hasta } = await searchParams

  let empresas: { id: string; name: string }[] = []
  try {
    empresas = await sinEmpresa(
      'auditoría de la plataforma: la bitácora es de todas las empresas',
      (tx) => tx.company.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
    )
  } catch (e) {
    console.error('[auditoria] empresas', e)
  }

  let items: Awaited<ReturnType<typeof getAuditoria>> = []
  let error = false
  try {
    items = await getAuditoria(null, { accion, empresa, q, desde, hasta })
  } catch (e) {
    console.error('[auditoria]', e)
    error = true
  }

  const qs = new URLSearchParams(
    Object.entries({ accion, empresa, q, desde, hasta }).filter(([, v]) => !!v) as [string, string][]
  ).toString()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoría"
        description="Todas las acciones de la plataforma, con la fecha y la hora exactas de cada una."
        action={
          items.length > 0 && (
            // Con los MISMOS filtros que la pantalla: un export que descarga
            // todo cuando la pantalla enseña un tramo filtrado es la forma más
            // silenciosa de dar un dato equivocado.
            <BotonExportar href={`/superadmin/auditoria/exportar${qs ? `?${qs}` : ''}`} />
          )
        }
      />

      <Form
        action="/superadmin/auditoria"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4"
      >
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q ?? ''} placeholder="Buscar por usuario o entidad…" className="pl-9" />
        </div>
        <select
          name="empresa"
          defaultValue={empresa ?? ''}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="">Todas las empresas</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
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
        <label className="text-caption text-muted-foreground">
          Desde
          <Input type="date" name="desde" defaultValue={desde ?? ''} className="mt-1" />
        </label>
        <label className="text-caption text-muted-foreground">
          Hasta
          <Input type="date" name="hasta" defaultValue={hasta ?? ''} className="mt-1" />
        </label>
        <Button type="submit" variant="secondary">Filtrar</Button>
        {(q || accion || empresa || desde || hasta) && (
          <Button asChild variant="ghost">
            <Link href="/superadmin/auditoria">Limpiar</Link>
          </Button>
        )}
      </Form>

      {error ? (
        <EmptyState
          icon={<History className="h-7 w-7" />}
          title="No se pudo cargar la auditoría"
          description="Intenta de nuevo en unos momentos."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History className="h-7 w-7" />}
          title="Sin acciones registradas"
          description="Aquí aparece toda la actividad de la plataforma con su hora exacta."
        />
      ) : (
        <>
          <BitacoraTabla items={items} timeZone="America/Santo_Domingo" mostrarEmpresa />
          <p className="text-caption text-muted-foreground">
            {items.length === 200
              ? 'Mostrando las 200 acciones más recientes — afina con los filtros.'
              : `${items.length} acción${items.length !== 1 ? 'es' : ''} registrada${items.length !== 1 ? 's' : ''}.`}
          </p>
        </>
      )}
    </div>
  )
}
