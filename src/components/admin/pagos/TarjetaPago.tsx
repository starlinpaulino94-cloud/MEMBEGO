import Image from 'next/image'
import Link from 'next/link'
import { ExternalLink, FileText } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import { esImagen } from '@/modules/pagos/colasMezcla'

/**
 * LA TARJETA DE UN PAGO PENDIENTE (auditoría admin · fase 5, tarea 5.2).
 *
 * La carcasa que las cinco colas de Pagos repetían a mano: el cliente (con enlace a su ficha), su correo, la empresa solo para
 * el superadmin, una insignia a la derecha y el cuerpo. Es solo PRESENTACIÓN y es la misma de antes, movida: ninguna lógica
 * de cobro vive aquí (los botones de aprobar y rechazar son los de siempre, con su confirmación y su motivo).
 */

export function TarjetaPago({
  claseTarjeta,
  claseCabecera,
  clienteId,
  nombre,
  email,
  empresa,
  insignia,
  children,
}: {
  /** Borde de la tarjeta: cada cola se distingue a simple vista (éxito, primario, info). */
  claseTarjeta?: string
  /** Fondo de su cabecera. */
  claseCabecera: string
  clienteId: string
  nombre: string
  email: string
  /** Solo el superadmin ve de qué empresa es el cliente. */
  empresa?: string
  insignia: ReactNode
  children: ReactNode
}) {
  return (
    <Card className={`overflow-hidden ${claseTarjeta ?? ""}`.trim()}>
      <CardHeader className={`border-b pb-4 ${claseCabecera}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              <Link href={`/admin/clientes/${clienteId}`} className="text-primary hover:underline">
                {nombre}
              </Link>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{email}</p>
            {empresa ? (
              <Badge variant="outline" className="mt-1 text-xs">
                {empresa}
              </Badge>
            ) : null}
          </div>
          {insignia}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">{children}</CardContent>
    </Card>
  )
}

/** El comprobante que subió el cliente: la imagen (se abre en otra pestaña) o el PDF como enlace. */
export function ComprobanteAdjunto({ url, alt }: { url: string; alt: string }) {
  return esImagen(url) ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <Image
        src={url}
        alt={alt}
        width={400}
        height={300}
        className="w-full rounded-lg border object-cover"
        style={{ maxHeight: '200px', objectFit: 'cover' }}
      />
    </a>
  ) : (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted"
    >
      <FileText className="h-5 w-5" />
      Ver comprobante (PDF)
      <ExternalLink className="ml-auto h-4 w-4" />
    </a>
  )
}

/** La nota que dejó el cliente al subir el comprobante. */
export function NotaDelCliente({ texto }: { texto: string }) {
  return (
    <div className="rounded-lg bg-warning/15 p-3 text-sm text-warning">
      <p className="font-medium">Nota del cliente:</p>
      <p>{texto}</p>
    </div>
  )
}

/** Fecha con hora, como la escribía Pagos. */
export const fmtFecha = (d: Date | null) => (d ? formatDate(d, undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')
