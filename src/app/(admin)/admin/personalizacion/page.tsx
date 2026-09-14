import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import { getEngagementConfig } from '@/modules/engagement/config'
import { getCategoriesPublic } from '@/modules/marketplace/cached'
import { getHomeBorrador, getHomePublicada } from '@/modules/home/composicion'
import { leerSlidesEditor } from '@/modules/home/editor-contrato'
import { TIPOS_BLOQUE } from '@/modules/home/esquema'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { PersonalizacionForm } from '@/components/admin/PersonalizacionForm'
import {
  EditorInicio,
  type BorradorInicial,
  type TipoBloque,
} from '@/components/admin/EditorInicio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Editor de inicio' }

function esTipoBloque(t: string): t is TipoBloque {
  return (TIPOS_BLOQUE as readonly string[]).includes(t)
}

export default async function AdminPersonalizacionPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) {
    return <SinEmpresaActiva seccion="la personalización de tu experiencia" />
  }

  const [config, trabajo, publicada, datos, categorias] = await Promise.all([
    getEngagementConfig(companyId),
    getHomeBorrador(companyId),
    getHomePublicada(companyId),
    conEmpresa(companyId, (tx) =>
      Promise.all([
        tx.company.findUnique({
          where: { id: companyId },
          select: {
            name: true,
            ciudad: true,
            bannerUrl: true,
            galleryImages: true,
            logoUrl: true,
          },
        }),
        tx.promocion.findMany({
          where: { companyId, activo: true },
          select: { id: true, titulo: true, imagenUrl: true, imagenes: true },
          orderBy: { updatedAt: 'desc' },
          take: 30,
        }),
        tx.plan.findMany({
          where: { companyId, activo: true },
          select: { id: true, nombre: true, precio: true },
          orderBy: [{ orden: 'asc' }, { precio: 'asc' }],
        }),
        tx.excursion.findMany({
          where: { companyId },
          select: { id: true, nombre: true },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
      ])
    ).catch(() => [null, [], [], []] as const),
    getCategoriesPublic().catch(() => []),
  ])

  const [empresa, promos, planes, excursiones] = datos
  const cabecera = trabajo?.bloques.find((b) => b.tipo === 'CABECERA')
  const seg = (cabecera?.config as { segmentacion?: unknown } | null)?.segmentacion as
    | { membresia?: unknown; radioKm?: unknown; hasta?: unknown }
    | undefined

  const borrador: BorradorInicial | null = trabajo
    ? {
        id: trabajo.id,
        estado: trabajo.estado,
        programadaPara: trabajo.programadaPara
          ? trabajo.programadaPara.toISOString().slice(0, 16)
          : null,
        territorio: trabajo.territorio,
        bloques: trabajo.bloques
          .filter((b) => esTipoBloque(b.tipo))
          .map((b) => ({ tipo: b.tipo as TipoBloque, activo: b.activo })),
        slides: leerSlidesEditor(
          trabajo.bloques.find((b) => b.tipo === 'HERO')?.config ?? { slides: [] }
        ),
        segmentacion: {
          membresia: seg?.membresia === 'SIN_PLAN' ? 'SIN_PLAN' : 'CUALQUIERA',
          radioKm:
            typeof seg?.radioKm === 'number' && seg.radioKm >= 1 && seg.radioKm <= 100
              ? seg.radioKm
              : 15,
          hasta: typeof seg?.hasta === 'string' ? seg.hasta.slice(0, 16) : '',
        },
      }
    : null

  const media = [
    ...new Set(
      [
        empresa?.bannerUrl,
        empresa?.logoUrl,
        ...(empresa?.galleryImages ?? []),
        ...promos.flatMap((p) => [p.imagenUrl, ...(p.imagenes ?? [])]),
      ].filter((u): u is string => !!u)
    ),
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Editor de inicio"
        description="Cómo se ve tu negocio en la app del cliente: bloques, banners, segmentación y publicación."
      />
      <EditorInicio
        companyId={companyId}
        companyName={empresa?.name ?? 'Tu empresa'}
        territorioSugerido={empresa?.ciudad ?? ''}
        trabajo={borrador}
        publicada={
          publicada
            ? {
                id: publicada.id,
                updatedAt: publicada.updatedAt.toISOString(),
                territorio: publicada.territorio,
              }
            : null
        }
        media={media}
        previewCategorias={categorias.map((c) => c.name)}
        promociones={promos.map((p) => ({ id: p.id, titulo: p.titulo }))}
        planes={planes.map((p) => ({ id: p.id, titulo: p.nombre }))}
        excursiones={excursiones.map((e) => ({ id: e.id, titulo: e.nombre }))}
        previewEmpresas={[{ name: empresa?.name ?? 'Tu empresa' }]}
        previewPlanes={planes
          .slice(0, 2)
          .map((p) => ({ nombre: p.nombre, precio: Number(p.precio) }))}
      />

      <div className="space-y-4">
        <PageHeader
          title="Personalización"
          description="Ajusta el color de acento y elige qué módulos del motor de engagement ve tu cliente en el inicio."
        />
        <PersonalizacionForm config={config} />
      </div>
    </div>
  )
}
