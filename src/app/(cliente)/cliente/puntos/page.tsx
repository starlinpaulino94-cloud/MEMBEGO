import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { misPuntos } from '@/modules/supply-v2/loyalty/queries'
import { RUTA_RECOMPENSAS_CLIENTE } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis puntos' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · «Mis puntos» (§25, §39).
 *
 * UNA CUENTA POR PROGRAMA, y se dice de quién es cada una: los puntos de un
 * negocio no sirven en otro, y esconderlo detrás de un número único sería
 * mentir. Se avisa de lo que vence pronto, porque dejar caducar puntos sin
 * avisar es quedarse con algo que ya se dio.
 */
export default async function MisPuntosPage() {
  const user = await requireRole('CLIENTE')
  const id = user.metadata.dbUserId
  const cuentas = id ? await misPuntos(id) : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis puntos"
        description="Los puntos que has ganado en cada programa. Son puntos, no dinero: se canjean por recompensas."
        eyebrow="Fidelización"
      />

      {cuentas.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Sparkles className="h-6 w-6" aria-hidden />}
          title="Todavía no tienes puntos"
          description="Ganarás puntos con tus compras en los negocios que tengan programa de fidelización."
        />
      ) : (
        cuentas.map((c) => (
          <Card key={c.programaId} data-testid="tarjeta-puntos">
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-h4" data-testid="puntos-programa">{c.negocio ?? c.programa}</p>
                  <p className="text-sm text-muted-foreground">{c.programa}</p>
                </div>
                <p className="text-h1 tabular-nums" data-testid="puntos-disponibles">{c.disponibles}</p>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {([
                  ['Pendientes', c.pendientes, 'puntos-pendientes'],
                  ['Apartados', c.reservados, 'puntos-reservados'],
                  ['Usados', c.usados, 'puntos-usados'],
                  ['Vencidos', c.vencidos, 'puntos-vencidos'],
                ] as const).map(([k, v, tid]) => (
                  <div key={k} className="rounded-xl bg-muted/50 p-2">
                    <dt className="text-caption text-muted-foreground">{k}</dt>
                    <dd className="tabular-nums" data-testid={tid}>{v}</dd>
                  </div>
                ))}
              </dl>

              {c.pendientes > 0 && (
                <p className="text-sm text-muted-foreground">
                  Los puntos pendientes se vuelven disponibles cuando la compra que los generó queda firme.
                </p>
              )}

              {c.proximoVencimiento && (
                <p className="text-sm" data-testid="puntos-proximo-vencimiento">
                  <strong className="tabular-nums">{c.proximoVencimiento.puntos}</strong> puntos vencen el{' '}
                  {formatDate(new Date(c.proximoVencimiento.fecha))}.
                </p>
              )}

              <Button asChild size="sm" data-testid="btn-ver-recompensas">
                <Link href={RUTA_RECOMPENSAS_CLIENTE}>Ver qué puedo pedir</Link>
              </Button>

              {c.historial.length > 0 && (
                <details className="rounded-2xl border p-3">
                  <summary className="cursor-pointer text-sm">Historial</summary>
                  <ul className="mt-2 space-y-1 text-sm" data-testid="puntos-historial">
                    {c.historial.map((h, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{formatDate(new Date(h.fecha))} · {h.concepto}</span>
                        <span className="tabular-nums">{h.puntos}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
