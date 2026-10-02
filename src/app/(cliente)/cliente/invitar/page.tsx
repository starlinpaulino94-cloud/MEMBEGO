import { UserPlus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { misInvitaciones } from '@/modules/supply-v2/loyalty/queries'
import { MiCodigoDeInvitacion, UsarInvitacion } from '@/components/supply-v2/fidelizacion-cliente'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Invitar amigos' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · «Invitar amigos» (§19, §39).
 *
 * Se dice CLARO lo que hace falta para cobrar: que la persona invitada haga
 * su primera compra válida. Prometer por compartir un enlace y no pagar
 * después es la forma más rápida de que nadie vuelva a compartir nada.
 */
export default async function InvitarPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const user = await requireRole('CLIENTE')
  const { codigo } = await searchParams
  const id = user.metadata.dbUserId
  const programas = id ? await misInvitaciones(id) : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invitar amigos"
        description="Comparte tu enlace. Ganas cuando la persona que invitas hace su primera compra válida, no antes."
        eyebrow="Fidelización"
      />

      <Card>
        <CardContent className="pt-6">
          <UsarInvitacion codigoInicial={codigo} />
        </CardContent>
      </Card>

      {programas.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<UserPlus className="h-6 w-6" aria-hidden />}
          title="Todavía no hay programas de invitación"
          description="Cuando un negocio active su programa de referidos, podrás compartir tu enlace desde aquí."
        />
      ) : (
        programas.map((p) => (
          <Card key={p.programaId} data-testid="tarjeta-invitacion">
            <CardContent className="space-y-4 pt-6">
              <div>
                <p className="text-h4" data-testid="invitacion-programa">{p.negocio ?? p.programa}</p>
                <p className="text-sm text-muted-foreground">
                  Ganas <strong>{p.premio}</strong>. {p.condicion}
                  {p.espera > 0 ? ` Se paga ${p.espera} día(s) después, por si la compra se cae.` : ''}
                </p>
              </div>

              <MiCodigoDeInvitacion programId={p.programaId} codigo={p.codigo} />

              {p.estadisticas && (
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="invitacion-estadisticas">
                  {([
                    ['Aperturas', p.estadisticas.aperturas],
                    ['Registros', p.estadisticas.registros],
                    ['Pendientes', p.estadisticas.pendientes],
                    ['Premiadas', p.estadisticas.validos],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-muted/50 p-2">
                      <dt className="text-caption text-muted-foreground">{k}</dt>
                      <dd className="tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
