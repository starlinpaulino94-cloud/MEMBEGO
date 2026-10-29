import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
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

export default async function AdminPersonalizacionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const bannerPedido = Number(Array.isArray(sp.banner) ? sp.banner[0] : sp.banner)
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) {
    return <SinEmpresaActiva seccion="la personalización de tu experiencia" />
  }

  const homeBuilderActivo = await tieneCapacidad(companyId, 'HOME_BUILDER')

  const [config, trabajo, publicada, datos, categorias] = await Promise.all([
    getEngagementConfig(companyId),
    homeBuilderActivo ? getHomeBorrador(companyId) : Promise.resolve(null),
    homeBuilderActivo ? getHomePublicada(companyId) : Promise.resolve(null),
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
        // Lo que un banner puede enganchar: productos y servicios ACTIVOS.
        tx.catalogItem.findMany({
          where: { companyId, status: 'ACTIVE' },
          select: { id: true, name: true },
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
          take: 100,
        }),
      ])
    ).catch(() => [null, [], [], [], []] as const),
    getCategoriesPublic().catch(() => []),
  ])

  const [empresa, promos, planes, excursiones, catalogo] = datos
  // La copia de trabajo es el borrador; si no hay, el editor abre con lo que
  // está PUBLICADO. Antes abría en blanco: al publicar, el borrador pasa a ser la
  // revisión publicada y la empresa dejaba de ver (y de poder editar) sus banners.
  const origenEditor = trabajo ?? publicada
  const cabecera = origenEditor?.bloques.find((b) => b.tipo === 'CABECERA')
  const seg = (cabecera?.config as { segmentacion?: unknown } | null)?.segmentacion as
    | { membresia?: unknown; radioKm?: unknown; hasta?: unknown }
    | undefined

  let borrador: BorradorInicial | null = null
  if (origenEditor) {
    try {
      borrador = {
        id: origenEditor.id,
        estado: origenEditor.estado,
        programadaPara: origenEditor.programadaPara
          ? origenEditor.programadaPara.toISOString().slice(0, 16)
          : null,
        territorio: origenEditor.territorio,
        bloques: origenEditor.bloques
          .filter((b) => esTipoBloque(b.tipo))
          .map((b) => ({ tipo: b.tipo as TipoBloque, activo: b.activo })),
        slides: leerSlidesEditor(
          origenEditor.bloques.find((b) => b.tipo === 'HERO')?.config ?? { slides: [] }
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
    } catch (e) {
      console.error('[personalizacion] No se pudo leer la composición para el editor:', e)
    }
  }

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
      {homeBuilderActivo && (
        <>
          <PageHeader
            title="Editor de inicio"
            description="Cómo se ve tu negocio en la app del cliente: bloques, banners, segmentación y publicación."
          />
          <EditorInicio
            companyId={companyId}
            companyName={empresa?.name ?? 'Tu empresa'}
            territorioSugerido={empresa?.ciudad ?? ''}
            trabajo={borrador}
            bannerInicial={Number.isInteger(bannerPedido) && bannerPedido >= 1 ? bannerPedido : 1}
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
            catalogo={catalogo.map((c) => ({ id: c.id, titulo: c.name }))}
            previewEmpresas={[{ name: empresa?.name ?? 'Tu empresa' }]}
            previewPlanes={planes
              .slice(0, 2)
              .map((p) => ({ nombre: p.nombre, precio: Number(p.precio) }))}
          />
        </>
      )}

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
