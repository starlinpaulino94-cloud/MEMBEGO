import Link from 'next/link'
import { Award } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { misMembresias } from '@/modules/supply-v2/loyalty/queries'
import { ESTADO_MEMBRESIA, RUTA_MEMBRESIAS_PUBLICAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis membresías' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · «Mis membresías» (§17).
 *
 * Qué tiene contratado, hasta cuándo, qué incluye y cuántos usos le quedan.
 * Nada de presupuesto ni de costos: eso no es asunto de quien compra.
 */
export default async function MisMembresiasPage() {
  const user = await requireRole('CLIENTE')
  const id = user.metadata.dbUserId
  const membresias = id ? await misMembresias(id) : []
  const vivas = membresias.filter((m) => m.vigente)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis membresías"
        description="Lo que tienes contratado con cada negocio, con sus beneficios y su vigencia."
        eyebrow="Fidelización"
      />

      {membresias.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Award className="h-6 w-6" aria-hidden />}
          title="Todavía no tienes membresías"
          description="Hazte miembro de un negocio y accede a sus beneficios exclusivos."
          action={
            <Button asChild>
              <Link href={RUTA_MEMBRESIAS_PUBLICAS}>Ver membresías disponibles</Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="membresias-resumen">
            {vivas.length === 0 ? 'Ahora mismo no tienes ninguna membresía activa.' : `Tienes ${vivas.length} membresía(s) activa(s).`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {membresias.map((m) => (
              <Card key={m.id} data-testid="tarjeta-membresia" className={m.vigente ? 'border-primary/40' : undefined}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-h4" data-testid="membresia-plan">{m.plan}</p>
                      <p className="text-sm text-muted-foreground" data-testid="membresia-negocio">{m.negocio}</p>
                      <p className="font-mono text-caption text-muted-foreground">{m.code}</p>
                    </div>
                    <span className="rounded-full bg-muted px-3 py-1 text-caption" data-testid="membresia-estado">
                      {ESTADO_MEMBRESIA[m.estado] ?? m.estado}
                    </span>
                  </div>

                  <dl className="space-y-1 text-sm">
                    {m.hasta && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Vence</dt>
                        <dd className="tabular-nums" data-testid="membresia-vence">
                          {formatDate(new Date(m.hasta))}
                          {m.diasRestantes != null && m.vigente ? ` · ${m.diasRestantes} día(s)` : ''}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Pagaste</dt>
                      <dd className="tabular-nums">{m.precioPagado}</dd>
                    </div>
                    {m.renovaciones > 0 && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Renovaciones</dt>
                        <dd className="tabular-nums">{m.renovaciones}</dd>
                      </div>
                    )}
                  </dl>

                  {m.beneficios.length > 0 && (
                    <div className="rounded-xl bg-muted/50 p-3">
                      <p className="mb-1 text-caption uppercase text-muted-foreground">Incluye</p>
                      <ul className="space-y-1 text-sm" data-testid="membresia-beneficios">
                        {m.beneficios.map((b, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{b.nombre}</span>
                            <span className="tabular-nums text-muted-foreground">{b.usosDisponibles} uso(s)</span>
                          </li>
                        ))}
                      </ul>
                      <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                        <Link href="/cliente/bonos" data-testid="btn-usar-beneficios">Usar mis beneficios</Link>
                      </Button>
                    </div>
                  )}

                  {!m.vigente && (
                    <Button asChild size="sm" className="w-full" data-testid="btn-renovar">
                      <Link href={RUTA_MEMBRESIAS_PUBLICAS}>Renovar</Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
