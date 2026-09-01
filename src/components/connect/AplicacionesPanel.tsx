'use client'

import { useActionState, useState } from 'react'
import { ExternalLink, Plug } from 'lucide-react'
import {
  conectarWhatsappAction,
  desconectarAppAction,
  type AccionState,
} from '@/modules/connect/adminActions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * Aplicaciones: las que se pueden conectar y las que ya lo están.
 *
 * El catálogo llega FILTRADO por el servidor: solo aparece lo que este
 * despliegue puede conectar de verdad. Si Google Calendar no tiene su app
 * configurada, no está en esta lista — en vez de un botón que lleva a una
 * pantalla de error de Google.
 */

const INIT: AccionState = {}

const ESTADO_CONEXION = {
  CONNECTED: { texto: 'Conectada', variante: 'default' },
  PENDING: { texto: 'Sin terminar', variante: 'secondary' },
  ERROR: { texto: 'Con problemas', variante: 'destructive' },
  DISCONNECTED: { texto: 'Desconectada', variante: 'outline' },
} as const

export interface ConectorVista {
  id: string
  slug: string
  nombre: string
  descripcion: string | null
  categoria: string
  authTipo: string
}

export interface ConexionVista {
  id: string
  slug: string
  nombre: string
  estado: string
  ultimoError: string | null
}

/** Alta de WhatsApp: la empresa pega su token y su identificador de número. */
function FormularioWhatsapp() {
  const [estado, conectar, conectando] = useActionState(conectarWhatsappAction, INIT)

  return (
    <form action={conectar} className="mt-3 space-y-3 rounded-xl border border-border/60 p-4">
      <p className="text-caption text-muted-foreground">
        Los dos datos salen del panel de WhatsApp de Meta, en «API Setup». El token debe ser
        permanente (de un Usuario del Sistema); los temporales caducan en 24 horas.
      </p>
      <div className="space-y-1">
        <Label htmlFor="wa-phone">Phone number ID</Label>
        <Input id="wa-phone" name="phoneNumberId" placeholder="123456789012345" required />
        <p className="text-caption text-muted-foreground">
          Es un número largo, no tu número de teléfono.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="wa-token">Token permanente</Label>
        <Input id="wa-token" name="token" type="password" autoComplete="off" required />
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
    </form>
  )
}

export function AplicacionesPanel({
  conectores,
  conexiones,
}: {
  conectores: ConectorVista[]
  conexiones: ConexionVista[]
}) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const conectadas = new Map(conexiones.map((c) => [c.slug, c]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Aplicaciones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {conectores.length === 0 ? (
          <EmptyState
            icon={<Plug className="h-6 w-6" aria-hidden />}
            title="Todavía no hay aplicaciones para conectar"
            description="Con una clave de API o un webhook ya puedes conectar MembeGo con Zapier, Make o tu propio sistema."
          />
        ) : (
          <ul className="space-y-3">
            {conectores.map((c) => {
              const conexion = conectadas.get(c.slug)
              const viva = conexion && conexion.estado !== 'DISCONNECTED'
              const e = viva
                ? (ESTADO_CONEXION[conexion.estado as keyof typeof ESTADO_CONEXION] ??
                  ESTADO_CONEXION.PENDING)
                : null

              return (
                <li key={c.id} className="rounded-xl border border-border/60 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="font-medium">{c.nombre}</span>
                    <Badge variant="secondary">{c.categoria}</Badge>
                    {e && <Badge variant={e.variante}>{e.texto}</Badge>}

                    <span className="ml-auto flex items-center gap-2">
                      {!viva && c.authTipo === 'API_KEY' && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setAbierto((v) => (v === c.slug ? null : c.slug))}
                        >
                          {abierto === c.slug ? 'Cancelar' : 'Conectar'}
                        </Button>
                      )}
                      {!viva && c.authTipo === 'OAUTH2' && (
                        <Button size="sm" asChild>
                          <a href={`/api/connect/oauth/${c.slug}/iniciar`}>
                            <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                            Conectar
                          </a>
                        </Button>
                      )}
                      {viva && conexion && (
                        <BotonConfirmado
                          accion={desconectarAppAction}
                          estadoInicial={INIT}
                          campos={{ id: conexion.id }}
                          variant="ghost"
                          size="sm"
                          confirmacion={{
                            titulo: `¿Desconectar ${c.nombre}?`,
                            descripcion:
                              'Se borran sus credenciales y las automatizaciones que lo usen dejarán de enviar por este canal. Para volver, habrá que conectarlo de nuevo.',
                            textoConfirmar: 'Desconectar',
                            peligrosa: true,
                          }}
                          mensajeExito="Aplicación desconectada."
                        >
                          Desconectar
                        </BotonConfirmado>
                      )}
                    </span>
                  </div>

                  {c.descripcion && (
                    <p className="mt-1 text-caption text-muted-foreground">{c.descripcion}</p>
                  )}
                  {viva && conexion?.ultimoError && (
                    <p className="mt-1 font-mono text-caption text-destructive">
                      {conexion.ultimoError}
                    </p>
                  )}

                  {abierto === c.slug && c.slug === 'whatsapp' && <FormularioWhatsapp />}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
