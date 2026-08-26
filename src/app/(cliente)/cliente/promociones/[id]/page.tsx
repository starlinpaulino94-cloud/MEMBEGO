import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { getPromotionDetail } from '@/modules/marketplace/cached'
import { estadoLimiteCliente } from '@/modules/promociones/compra'
import { fichaEnEmpresa } from '@/modules/cliente/afiliacion'
import { PromotionDetail } from '@/components/marketplace/PromotionDetail'
import { ComprarPromoButton } from '@/components/cliente/ComprarPromoButton'

export const dynamic = 'force-dynamic'

interface ClientePromocionPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ retorno?: string }>
}

/**
 * Detalle de promoción INTERNO. Reutiliza <PromotionDetail mode="app" /> para
 * que el cliente autenticado no salga a la Landing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL BOTÓN DE ADQUIRIR YA NO DEPENDE DE LA EMPRESA
 *
 * Aquí había una condición `promotion.venta && esMiEmpresa`: en una promoción
 * de otro negocio el botón NO se dibujaba y lo único que quedaba era «Ver
 * empresa y sus planes». Una recompensa que se puede reclamar se veía igual
 * que un folleto.
 *
 * Ahora basta con que la promoción esté a la venta. El alta en esa empresa y su
 * seguimiento son consecuencia de reclamarla, no un trámite previo — la regla
 * vive en `compraActions`, que es quien de verdad la aplica; esta pantalla solo
 * deja de esconder la puerta.
 *
 * `retorno` preserva el contexto de ubicación (volver al detalle de empresa).
 */
export default async function ClientePromocionPage({
  params,
  searchParams,
}: ClientePromocionPageProps) {
  const user = await requireRole('CLIENTE')
  const { id } = await params
  const { retorno } = await searchParams

  const promotion = await getPromotionDetail(id)
  if (!promotion) notFound()

  const esMiEmpresa = promotion.company.id === user.metadata.companyId

  // Límite por cliente (ej. "primer lavado gratis" = un solo uso): si ya llegó
  // al tope, el botón muestra "ya adquirida" en vez de dejar reintentar.
  //
  // Se cuenta contra la ficha que la persona tenga EN LA EMPRESA DE LA
  // PROMOCIÓN, que no tiene por qué ser la activa. Usando la activa, alguien
  // que ya reclamó los tacos vería el botón como si nunca lo hubiera hecho y se
  // toparía con el rechazo al pulsarlo.
  const miFicha = await fichaEnEmpresa(user.supabaseId, promotion.company.id)
  const limite =
    promotion.venta && miFicha
      ? await estadoLimiteCliente(miFicha, promotion.id, promotion.venta.limitePorCliente)
      : { limite: null, adquiridas: 0, alcanzado: false }

  return (
    <PromotionDetail
      mode="app"
      promotion={promotion}
      retorno={retorno}
        comprarSlot={
        promotion.venta ? (
          <ComprarPromoButton
            promocionId={promotion.id}
            precio={promotion.venta.precio}
            agotada={promotion.venta.agotada}
            yaAdquirida={limite.alcanzado}
            unSoloUso={promotion.venta.limitePorCliente === 1}
            retorno={retorno}
            // Negocio que la persona todavía no tiene: el botón lo dice antes de
            // pulsarlo. Empezar a seguir a alguien es un efecto que se avisa, no
            // una letra pequeña.
            empresaNueva={!esMiEmpresa && !miFicha}
            empresa={promotion.company.name}
          />
        ) : undefined
      }
    />
  )
}
