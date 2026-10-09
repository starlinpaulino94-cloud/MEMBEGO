import Link from 'next/link'
import { Clock, Tag } from 'lucide-react'
import type { OfertaPublica } from '@/modules/deals/publico-nucleo'
import { formatearPrecio } from '@/modules/catalog/formato'
import { rutaDeEmpresa, type Espacio } from '@/modules/comercio/rutas'
import { ReclamarOfertaBoton } from './ReclamarOfertaBoton'

function hasta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', timeZone: 'America/Santo_Domingo' })
}

/**
 * Tarjeta pública de una oferta. Solo recibe la proyección pública: nada interno llega aquí.
 *
 * `espacio` es obligatorio a propósito: dice dónde se pinta (la landing o la app
 * del cliente) y de él sale el enlace a la empresa. Con un valor por defecto, una
 * pantalla de la app que lo olvidara sacaría al cliente a la landing sin aviso.
 */
export function TarjetaOferta({ oferta: o, retorno, espacio, mostrarEmpresa = true }: { oferta: OfertaPublica; retorno: string; espacio: Espacio; mostrarEmpresa?: boolean }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-card" aria-label={o.title}>
      {o.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- la URL es del bucket público de Storage
        <img src={o.imageUrl} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />
      ) : (
        <div className="flex aspect-[16/9] w-full items-center justify-center bg-muted" aria-hidden>
          <Tag className="h-8 w-8 text-muted-foreground/40" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{o.etiqueta}</p>
          <h3 className="mt-2 text-h3 text-foreground">{o.title}</h3>
          <p className="text-sm text-muted-foreground">
            {o.itemName}
            {o.variantName !== o.itemName ? ` · ${o.variantName}` : ''}
          </p>
          {mostrarEmpresa && (
            <Link href={rutaDeEmpresa(espacio, o.empresa.slug)} className="text-sm underline">
              {o.empresa.name}
            </Link>
          )}
        </div>
        {o.description && <p className="text-sm text-muted-foreground">{o.description}</p>}
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">{formatearPrecio(o.precioAhora, o.currency)}</span>
          <span className="text-sm text-muted-foreground line-through tabular-nums">{formatearPrecio(o.precioAntes, o.currency)}</span>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {o.endsAt && (
            <li className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Hasta el {hasta(o.endsAt)}
            </li>
          )}
          <li>Tu cupón vale {o.voucherDays} días para canjearlo en el negocio.</li>
          {o.soloClientesNuevos && <li>Solo para quienes aún no han visitado este negocio.</li>}
          {o.quedan !== null && <li className="font-medium text-foreground">{o.quedan === 1 ? 'Queda 1' : `Quedan ${o.quedan}`}</li>}
        </ul>
        <div className="mt-auto">
          <ReclamarOfertaBoton dealId={o.id} retorno={retorno} sucursales={o.sucursales} />
        </div>
      </div>
    </article>
  )
}
