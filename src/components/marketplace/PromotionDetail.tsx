import Link from 'next/link'
import Image from 'next/image'
import { SharePromocionMenu } from '@/components/public/SharePromocionMenu'
import type { PromotionPublic } from '@/modules/marketplace/types'
import { formatDescuento, PROMO_TIPO_LABEL } from '@/lib/promociones'

export interface PromotionDetailProps {
  /**
   * 'public' = detalle dentro de la Landing (CTA de registro).
   * 'app'    = detalle interno dentro de la aplicación autenticada; los enlaces
   *            a la empresa y de vuelta permanecen dentro del sistema.
   */
  mode: 'public' | 'app'
  promotion: PromotionPublic
  /** Fase E5: CTA de compra directa (lo inyecta la página del cliente). */
  comprarSlot?: React.ReactNode
  /**
   * Fase 4: ruta a la que volver en lugar del índice (viniendo del detalle de
   * empresa desde el mapa se regresa ahí, sin perder el contexto de ubicación).
   */
  retorno?: string
}

export function PromotionDetail({ mode, promotion, comprarSlot, retorno }: PromotionDetailProps) {
  const isApp = mode === 'app'
  const isExpired =
    promotion.vigenciaHasta && new Date(promotion.vigenciaHasta) < new Date()

  const backHref = retorno ?? (isApp ? '/cliente/promociones' : '/promociones')
  const empresaHref = isApp
    ? `/cliente/empresas/${promotion.company.slug}`
    : `/empresas/${promotion.company.slug}`
  // Al registrarse desde una promo compartida, lo PRIMERO que ve el usuario
  // dentro de la app es ESTA promoción con su botón de reclamar (?next=).
  const registroHref = `/registro/${promotion.company.slug}?next=${encodeURIComponent(
    `/cliente/promociones/${promotion.id}`
  )}`

  return (
    <div className={isApp ? 'bg-card' : 'min-h-screen bg-card'}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back Link */}
        <Link href={backHref} className="text-primary hover:underline flex items-center gap-2">
          ← Volver a promociones
        </Link>

        {/* Main Card */}
        <div className="mt-8 overflow-hidden rounded-3xl border border-border/80 shadow-premium">
          {/* Image */}
          {promotion.imagenUrl && (
            // El arte lo sube el negocio y suele llevar el TEXTO en los bordes
            // (formato de Instagram, 1:1). Con altura fija + `object-cover`,
            // en un celular la caja quedaba casi cuadrada y el recorte se
            // comía justo ese texto. En móvil la caja es cuadrada (el formato
            // real del arte) y `object-contain` garantiza la imagen ENTERA en
            // cualquier proporción; el fondo `bg-muted` hace de paspartú
            // cuando sobra espacio.
            <div className="relative aspect-square w-full overflow-hidden bg-muted sm:aspect-auto sm:h-96">
              <Image
                src={promotion.imagenUrl}
                alt={promotion.titulo}
                fill
                className="object-contain"
              />
            </div>
          )}

          {/* Content */}
          <div className="p-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div className="flex-1">
                <h1 className="text-4xl font-bold text-foreground">
                  {promotion.titulo}
                </h1>

                {/* Company */}
                <div className="flex items-center gap-3 mt-4">
                  {promotion.company.logoUrl && (
                    <div className="relative h-10 w-10 overflow-hidden rounded-full bg-muted">
                      <Image
                        src={promotion.company.logoUrl}
                        alt={promotion.company.name}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-foreground">
                      {promotion.company.name}
                    </p>
                    <Link
                      href={empresaHref}
                      className="text-primary hover:underline text-sm"
                    >
                      Ver empresa
                    </Link>
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              {isExpired && (
                <div className="bg-destructive/15 text-destructive px-4 py-2 rounded-lg font-semibold">
                  Expirada
                </div>
              )}
              {promotion.isFeatured && (
                <div className="bg-info/15 text-info px-4 py-2 rounded-lg font-semibold flex items-center gap-2">
                  ⭐ Destacada
                </div>
              )}
            </div>

            {/* Compartir — acción primaria, prominente al inicio del detalle */}
            <div className="flex justify-start">
              <SharePromocionMenu
                promocionId={promotion.id}
                slug={promotion.slug}
                titulo={promotion.titulo}
                companyName={promotion.company.name}
              />
            </div>

            {/* Main Info */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-6 border-y border-border">
              {/* Discount */}
              {promotion.descuento && (
                <div className="bg-destructive/10 p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-destructive">
                    {formatDescuento(promotion.descuento, promotion.tipo)}
                  </div>
                  <div className="text-sm text-muted-foreground">Descuento</div>
                </div>
              )}

              {/* Code */}
              {promotion.codigo && (
                <div className="bg-info/10 p-4 rounded-lg text-center">
                  <code className="text-2xl font-bold text-primary">
                    {promotion.codigo}
                  </code>
                  <div className="text-sm text-muted-foreground">Código</div>
                </div>
              )}

              {/* Type */}
              <div className="rounded-xl bg-muted p-4 text-center">
                <div className="text-lg font-bold text-foreground">
                  {PROMO_TIPO_LABEL[promotion.tipo] ?? promotion.tipo}
                </div>
                <div className="text-sm text-muted-foreground">Tipo</div>
              </div>
            </div>

            {/* Description */}
            {promotion.descripcion && (
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-3">
                  Descripción
                </h2>
                <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                  {promotion.descripcion}
                </p>
              </div>
            )}

            {/* Validity */}
            <div className="rounded-xl bg-muted p-4">
              <h3 className="font-semibold text-foreground mb-2">Vigencia</h3>
              <div className="space-y-1 text-sm text-foreground">
                {promotion.vigenciaDesde && (
                  <div>
                    <span className="font-semibold">Desde:</span>{' '}
                    {new Date(promotion.vigenciaDesde).toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </div>
                )}
                {promotion.vigenciaHasta && (
                  <div className={isExpired ? 'text-destructive font-semibold' : ''}>
                    <span className="font-semibold">Hasta:</span>{' '}
                    {new Date(promotion.vigenciaHasta).toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                    {isExpired && ' (Expirada)'}
                  </div>
                )}
              </div>
            </div>

            {/* Tags */}
            {promotion.tags && promotion.tags.length > 0 && (
              <div>
                <h3 className="font-semibold text-foreground mb-2">Categorías</h3>
                <div className="flex flex-wrap gap-2">
                  {promotion.tags.map((tag) => (
                    <span
                      key={tag}
                      className="bg-info/10 text-info px-3 py-1 rounded-full text-sm"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span>{promotion.viewCount} vistas</span>
              <span>{promotion.shareCount} compartidas</span>
            </div>

            {/* CTA */}
            {!isExpired && (
              <div className="pt-4 space-y-3">
                {/* Fase E5: compra directa (inyectada por la página del cliente) */}
                {comprarSlot}
                {isApp && comprarSlot ? null : isApp ? (
                  <Link
                    href={empresaHref}
                    className="w-full block text-center bg-primary text-primary-foreground px-6 py-4 rounded-lg hover:bg-primary transition-colors font-bold text-lg"
                  >
                    {/* No se nombran los planes de un negocio que no los tiene:
                        el botón es una promesa y aquí llevaba a una sección que
                        no existe. `undefined` (listados) mantiene el texto de
                        siempre. */}
                    {promotion.company.tienePlanes === false
                      ? 'Ver empresa'
                      : 'Ver empresa y sus planes'}
                  </Link>
                ) : (
                  <Link
                    href={registroHref}
                    className="w-full block text-center bg-primary text-primary-foreground px-6 py-4 rounded-lg hover:bg-primary transition-colors font-bold text-lg"
                  >
                    Adquirir promoción
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Related Company Info */}
        <div className="mt-12 rounded-2xl bg-muted p-6">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Más sobre {promotion.company.name}
          </h2>
          <p className="text-foreground mb-4">
            Descubre todas las promociones y beneficios que ofrece esta empresa
          </p>
          <Link
            href={empresaHref}
            className="inline-block bg-primary text-primary-foreground px-6 py-3 rounded-lg hover:bg-primary transition-colors"
          >
            Ver empresa completa
          </Link>
        </div>
      </div>
    </div>
  )
}
