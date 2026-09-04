import Link from 'next/link'
import { ArrowLeft, Bot } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { StatusChip } from '@/components/ui/status-chip'
import type { RegionalPrefs } from '@/lib/format'
import { formatDateTime } from '@/lib/format'
import type { ConversacionVista, MensajeVista } from '@/modules/mensajeria/bandeja'
import { ETIQUETA_ESTADO_MENSAJE, etiquetaContacto, vistaPrevia } from '@/modules/mensajeria/nucleo'
import type { PlantillaVista } from '@/modules/mensajeria/plantillas'
import { AccionesConversacion, MarcarLeidaAlAbrir } from './AccionesConversacion'
import { ChipCanal } from './ListaConversaciones'
import { Redactor } from './Redactor'
import type { ParametrosBandeja } from './href'
import { hrefBandeja } from './href'

/**
 * EL HILO (Meta · Fase 5). Cabecera con quién es y por dónde escribe,
 * los mensajes en orden, y el redactor. Los salientes enseñan su estado
 * real (enviado, entregado, leído, no se pudo enviar) tal como lo cuenta
 * Meta por el webhook; ninguno se inventa.
 */

function ClaseBurbuja(direccion: MensajeVista['direccion']) {
  return direccion === 'SALIENTE'
    ? 'ml-auto bg-primary text-primary-foreground rounded-2xl'
    : 'mr-auto bg-muted text-foreground rounded-2xl'
}

function Burbuja({ m, prefs }: { m: MensajeVista; prefs: RegionalPrefs | null }) {
  const saliente = m.direccion === 'SALIENTE'
  const cuerpo = m.tipo === 'text' && m.texto ? m.texto : vistaPrevia(m.tipo, m.texto)
  const fallo = m.estado === 'FALLIDO'
  return (
    <li className={`flex max-w-[85%] flex-col gap-1 ${saliente ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
      <div className={`px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${ClaseBurbuja(m.direccion)}`}>
        {m.tipo === 'template' && (
          <span className="mb-1 block text-xs font-semibold opacity-80">
            Plantilla{m.plantilla?.nombre ? ` · ${m.plantilla.nombre}` : ''}
          </span>
        )}
        {cuerpo}
      </div>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {saliente && m.origen === 'automatizacion' && <Bot className="h-3 w-3" aria-label="Automatización" />}
        <time dateTime={m.timestamp.toISOString()}>{formatDateTime(m.timestamp, prefs)}</time>
        {saliente && (
          <span className={fallo ? 'font-medium text-destructive' : ''}>
            · {ETIQUETA_ESTADO_MENSAJE[m.estado] ?? m.estado}
            {fallo && m.errorDetalle ? ` (${m.errorDetalle})` : ''}
          </span>
        )}
      </span>
    </li>
  )
}

export function Hilo({
  conversacion,
  mensajes,
  plantillas,
  prefs,
  filtro,
}: {
  conversacion: ConversacionVista
  mensajes: MensajeVista[]
  plantillas: PlantillaVista[]
  prefs: RegionalPrefs | null
  filtro: ParametrosBandeja
}) {
  const nombre = etiquetaContacto({ ...conversacion.contacto, canal: conversacion.canal })
  const cerrada = conversacion.estado === 'CERRADA'

  return (
    <section aria-label={`Conversación con ${nombre}`} className="flex min-h-0 flex-col gap-4">
      <MarcarLeidaAlAbrir conversacionId={conversacion.id} noLeidos={conversacion.noLeidos} />

      <header className="flex flex-wrap items-center gap-3">
        <Link
          href={hrefBandeja({ canal: filtro.canal, estado: filtro.estado, q: filtro.q })}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Volver
        </Link>
        <Avatar nombre={nombre} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <span className="truncate">{nombre}</span>
            <ChipCanal canal={conversacion.canal} />
            {cerrada && <StatusChip tone="neutral">Cerrada</StatusChip>}
            {!cerrada && conversacion.ventanaAbierta && (
              <StatusChip tone="success" pulso>
                Puedes responder
              </StatusChip>
            )}
            {!cerrada && !conversacion.ventanaAbierta && <StatusChip tone="warning">Más de 24 h sin respuesta del cliente</StatusChip>}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {conversacion.canal === 'WHATSAPP' && conversacion.contacto.telefono
              ? `+${conversacion.contacto.telefono}`
              : conversacion.activo.nombre
                ? `Por ${conversacion.activo.nombre}`
                : null}
            {conversacion.contacto.clienteId && (
              <>
                {' · '}
                <Link href={`/admin/clientes/${conversacion.contacto.clienteId}`} className="text-primary underline-offset-4 hover:underline">
                  Ver ficha del cliente
                </Link>
              </>
            )}
          </p>
        </div>
        <AccionesConversacion conversacionId={conversacion.id} estado={conversacion.estado} />
      </header>

      {mensajes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          Todavía no hay mensajes en esta conversación.
        </p>
      ) : (
        <ol className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-xl border border-border/60 bg-card p-4">
          {mensajes.map((m) => (
            <Burbuja key={m.id} m={m} prefs={prefs} />
          ))}
        </ol>
      )}

      <Redactor
        conversacionId={conversacion.id}
        canal={conversacion.canal}
        ventanaAbierta={conversacion.ventanaAbierta}
        cerrada={cerrada}
        plantillas={plantillas}
      />
    </section>
  )
}
