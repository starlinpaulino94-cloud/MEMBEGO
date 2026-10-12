import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { obtenerItemEnTx } from '@/modules/catalog/queries'
import { listarCategoriasEnTx } from '@/modules/catalog/medios'
import { panoramaDelItemEnTx } from '@/modules/comercio/panorama-item'
import { CatalogoError } from '@/modules/catalog/errores'
import { TRANSICIONES_ITEM, normalizarCapacidades } from '@/modules/catalog/domain'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { ETIQUETA_ESTADO, ETIQUETA_TIPO, urlPublicaCatalogo } from '@/modules/catalog/formato'
import { ItemDetalleForm } from '@/components/catalogo/ItemDetalleForm'
import { EstadoItemBotones } from '@/components/catalogo/EstadoItemBotones'
import { VariantesPanel } from '@/components/catalogo/VariantesPanel'
import { ImagenesPanel } from '@/components/catalogo/ImagenesPanel'
import { CategoriasPanel } from '@/components/catalogo/CategoriasPanel'
import { PanoramaComercial } from '@/components/catalogo/PanoramaComercial'
import type { VarianteVista } from '@/components/catalogo/VarianteForm'

const SECCIONES = [
  { id: 'informacion', label: 'Información' },
  { id: 'variantes', label: 'Variantes y precio' },
  { id: 'inventario', label: 'Inventario' },
  { id: 'promociones', label: 'Promociones' },
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'historial', label: 'Historial' },
] as const

export const dynamic = 'force-dynamic'

export default async function ItemCatalogoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params

  let datos
  try {
    datos = await conEmpresa(companyId, async (tx) => ({
      item: await obtenerItemEnTx(tx, companyId, id),
      categorias: await listarCategoriasEnTx(tx, companyId),
      panorama: await panoramaDelItemEnTx(tx, companyId, id),
    }))
  } catch (e) {
    // «No existe» y «es de otra empresa» se ven igual a propósito.
    if (e instanceof CatalogoError) notFound()
    throw e
  }
  const { item, categorias, panorama } = datos

  const deSupply = item.source === 'SUPPLY'
  const archivado = item.status === 'ARCHIVED'
  const editable = !deSupply && !archivado
  const caps = normalizarCapacidades(item.type, item.capabilities)

  // Lo que se enseña del resto del comercio depende de lo que la persona puede
  // hacer allí (la página destino lo vuelve a comprobar) y de que el módulo
  // esté encendido para la empresa.
  const [vInventario, vOfertas, vPedidos, conDeals, conPedidos] = await Promise.all([
    puedeFuncion('inventario', 'ajustar'),
    puedeFuncion('deals', 'crear'),
    puedeFuncion('pedidos-membego', 'gestionar'),
    tieneCapacidad(companyId, 'DEALS_MARKETPLACE').catch(() => false),
    tieneCapacidad(companyId, 'PEDIDOS_MEMBEGO').catch(() => false),
  ])

  const variantes: VarianteVista[] = item.variants.map((v) => ({
    id: v.id,
    name: v.name,
    sku: v.sku,
    barcode: v.barcode,
    price: v.price,
    cost: v.cost,
    compareAtPrice: v.compareAtPrice,
    attributes: (v.attributes ?? {}) as Record<string, string>,
    isDefault: v.isDefault,
    status: v.status,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/catalogo" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Catálogo
          </Link>
        }
        title={item.name}
        description={`${ETIQUETA_TIPO[item.type]} · ${item.slug}`}
        action={<Badge>{ETIQUETA_ESTADO[item.status]}</Badge>}
      />

      {deSupply && (
        <Alert>
          <AlertDescription>Este producto viene de Membego Supply y no se edita aquí.</AlertDescription>
        </Alert>
      )}
      {archivado && (
        <Alert>
          <AlertDescription>Está archivado. Restáuralo como borrador para volver a editarlo.</AlertDescription>
        </Alert>
      )}

      <EstadoItemBotones itemId={item.id} siguientes={deSupply ? [] : TRANSICIONES_ITEM[item.status]} soloLectura={deSupply} />

      {/* Un solo producto, una sola ficha: lo que es, lo que cuesta, lo que hay,
          lo que se ofrece, lo que se pidió. Las secciones son anclas, no páginas:
          nadie tiene que saltar entre cinco módulos para entender un producto. */}
      <nav aria-label="Secciones del producto" className="-mx-1 overflow-x-auto">
        <ul className="flex gap-1 px-1 text-sm">
          {SECCIONES.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-block whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="informacion">
          <CardHeader>
            <CardTitle>Información</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemDetalleForm
              itemId={item.id}
              name={item.name}
              description={item.description}
              capabilities={(item.capabilities ?? {}) as Record<string, boolean>}
              editable={editable}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card id="variantes">
            <CardHeader>
              <CardTitle>{item.tieneVariantes ? 'Variantes y precios' : 'Precio'}</CardTitle>
            </CardHeader>
            <CardContent>
              <VariantesPanel itemId={item.id} moneda={item.currency} variantes={variantes} editable={editable} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fotos</CardTitle>
            </CardHeader>
            <CardContent>
              <ImagenesPanel
                itemId={item.id}
                editable={editable}
                imagenes={item.images.map((i) => ({ id: i.id, url: urlPublicaCatalogo(i.path) }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Categorías</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoriasPanel
                itemId={item.id}
                editable={editable}
                categorias={categorias.map((c) => ({ id: c.id, name: c.name, items: c._count.items }))}
                asignadas={item.categories.map((c) => c.categoryId)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {panorama && (
        <div className="grid gap-6 lg:grid-cols-2">
          <PanoramaComercial
            itemNombre={item.name}
            itemSlug={item.slug}
            moneda={item.currency}
            publicado={item.status === 'ACTIVE'}
            enMarketplace={caps.availableMarketplace}
            enPOS={caps.availablePOS}
            panorama={panorama}
            puede={{ inventario: vInventario, ofertas: vOfertas && conDeals && !deSupply, pedidos: vPedidos && conPedidos }}
          />
        </div>
      )}
    </div>
  )
}
