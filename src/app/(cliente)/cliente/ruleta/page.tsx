import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, History, ArrowLeft, Trophy } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { COSTO_RULETA } from '@/lib/gamificacion'
import { getGamificacion } from '@/modules/engagement/gamificacion'
import { getRuletaPremiosActivos, getUltimasJugadas } from '@/modules/engagement/ruleta'
import { formatDate } from '@/lib/format'
import { RuletaWheel } from '@/components/engagement/RuletaWheel'
import { Button } from '@/components/ui/button'
import { Gamificacion } from '@/components/engagement/Gamificacion'
import { getEngagementConfig } from '@/modules/engagement/config'
import { normalizeEngagementConfig } from '@/lib/engagementConfig'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ruleta de premios' }

function fmt(d: Date) {
  return formatDate(d, undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function RuletaPage() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') redirect('/login')
  const { clienteId, companyId } = user.metadata
  if (!clienteId || !companyId) redirect('/mis-membresias')

  const [game, premios, jugadas, engagement] = await Promise.all([
    getGamificacion(clienteId, companyId),
    getRuletaPremiosActivos(companyId),
    getUltimasJugadas(clienteId, companyId, 8),
    getEngagementConfig(companyId)
      .then((cfg) => normalizeEngagementConfig(cfg, null))
      .catch(() => normalizeEngagementConfig(null, null)),
  ])

  const saldo = game?.saldo ?? 0

  return (
    <main className="container max-w-2xl py-8">
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="mb-3 gap-1.5">
          <Link href="/mis-membresias">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-h1 tracking-tight text-foreground">Ruleta de premios</h1>
        </div>
        <p className="mt-1 text-small text-muted-foreground">
          Gana puntos usando tus beneficios e invitando amigos, y cámbialos por premios reales.
        </p>
      </div>

      {game && (
        <Gamificacion data={game} color={engagement.color} />
      )}

      {premios.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-card p-10 text-center shadow-card">
          <Trophy className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
          <h2 className="text-lg font-bold text-foreground">Aún no hay premios</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Este negocio todavía no configuró su ruleta. ¡Vuelve pronto!
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-card sm:p-8">
          <RuletaWheel premios={premios} costo={COSTO_RULETA} saldoInicial={saldo} />
        </div>
      )}

      {jugadas.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <History className="h-4 w-4 text-muted-foreground" />
            Tus últimos giros
          </h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
            {jugadas.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{j.premioNombre}</p>
                  <p className="text-xs text-muted-foreground">{fmt(j.createdAt)}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    j.gano
                      ? 'bg-success/12 text-success'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {j.gano ? 'Ganaste' : 'Sigue participando'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
