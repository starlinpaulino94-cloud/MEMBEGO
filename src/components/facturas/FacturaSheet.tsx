'use client'

/**
 * Factura en formato hoja (Carta / A4): documento comercial profesional con
 * logo, datos de la empresa, número de factura, cliente, empleado, sucursal,
 * detalle de líneas, totales, QR de la transacción y mensaje de pie.
 *
 * Diseño 100% fluido: la tabla crece con las líneas y los textos largos hacen
 * wrap — nada se recorta ni se desborda. El mismo componente sirve para la
 * vista previa en pantalla y para la impresión (el contenedor decide).
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { TicketPayload } from '@/modules/transacciones/actions'

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

export type FacturaFormato = 'carta' | 'a4'

export function FacturaSheet({
  ticket,
  esCopia = false,
}: {
  ticket: TicketPayload
  esCopia?: boolean
}) {
  const t = ticket.transaccion
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(t.codigo, { errorCorrectionLevel: 'M', margin: 1, width: 180 }).then(
      (url) => {
        if (!cancelled) setQrUrl(url)
      }
    )
    return () => {
      cancelled = true
    }
  }, [t.codigo])

  const fecha = new Intl.DateTimeFormat('es-DO', {
    timeZone: ticket.timeZone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(t.fecha))

  const lineas =
    ticket.lineas.length > 0
      ? ticket.lineas
      : [
          {
            descripcion: t.servicio ?? t.promocion ?? t.plan ?? 'Servicio',
            cantidad: 1,
            precioUnitario: Number(t.total ?? 0),
            descuento: 0,
            total: Number(t.total ?? 0),
          },
        ]
  const subtotal = lineas.reduce((a, l) => a + l.precioUnitario * l.cantidad, 0)
  const descuentos = lineas.reduce((a, l) => a + l.descuento, 0)
  const total = lineas.reduce((a, l) => a + l.total, 0)

  return (
    <div className="bg-white p-10 font-sans text-[13px] leading-relaxed text-neutral-900">
      {/* Encabezado: empresa + № de factura */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-neutral-900 pb-5">
        <div className="flex items-start gap-4">
          {ticket.empresa.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ticket.empresa.logoUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded object-contain"
            />
          )}
          <div>
            <p className="text-xl font-bold">{ticket.empresa.nombre}</p>
            {ticket.empresa.sucursal && <p>Sucursal {ticket.empresa.sucursal}</p>}
            {ticket.empresa.direccion && <p>{ticket.empresa.direccion}</p>}
            {ticket.empresa.telefono && <p>Tel: {ticket.empresa.telefono}</p>}
            {ticket.template.rnc && <p>RNC: {ticket.template.rnc}</p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tracking-wide">
            FACTURA {esCopia && <span className="text-sm font-semibold">(COPIA)</span>}
          </p>
          <p className="mt-1 font-mono font-semibold">{t.ticketNumero}</p>
          <p className="font-mono text-xs text-neutral-600">{t.codigo}</p>
          <p className="mt-1 text-xs">{fecha}</p>
        </div>
      </div>

      {/* Cliente / empleado / caja */}
      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-1.5 sm:grid-cols-4">
        {[
          ['Cliente', t.cliente],
          ['Atendido por', t.empleado],
          ['Caja', t.caja],
          ['Método de pago', ticket.metodoPago],
          ['Referencia', t.referenciaPago],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k as string}>
              <p className="text-xs uppercase tracking-wide text-neutral-500">{k}</p>
              <p className="font-medium">{v}</p>
            </div>
          ))}
      </div>

      {/* Detalle */}
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-2 font-semibold">Descripción</th>
            <th className="py-2 pr-2 text-center font-semibold">Cant.</th>
            <th className="py-2 pr-2 text-right font-semibold">Precio</th>
            <th className="py-2 pr-2 text-right font-semibold">Desc.</th>
            <th className="py-2 text-right font-semibold">Importe</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-2 break-words">{l.descripcion}</td>
              <td className="py-2 pr-2 text-center tabular-nums">{l.cantidad}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtRD(l.precioUnitario)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {l.descuento > 0 ? `-${fmtRD(l.descuento)}` : '—'}
              </td>
              <td className="py-2 text-right font-medium tabular-nums">{fmtRD(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totales */}
      <div className="mt-4 ml-auto w-64 space-y-1">
        <div className="flex justify-between">
          <span className="text-neutral-600">Subtotal</span>
          <span className="tabular-nums">{fmtRD(subtotal)}</span>
        </div>
        {descuentos > 0 && (
          <div className="flex justify-between">
            <span className="text-neutral-600">Descuentos</span>
            <span className="tabular-nums">-{fmtRD(descuentos)}</span>
          </div>
        )}
        <div className="flex justify-between border-t-2 border-neutral-900 pt-1.5 text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{fmtRD(total)}</span>
        </div>
      </div>

      {t.observaciones && (
        <p className="mt-5 text-xs text-neutral-600">
          <span className="font-semibold">Observaciones:</span> {t.observaciones}
        </p>
      )}

      {/* Pie: QR + agradecimiento + contacto */}
      <div className="mt-8 flex items-end justify-between gap-6 border-t border-neutral-300 pt-5">
        <div className="text-xs text-neutral-600">
          <p className="text-sm font-semibold text-neutral-900">
            {ticket.template.mensajePie || '¡Gracias por su compra!'}
          </p>
          {ticket.empresa.web && <p className="mt-1">{ticket.empresa.web}</p>}
          {ticket.template.redes && <p>{ticket.template.redes}</p>}
          {ticket.template.politicas && <p className="mt-1">{ticket.template.politicas}</p>}
        </div>
        {qrUrl && (
          <div className="shrink-0 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt={`QR ${t.codigo}`} className="mx-auto h-24 w-24" />
            <p className="mt-1 font-mono text-xs text-neutral-500">{t.codigo}</p>
          </div>
        )}
      </div>
    </div>
  )
}
