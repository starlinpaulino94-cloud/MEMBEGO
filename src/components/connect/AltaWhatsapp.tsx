'use client'

import { useActionState } from 'react'
import { conectarWhatsappAction, type AccionState } from '@/modules/connect/adminActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBanner } from '@/components/ui/status-banner'

const INIT: AccionState = {}

/**
 * ALTA DE WHATSAPP · el paso «credencial», que es PROVISIONAL.
 *
 * La experiencia objetivo es el Alta Incrustada de Meta: pulsar un botón,
 * autorizar y terminar. Mientras Meta no apruebe la app (Verificación de
 * Negocio + Revisión), este formulario es el camino que funciona, y se cuenta
 * como lo que es en vez de disfrazarlo.
 *
 * Cuando llegue el alta incrustada, este componente se sustituye por el
 * diálogo de Meta y NADA más cambia: el token acaba en la misma credencial
 * sellada, y el envío, la salud y las automatizaciones no se enteran.
 */
export function AltaWhatsapp() {
  const [estado, conectar, conectando] = useActionState(conectarWhatsappAction, INIT)

  return (
    <form action={conectar} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="wa-phone">Identificador del número (Phone number ID)</Label>
        <Input id="wa-phone" name="phoneNumberId" placeholder="123456789012345" required />
        <p className="text-caption text-muted-foreground">
          Es un número largo que da Meta, no tu número de teléfono.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="wa-token">Token permanente</Label>
        <Input id="wa-token" name="token" type="password" autoComplete="off" required />
        <p className="text-caption text-muted-foreground">
          Debe ser el de un Usuario del Sistema. Los temporales caducan en 24 horas y la
          conexión dejaría de funcionar al día siguiente.
        </p>
      </div>

      {estado.error && (
        <StatusBanner variant="destructive" title="No se pudo conectar">
          {estado.error}
        </StatusBanner>
      )}
      {estado.success && (
        <StatusBanner variant="success" title="Listo">
          {estado.success}
        </StatusBanner>
      )}

      <Button type="submit" disabled={conectando}>
        {conectando ? 'Comprobando con Meta…' : 'Conectar WhatsApp'}
      </Button>
      <p className="text-caption text-muted-foreground">
        Comprobamos el número con Meta antes de guardar nada. Si el token no sirve, no se
        guarda.
      </p>
    </form>
  )
}
