'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Webhook } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import {
  actualizarEventosWebhookAction,
  cambiarEstadoWebhookAction,
  crearWebhookAction,
  rotarSecretoWebhookAction,
  type AccionState,
} from '@/modules/connect/adminActions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { StatusBanner } from '@/components/ui/status-banner'
import { CandadoPlan, LimiteAlcanzado } from '@/components/connect/EstadoPlanConnect'

/**
 * Webhooks de la empresa: a dónde avisamos cuando pasa algo suyo.
 *
 * Tres cosas que la pantalla tiene que dejar claras, porque son las tres que
 * generan tickets de soporte cuando no se dicen:
 *
 *  1. El SECRETO sirve para verificar que el aviso viene de nosotros, y se
 *     enseña UNA sola vez: al crear el webhook o al rotarlo. No se puede
 *     volver a ver.
 *
 *     (Este comentario decía lo contrario —«se puede volver a ver»— y era
 *     falso: nunca hubo pantalla que lo enseñara. Lo que lo vuelve aceptable es
 *     la rotación de la Fase A-7: quien pierda el secreto ya no tiene que
 *     borrar la suscripción y crear otra, con id nuevo e historial perdido;
 *     rota, y tiene unos días de solape para copiarlo.)
 *  2. PAUSADO lo decide la empresa; APAGADO lo decidimos nosotros tras muchos
 *     fallos seguidos. Son estados distintos y la etiqueta lo dice.
 *  3. Sin elegir eventos, se reciben TODOS. Es lo que casi todo el mundo
 *     quiere y evita que un evento nuevo no le llegue por olvido. Desde la
 *     Fase A-5 esa regla deja de ser un secreto del código: la pantalla la
 *     dice, y por fin hay casillas para no aceptarla.
 */

const INIT: AccionState = {}

/**
 * LAS CASILLAS DE EVENTOS, compartidas por el alta y la edición.
 *
 * Un solo componente para los dos sitios porque la regla que hay que explicar
 * —«sin marcar nada, llega todo»— es la misma, y escrita dos veces se acaba
 * diciendo de dos formas. Es además la frase que evita el malentendido caro:
 * quien ve una lista de casillas vacías asume que no recibe nada.
 */
function CasillasDeEventos({
  catalogo,
  marcados,
  idPrefijo,
}: {
  catalogo: { valor: string; label: string }[]
  /** Lo que ya recibe. Vacío = todos, y entonces no se marca ninguna. */
  marcados: string[]
  idPrefijo: string
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Qué eventos quieres recibir</legend>
      <p className="text-caption text-muted-foreground">
        Sin marcar ninguna, te avisamos de <strong>todo</strong> — incluidos los eventos que
        añadamos más adelante. Marca solo si quieres filtrar.
      </p>
      {catalogo.map((e) => (
        <label key={e.valor} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="eventos"
            value={e.valor}
            id={`${idPrefijo}-${e.valor}`}
            defaultChecked={marcados.includes(e.valor)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            {e.label}
            {/*
              El nombre técnico, discreto y al lado. Quien escribe el receptor
              compara contra esta cadena exacta; sin ella tendría que adivinar
              cómo se llama «Un cliente te compra por primera vez» en el JSON.
            */}
            <code className="ml-2 font-mono text-caption text-muted-foreground">{e.valor}</code>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * Cambiar los eventos de un webhook que ya existe.
 *
 * Es la mitad que de verdad hacía falta: TODAS las suscripciones que hay hoy
 * tienen la lista vacía, porque hasta ahora no había forma de decir otra cosa.
 * Si solo se pudiera elegir al crear, esto no le serviría a nadie que ya
 * estuviera integrado.
 */
function EditarEventos({
  webhook,
  catalogo,
}: {
  webhook: WebhookVista
  catalogo: { valor: string; label: string }[]
}) {
  const [estado, guardar, guardando] = useActionState(actualizarEventosWebhookAction, INIT)
  const [abierto, setAbierto] = useState(false)

  if (!abierto) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(true)}>
        Cambiar eventos
      </Button>
    )
  }

  return (
    <form action={guardar} className="mt-2 w-full space-y-3 rounded-xl border border-border/60 p-4">
      <input type="hidden" name="id" value={webhook.id} />
      <CasillasDeEventos
        catalogo={catalogo}
        marcados={webhook.eventos}
        idPrefijo={`ev-${webhook.id}`}
      />
      {estado.error && (
        <StatusBanner variant="destructive" title="No se pudo guardar">
          {estado.error}
        </StatusBanner>
      )}
      {estado.success && <StatusBanner variant="success" title={estado.success} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          Cerrar
        </Button>
      </div>
    </form>
  )
}

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
  /**
   * Hasta cuándo sigue valiendo el secreto anterior, si hay una rotación en
   * curso. Null = no la hay. NUNCA viajan los secretos: solo la fecha.
   */
  rotandoHasta: string | null
}

const ESTADO = {
  ACTIVE: { texto: 'Activo', variante: 'default' },
  PAUSED: { texto: 'Pausado por ti', variante: 'secondary' },
  DISABLED: { texto: 'Apagado por fallos', variante: 'destructive' },
} as const

export function WebhooksPanel({
  webhooks,
  limite,
  catalogo,
  puedeRotar,
}: {
  webhooks: WebhookVista[]
  limite: number | null
  /** Rotar tiene permiso propio: no se pinta el botón si la acción va a negarlo. */
  puedeRotar: boolean
  /**
   * Los eventos que se pueden marcar, ya traducidos. Vienen del servidor y no
   * se calculan aquí: el catálogo se deriva de lo que el bus emite de verdad
   * (`modules/connect/eventosSuscribibles`) y meter ese módulo en el navegador
   * arrastraría el núcleo de integraciones —y `node:crypto` con él— al bundle.
   */
  catalogo: { valor: string; label: string }[]
}) {
  const [estado, crear, creando] = useActionState(crearWebhookAction, INIT)
  const [abierto, setAbierto] = useState(false)

  const vivos = webhooks.filter((w) => w.estado !== 'DISABLED').length
  const puedeCrear = limite === null || vivos < limite
  // «No concedido» y «lleno» son hechos distintos: la frase «tu plan no
  // incluye webhooks» era falsa cuando sí los incluía y estaban todos usados.
  const sinConcesion = limite === 0
  const lleno = !puedeCrear && !sinConcesion && limite !== null

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Webhooks</CardTitle>
        {puedeCrear ? (
          <Button type="button" size="sm" onClick={() => setAbierto((v) => !v)}>
            <Webhook className="mr-2 h-4 w-4" aria-hidden />
            {abierto ? 'Cancelar' : 'Crear webhook'}
          </Button>
        ) : (
          sinConcesion && (
            <CandadoPlan titulo="Los webhooks no están activados para tu negocio" />
          )
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

        {lleno && limite !== null && <LimiteAlcanzado que="webhooks" limite={limite} />}

        {sinConcesion && webhooks.length > 0 && (
          <StatusBanner variant="info" title="Los webhooks ya no están activados">
            Estos siguen entregando y puedes pausarlos, pero no se pueden crear nuevos.
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
            <CasillasDeEventos catalogo={catalogo} marcados={[]} idPrefijo="nuevo" />
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
                  className="flex flex-col gap-2 rounded-xl border border-border/60 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3"
                >
                  <span className="font-medium">{w.nombre}</span>
                  <Badge variant={e.variante}>{e.texto}</Badge>
                  <code className="min-w-0 break-all font-mono text-caption text-muted-foreground">
                    {w.url}
                  </code>
                  <span className="text-caption text-muted-foreground sm:w-full">
                    {/*
                      Con las etiquetas y no con los identificadores: «Recibe:
                      purchase.first_completed, referral.converted» obliga a
                      traducir de cabeza cada vez que alguien quiere comprobar
                      qué eligió. El identificador sigue a un clic, en las
                      casillas.
                    */}
                    {w.eventos.length === 0
                      ? 'Recibe todos los eventos'
                      : `Recibe: ${w.eventos
                          .map((e) => catalogo.find((c) => c.valor === e)?.label ?? e)
                          .join(' · ')}`}
                    {w.ultimoOkAt && ` · Última entrega correcta: ${formatDateTime(new Date(w.ultimoOkAt))}`}
                  </span>
                  {w.ultimoError && (
                    <span className="break-all font-mono text-caption text-destructive sm:w-full">
                      {w.ultimoError}
                    </span>
                  )}
                  {/*
                    El plazo, mientras dure. Es lo único de la rotación que hay
                    que tener delante todos los días: el secreto nuevo se enseña
                    una vez al rotarlo, pero «cuándo deja de valer el viejo» es
                    la fecha que decide si hay que correr.
                  */}
                  {w.rotandoHasta && (
                    <span className="text-caption text-warning sm:w-full">
                      Rotación en curso: el secreto anterior deja de valer el{' '}
                      {formatDateTime(new Date(w.rotandoHasta))}. Copia el nuevo en tu servidor
                      antes.
                    </span>
                  )}
                  {/*
                    El enlace a las entregas va ANTES que pausar y reactivar, y
                    es el único que aparece en los tres estados. Quien abre esta
                    lista casi siempre viene con la misma pregunta —«¿está
                    llegando?»— y hasta la Fase A-4 esa pregunta no tenía dónde
                    contestarse. Pausar es lo que se hace DESPUÉS de mirar.
                  */}
                  <span className="sm:ml-auto">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/integraciones/desarrolladores/webhooks/${w.id}`}>
                        Ver entregas
                      </Link>
                    </Button>
                  </span>
                  <span>
                    <EditarEventos webhook={w} catalogo={catalogo} />
                  </span>
                  {puedeRotar && (
                    <span>
                      <BotonConfirmado
                        accion={rotarSecretoWebhookAction}
                        estadoInicial={INIT}
                        campos={{ id: w.id }}
                        variant="ghost"
                        size="sm"
                        confirmacion={{
                          titulo: '¿Rotar el secreto de este webhook?',
                          // Las tres cosas que hay que saber ANTES de pulsar, y
                          // la tercera es la que evita el susto: nada se corta
                          // hoy, pero hay un plazo y empieza ahora.
                          descripcion:
                            'Te daremos un secreto nuevo y lo verás una sola vez. El anterior seguirá valiendo unos días, así que no se corta nada ahora mismo — pero tienes que copiar el nuevo en tu servidor antes de que venza, o dejaremos de firmar con el que tienes.',
                          textoConfirmar: 'Rotar secreto',
                        }}
                      >
                        Rotar secreto
                      </BotonConfirmado>
                    </span>
                  )}
                  {w.estado !== 'DISABLED' && (
                    <span>
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
                    <span>
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
