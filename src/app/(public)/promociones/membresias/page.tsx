import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { membresiasEnElMarketplace } from '@/modules/supply-v2/loyalty/queries'
import { BotonContratarMembresia } from '@/components/supply-v2/boton-contratar-membresia'
import { RUTA_FIDELIZACION_CLIENTE } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Membresías · Membego',
  description: 'Planes de membresía de los negocios de la red, con lo que incluye cada uno.',
}

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · escaparate público de membresías (§15).
 *
 * Vive dentro del marketplace que ya existe: no es otro marketplace. El
 * cliente ve el precio, la duración y lo que incluye. Nunca el presupuesto, el
 * costo ni la comisión: esas claves no salen de la consulta.
 */
export default async function MembresiasPublicasPage() {
  const planes = await membresiasEnElMarketplace()

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <p className="text-caption uppercase tracking-wide text-muted-foreground">Membego</p>
        <h1 className="text-h1">Membresías</h1>
        <p className="text-body text-muted-foreground">
          Planes de los negocios de la red. Contratas una vez y sus beneficios quedan en tu cuenta mientras esté vigente.
        </p>
      </header>

      {planes.length === 0 ? (
        <EmptyState
          title="Todavía no hay membresías publicadas"
          description="Cuando un negocio publique su plan, aparecerá aquí con lo que incluye y su precio."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="membresias-publicas">
          {planes.map((p) => (
            <li key={p.id}>
              <Card className="h-full" data-testid="plan-publico">
                <CardContent className="flex h-full flex-col gap-3 pt-6">
                  <div>
                    <p className="text-caption text-muted-foreground" data-testid="plan-publico-negocio">{p.negocio}</p>
                    <h2 className="text-h3" data-testid="plan-publico-nombre">{p.nombre}</h2>
                  </div>
                  <p className="text-h2 tabular-nums" data-testid="plan-publico-precio">
                    {p.gratuita ? 'Gratis' : p.precio}
                  </p>
                  <p className="text-caption text-muted-foreground" data-testid="plan-publico-duracion">{p.duracionDias} días</p>
                  {p.descripcion && <p className="text-sm text-muted-foreground">{p.descripcion}</p>}
                  {p.incluye.length > 0 && (
                    <ul className="space-y-1 text-sm" data-testid="plan-publico-incluye">
                      {p.incluye.map((i, n) => (
                        <li key={n} className="flex gap-2">
                          <span aria-hidden="true" className="text-success">✓</span>
                          <span>{i}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto pt-2">
                    <BotonContratarMembresia planId={p.id} gratuita={p.gratuita} precio={p.precio} />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-caption text-muted-foreground">
        ¿Ya tienes una? Está en{' '}
        <Link href={RUTA_FIDELIZACION_CLIENTE} className="text-primary underline-offset-4 hover:underline">tu cuenta</Link>.
      </p>
    </div>
  )
}
