import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, MessageSquare, UserCheck } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import { Avatar } from '@/components/ui/avatar'
import { StatusChip } from '@/components/ui/status-chip'
import { ChipCanal } from '@/components/crm/bandeja/ListaConversaciones'
import { hrefBandeja } from '@/components/crm/bandeja/href'
import { ConvertirEnCliente, EtapaSelector, FormSeguimiento, MarcarHecho, NotasProspecto } from '@/components/crm/prospectos/Controles'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { ETIQUETA_ETAPA } from '@/modules/crm/nucleo'
import { prospectoDe } from '@/modules/crm/prospectos'
import { ACTIVIDAD_CHIP } from '@/app/(admin)/admin/crm/paleta'

export const metadata = { title: 'Prospecto' }

const ID_VALIDO = /^[a-z0-9]{10,40}$/i

/** FICHA DEL PROSPECTO (Meta · Fase 6): de dónde llegó, en qué va, qué se ha hecho. */
export default async function ProspectoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const { id } = await params
  if (!ID_VALIDO.test(id)) notFound()

  const [p, prefs] = await Promise.all([prospectoDe(user.metadata.companyId, id), getRegionalPrefs(user.metadata.companyId)])
  if (!p) notFound()

  const pendientes = p.seguimientos.filter((s) => !s.hechoAt)
  const hechos = p.seguimientos.filter((s) => s.hechoAt)

  return (
    <div className="space-y-5">
      <Link href="/admin/crm" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Todos los prospectos
      </Link>

      <header className="flex flex-wrap items-center gap-3">
        <Avatar nombre={p.etiqueta} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span className="truncate">{p.etiqueta}</span>
            <ChipCanal canal={p.canal} />
            {p.clienteId && (
              <StatusChip tone="success">
                <UserCheck className="h-3 w-3" aria-hidden /> Ya es cliente
              </StatusChip>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            {p.telefono ? `+${p.telefono.replace(/^\+/, '')} · ` : ''}
            Escribió por primera vez el {formatDateTime(p.primerMensajeAt, prefs)} · última actividad {formatDateTime(p.ultimaActividadAt, prefs)}
          </p>
        </div>
        <EtapaSelector prospectoId={p.id} etapa={p.etapa} />
      </header>

      <div className="flex flex-wrap gap-2">
        {p.conversacionId && (
          <Link
            href={hrefBandeja({ c: p.conversacionId })}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-xs font-medium hover:bg-muted/40"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Abrir la conversación
          </Link>
        )}
        {p.clienteId && (
          <Link
            href={`/admin/clientes/${p.clienteId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-xs font-medium hover:bg-muted/40"
          >
            Ver ficha del cliente
          </Link>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {!p.clienteId && <ConvertirEnCliente prospectoId={p.id} nombre={p.etiqueta.startsWith('+') ? '' : p.etiqueta} telefono={p.telefono} />}
          <NotasProspecto prospectoId={p.id} notas={p.notas} />
        </div>
        <div className="space-y-4">
          <FormSeguimiento prospectoId={p.id} />
          <section aria-label="Seguimientos" className="space-y-2">
            <h3 className="text-sm font-semibold">
              Seguimientos <span className="text-muted-foreground">· {ETIQUETA_ETAPA[p.etapa]}</span>
            </h3>
            {p.seguimientos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay seguimientos con este prospecto.</p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
                {[...pendientes, ...hechos].map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${ACTIVIDAD_CHIP[s.tipo as keyof typeof ACTIVIDAD_CHIP] ?? 'bg-muted text-muted-foreground'}`}>
                        {s.tipo}
                      </span>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{s.nota}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {s.hechoAt
                          ? `Hecho el ${formatDateTime(s.hechoAt, prefs)}`
                          : s.programadoAt
                            ? `Para el ${formatDateTime(s.programadoAt, prefs)}`
                            : 'Sin fecha'}
                      </p>
                    </div>
                    {!s.hechoAt && <MarcarHecho seguimientoId={s.id} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
