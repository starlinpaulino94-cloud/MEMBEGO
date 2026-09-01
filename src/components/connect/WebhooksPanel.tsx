'use client'

import { useActionState, useState } from 'react'
import { Webhook } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import {
  cambiarEstadoWebhookAction,
  crearWebhookAction,
  type AccionState,
} from '@/modules/connect/adminActions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * Webhooks de la empresa: a dónde avisamos cuando pasa algo suyo.
 *
 * Tres cosas que la pantalla tiene que dejar claras, porque son las tres que
 * generan tickets de soporte cuando no se dicen:
 *
 *  1. El SECRETO sirve para verificar que el aviso viene de nosotros. Se
 *     enseña al crear y se puede volver a ver — a diferencia de las claves de
 *     API, aquí no gana nada estar oculto: quien integra tiene que copiarlo a
 *     su servidor de todos modos.
 *  2. PAUSADO lo decide la empresa; APAGADO lo decidimos nosotros tras muchos
 *     fallos seguidos. Son estados distintos y la etiqueta lo dice.
 *  3. Sin elegir eventos, se reciben TODOS. Es lo que casi todo el mundo
 *     quiere y evita que un evento nuevo no le llegue por olvido.
 */

const INIT: AccionState = {}

export interface WebhookVista {
  id: string
  nombre: string
  url: string
  eventos: string[]
  estado: string
  fallosSeguidos: number
  ultimoOkAt: string | null
  ultimoErrorAt: string | null
  ultimoError: string | null
}

const ESTADO = {
  ACTIVE: { texto: 'Activo', variante: 'default' },
  PAUSED: { texto: 'Pausado por ti', variante: 'secondary' },
  DISABLED: { texto: 'Apagado por fallos', variante: 'destructive' },
} as const

export function WebhooksPanel({
  webhooks,
  limite,
}: {
  webhooks: WebhookVista[]
  limite: number | null
}) {
  const [estado, crear, creando] = useActionState(crearWebhookAction, INIT)
  const [abierto, setAbierto] = useState(false)

  const vivos = webhooks.filter((w) => w.estado !== 'DISABLED').length
  const puedeCrear = limite === null || vivos < limite

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Webhooks</CardTitle>
        {puedeCrear && (
          <Button type="button" size="sm" onClick={() => setAbierto((v) => !v)}>
            <Webhook className="mr-2 h-4 w-4" aria-hidden />
            {abierto ? 'Cancelar' : 'Crear webhook'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-caption text-muted-foreground">
          Te avisamos a tu dirección cuando ocurre algo en tu empresa: una visita, una membresía
          activada, un referido que convirtió. Cada aviso va firmado para que puedas comprobar que
          viene de nosotros.
        </p>

        {estado.secretoNuevo && (
          <StatusBanner variant="success" title="Guarda este secreto en tu servidor">
            <p>Con él verificas la firma de cada aviso que te enviemos.</p>
            <code className="mt-2 block break-all rounded-lg bg-muted px-3 py-2 font-mono text-caption">
              {estado.secretoNuevo}
            </code>
          </StatusBanner>
        )}
        {estado.error && (
          <StatusBanner variant="destructive" title="No se pudo crear">
            {estado.error}
          </StatusBanner>
        )}

        {!puedeCrear && (
          <StatusBanner variant="warning" title="Tu plan no incluye webhooks">
            Escríbenos y te los habilitamos.
          </StatusBanner>
        )}

        {abierto && puedeCrear && (
          <form action={crear} className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="space-y-1">
              <Label htmlFor="wh-nombre">Nombre</Label>
              <Input id="wh-nombre" name="nombre" placeholder="Zapier · reservas" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wh-url">Dirección</Label>
              <Input
                id="wh-url"
                name="url"
                type="url"
                inputMode="url"
                placeholder="https://tu-servidor.com/webhook"
                required
              />
              <p className="text-caption text-muted-foreground">
                Debe empezar por https:// y ser accesible desde internet.
              </p>
            </div>
            <Button type="submit" disabled={creando}>
              {creando ? 'Creando…' : 'Crear webhook'}
            </Button>
          </form>
        )}

        {webhooks.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            Todavía no has creado ninguno.
          </p>
        ) : (
          <ul className="space-y-2">
            {webhooks.map((w) => {
              const e = ESTADO[w.estado as keyof typeof ESTADO] ?? ESTADO.ACTIVE
              return (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 px-3 py-2"
                >
                  <span className="font-medium">{w.nombre}</span>
                  <Badge variant={e.variante}>{e.texto}</Badge>
                  <code className="min-w-0 break-all font-mono text-caption text-muted-foreground">
                    {w.url}
                  </code>
                  <span className="w-full text-caption text-muted-foreground">
                    {w.eventos.length === 0
                      ? 'Recibe todos los eventos'
                      : `Recibe: ${w.eventos.join(', ')}`}
                    {w.ultimoOkAt && ` · Última entrega correcta: ${formatDateTime(new Date(w.ultimoOkAt))}`}
                  </span>
                  {w.ultimoError && (
                    <span className="w-full font-mono text-caption text-destructive">
                      {w.ultimoError}
                    </span>
                  )}
                  {w.estado !== 'DISABLED' && (
                    <span className="ml-auto">
                      <BotonConfirmado
                        accion={cambiarEstadoWebhookAction}
                        estadoInicial={INIT}
                        campos={{ id: w.id, estado: w.estado === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }}
                        variant="outline"
                        size="sm"
                        mensajeExito={
                          w.estado === 'ACTIVE' ? 'Webhook pausado.' : 'Webhook reactivado.'
                        }
                      >
                        {w.estado === 'ACTIVE' ? 'Pausar' : 'Reactivar'}
                      </BotonConfirmado>
                    </span>
                  )}
                  {w.estado === 'DISABLED' && (
                    <span className="ml-auto">
                      <BotonConfirmado
                        accion={cambiarEstadoWebhookAction}
                        estadoInicial={INIT}
                        campos={{ id: w.id, estado: 'ACTIVE' }}
                        variant="outline"
                        size="sm"
                        confirmacion={{
                          titulo: '¿Reactivar este webhook?',
                          descripcion:
                            'Lo apagamos tras muchos fallos seguidos. Si el problema de tu servidor sigue ahí, volverá a apagarse.',
                          textoConfirmar: 'Reactivar',
                        }}
                        mensajeExito="Webhook reactivado."
                      >
                        Reactivar
                      </BotonConfirmado>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
