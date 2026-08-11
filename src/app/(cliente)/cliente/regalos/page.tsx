import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { getRegalosCliente } from '@/modules/regalos/queries'
import { getGiftCardsCliente, ESTADO_GIFTCARD_LABEL } from '@/modules/regalos/giftcards'
import { RegaloRecibidoCard, RegaloEnviadoCard } from '@/components/regalos/RegaloCards'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { CreditCard, Gift, Send } from 'lucide-react'

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

const GIFTCARD_CHIP: Record<string, string> = {
  PENDIENTE_PAGO: 'bg-warning/15 text-warning',
  ACTIVA: 'bg-success/15 text-success',
  AGOTADA: 'bg-muted text-muted-foreground',
  CANCELADA: 'bg-destructive/10 text-destructive',
}

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Regalos' }

/**
 * Regalos P2P · Fase R2 — centro de regalos del cliente: recibidos (aceptar/
 * rechazar antes de que expiren) y enviados (con cancelar si sigue pendiente).
 */
export default async function RegalosPage() {
  const user = await requireRole('CLIENTE')
  const clienteId = user.metadata.clienteId
  if (!clienteId) {
    return (
      <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
    )
  }

  const [{ recibidos, enviados }, { recibidas: gcRecibidas, compradas: gcCompradas }] =
    await Promise.all([
      getRegalosCliente(clienteId).catch(() => ({
        recibidos: [],
        enviados: [],
        pendientesRecibidos: 0,
      })),
      getGiftCardsCliente(clienteId).catch(() => ({ recibidas: [], compradas: [] })),
    ])
  const giftCards = [...gcRecibidas, ...gcCompradas]

  return (
    <div className="space-y-6 animate-fade-up">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h1 text-foreground">Regalos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* "Lavados" era el vocabulario de un solo oficio en una pantalla
                que ve el cliente de cualquier negocio. */}
            Envía tus usos a tus amigos o acepta los que te enviaron.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link href="/cliente/regalos/giftcard">
              <CreditCard className="h-4 w-4" /> Gift card
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/cliente/regalos/regalar">
              <Gift className="h-4 w-4" /> Regalar promo o membresía
            </Link>
          </Button>
          <Button asChild className="gap-2">
            <Link href="/cliente/regalos/enviar">
              <Send className="h-4 w-4" /> Transferir mis usos
            </Link>
          </Button>
        </div>
      </header>

      {giftCards.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Gift cards
          </h2>
          {giftCards.map((g) => (
            <div
              key={g.id}
              className="flex flex-wrap items-center gap-3 rounded-3xl border border-border/70 bg-card p-4 shadow-card"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CreditCard className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {g.rol === 'RECIBIDA' ? `De ${g.contraparte}` : `Para ${g.contraparte}`}
                  {' · '}
                  <span className="tabular-nums">{fmtRD(g.monto)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {g.estado === 'ACTIVA'
                    ? `Saldo ${fmtRD(g.saldo)} · muestra el código al pagar`
                    : g.estado === 'PENDIENTE_PAGO' && g.rol === 'COMPRADA'
                      ? 'Paga citando el código para activarla'
                      : (ESTADO_GIFTCARD_LABEL[g.estado] ?? g.estado)}
                  {g.mensaje ? ` · “${g.mensaje}”` : ''}
                </p>
              </div>
              {(g.estado === 'ACTIVA' || (g.estado === 'PENDIENTE_PAGO' && g.rol === 'COMPRADA')) && (
                <code className="rounded-xl bg-muted px-3 py-1.5 font-mono text-sm font-bold tracking-widest text-foreground">
                  {g.codigo}
                </code>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${GIFTCARD_CHIP[g.estado] ?? 'bg-muted text-muted-foreground'}`}
              >
                {ESTADO_GIFTCARD_LABEL[g.estado] ?? g.estado}
              </span>
            </div>
          ))}
        </section>
      )}

      {recibidos.length === 0 && enviados.length === 0 && giftCards.length === 0 ? (
        <EmptyState
          icon={<Gift className="h-7 w-7" />}
          title="Aún no tienes regalos"
          description="Comparte tu @ID MembeGo (está en tu perfil) para recibir, o envía tus usos a un amigo."
        />
      ) : (
        <>
          {recibidos.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recibidos
              </h2>
              {recibidos.map((r) => (
                <RegaloRecibidoCard key={r.id} regalo={r} />
              ))}
            </section>
          )}
          {enviados.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Enviados
              </h2>
              {enviados.map((r) => (
                <RegaloEnviadoCard key={r.id} regalo={r} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
