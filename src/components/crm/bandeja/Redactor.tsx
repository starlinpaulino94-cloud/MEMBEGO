'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBanner } from '@/components/ui/status-banner'
import { Textarea } from '@/components/ui/textarea'
import {
  enviarPlantillaAction,
  enviarTextoAction,
  sincronizarPlantillasAction,
  type EstadoRedactor,
} from '@/modules/mensajeria/actions'
import type { Canal } from '@/modules/mensajeria/nucleo'
import type { PlantillaVista } from '@/modules/mensajeria/plantillas'

/**
 * EL REDACTOR (Meta · Fase 5). La ventana de 24 h decide lo que se ofrece:
 *
 *   · abierta → texto libre por cualquier canal;
 *   · cerrada y WhatsApp → una plantilla APROBADA con sus parámetros;
 *   · cerrada y Messenger / Instagram → nada: se espera al cliente.
 *
 * El servidor vuelve a comprobar la ventana en cada envío; aquí solo se evita
 * ofrecer lo que Meta rechazaría.
 */

const INIT: EstadoRedactor = {}

export function Redactor({
  conversacionId,
  canal,
  ventanaAbierta,
  cerrada,
  plantillas,
}: {
  conversacionId: string
  canal: Canal
  ventanaAbierta: boolean
  cerrada: boolean
  plantillas: PlantillaVista[]
}) {
  if (cerrada) {
    return (
      <p className="rounded-xl border border-dashed border-border/60 px-4 py-3 text-center text-sm text-muted-foreground">
        Esta conversación está cerrada. Reábrela para responder.
      </p>
    )
  }
  if (ventanaAbierta) return <RedactorTexto conversacionId={conversacionId} />
  if (canal === 'WHATSAPP') return <RedactorPlantilla conversacionId={conversacionId} plantillas={plantillas} />
  return (
    <StatusBanner variant="info" title="Solo se puede responder durante 24 horas">
      Han pasado más de 24 horas desde el último mensaje de esta persona. Por {canal === 'INSTAGRAM' ? 'Instagram' : 'Messenger'} no
      se puede iniciar la conversación desde el negocio: cuando vuelva a escribir, podrás contestar.
    </StatusBanner>
  )
}

function useRefrescoAlEnviar(estado: EstadoRedactor) {
  const router = useRouter()
  useEffect(() => {
    if (estado.enviadoAt) router.refresh()
  }, [estado.enviadoAt, router])
}

function RedactorTexto({ conversacionId }: { conversacionId: string }) {
  const [estado, enviar, enviando] = useActionState(enviarTextoAction, INIT)
  useRefrescoAlEnviar(estado)

  return (
    <form key={estado.enviadoAt ?? 0} action={enviar} className="space-y-2">
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <Textarea
        name="texto"
        required
        maxLength={4096}
        rows={3}
        placeholder="Escribe tu respuesta…"
        aria-label="Mensaje"
        disabled={enviando}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
      />
      {estado.error && (
        <StatusBanner variant="destructive" title="No se envió">
          {estado.error}
        </StatusBanner>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Ctrl + Enter para enviar</span>
        <Button type="submit" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>
    </form>
  )
}

function RedactorPlantilla({ conversacionId, plantillas }: { conversacionId: string; plantillas: PlantillaVista[] }) {
  const [estado, enviar, enviando] = useActionState(enviarPlantillaAction, INIT)
  const [elegidaId, setElegidaId] = useState<string>(plantillas[0]?.id ?? '')
  const [sincronizando, sincronizar] = useTransition()
  const [avisoSync, setAvisoSync] = useState<string | null>(null)
  const router = useRouter()
  useRefrescoAlEnviar(estado)
  const elegida = plantillas.find((p) => p.id === elegidaId) ?? null

  return (
    <div className="space-y-3">
      <StatusBanner variant="info" title="Han pasado más de 24 horas desde el último mensaje del cliente">
        Por WhatsApp solo se puede enviar ahora una plantilla aprobada por Meta. Cuando el cliente responda, podrás
        escribirle texto libre.
      </StatusBanner>

      {plantillas.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
          <p>No hay plantillas aprobadas guardadas. Se crean y aprueban en el administrador de WhatsApp de Meta; desde aquí se traen las que ya estén aprobadas.</p>
          <BotonSincronizar
            pendiente={sincronizando}
            onClick={() =>
              sincronizar(async () => {
                const r = await sincronizarPlantillasAction()
                setAvisoSync(r.mensaje)
                if (r.ok) router.refresh()
              })
            }
          />
          {avisoSync && <p className="text-xs">{avisoSync}</p>}
        </div>
      ) : (
        <form key={estado.enviadoAt ?? 0} action={enviar} className="space-y-3">
          <input type="hidden" name="conversacionId" value={conversacionId} />
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Plantilla</span>
            <select
              name="plantillaId"
              value={elegidaId}
              onChange={(e) => setElegidaId(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
            >
              {plantillas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} · {p.idioma}
                </option>
              ))}
            </select>
          </label>
          {elegida?.cuerpo && (
            <p className="whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 text-sm text-foreground/90">{elegida.cuerpo}</p>
          )}
          {elegida && elegida.variables > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Los datos que lleva la plantilla</legend>
              {Array.from({ length: elegida.variables }, (_, i) => (
                <Input key={`${elegida.id}-${i}`} name="parametro" required placeholder={`Dato ${i + 1} — {{${i + 1}}}`} aria-label={`Dato ${i + 1}`} />
              ))}
            </fieldset>
          )}
          {estado.error && (
            <StatusBanner variant="destructive" title="No se envió">
              {estado.error}
            </StatusBanner>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <BotonSincronizar
              pendiente={sincronizando}
              onClick={() =>
                sincronizar(async () => {
                  const r = await sincronizarPlantillasAction()
                  setAvisoSync(r.mensaje)
                  if (r.ok) router.refresh()
                })
              }
            />
            <Button type="submit" disabled={enviando || !elegida}>
              {enviando ? 'Enviando…' : 'Enviar plantilla'}
            </Button>
          </div>
          {avisoSync && <p className="text-xs text-muted-foreground">{avisoSync}</p>}
        </form>
      )}
    </div>
  )
}

function BotonSincronizar({ pendiente, onClick }: { pendiente: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" disabled={pendiente} onClick={onClick}>
      {pendiente ? 'Consultando a Meta…' : 'Traer plantillas de Meta'}
    </Button>
  )
}
