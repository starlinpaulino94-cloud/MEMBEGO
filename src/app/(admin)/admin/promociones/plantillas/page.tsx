import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import {
  listPromoPlantillas,
  promoPlantillaCategorias,
  type PromoPlantillaCard,
} from '@/modules/admin/plantillas'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { ArrowLeft, Sparkles, Target, Gauge, Users } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DIFICULTAD_STYLE: Record<PromoPlantillaCard['dificultad'], string> = {
  baja: 'bg-success/10 text-success',
  media: 'bg-warning/15 text-warning',
  alta: 'bg-destructive/10 text-destructive',
}

function PlantillaCard({ p }: { p: PromoPlantillaCard }) {
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">{p.nombre}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-info">
                {p.categoria}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-medium capitalize ${DIFICULTAD_STYLE[p.dificultad]}`}
              >
                Dificultad {p.dificultad}
              </span>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {p.code}
          </Badge>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">{p.descripcion}</p>

        <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-start gap-1.5">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              <span className="font-medium text-foreground">Beneficio:</span> {p.beneficio}
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              <span className="font-medium text-foreground">Recomendado para:</span>{' '}
              {p.recomendadoPara}
            </span>
          </div>
          {p.resultadoEsperado && (
            <div className="flex items-start gap-1.5">
              <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span className="line-clamp-2">
                <span className="font-medium text-foreground">Resultado esperado:</span>{' '}
                {p.resultadoEsperado}
              </span>
            </div>
          )}
          {p.duracionRecomendada && (
            <div className="flex items-start gap-1.5">
              <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium text-foreground">Duración sugerida:</span>{' '}
                {p.duracionRecomendada}
              </span>
            </div>
          )}
        </dl>

        <div className="mt-auto pt-4">
          <Link href={`/admin/promociones/nuevo?plantilla=${encodeURIComponent(p.key)}`}>
            <Button size="sm" className="w-full">
              Usar plantilla
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export default async function PromoPlantillasPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string }>
}) {
  await requireRole(ADMIN_ROLES)
  const { categoria } = await searchParams

  const categorias = promoPlantillaCategorias()
  const categoriaActiva = categoria && categorias.includes(categoria) ? categoria : null
  const plantillas = listPromoPlantillas(categoriaActiva ?? undefined)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plantillas de promoción"
        description="Estrategias listas para usar. Al elegir una se crea una copia editable: ajústala y publícala. La plantilla original no cambia."
        action={
          <Link href="/admin/promociones">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Mis promociones
            </Button>
          </Link>
        }
      />

      {/* Filtro por categoría (objetivo comercial) */}
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/promociones/plantillas">
          <Badge
            variant={categoriaActiva ? 'secondary' : 'default'}
            className="cursor-pointer"
          >
            Todas ({listPromoPlantillas().length})
          </Badge>
        </Link>
        {categorias.map((c) => (
          <Link
            key={c}
            href={`/admin/promociones/plantillas?categoria=${encodeURIComponent(c)}`}
          >
            <Badge
              variant={categoriaActiva === c ? 'default' : 'secondary'}
              className="cursor-pointer"
            >
              {c}
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
