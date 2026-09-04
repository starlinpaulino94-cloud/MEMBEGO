import Link from 'next/link'
import { Search } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import type { RegionalPrefs } from '@/lib/format'
import { formatDateTime } from '@/lib/format'
import type { ConversacionVista, ResumenBandeja } from '@/modules/mensajeria/bandeja'
import { ETIQUETA_CANAL, etiquetaContacto, type Canal } from '@/modules/mensajeria/nucleo'
import { CANAL_TINTE } from '@/app/(admin)/admin/crm/paleta'
import { hrefBandeja, type ParametrosBandeja } from './href'

/**
 * LA LISTA (Meta · Fase 5). Componente de servidor: filtros por enlace,
 * búsqueda por formulario GET, cada hilo un enlace con `?c=`. Sin estado en el
 * navegador: lo que se ve es lo que hay en la base en ese momento.
 */

const TINTE: Record<Canal, { texto: string; fondo: string }> = {
  WHATSAPP: CANAL_TINTE.whatsapp,
  MESSENGER: CANAL_TINTE.messenger,
  INSTAGRAM: CANAL_TINTE.instagram,
}

export function ChipCanal({ canal }: { canal: Canal }) {
  const t = TINTE[canal]
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${t.fondo} ${t.texto}`}>
      {ETIQUETA_CANAL[canal]}
    </span>
  )
}

export function ListaConversaciones({
  items,
  seleccionadaId,
  filtro,
  resumen,
  prefs,
}: {
  items: ConversacionVista[]
  seleccionadaId: string | null
  filtro: ParametrosBandeja
  resumen: ResumenBandeja
  prefs: RegionalPrefs | null
}) {
  const canales: { valor: Canal | null; etiqueta: string; noLeidos: number }[] = [
    { valor: null, etiqueta: 'Todos', noLeidos: Object.values(resumen).reduce((a, r) => a + r.noLeidos, 0) },
    { valor: 'WHATSAPP', etiqueta: 'WhatsApp', noLeidos: resumen.WHATSAPP.noLeidos },
    { valor: 'MESSENGER', etiqueta: 'Messenger', noLeidos: resumen.MESSENGER.noLeidos },
    { valor: 'INSTAGRAM', etiqueta: 'Instagram', noLeidos: resumen.INSTAGRAM.noLeidos },
  ]
  const estadoActual = filtro.estado === 'CERRADA' ? 'CERRADA' : 'ABIERTA'

  return (
    <section aria-label="Conversaciones" className="flex min-h-0 flex-col gap-3">
      <nav aria-label="Canal" className="flex flex-wrap gap-1.5">
        {canales.map((c) => {
          const activo = (filtro.canal ?? null) === c.valor
          return (
            <Link
              key={c.etiqueta}
              href={hrefBandeja({ canal: c.valor, estado: estadoActual, q: filtro.q })}
              aria-current={activo ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast ${
                activo
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
            >
              {c.etiqueta}
              {c.noLeidos > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                  {c.noLeidos}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="flex items-center gap-2">
        <form method="get" action={hrefBandeja({})} className="relative flex-1">
          {filtro.canal && <input type="hidden" name="canal" value={filtro.canal} />}
          {estadoActual === 'CERRADA' && <input type="hidden" name="estado" value="CERRADA" />}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            name="q"
            defaultValue={filtro.q ?? ''}
            placeholder="Buscar por nombre o número"
            aria-label="Buscar conversaciones"
            className="pl-9"
          />
        </form>
        <Link
          href={hrefBandeja({ canal: filtro.canal, estado: estadoActual === 'ABIERTA' ? 'CERRADA' : 'ABIERTA', q: filtro.q })}
          className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {estadoActual === 'ABIERTA' ? 'Ver cerradas' : 'Ver abiertas'}
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          {filtro.q
            ? 'Nada coincide con esa búsqueda.'
            : estadoActual === 'CERRADA'
              ? 'No hay conversaciones cerradas.'
              : 'No hay conversaciones abiertas en este canal.'}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
          {items.map((c) => {
            const nombre = etiquetaContacto({ ...c.contacto, canal: c.canal })
            const activo = c.id === seleccionadaId
            return (
              <li key={c.id}>
                <Link
                  href={hrefBandeja({ canal: filtro.canal, estado: estadoActual, q: filtro.q, c: c.id })}
                  aria-current={activo ? 'true' : undefined}
                  className={`flex items-start gap-3 px-3 py-2.5 transition-colors duration-fast hover:bg-muted/40 ${
                    activo ? 'bg-primary/5' : ''
                  }`}
                >
                  <Avatar nombre={nombre} size="sm" className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.noLeidos > 0 ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}`}>
                        {nombre}
                      </span>
                      {c.ultimoMensajeAt && (
                        <time
                          dateTime={c.ultimoMensajeAt.toISOString()}
                          className="shrink-0 text-xs text-muted-foreground"
                        >
                          {formatDateTime(c.ultimoMensajeAt, prefs)}
                        </time>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{c.ultimoTexto ?? 'Sin mensajes todavía'}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <ChipCanal canal={c.canal} />
                        {c.noLeidos > 0 && (
                          <span
                            aria-label={`${c.noLeidos} sin leer`}
                            className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
                          >
                            {c.noLeidos}
                          </span>
                        )}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
