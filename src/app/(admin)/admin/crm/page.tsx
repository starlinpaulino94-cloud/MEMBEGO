import { redirect } from 'next/navigation'
import Form from 'next/form'
import { requireSection } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getLeads, getStats } from '@/modules/crm/queries'
import type {
  LeadFilter,
  PaginacionParams,
  LeadEtapa,
  LeadPrioridad,
  LeadEstado,
  LeadFuente,
  LeadCanal,
} from '@/modules/crm/types'
import { PipelineBoard } from './pipeline-board'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const dynamic = 'force-dynamic'

const COLUMN_META = [
  { key: 'NUEVO' as const, label: 'Nuevo' },
  { key: 'CONTACTADO' as const, label: 'Contactado' },
  { key: 'INTERESADO' as const, label: 'Interesado' },
  { key: 'PROPUESTA' as const, label: 'Propuesta' },
  { key: 'NEGOCIACION' as const, label: 'Negociación' },
  { key: 'GANADO' as const, label: 'Ganado' },
  { key: 'PERDIDO' as const, label: 'Perdido' },
]

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireSection('leads')
  if (!user) redirect('/login')

  const companyId = companyFilter(user)
  if (!companyId) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Selecciona una empresa desde el panel de superadmin para usar el CRM.
        </p>
      </div>
    )
  }

  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const etapa = (sp.etapa as LeadEtapa | undefined) ?? undefined
  const prioridad = (sp.prioridad as LeadPrioridad | undefined) ?? undefined
  const estado = (sp.estado as LeadEstado | undefined) ?? undefined
  const fuente = (sp.fuente as LeadFuente | undefined) ?? undefined
  const canal = (sp.canal as LeadCanal | undefined) ?? undefined
  const pagina = Math.max(1, Number.parseInt(sp.p ?? '1', 10) || 1)

  const filtro: LeadFilter = {
    q: q || undefined,
    etapa,
    prioridad,
    estado,
    fuente,
    canal,
  }
  const paginacion: PaginacionParams = { pagina, porPagina: 20 }

  const [result, stats] = await Promise.all([
    getLeads(companyId, filtro, paginacion),
    getStats(companyId),
  ])

  const paginas = result.totalPaginas
  const desde = result.total === 0 ? 0 : (result.pagina - 1) * result.porPagina + 1
  const hasta = Math.min(result.pagina * result.porPagina, result.total)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Gestiona tus prospectos en el pipeline de ventas.
        </p>
      </div>

      <Form action="/admin/crm" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {(['etapa', 'prioridad', 'estado', 'fuente', 'canal'] as const).map((k) =>
          sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null,
        )}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            aria-label="Buscar por nombre o email"
            placeholder="Buscar por nombre o email..."
            defaultValue={q}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="outline" className="shrink-0">
          <Search className="h-4 w-4" />
        </Button>
      </Form>

      <PipelineBoard
        leads={result.leads}
        stats={stats}
        total={result.total}
        pagina={result.pagina}
        totalPaginas={result.totalPaginas}
        filters={{ q, etapa, prioridad, estado, fuente, canal }}
        columnMeta={COLUMN_META}
      />

      {paginas > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Paginación">
          <PaginationLink
            href={buildUrl('/admin/crm', sp, { p: result.pagina - 1 > 1 ? String(result.pagina - 1) : undefined })}
            disponible={result.pagina > 1}
            texto="← Anterior"
          />
          <span className="text-sm text-muted-foreground">
            {desde}–{hasta} de {result.total} · Página {result.pagina} de {paginas}
          </span>
          <PaginationLink
            href={buildUrl('/admin/crm', sp, { p: String(result.pagina + 1) })}
            disponible={result.pagina < paginas}
            texto="Siguiente →"
          />
        </nav>
      )}
    </div>
  )
}

function PaginationLink({
  href,
  disponible,
  texto,
}: {
  href: string
  disponible: boolean
  texto: string
}) {
  if (!disponible) {
    return <span className="text-sm text-muted-foreground/50">{texto}</span>
  }
  return (
    <a
      href={href}
      className="rounded-lg border border-border/70 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
    >
      {texto}
    </a>
  )
}

function buildUrl(
  base: string,
  sp: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...sp, ...overrides })) {
    if (v) params.set(k, v)
  }
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}
