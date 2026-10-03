import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipOferta } from '@/components/supply-v2/chips'
import { FormEditarOferta } from '@/components/supply-v2/form-editar-oferta'
import { fichaOferta } from '@/modules/supply-v2/offers/queries'
import { OFERTA_EDITABLE } from '@/modules/supply-v2/core/estados'
import { BASE_SUPPLY_V2, OFFER_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY 2.0 · EDITAR una oferta (§7–§15).
 *
 * Un formulario plano, no el asistente de seis pasos: editar no es crear. Quien
 * llega aquí ya tiene la oferta publicada y viene a cambiar una cosa.
 */
export default async function EditarOfertaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const o = await fichaOferta(id)
  if (!o) notFound()

  const editable = OFERTA_EDITABLE.includes(o.status)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Editar ${o.title}`}
        description={`${o.code} · ${o.catalogItem.name} · ${o.supplier.commercialName}`}
        eyebrow={
          <Link href={`${BASE_SUPPLY_V2}/ofertas/${o.id}`} className="hover:underline">
            Volver a la oferta
          </Link>
        }
        nav={<NavSupplyV2 activa="ofertas" />}
        action={<ChipOferta estado={o.status} />}
      />

      {editable ? (
        <FormEditarOferta
          offerId={o.id}
          moneda={o.currency}
          unidades={o.quantityLimit}
          inicial={{
            title: o.title,
            description: o.description ?? '',
            publicPrice: o.publicPrice.toString(),
            salePrice: o.salePrice.toString(),
            perCustomerLimit: o.perCustomerLimit,
            endsAt: o.endsAt ? o.endsAt.toISOString().slice(0, 10) : '',
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="oferta-no-editable">
          Una oferta {OFFER_STATUS_LABELS[o.status].toLowerCase()} ya no se edita. Publica una nueva.
        </p>
      )}
    </div>
  )
}
