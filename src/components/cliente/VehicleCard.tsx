import Link from 'next/link'
import { Car, Star, WalletCards } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DeleteVehiculoButton } from '@/components/cliente/DeleteVehiculoButton'
import type { VehiculoCliente } from '@/modules/cliente/queries'

/**
 * Tarjeta de un vehículo del cliente (§41).
 *
 * Responde en este orden: qué coche es, si es el principal, y a qué
 * membresías está asociado — que es lo que hace que borrarlo NO sea trivial.
 * Por eso las membresías se enseñan junto al botón de eliminar y no escondidas
 * en un detalle: quien va a borrar tiene que ver qué se lleva por delante.
 */
export function VehicleCard({ vehiculo }: { vehiculo: VehiculoCliente }) {
  const etiqueta = `${vehiculo.marca} ${vehiculo.modelo} (${vehiculo.anio})${
    vehiculo.placa ? ` · ${vehiculo.placa}` : ''
  }`

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <Car className="h-6 w-6" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-h3 text-foreground">
              {vehiculo.marca} {vehiculo.modelo}
            </h3>
            {vehiculo.esPrincipal && (
              <Badge variant="secondary" className="gap-1">
                <Star className="h-3 w-3 fill-current" aria-hidden />
                Principal
              </Badge>
            )}
          </div>

          <p className="mt-0.5 text-caption">
            {[vehiculo.categoria, String(vehiculo.anio), vehiculo.color]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {vehiculo.placa && (
            // La placa en monoespaciada: es un identificador que se compara
            // carácter a carácter con el del parabrisas.
            <p className="mt-2 inline-flex rounded-lg border border-dashed border-border bg-muted/50 px-2.5 py-1 font-mono text-small font-bold tracking-wider text-foreground">
              {vehiculo.placa}
            </p>
          )}
        </div>

        <DeleteVehiculoButton vehiculoId={vehiculo.id} label={etiqueta} />
      </div>

      {vehiculo.membresias.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-overline">Membresías asociadas</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {vehiculo.membresias.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/membresia/${m.id}`}
                  className="inline-flex min-h-9 items-center gap-2 text-small text-foreground underline-offset-2 hover:underline"
                >
                  <WalletCards className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">
                    {m.planNombre}
                    {m.empresaNombre && ` · ${m.empresaNombre}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}
