import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { DeletePostButton } from '@/components/admin/DeletePostButton'
import { CompartirOfertaButton } from '@/components/admin/CompartirOfertaButton'
import {
  Newspaper,
  CalendarDays,
  BadgeCheck,
  Plus,
  Pencil,
  MapPin,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const dynamic = 'force-dynamic'

const TIPO_META: Record<string, { label: string; icon: LucideIcon; chip: string }> = {
  EVENTO: { label: 'Evento', icon: CalendarDays, chip: 'bg-primary/10 text-primary' },
  NOTICIA: { label: 'Noticia', icon: Newspaper, chip: 'bg-info/10 text-info' },
  BENEFICIO: { label: 'Beneficio', icon: BadgeCheck, chip: 'bg-success/10 text-success' },
}

// Sección del perfil público donde se muestra cada tipo de publicación.
const TIPO_ANCLA: Record<string, string> = {
  EVENTO: 'eventos',
  NOTICIA: 'noticias',
  BENEFICIO: 'beneficios',
}

function fmtFecha(d: Date | null) {
  if (!d) return null
  return new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(d))
}

export default async function PublicacionesPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)

  let posts: Awaited<ReturnType<typeof query>> = []
  async function query() {
    return conEmpresaOTodas(companyId, 'publicaciones: sin empresa activa es el superadmin', (tx) =>
      tx.companyPost.findMany({
      where: companyId ? { companyId } : {},
      include: { company: { select: { name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
      })
    )
  }
  try {
    posts = await query()
  } catch (e) {
    console.error('[admin-publicaciones]', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Publicaciones"
        description="Eventos, noticias y beneficios de tu empresa. Tus seguidores se notifican automáticamente al publicar."
        action={
          <Link href="/admin/publicaciones/nuevo">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nueva publicación
            </Button>
          </Link>
        }
      />

      {posts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Newspaper className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Sin publicaciones</p>
            <p className="text-sm">
              Publica un evento, una noticia o un beneficio para tus
              seguidores.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {posts.map((p) => {
            const meta = TIPO_META[p.tipo] ?? TIPO_META.NOTICIA
            return (
              <Card key={p.id} className={p.activo ? '' : 'opacity-60'}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-lg p-2 ${meta.chip}`}>
                        <meta.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{p.titulo}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className={`rounded-full px-2 py-0.5 font-medium ${meta.chip}`}>
                            {meta.label}
                          </span>
                          {!companyId && <span>{p.company.name}</span>}
                        </div>
                      </div>
                    </div>
                    <Badge variant={p.activo ? 'default' : 'secondary'}>
                      {p.activo ? 'Activa' : 'Oculta'}
                    </Badge>
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {p.contenido}
                  </p>

                  {p.tipo === 'EVENTO' && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {p.fechaEvento && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {fmtFecha(p.fechaEvento)}
                        </span>
                      )}
                      {p.lugar && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {p.lugar}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-end gap-1 border-t border-border/60 pt-3">
                    <CompartirOfertaButton
                      path={`/empresas/${p.company.slug}#${TIPO_ANCLA[p.tipo] ?? 'informacion'}`}
                      titulo={p.titulo}
                      texto={`${p.titulo} — ${meta.label.toLowerCase()} de ${p.company.name} en MembeGo.`}
                      advertencia={
                        p.activo
                          ? null
                          : 'La publicación está oculta: no se verá en tu página pública hasta activarla.'
                      }
                    />
                    <Link href={`/admin/publicaciones/${p.id}/editar`}>
                      <Button size="icon" variant="ghost" aria-label="Editar" title="Editar">
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </Link>
                    <DeletePostButton id={p.id} titulo={p.titulo} />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
