'use client'

/**
 * El QR de check-in de una reserva: se genera cuando se pide y se comparte con
 * el cliente. Es TRANSACCIONAL —identifica esta reserva el día de la salida— y
 * no tiene nada que ver con el QR de captación del vendedor.
 *
 * El código no se muestra en texto plano junto al QR: quien tenga el QR puede
 * embarcar, y una foto de la pantalla del mostrador no debería regalar el
 * código de otra reserva a quien pase por detrás.
 */

import { useActionState, useEffect } from 'react'
import { Loader2, QrCode, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  tokenDeCheckin,
  type CheckinActionState,
} from '@/modules/excursiones/checkin/actions'
import { codigoDeCheckin } from '@/modules/excursiones/checkin/nucleo'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: CheckinActionState & { token?: string } = {}

export function ReservaCheckinQr({
  reservaId,
  numero,
  tokenInicial,
}: {
  reservaId: string
  numero: string
  tokenInicial: string | null
}) {
  const [state, formAction, pending] = useActionState(tokenDeCheckin, init)
  const token = state.token ?? tokenInicial

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  return (
    <section className="rounded-2xl border border-border bg-card p-5 text-center">
      <h2 className="text-h3 text-foreground">QR de embarque</h2>
      <p className="mt-1 text-caption text-muted-foreground">
        El cliente lo enseña el día de la salida. Sirve para marcar quién se subió, nada más.
      </p>

      {token ? (
        <>
          <div className="mt-4 flex justify-center">
            <QRDisplay token={codigoDeCheckin(token)} />
          </div>
          <p className="mt-2 font-mono text-sm font-semibold text-foreground">{numero}</p>
          <Button asChild variant="outline" size="sm" className="mt-3 gap-1.5">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                `Tu reserva ${numero} está lista. Enséñanos este código el día de la excursión.`
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              <Share2 className="h-3.5 w-3.5" /> Avisar por WhatsApp
            </a>
          </Button>
          <p className="mt-2 text-caption text-muted-foreground">
            Manda el QR como imagen: el mensaje solo lleva el aviso.
          </p>
        </>
      ) : (
        <form action={formAction} className="mt-4">
          <input type="hidden" name="reservaId" value={reservaId} />
          {state.error ? (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
            Generar el QR de embarque
          </Button>
        </form>
      )}
    </section>
  )
}
