import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { metricasCrm } from '@/modules/crm/metricas'
import { ETAPAS, ETIQUETA_ETAPA, type Etapa } from '@/modules/crm/nucleo'
import { ETIQUETA_CANAL, type Canal } from '@/modules/mensajeria/nucleo'
import { CANAL_TINTE, ETAPA_PUNTO } from '../paleta'

export const metadata = { title: 'Métricas del CRM' }

/**
 * MÉTRICAS (Meta · Fase 6): de dónde llegan los prospectos, en qué etapa
 * están, cuántos se convierten y cuánto tarda el negocio en responder. Todo
 * calculado ahora, sobre datos reales; sin datos, se dice.
 */
const PUNTO: Record<Etapa, string> = { ...ETAPA_PUNTO, perdido: 'bg-destructive' }
const CANALES: Canal[] = ['WHATSAPP', 'MESSENGER', 'INSTAGRAM']
const TINTE: Record<Canal, string> = {
  WHATSAPP: CANAL_TINTE.whatsapp.texto,
  MESSENGER: CANAL_TINTE.messenger.texto,
  INSTAGRAM: CANAL_TINTE.instagram.texto,
}

function Cifra({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
    </div>
  )
}

export default async function MetricasPage() {
  const user = await requireRole(ADMIN_ROLES)
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const m = await metricasCrm(user.metadata.companyId)

  if (m.prospectos.total === 0 && m.conversaciones.total === 0) {
    return (
      <EmptyState
        variant="card"
        icon={<BarChart3 className="h-6 w-6" aria-hidden />}
        title="Sin métricas todavía"
        description="Se calculan sobre conversaciones y prospectos reales. En cuanto alguien escriba a tu negocio, aquí verás de dónde llegan tus prospectos, cuántos se convierten y cuánto tardas en responder."
        action={
          <Button asChild>
            <Link href="/admin/integraciones">Conectar un canal</Link>
          </Button>
        }
      />
    )
  }

  const total = Math.max(m.prospectos.total, 1)

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cifra etiqueta="Prospectos" valor={String(m.prospectos.total)} nota={`${m.prospectos.nuevos7d} en 7 días · ${m.prospectos.nuevos30d} en 30`} />
        <Cifra
          etiqueta="Conversión"
          valor={m.prospectos.conversion === null ? '—' : `${m.prospectos.conversion} %`}
          nota={`${m.prospectos.porEtapa.cerrado} cerrados · ${m.prospectos.porEtapa.perdido} perdidos`}
        />
        <Cifra
          etiqueta="Primera respuesta"
          valor={m.conversaciones.minutosPrimeraRespuesta === null ? '—' : `${m.conversaciones.minutosPrimeraRespuesta} min`}
          nota={m.conversaciones.medidas === 0 ? 'Sin conversaciones medidas' : `Mediana · ${m.conversaciones.respondidas} de ${m.conversaciones.medidas} respondidas`}
        />
        <Cifra
          etiqueta="Seguimientos pendientes"
          valor={String(m.seguimientos.pendientes)}
          nota={m.seguimientos.vencidos > 0 ? `${m.seguimientos.vencidos} vencidos` : 'Ninguno vencido'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Por canal" className="rounded-xl border border-border/60 bg-card p-4">
          <h2 className="text-sm font-semibold">De dónde llegan</h2>
          <ul className="mt-3 space-y-2">
            {CANALES.map((c) => (
              <li key={c} className="flex items-center justify-between text-sm">
                <span className={`font-medium ${TINTE[c]}`}>{ETIQUETA_CANAL[c]}</span>
                <span className="tabular-nums text-muted-foreground">
                  {m.prospectos.porCanal[c]} prospectos · {m.conversaciones.porCanal[c]} conversaciones
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Por etapa" className="rounded-xl border border-border/60 bg-card p-4">
          <h2 className="text-sm font-semibold">En qué etapa están</h2>
          <ul className="mt-3 space-y-2">
            {ETAPAS.map((e) => {
              const n = m.prospectos.porEtapa[e]
              return (
                <li key={e} className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${PUNTO[e]}`} aria-hidden />
                      {ETIQUETA_ETAPA[e]}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{n}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className={`h-full rounded-full ${PUNTO[e]}`} style={{ width: `${Math.round((n / total) * 100)}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
