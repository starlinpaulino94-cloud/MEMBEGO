import Link from 'next/link'
import { Clock, Tag } from 'lucide-react'
import type { OfertaPublica } from '@/modules/deals/publico-nucleo'
import { formatearPrecio } from '@/modules/catalog/formato'
import type { ReactNode } from 'react'
import { rutaDeEmpresa, type Espacio } from '@/modules/comercio/rutas'

function hasta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', timeZone: 'America/Santo_Domingo' })
}

/**
 * Tarjeta pública de una oferta. Solo recibe la proyección pública: nada interno llega aquí.
 *
 * `espacio` es obligatorio a propósito: dice dónde se pinta (la landing o la app
 * del cliente) y de él sale el enlace a la empresa. Con un valor por defecto, una
 * pantalla de la app que lo olvidara sacaría al cliente a la landing sin aviso.
 *
 * `accion` es lo único que OPERA en la tarjeta («Obtener oferta»), y entra por
 * ranura: la app pone el botón que obtiene la oferta; la landing pone un enlace
 * que lleva a la app. Así esta tarjeta es presentación pura y la landing no
 * arrastra ninguna operación comercial al pintarla.
 *
 * Por defecto es COMPACTA (se pinta de a dos por fila en el móvil, como las de
 * producto): título en dos líneas, precio y una línea de vigencia. Con `detalle`
 * es la tarjeta completa de la página de la oferta, con la descripción y las
 * condiciones del cupón.
 */
export function TarjetaOferta({
  oferta: o,
  espacio,
  accion,
  mostrarEmpresa = true,
  detalle = false,
}: {
  oferta: OfertaPublica
  espacio: Espacio
  accion: ReactNode
  mostrarEmpresa?: boolean
  detalle?: boolean
}) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card" aria-label={o.title}>
      {o.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- la URL es del bucket público de Storage
        <img src={o.imageUrl} alt="" loading="lazy" className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted" aria-hidden>
          <Tag className="h-8 w-8 text-muted-foreground/40" />
        </div>
      )}
      <div className={detalle ? 'flex flex-1 flex-col gap-3 p-4' : 'flex flex-1 flex-col gap-2 p-2.5 sm:p-3'}>
        <div className="min-w-0">
          <p className="inline-block max-w-full truncate rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{o.etiqueta}</p>
          <h3 className={detalle ? 'mt-2 text-h3 text-foreground' : 'mt-1.5 line-clamp-2 text-label-lg text-foreground'}>{o.title}</h3>
          <p className={detalle ? 'text-sm text-muted-foreground' : 'line-clamp-1 text-caption text-muted-foreground'}>
            {o.itemName}
            {o.variantName !== o.itemName ? ` · ${o.variantName}` : ''}
          </p>
          {mostrarEmpresa && (
            <Link href={rutaDeEmpresa(espacio, o.empresa.slug)} className={detalle ? 'text-sm underline' : 'block truncate text-caption underline'}>
              {o.empresa.name}
            </Link>
          )}
        </div>
        {detalle && o.description && <p className="text-sm text-muted-foreground">{o.description}</p>}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={detalle ? 'text-xl font-semibold tabular-nums' : 'text-base font-semibold tabular-nums'}>{formatearPrecio(o.precioAhora, o.currency)}</span>
          <span className="text-sm text-muted-foreground line-through tabular-nums">{formatearPrecio(o.precioAntes, o.currency)}</span>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {o.endsAt && (
            <li className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Hasta el {hasta(o.endsAt)}
            </li>
          )}
          {detalle && <li>Tu cupón vale {o.voucherDays} días para canjearlo en el negocio.</li>}
          {o.soloClientesNuevos && <li>{detalle ? 'Solo para quienes aún no han visitado este negocio.' : 'Solo clientes nuevos'}</li>}
          {o.quedan !== null && <li className="font-medium text-foreground">{o.quedan === 1 ? 'Queda 1' : `Quedan ${o.quedan}`}</li>}
        </ul>
        <div className="mt-auto">{accion}</div>
      </div>
    </article>
  )
}
