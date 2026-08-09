import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import {
  listPlanPlantillas,
  planPlantillaModelos,
  type PlanPlantillaCard,
} from '@/modules/admin/plantillas'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { ArrowLeft, Check, Users, Target } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DIFICULTAD_STYLE: Record<PlanPlantillaCard['dificultad'], string> = {
  baja: 'bg-success/10 text-success',
  media: 'bg-warning/15 text-warning',
  alta: 'bg-destructive/10 text-destructive',
}

function fmtPrecio(p: PlanPlantillaCard): string {
  if (p.precioSugerido <= 0) return 'Sin cuota'
  return `${p.moneda === 'DOP' ? 'RD$' : p.moneda + ' '}${p.precioSugerido.toLocaleString('es-DO')}`
}

function PlantillaCard({ p }: { p: PlanPlantillaCard }) {
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">{p.nombre}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-info">
                {p.modelo}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-medium capitalize ${DIFICULTAD_STYLE[p.dificultad]}`}
              >
                Dificultad {p.dificultad}
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">{p.descripcion}</p>

        <p className="mt-3 text-xl font-bold text-foreground">
          {fmtPrecio(p)}
          <span className="text-sm font-normal text-muted-foreground">
            {' '}
            · {p.periodicidad} (precio sugerido)
          </span>
        </p>

        {p.beneficios.length > 0 && (
          <ul className="mt-3 space-y-1">
            {p.beneficios.slice(0, 4).map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {b}
              </li>
            ))}
            {p.beneficios.length > 4 && (
              <li className="text-xs text-muted-foreground">
                +{p.beneficios.length - 4} beneficios más
              </li>
            )}
          </ul>
        )}

        <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          {p.recomendadoPara && (
            <div className="flex items-start gap-1.5">
              <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium text-foreground">Recomendado para:</span>{' '}
                {p.recomendadoPara}
              </span>
            </div>
          )}
          {p.problemaQueResuelve && (
            <div className="flex items-start gap-1.5">
              <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span className="line-clamp-2">
                <span className="font-medium text-foreground">Resuelve:</span>{' '}
                {p.problemaQueResuelve}
              </span>
            </div>
          )}
        </dl>

        <div className="mt-auto pt-4">
          <Link href={`/admin/planes/nuevo?plantilla=${encodeURIComponent(p.key)}`}>
            <Button size="sm" className="w-full">
              Usar plantilla
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export default async function PlanPlantillasPage({
  searchParams,
}: {
  searchParams: Promise<{ modelo?: string }>
}) {
  await requireRole(ADMIN_ROLES)
  const { modelo } = await searchParams

  const modelos = planPlantillaModelos()
  const modeloActivo = modelo && modelos.includes(modelo) ? modelo : null
  const plantillas = listPlanPlantillas(modeloActivo ?? undefined)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plantillas de plan"
        description="Modelos de membresía listos para usar. Al elegir uno se crea una copia editable: ajusta precio y beneficios y guárdalo. La plantilla original no cambia."
        action={
          <Link href="/admin/planes">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Mis planes
            </Button>
          </Link>
        }
      />

      {/* Filtro por modelo comercial */}
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/planes/plantillas">
          <Badge variant={modeloActivo ? 'secondary' : 'default'} className="cursor-pointer">
            Todos ({listPlanPlantillas().length})
          </Badge>
        </Link>
        {modelos.map((m) => (
          <Link key={m} href={`/admin/planes/plantillas?modelo=${encodeURIComponent(m)}`}>
            <Badge
              variant={modeloActivo === m ? 'default' : 'secondary'}
              className="cursor-pointer"
            >
              {m}
            </Badge>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plantillas.map((p) => (
          <PlantillaCard key={p.key} p={p} />
        ))}
      </div>
    </div>
  )
}
