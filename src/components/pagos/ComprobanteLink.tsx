import { ExternalLink, FileText } from 'lucide-react'
import { urlComprobante, urlAdjuntoTicket } from '@/modules/storage/comprobantes'
import type { TipoComprobante } from '@/modules/storage/tipos'

/**
 * Enlace para ver un comprobante guardado en el bucket PRIVADO.
 *
 * Es un componente de servidor asíncrono a propósito: firma la URL en el
 * momento de pintar, con vigencia de cinco minutos, y solo después de que
 * `urlComprobante` haya comprobado quién pregunta. Así ninguna URL de un
 * comprobante bancario queda escrita en el HTML de forma permanente ni viaja a
 * un componente de cliente.
 *
 * Si la persona no tiene permiso —o el archivo ya no está— no se renderiza
 * nada. Silencio en vez de un enlace roto: un "no autorizado" visible sobre un
 * comprobante ajeno ya confirma que ese comprobante existe.
 */
export async function ComprobanteLink({
  tipo,
  id,
  valor,
  etiqueta = 'Ver comprobante',
  className,
}: {
  tipo: TipoComprobante
  /** Id de la membresía o de la compra a la que pertenece el comprobante. */
  id: string
  /** Lo guardado en la base: ruta nueva o URL pública antigua. */
  valor: string | null | undefined
  etiqueta?: string
  className?: string
}) {
  const url = await urlComprobante(tipo, id, valor)
  if (!url) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        'inline-flex items-center gap-2 rounded-xl border border-border/70 px-3.5 py-2 text-sm text-primary transition hover:bg-muted'
      }
    >
      <FileText className="h-4 w-4" />
      {etiqueta}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

/** Igual, para el adjunto de un ticket de soporte (permiso distinto). */
export async function AdjuntoTicketLink({
  ticketId,
  valor,
  etiqueta = 'Ver archivo adjunto',
  className,
}: {
  ticketId: string
  valor: string | null | undefined
  etiqueta?: string
  className?: string
}) {
  const url = await urlAdjuntoTicket(ticketId, valor)
  if (!url) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ?? 'inline-flex items-center gap-2 text-sm text-primary hover:underline'
      }
    >
      <FileText className="h-4 w-4" />
      {etiqueta}
    </a>
  )
}

/**
 * Vista previa del comprobante para quien lo tiene que VALIDAR (el panel de
 * la empresa). Muestra la imagen si lo es, y un enlace si es un PDF.
 */
export async function ComprobantePreview({
  tipo,
  id,
  valor,
}: {
  tipo: TipoComprobante
  id: string
  valor: string | null | undefined
}) {
  const url = await urlComprobante(tipo, id, valor)
  if (!url) return null

  const esImagen = /\.(jpe?g|png|webp)(\?|$)/i.test(valor ?? '')
  if (!esImagen) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary underline"
      >
        Abrir comprobante (PDF)
      </a>
    )
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Comprobante de pago"
        className="max-h-48 rounded-lg border object-contain"
      />
    </a>
  )
}
