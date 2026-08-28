import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { notFound } from 'next/navigation'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { getPlaybook } from '@/lib/automation'
import {
  CATEGORIA_LABELS,
  COMPLEJIDAD_LABELS,
  ESTADO_LABELS,
  ESTADO_BADGE,
} from '@/modules/admin/estrategiasUi'
import {
  InstalarEstrategiaButton,
  PublicarEstrategiaButton,
  PausarEstrategiaButton,
  ArchivarEstrategiaButton,
} from '@/components/admin/EstrategiaAcciones'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  Target,
  AlertTriangle,
  Clock,
  ListChecks,
  Settings2,
  BarChart3,
  Link2,
  Lightbulb,
  GitBranch,
  Zap,
  CheckCircle2,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Detalle de una estrategia (Automation Playbook): muestra la ficha completa
 * del Documento Maestro (objetivo, problema, flujo, condiciones, acciones,
 * KPIs, configuración editable…) y permite instalarla o administrarla.
 */
export default async function EstrategiaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  const { id } = await params

  const playbook = getPlaybook(id)
  if (!playbook) notFound()

  const instalada = companyId
    ? await conEmpresaOTodas(
      companyId,
      'automatizaciones · plantillas · [id]: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.automation.findFirst({
          where: {
            companyId,
            templateKey: `playbook.${playbook.id}`,
            status: { not: 'ARCHIVED' },
          },
          select: { id: true, nombre: true, status: true },
        })
    )
    : null

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Volver + encabezado */}
      <div>
        <Link
          href={`/admin/automatizaciones/plantillas?categoria=${playbook.category}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a la biblioteca
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">{playbook.id}</Badge>
              <Badge variant="secondary">{CATEGORIA_LABELS[playbook.category]}</Badge>
              <Badge variant="outline">{COMPLEJIDAD_LABELS[playbook.complexity]}</Badge>
              {instalada ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[instalada.status] ?? ''}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {ESTADO_LABELS[instalada.status] ?? instalada.status}
                </span>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl font-bold text-foreground">{playbook.name}</h1>
            <p className="mt-1 text-muted-foreground">{playbook.objective}</p>
          </div>
          <div className="flex items-center gap-2">
            {!instalada ? (
              <InstalarEstrategiaButton playbookId={playbook.id} nombre={playbook.name} />
            ) : (
              <>
                {instalada.status !== 'PUBLISHED' ? (
                  <PublicarEstrategiaButton id={instalada.id} nombre={instalada.nombre} />
                ) : (
                  <PausarEstrategiaButton id={instalada.id} nombre={instalada.nombre} />
                )}
                <ArchivarEstrategiaButton id={instalada.id} nombre={instalada.nombre} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Qué resuelve y cuándo usarla */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Seccion icon={AlertTriangle} titulo="Problema que resuelve">
          <p className="text-sm text-muted-foreground">{playbook.problem}</p>
        </Seccion>
        <Seccion icon={Clock} titulo="Cuándo utilizarla">
          <p className="text-sm text-muted-foreground">{playbook.whenToUse}</p>
        </Seccion>
      </div>

      {/* Flujo completo */}
      <Seccion icon={GitBranch} titulo="Cómo funciona (flujo)">
        <ol className="space-y-2">
          {playbook.flow.map((paso, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              {paso}
            </li>
          ))}
        </ol>
      </Seccion>

      {/* Disparadores y condiciones */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Seccion icon={Zap} titulo="Se dispara cuando">
          <Lista items={playbook.triggers} />
        </Seccion>
        <Seccion icon={ListChecks} titulo="Condiciones">
          {playbook.conditions.length > 0 ? (
            <Lista items={playbook.conditions} />
          ) : (
            <p className="text-sm text-muted-foreground">Sin condiciones adicionales.</p>
          )}
        </Seccion>
      </div>

      {/* Esperas y excepciones */}
      {(playbook.esperas?.length || playbook.exceptions.length) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Seccion icon={Clock} titulo="Esperas del flujo">
            {playbook.esperas && playbook.esperas.length > 0 ? (
              <Lista items={playbook.esperas} />
            ) : (
              <p className="text-sm text-muted-foreground">Se ejecuta de inmediato.</p>
            )}
          </Seccion>
          <Seccion icon={AlertTriangle} titulo="Casos que se excluyen">
            <Lista items={playbook.exceptions} />
          </Seccion>
        </div>
      ) : null}

      {/* KPIs y configuración editable */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Seccion icon={BarChart3} titulo="Métricas que genera (KPIs)">
          <div className="flex flex-wrap gap-1.5">
            {playbook.kpis.map((k) => (
              <Badge key={k} variant="secondary" className="text-xs">
                {k.replaceAll('_', ' ')}
              </Badge>
            ))}
          </div>
        </Seccion>
        <Seccion icon={Settings2} titulo="Todo esto es configurable">
          <div className="flex flex-wrap gap-1.5">
            {playbook.editable.map((e) => (
              <Badge key={e} variant="outline" className="text-xs">
                {e}
              </Badge>
            ))}
          </div>
        </Seccion>
      </div>

      {/* Compatibilidades y dependencias */}
      <Seccion icon={Link2} titulo="Se integra con">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Motores:</span>{' '}
            {playbook.engines.join(', ')}
          </p>
          {playbook.compatibleBenefits.length > 0 ? (
            <p>
              <span className="font-medium text-foreground">Beneficios compatibles:</span>{' '}
              {playbook.compatibleBenefits.join(', ')}
            </p>
          ) : null}
          {playbook.compatiblePromotions.length > 0 ? (
            <p>
              <span className="font-medium text-foreground">Promociones compatibles:</span>{' '}
              {playbook.compatiblePromotions.join(', ')}
            </p>
          ) : null}
          {playbook.dependencies.length > 0 ? (
            <p>
              <span className="font-medium text-foreground">Requiere:</span>{' '}
              {playbook.dependencies.join('; ')}
            </p>
          ) : null}
        </div>
      </Seccion>

      {/* Ejemplos */}
      <Seccion icon={Lightbulb} titulo="Ejemplos de uso">
        <Lista items={playbook.examples} />
      </Seccion>

      {/* Nota técnica */}
      {playbook.notes ? (
        <p className="rounded-lg bg-muted p-4 text-xs text-muted-foreground">
          <span className="font-medium">Nota técnica:</span> {playbook.notes}
        </p>
      ) : null}
    </div>
  )
}

function Seccion({
  icon: Icon,
  titulo,
  children,
}: {
  icon: typeof Target
  titulo: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 text-primary" />
          {titulo}
        </h2>
        {children}
      </CardContent>
    </Card>
  )
}

function Lista({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
          {item}
        </li>
      ))}
    </ul>
  )
}
