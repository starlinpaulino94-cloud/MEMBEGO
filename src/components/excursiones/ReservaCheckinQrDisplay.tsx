'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Check, QrCode, Shield } from 'lucide-react'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { codigoDeCheckin } from '@/modules/excursiones/checkin/nucleo'

interface ReservaCheckinQrDisplayProps {
  checkinToken: string | null
  checkinAt: Date | null
  checkinPorId: string | null
  numero: string
}

export function ReservaCheckinQrDisplay({
  checkinToken,
  checkinAt,
  checkinPorId,
  numero,
}: ReservaCheckinQrDisplayProps) {
  if (!checkinToken) return null

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <QrCode className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">QR de embarque</h3>
            <p className="text-caption text-muted-foreground">
              El cliente lo enseña el día de la salida. Sirve para marcar quién se subió.
            </p>
          </div>
        </div>
        {checkinAt && (
          <span className="flex-shrink-0 flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
            <Check className="h-3.5 w-3.5" />
            Embarcado
          </span>
        )}
      </div>

      <div className="mt-4 flex justify-center">
        <QRDisplay token={codigoDeCheckin(checkinToken)} size={200} />
      </div>

      <p className="mt-2 font-mono text-sm font-semibold text-center text-foreground">
        {numero}
      </p>

      {checkinAt && (
        <div className="mt-4 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Shield className="h-4 w-4" />
          <span>
            Embarcado el {format(new Date(checkinAt), "dd 'de' MMMM 'de' yyyy 'a las' HH:mm", {
              locale: es,
            })}
          </span>
        </div>
      )}
    </section>
  )
}