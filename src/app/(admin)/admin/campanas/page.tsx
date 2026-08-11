import Link from 'next/link'
import { conEmpresaOTodas, type Tx } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { DeleteCampanaButton } from '@/components/admin/DeleteCampanaButton'
import {
  Flag,
  Plus,
  Pencil,
  Gift,
  Newspaper,
  Eye,
  Share2,
  Heart,
  CalendarDays,
} from 'lucide-react'

import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'

export const dynamic = 'force-dynamic'

function fmtFecha(d: Date | null) {
  if (!d) return null
  return new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'medium' }).format(new Date(d))
}

export default async function CampanasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  const sp = await searchParams
  const paginacion = leerPaginacion(sp)

  if (!companyId) {
    return <SinEmpresaActiva seccion="tus campañas" />
  }

  let campanas: Awaited<ReturnType<typeof query>> = []
  let total = 0
  // Esta lista no tenía tope: con muchas campañas se traían todas con sus
  // promociones anidadas en cada carga.
  // La lista recibe el `tx` de la transacción de abajo en vez de abrir la suya:
  // anidar transacciones pide una segunda conexión desde dentro de una abierta,
  // y con el pooler por delante es así como se agota el pool.
  const query = (tx: Tx) =>
    tx.campana.findMany({
      where: { companyId: companyId! },
      include: {
        promociones: {
          select: {
            viewCount: true,
            shareCount: true,
            _count: { select: { guardadaPor: true } },
          },
        },
        _count: { select: { promociones: true, posts: true } },
      },
      orderBy: [{ activo: 'desc' }, { createdAt: 'desc' }],
      skip: paginacion.saltar,
      take: paginacion.tomar,
    })
  try {
    ;[campanas, total] = await conEmpresaOTodas(
      companyId,
      'campanas: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => Promise.all([
        query(tx),
        tx.campana.count({ where: { companyId } }),
      ])
    )
  } catch (e) {
    console.error('[admin-campanas]', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas"
        description="Agrupa promociones y publicaciones bajo una misma campaña y mide su rendimiento en conjunto."
        action={
          <Link href="/admin/campanas/nueva">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nueva campaña
            </Button>
          </Link>
        }
      />

      {campanas.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Flag className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Sin campañas</p>
            <p className="text-sm">
              Crea una campaña (ej. &quot;Black Friday&quot;) y asígnale
              promociones y publicaciones desde sus formularios.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {campanas.map((c) => {
            const vistas = c.promociones.reduce((s, p) => s + p.viewCount, 0)
            const compartidas = c.promociones.reduce((s, p) => s + p.shareCount, 0)
            const guardadas = c.promociones.reduce(
              (s, p) => s + p._count.guardadaPor,
              0
            )
            return (
              <Card key={c.id} className={c.activo ? '' : 'opacity-60'}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-primary/10 p-2">
                        <Flag className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{c.nombre}</p>
                        {(c.fechaInicio || c.fechaFin) && (
                          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />
                            {fmtFecha(c.fechaInicio) ?? '—'} → {fmtFecha(c.fechaFin) ?? 'sin fin'}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant={c.activo ? 'default' : 'secondary'}>
                      {c.activo ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </div>

                  {c.descripcion && (
                    <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                      {c.descripcion}
                    </p>
                  )}

                  {/* Contenido de la campaña */}
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Gift className="h-3.5 w-3.5 text-warning" />
                      {c._count.promociones} promociones
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Newspaper className="h-3.5 w-3.5 text-primary" />
                      {c._count.posts} publicaciones
                    </span>
                  </div>

                  {/* Métricas conjuntas */}
                  <div className="mt-3 flex gap-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" /> {vistas}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Share2 className="h-3.5 w-3.5" /> {compartidas}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Heart className="h-3.5 w-3.5" /> {guardadas}
                    </span>

                    <div className="ml-auto flex items-center gap-1">
                      <Link href={`/admin/campanas/${c.id}/editar`}>
                        <Button size="icon" variant="ghost" title="Editar" aria-label="Editar">
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </Link>
                      <DeleteCampanaButton id={c.id} nombre={c.nombre} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {campanas.length > 0 && (
        <TablaPaginacion
          paginacion={paginacion}
          total={total}
          params={sp}
          etiqueta="campañas"
        />
      )}
    </div>
  )
}
