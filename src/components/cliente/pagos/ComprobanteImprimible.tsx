'use client'

/**
 * El comprobante de pago que el propio cliente ve e imprime (o guarda en PDF):
 * la misma factura Carta del negocio (`FacturaSheet`), por el mismo canal de
 * impresión que el mostrador (`AreaDeImpresion`): una sola página, sin el
 * resto de la pantalla.
 */

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import { FacturaSheet } from '@/components/facturas/FacturaSheet'
import { AreaDeImpresion } from '@/components/impresion/AreaDeImpresion'
import { Button } from '@/components/ui/button'
import type { TicketPayload } from '@/modules/transacciones/ticket'

export function ComprobanteImprimible({ ticket, volverHref }: { ticket: TicketPayload; volverHref?: string }) {
  const [solicitud, setSolicitud] = useState(0)
  const [imprimiendo, setImprimiendo] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {volverHref ? (
          <Button asChild variant="outline">
            <Link href={volverHref}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Mis pagos
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <Button
          onClick={() => {
            setImprimiendo(true)
            setSolicitud((s) => s + 1)
          }}
          disabled={imprimiendo}
          className="gap-2"
        >
          {imprimiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
          Imprimir / Guardar PDF
        </Button>
      </div>

      <div className="overflow-auto rounded-2xl border border-border/60 bg-muted/40 p-3 sm:p-5">
        <div className="mx-auto max-w-[210mm] bg-white shadow">
          <FacturaSheet ticket={ticket} />
        </div>
      </div>

      <AreaDeImpresion papel="carta" solicitud={solicitud} onImpreso={() => setImprimiendo(false)}>
        <FacturaSheet ticket={ticket} />
      </AreaDeImpresion>
    </div>
  )
}
