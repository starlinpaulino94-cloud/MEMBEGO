import { Gift } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { misPuntos, recompensasParaElCliente } from '@/modules/supply-v2/loyalty/queries'
import { BotonReclamar } from '@/components/supply-v2/fidelizacion-cliente'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis recompensas' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · «Mis recompensas» (§30–§31, §39).
 *
 * Lo que esta persona puede pedir con sus puntos, y cuando no puede, POR QUÉ,
 * en una frase. El costo en puntos se enseña; el costo en dinero para el
 * negocio, nunca: no es asunto de quien canjea.
 */
export default async function MisRecompensasPage() {
  const user = await requireRole('CLIENTE')
  const id = user.metadata.dbUserId
  const cuentas = id ? await misPuntos(id) : []

  const bloques = await Promise.all(
    cuentas.map(async (c) => ({
      programa: c.negocio ?? c.programa,
      programaId: c.programaId,
      disponibles: c.disponibles,
      recompensas: id ? await recompensasParaElCliente(id, c.programaId) : [],
    }))
  )
  const conAlgo = bloques.filter((b) => b.recompensas.length > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis recompensas"
        description="Lo que puedes pedir con los puntos de cada programa."
        eyebrow="Fidelización"
      />

      {conAlgo.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Gift className="h-6 w-6" aria-hidden />}
          title="Todavía no hay recompensas para ti"
          description="Cuando un negocio publique recompensas en un programa donde tengas puntos, aparecerán aquí."
        />
      ) : (
        conAlgo.map((b) => (
          <section key={b.programaId} className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-h4" data-testid="recompensas-programa">{b.programa}</h2>
              <p className="text-sm tabular-nums text-muted-foreground">{b.disponibles} puntos</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {b.recompensas.map((r) => (
                <Card key={r.id} data-testid="tarjeta-recompensa" className={r.alcanza ? 'border-primary/40' : undefined}>
                  <CardContent className="space-y-3 pt-6">
                    <div>
                      <p className="text-h4" data-testid="recompensa-nombre">{r.nombre}</p>
                      <p className="font-mono text-caption text-muted-foreground">{r.code}</p>
                    </div>
                    {r.descripcion && <p className="text-sm text-muted-foreground">{r.descripcion}</p>}
                    <p className="text-h2 tabular-nums" data-testid="recompensa-puntos">{r.puntosNecesarios} puntos</p>
                    <BotonReclamar rewardId={r.id} puede={r.alcanza} porQueNo={r.porQueNo} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
