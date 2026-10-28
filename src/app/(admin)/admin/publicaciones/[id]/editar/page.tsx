import { notFound } from 'next/navigation'
import { conEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { PostForm } from '@/components/admin/PostForm'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

export default async function EditarPublicacionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params

  const post = await conEmpresa(companyId,
    (tx) => tx.companyPost.findUnique({ where: { id } })
  )
  if (!post) notFound()

  const campanas = await conEmpresa(companyId,
    (tx) => tx.campana.findMany({
      where: { companyId: post.companyId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { createdAt: 'desc' },
    })
  )
  // Aislamiento: solo la empresa dueña (o superadmin) puede editar.
  if (companyId && post.companyId !== companyId) notFound()

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        variant="formulario"
        className="mb-0 sm:mb-0"
        back={
          <Link href="/admin/publicaciones" className="text-muted-foreground hover:text-foreground">
            ‹ Publicaciones
          </Link>
        }
        title="Editar publicación"
        description={post.titulo}
      />
      <PostForm
        campanas={campanas}
        existing={{
          id: post.id,
          tipo: post.tipo,
          titulo: post.titulo,
          contenido: post.contenido,
          imagenUrl: post.imagenUrl,
          fechaEvento: post.fechaEvento,
          lugar: post.lugar,
          campanaId: post.campanaId,
          activo: post.activo,
        }}
      />
    </div>
  )
}

