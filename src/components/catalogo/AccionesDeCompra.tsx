import type { FichaDeItemDatos } from '@/modules/comercio/ficha-item'
import { PedirForm } from '@/components/pedidos/PedirForm'
import { AgregarAlCarrito } from '@/components/checkout/AgregarAlCarrito'
import { ReclamarOfertaBoton } from '@/components/deals/ReclamarOfertaBoton'

/**
 * LO QUE OPERA EN LA FICHA DE UN PRODUCTO O SERVICIO: obtener la oferta, agregar
 * al carrito, pedir o reservar.
 *
 * Solo lo importa la página de la ficha DENTRO DE LA APP (`/cliente/...`). La
 * landing no lo importa nunca, ni directa ni transitivamente: sus fichas son de
 * consulta y llevan a la app mediante `TraspasoALaApp`. La guardia
 * `tests/separacion-landing-app.test.ts` lo vigila.
 */

/** «Obtener oferta» sobre la mejor oferta viva del ítem. */
export function OfertaDeLaFicha({ ficha, retorno }: { ficha: FichaDeItemDatos; retorno: string }) {
  const oferta = ficha.mejorOferta
  if (!oferta) return null
  return <ReclamarOfertaBoton dealId={oferta.id} retorno={retorno} sucursales={oferta.sucursales} />
}

/**
 * El carrito admite productos Y servicios en un mismo pedido (una instalación con su cable); lo que cambia
 * según el tipo es el botón principal: «Hacer un pedido» o «Reservar».
 */
export function CompraDeLaFicha({ ficha, retorno }: { ficha: FichaDeItemDatos; retorno: string }) {
  const { item, pedido, servicio } = ficha
  if (!pedido?.habilitado) return null
  return (
    <>
      <AgregarAlCarrito
        companySlug={item.company.slug}
        moneda={item.currency}
        conVariantes={item.hasVariants}
        variantes={item.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, available: v.available }))}
      />
      <PedirForm
        retorno={retorno}
        moneda={item.currency}
        conVariantes={item.hasVariants}
        variantes={item.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, available: v.available, sucursalesConStock: v.sucursalesConStock, disponibilidad: v.disponibilidad }))}
        sucursales={pedido.sucursales}
        titulo={servicio ? 'Reservar este servicio' : 'Hacer un pedido'}
        cta={servicio ? 'Reservar' : 'Enviar pedido'}
      />
    </>
  )
}
