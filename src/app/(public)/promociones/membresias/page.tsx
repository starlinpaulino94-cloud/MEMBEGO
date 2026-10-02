import { Award } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { getUser } from '@/lib/auth'
import { membresiasEnElMarketplace } from '@/modules/supply-v2/loyalty/queries'
import { BotonContratar } from '@/components/supply-v2/fidelizacion-cliente'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Membresías · Membego',
  description: 'Hazte miembro de tus negocios favoritos y accede a beneficios exclusivos.',
}

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · las membresías en el MARKETPLACE (§15).
 *
 * Vive dentro de `/promociones`, el marketplace de siempre: no se desarrolló
 * otro. La ficha dice empresa, precio, duración, qué incluye y cómo se
 * activa, que es lo que hay que saber antes de pagar. No dice presupuesto ni
 * costos: eso no es del cliente.
 */
export default async function MembresiasPublicasPage() {
  const planes = await membresiasEnElMarketplace()
  const user = await getUser().catch(() => null)
  const esCliente = user?.metadata.role === 'CLIENTE'

  return (
    <div className="container mx-auto space-y-6 px-4 py-8">
      <PageHeader
        title="Membresías"
        description="Hazte miembro de un negocio y accede a sus beneficios exclusivos cada mes."
        eyebrow="Membego"
      />

      {planes.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Award className="h-6 w-6" aria-hidden />}
          title="Todavía no hay membresías publicadas"
          description="Vuelve pronto: los negocios están preparando sus planes."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="membresias-marketplace">
          {planes.map((p) => (
            <Card key={p.id} data-testid="tarjeta-plan-publico">
              <CardContent className="flex h-full flex-col gap-3 pt-6">
                <div>
                  <p className="text-caption uppercase text-muted-foreground" data-testid="plan-negocio">{p.negocio}</p>
                  <p className="text-h3" data-testid="plan-nombre">{p.nombre}</p>
                  <p className="font-mono text-caption text-muted-foreground">{p.code}</p>
                </div>

                <p className="text-h1 tabular-nums" data-testid="plan-precio">{p.gratuita ? 'Gratis' : p.precio}</p>
                <p className="text-sm text-muted-foreground" data-testid="plan-duracion">
                  Dura {p.duracionDias} días desde que se activa.
                </p>
                {p.descripcion && <p className="text-sm">{p.descripcion}</p>}

                {p.incluye.length > 0 && (
                  <div className="rounded-xl bg-muted/50 p-3">
                    <p className="mb-1 text-caption uppercase text-muted-foreground">Incluye</p>
                    <ul className="space-y-1 text-sm" data-testid="plan-incluye">
                      {p.incluye.map((b, i) => <li key={i}>· {b}</li>)}
                    </ul>
                  </div>
                )}

                <p className="text-caption text-muted-foreground">
                  {p.gratuita
                    ? 'Se activa en el momento, sin pagar nada.'
                    : 'Se activa cuando Membego confirma tu pago.'}
                </p>

                <div className="mt-auto">
                  {esCliente ? (
                    <BotonContratar planId={p.id} gratuita={p.gratuita} precio={p.precio} />
                  ) : (
                    <a className="block w-full rounded-lg border px-4 py-2 text-center text-sm" href="/login" data-testid="plan-entrar">
                      Entra para hacerte miembro
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
