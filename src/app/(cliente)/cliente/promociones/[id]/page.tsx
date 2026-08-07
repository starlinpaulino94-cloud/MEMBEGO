import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { recordPromotionView } from '@/modules/marketplace/actions'
import { getPromotionDetail } from '@/modules/marketplace/cached'
import { estadoLimiteCliente } from '@/modules/promociones/compra'
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
 * Fase 4 · la compra es multi-tenant: solo se muestra el botón de adquirir si
 * el cliente pertenece a la empresa que publica la promoción; en empresas
 * ajenas el detalle es informativo ("Ver empresa y sus planes"). El parámetro
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

  // Registrar vista (no bloqueante)
  recordPromotionView(id).catch(console.error)

  const clienteId = user.metadata.clienteId as string | undefined
  const esMiEmpresa = promotion.company.id === user.metadata.companyId

  // Límite por cliente (ej. "primer lavado gratis" = un solo uso): si ya llegó
  // al tope, el botón muestra "ya adquirida" en vez de dejar reintentar.
  const limite =
    promotion.venta && clienteId && esMiEmpresa
      ? await estadoLimiteCliente(clienteId, promotion.id, promotion.venta.limitePorCliente)
      : { limite: null, adquiridas: 0, alcanzado: false }

  return (
    <PromotionDetail
      mode="app"
      promotion={promotion}
      retorno={retorno}
        comprarSlot={
        promotion.venta && esMiEmpresa ? (
          <ComprarPromoButton
            promocionId={promotion.id}
            precio={promotion.venta.precio}
            agotada={promotion.venta.agotada}
            yaAdquirida={limite.alcanzado}
            unSoloUso={promotion.venta.limitePorCliente === 1}
            retorno={retorno}
          />
        ) : undefined
      }
    />
  )
}
