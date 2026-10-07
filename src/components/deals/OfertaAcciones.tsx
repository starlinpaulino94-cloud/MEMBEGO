'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Loader2, PauseCircle, PlayCircle, Rocket, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { ampliarPresupuestoOferta, archivarOferta, pausarOferta, publicarOferta, reanudarOferta } from '@/modules/deals/actions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface PermisosOferta {
  publicar: boolean
  presupuesto: boolean
  archivar: boolean
}

/** Lo que el servidor ya decidió que se puede hacer con esta oferta (el cliente no recalcula la máquina de estados). */
export interface PosibilidadesOferta {
  publicar: boolean
  pausar: boolean
  reanudar: boolean
  ampliar: boolean
  archivar: boolean
}

interface Props {
  ofertaId: string
  moneda: string
  permisos: PermisosOferta
  puede: PosibilidadesOferta
}

/**
 * Lo que la empresa puede hacer con una oferta. Cada bloque aparece solo si el estado lo permite
 * (`puede`, decidido en el servidor) Y la persona tiene la función de permiso (`permisos`); la
 * acción de servidor lo comprueba otra vez: ocultar un botón no es seguridad.
 */
export function OfertaAcciones({ ofertaId, moneda, permisos, puede }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [extra, setExtra] = useState('')
  const [motivo, setMotivo] = useState('')

  function ejecutar(accion: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string, despues?: () => void) {
    start(async () => {
      const r = await accion()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(exito)
      despues?.()
      router.refresh()
    })
  }

  const verEstado = (permisos.publicar && (puede.publicar || puede.pausar || puede.reanudar)) || (permisos.archivar && puede.archivar)
  const verPresupuesto = permisos.presupuesto && puede.ampliar
  if (!verEstado && !verPresupuesto) return null
  const spinner = pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null

  return (
    <div className="space-y-4" aria-label="Acciones de la oferta">
      {verEstado && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            {permisos.publicar && puede.publicar && (
              <Button disabled={pending} onClick={() => ejecutar(() => publicarOferta(ofertaId), 'Oferta publicada: los clientes ya pueden obtenerla.')}>
                {spinner}
                <Rocket className="mr-2 h-4 w-4" />
                Publicar
              </Button>
            )}
            {permisos.publicar && puede.pausar && (
              <>
                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo de la pausa" maxLength={200} className="w-56" />
                <Button variant="outline" disabled={pending} onClick={() => ejecutar(() => pausarOferta(ofertaId, motivo), 'Oferta pausada.', () => setMotivo(''))}>
                  {spinner}
                  <PauseCircle className="mr-2 h-4 w-4" />
                  Pausar
                </Button>
              </>
            )}
            {permisos.publicar && puede.reanudar && (
              <Button disabled={pending} onClick={() => ejecutar(() => reanudarOferta(ofertaId), 'Oferta reanudada.')}>
                {spinner}
                <PlayCircle className="mr-2 h-4 w-4" />
                Reanudar
              </Button>
            )}
            {permisos.archivar && puede.archivar && (
              <Button variant="outline" disabled={pending} onClick={() => ejecutar(() => archivarOferta(ofertaId), 'Oferta archivada.')}>
                {spinner}
                <Archive className="mr-2 h-4 w-4" />
                Archivar
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {verPresupuesto && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" />
              Ampliar el presupuesto
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="extra">Sumar ({moneda})</Label>
                <Input id="extra" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} className="w-40" placeholder="2000" />
              </div>
              <Button disabled={pending || extra.trim() === ''} onClick={() => ejecutar(() => ampliarPresupuestoOferta(ofertaId, extra), 'Presupuesto ampliado.', () => setExtra(''))}>
                {spinner}
                Ampliar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">El presupuesto solo se amplía, nunca se reduce: lo reservado y lo gastado ya son compromisos. Si la oferta se había agotado, se reabre sola.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
