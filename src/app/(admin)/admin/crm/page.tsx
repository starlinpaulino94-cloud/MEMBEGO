import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Contact } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ChipCanal } from '@/components/crm/bandeja/ListaConversaciones'
import { EtapaSelector } from '@/components/crm/prospectos/Controles'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { ETAPAS, ETIQUETA_ETAPA, type Etapa } from '@/modules/crm/nucleo'
import { listarProspectos } from '@/modules/crm/prospectos'
import { esCanal } from '@/modules/mensajeria/bandeja'
import { ETAPA_PUNTO } from './paleta'

export const metadata = { title: 'Prospectos' }

/**
 * PROSPECTOS (Meta · Fase 6). El tablero lee prospectos REALES: nacen solos
 * del primer mensaje entrante de quien todavía no es cliente, con su canal de
 * origen y su conversación. Página de servidor; el filtro va en la URL.
 */
const PUNTO: Record<Etapa, string> = { ...ETAPA_PUNTO, perdido: 'bg-destructive' }

export default async function ProspectosPage({ searchParams }: { searchParams: Promise<{ canal?: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId
  const sp = await searchParams
  const canal = esCanal(sp.canal) ? sp.canal : null

  const [prospectos, prefs] = await Promise.all([listarProspectos(companyId, { canal }), getRegionalPrefs(companyId)])

  if (prospectos.length === 0 && !canal) {
    return (
      <EmptyState
        variant="card"
        icon={<Contact className="h-6 w-6" aria-hidden />}
        title="Todavía no hay prospectos"
        description="Cada persona que escriba por WhatsApp, Messenger o Instagram sin ser cliente aparecerá aquí como prospecto, con su canal de origen y su conversación. Mientras tanto, tus clientes viven en el directorio."
        action={
          <Button asChild>
            <Link href="/admin/clientes">Ir al directorio de clientes</Link>
          </Button>
        }
        secondaryAction={
          <Button variant="ghost" asChild>
            <Link href="/admin/integraciones">Conectar un canal</Link>
          </Button>
        }
      />
    )
  }

  const filtros: { valor: string | null; etiqueta: string }[] = [
    { valor: null, etiqueta: 'Todos' },
    { valor: 'WHATSAPP', etiqueta: 'WhatsApp' },
    { valor: 'MESSENGER', etiqueta: 'Messenger' },
    { valor: 'INSTAGRAM', etiqueta: 'Instagram' },
  ]

  return (
    <div className="space-y-4">
      <nav aria-label="Canal de origen" className="flex flex-wrap gap-1.5">
        {filtros.map((f) => {
          const activo = (canal ?? null) === f.valor
          return (
            <Link
              key={f.etiqueta}
              href={f.valor ? `/admin/crm?canal=${f.valor}` : '/admin/crm'}
              aria-current={activo ? 'page' : undefined}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast ${
                activo ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
            >
              {f.etiqueta}
            </Link>
          )
        })}
      </nav>

      {prospectos.length === 0 ? (
        <EmptyState title="Nada por este canal" description="No hay prospectos que hayan llegado por aquí." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ETAPAS.map((etapa) => {
            const columna = prospectos.filter((p) => p.etapa === etapa)
            return (
              <section key={etapa} aria-label={ETIQUETA_ETAPA[etapa]} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`size-2 rounded-full ${PUNTO[etapa]}`} aria-hidden />
                  {ETIQUETA_ETAPA[etapa]}
                  <span className="text-muted-foreground">· {columna.length}</span>
                </h2>
                {columna.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">Vacío</p>
                ) : (
                  <ul className="space-y-2">
                    {columna.map((p) => (
                      <li key={p.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                        <Link href={`/admin/crm/prospectos/${p.id}`} className="block min-w-0">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium hover:underline">{p.etiqueta}</span>
                            <ChipCanal canal={p.canal} />
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Última actividad {formatDateTime(p.ultimaActividadAt, prefs)}
                            {p.seguimientosPendientes > 0 ? ` · ${p.seguimientosPendientes} por hacer` : ''}
                            {p.clienteId ? ' · ya es cliente' : ''}
                          </span>
                        </Link>
                        <EtapaSelector prospectoId={p.id} etapa={p.etapa} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
