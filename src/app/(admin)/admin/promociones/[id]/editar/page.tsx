import { notFound } from 'next/navigation'
import { conEmpresa, conEmpresaOTodas } from '@/lib/tenant'
import { companyFilter } from '@/modules/admin/queries'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { rutaPublicaPromo } from '@/modules/promociones/slug'
import { PromocionForm } from '@/components/admin/PromocionForm'
import { SharePreviewCard } from '@/components/share/SharePreviewCard'

export default async function EditarPromocionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params

  // Con el contexto del administrador: además de preparar RLS, impide abrir la
  // promoción de otra empresa acertando el identificador.
  const companyId = companyFilter(user)
  const promo = await conEmpresaOTodas(
    companyId,
    'promociones · editar: sin empresa activa es el superadmin',
    (tx) => tx.promocion.findUnique({ where: { id } })
  )
  if (!promo) notFound()
  if (companyId && promo.companyId !== companyId) notFound()

  // Textos de compartición guardados (para la vista previa de abajo).
  const shareRaw = (promo.shareConfig ?? {}) as { ogTitulo?: unknown; ogDescripcion?: unknown }
  const share = {
    ogTitulo: typeof shareRaw.ogTitulo === 'string' ? shareRaw.ogTitulo : '',
    ogDescripcion: typeof shareRaw.ogDescripcion === 'string' ? shareRaw.ogDescripcion : '',
  }

  const campanas = await conEmpresa(promo.companyId, (tx) =>
    tx.campana.findMany({
      where: { companyId: promo.companyId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { createdAt: 'desc' },
    })
  )
  if (
    user.metadata.role !== 'SUPERADMIN' &&
    promo.companyId !== user.metadata.companyId
  ) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Editar promoción</h1>
      </div>
      <PromocionForm
        existing={{ ...promo, precio: promo.precio != null ? Number(promo.precio) : null }}
        campanas={campanas}
      />

      {/* Share Engine: cómo se verá el enlace al compartirlo (tarjeta REAL). */}
      <section className="rounded-2xl border border-border/70 bg-card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Vista previa al compartir
        </h2>
        <SharePreviewCard
          imageSrc={`${rutaPublicaPromo(promo)}/opengraph-image?v=${promo.updatedAt.getTime()}`}
          titulo={share.ogTitulo || promo.titulo}
          descripcion={share.ogDescripcion || promo.descripcion || ''}
          urlMostrada={`membego.com${rutaPublicaPromo(promo)}`}
        />
      </section>
    </div>
  )
}
