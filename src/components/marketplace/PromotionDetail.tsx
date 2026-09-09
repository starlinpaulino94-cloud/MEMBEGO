import Link from 'next/link'
import Image from 'next/image'
import { SharePromocionMenu } from '@/components/public/SharePromocionMenu'
import { PromotionViewTracker } from '@/components/marketplace/PromotionViewTracker'
import { GaleriaPromocion } from '@/components/marketplace/GaleriaPromocion'
import { getResenasEmpresa } from '@/modules/marketplace/cached'
import type { PromotionPublic } from '@/modules/marketplace/types'
import { formatDescuento, PROMO_TIPO_LABEL } from '@/lib/promociones'

/** «★★★★☆ 4.6 (120)» con estrellas de verdad, no un número seco. */
function Estrellas({ promedio, total }: { promedio: number; total: number }) {
  const llenas = Math.round(promedio)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="text-retail-star tracking-tight">
        {'★'.repeat(llenas)}
        <span className="text-border">{'★'.repeat(5 - llenas)}</span>
      </span>
      <span className="text-label-lg text-foreground">{promedio.toFixed(1)}</span>
      <span className="sr-only">de 5, </span>
      <span className="text-caption">
        ({total.toLocaleString('es-DO')}
        <span className="sr-only"> reseñas</span>)
      </span>
    </span>
  )
}

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

export async function PromotionDetail({ mode, promotion, comprarSlot, retorno }: PromotionDetailProps) {
  const isApp = mode === 'app'
  const isExpired =
    promotion.vigenciaHasta && new Date(promotion.vigenciaHasta) < new Date()

  // El perfil enseña lo que los clientes del negocio opinan. Van cacheadas
  // 5 min; si la lectura falla, la sección simplemente no se pinta.
  const resenas = await getResenasEmpresa(promotion.company.id)

  // La galería: portada + arte adicional, sin duplicados y sin huecos.
  const galeria = [
    ...(promotion.imagenUrl ? [promotion.imagenUrl] : []),
    ...(promotion.imagenes ?? []),
  ].filter((src, i, todas) => todas.indexOf(src) === i)

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
      <PromotionViewTracker promocionId={promotion.id} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back Link */}
        <Link href={backHref} className="text-primary hover:underline flex items-center gap-2">
          ← Volver a promociones
        </Link>

        {/* Main Card */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-border/80 shadow-premium">
          {/* Galería (2+ imágenes) o portada simple. El campo `imagenes`
              existía en el modelo desde el principio; esta es la primera
              pantalla que lo enseña. */}
          {galeria.length > 1 ? (
            <GaleriaPromocion imagenes={galeria} alt={promotion.titulo} />
          ) : null}
          {galeria.length <= 1 && promotion.imagenUrl && (
            // LA IMAGEN SE MUESTRA A SU PROPORCIÓN REAL, a todo el ancho.
            //
            // El historial de esta caja, para no repetirlo: altura fija +
            // `cover` recortaba el arte por los lados en móvil; una caja de
            // proporción fija + `contain` le ponía franjas a todo lo que no
            // midiera exactamente eso. Desde que la subida EXIGE el formato
            // Instagram (1:1 a 4:5, ver formato-imagen.ts) hay un RANGO
            // válido, y la única caja que no castiga a ninguno es la de la
            // propia imagen: ancho completo, alto el suyo, ni recorte ni
            // paspartú. El arte apaisado anterior a la exigencia también se
            // ve entero — simplemente más bajo.
            //
            // <img> nativo a propósito: `next/image` exige declarar una
            // proporción por adelantado (fill o width/height), que es
            // exactamente lo que ya no existe.
            <div className="overflow-hidden bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={promotion.imagenUrl}
                alt={promotion.titulo}
                className="block w-full h-auto"
              />
            </div>
          )}

          {/* Content */}
          <div className="p-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div className="flex-1">
                {/* `break-words`: un título con una palabra más ancha que el
                    móvil (un código, una URL) desbordaba la página entera. */}
                <h1 className="break-words text-4xl font-bold text-foreground">
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
                    <p className="break-words font-semibold text-foreground">
                      {promotion.company.name}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {resenas.promedio !== null && resenas.total > 0 ? (
                        <Estrellas promedio={resenas.promedio} total={resenas.total} />
                      ) : null}
                      <Link
                        href={empresaHref}
                        className="text-primary hover:underline text-sm"
                      >
                        Ver empresa
                      </Link>
                    </p>
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

        {/* Reseñas de clientes — el patrón Amazon: lo que otra gente dice es
            lo que decide. Son las reseñas del NEGOCIO (CompanyRating, lo que
            hoy existe), y la sección lo dice con su nombre: etiquetarlas como
            reseñas «del plan» sería inventar una fuente que no hay. */}
        {resenas.total > 0 ? (
          <section className="mt-8 rounded-lg border border-border bg-card p-6" aria-labelledby="resenas-titulo">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="resenas-titulo" className="min-w-0 break-words text-h3 text-foreground">
                Reseñas de clientes de {promotion.company.name}
              </h2>
              {resenas.promedio !== null ? (
                <Estrellas promedio={resenas.promedio} total={resenas.total} />
              ) : null}
            </div>

            {resenas.comentarios.length === 0 ? (
              <p className="mt-3 text-small text-muted-foreground">
                {resenas.total.toLocaleString('es-DO')}{' '}
                {resenas.total === 1 ? 'cliente ha valorado' : 'clientes han valorado'} este
                negocio, todavía sin comentarios escritos.
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {resenas.comentarios.map((r) => (
                  <li key={r.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="flex size-8 items-center justify-center rounded-full bg-brand-primary-soft text-label-sm font-semibold text-primary" aria-hidden>
                        {r.autor.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-label-lg text-foreground">{r.autor}</span>
                      <span aria-hidden className="text-caption text-retail-star">
                        {'★'.repeat(r.rating)}
                      </span>
                      <span className="sr-only">{r.rating} de 5 estrellas</span>
                      <span className="text-label-sm text-muted-foreground">
                        {new Date(r.fecha).toLocaleDateString('es-DO', {
                          timeZone: 'America/Santo_Domingo',
                          year: 'numeric',
                          month: 'long',
                        })}
                      </span>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-small leading-relaxed text-foreground">
                      {r.comentario}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/* Related Company Info */}
        <div className="mt-8 rounded-lg border border-border bg-brand-primary-soft p-6">
          <h2 className="break-words text-2xl font-bold text-foreground mb-4">
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
