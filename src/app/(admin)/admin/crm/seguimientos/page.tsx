import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ListChecks } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import type { RegionalPrefs } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ChipCanal } from '@/components/crm/bandeja/ListaConversaciones'
import { FormSeguimiento, MarcarHecho } from '@/components/crm/prospectos/Controles'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { prospectosParaElegir } from '@/modules/crm/prospectos'
import { listarSeguimientos, type SeguimientoEnLista } from '@/modules/crm/seguimientos'
import { ACTIVIDAD_CHIP } from '../paleta'

export const metadata = { title: 'Seguimientos' }

/**
 * SEGUIMIENTOS (Meta · Fase 6): lo pendiente primero, vencido en rojo; lo
 * hecho debajo. Todo sobre prospectos reales.
 */
function Fila({ s, prefs }: { s: SeguimientoEnLista; prefs: RegionalPrefs | null }) {
  const vencido = s.vencido
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/crm/prospectos/${s.prospecto.id}`} className="truncate text-sm font-medium hover:underline">
            {s.prospecto.etiqueta}
          </Link>
          <ChipCanal canal={s.prospecto.canal} />
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${ACTIVIDAD_CHIP[s.tipo as keyof typeof ACTIVIDAD_CHIP] ?? 'bg-muted text-muted-foreground'}`}>
            {s.tipo}
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm">{s.nota}</p>
        <p className={`mt-0.5 text-xs ${vencido ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
          {s.hechoAt
            ? `Hecho el ${formatDateTime(s.hechoAt, prefs)}`
            : s.programadoAt
              ? `${vencido ? 'Vencido: ' : 'Para el '}${formatDateTime(s.programadoAt, prefs)}`
              : 'Sin fecha'}
        </p>
      </div>
      {!s.hechoAt && <MarcarHecho seguimientoId={s.id} />}
    </li>
  )
}

export default async function SeguimientosPage() {
  const user = await requireRole(ADMIN_ROLES)
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const [pendientes, hechos, prospectos, prefs] = await Promise.all([
    listarSeguimientos(companyId, 'pendientes'),
    listarSeguimientos(companyId, 'hechos', 50),
    prospectosParaElegir(companyId),
    getRegionalPrefs(companyId),
  ])

  if (pendientes.length === 0 && hechos.length === 0 && prospectos.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={<ListChecks className="h-6 w-6" aria-hidden />}
        title="Todavía no hay seguimientos"
        description="Aquí quedarán las llamadas, visitas y mensajes que programes con cada prospecto. Aparecerán en cuanto tengas prospectos: nacen solos cuando alguien escribe a tu negocio."
        action={
          <Button asChild>
            <Link href="/admin/crm">Ver prospectos</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_minmax(280px,380px)]">
      <div className="space-y-5">
        <section aria-label="Pendientes" className="space-y-2">
          <h2 className="text-sm font-semibold">
            Pendientes <span className="text-muted-foreground">· {pendientes.length}</span>
          </h2>
          {pendientes.length === 0 ? (
            <EmptyState title="Nada pendiente" description="Programa el siguiente paso con un prospecto desde el formulario." />
          ) : (
            <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
              {pendientes.map((s) => (
                <Fila key={s.id} s={s} prefs={prefs} />
              ))}
            </ul>
          )}
        </section>
        {hechos.length > 0 && (
          <section aria-label="Hechos" className="space-y-2">
            <h2 className="text-sm font-semibold">
              Hechos <span className="text-muted-foreground">· últimos {hechos.length}</span>
            </h2>
            <ul className="divide-y divide-border/60 rounded-xl border border-border/60 opacity-80">
              {hechos.map((s) => (
                <Fila key={s.id} s={s} prefs={prefs} />
              ))}
            </ul>
          </section>
        )}
      </div>
      <FormSeguimiento prospectos={prospectos} />
    </div>
  )
}
