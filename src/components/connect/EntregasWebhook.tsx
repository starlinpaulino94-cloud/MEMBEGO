'use client'

import { useActionState, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Send } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import {
  detalleEntregaAction,
  probarWebhookAction,
  reenviarEntregaAction,
  type AccionState,
  type DetalleEntregaState,
} from '@/modules/connect/adminActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBanner } from '@/components/ui/status-banner'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'

/**
 * EL REGISTRO DE ENTREGAS de un webhook (hallazgo A-4 de la auditoría).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES PREGUNTAS QUE ESTA PANTALLA CONTESTA
 *
 * Son las tres que hasta ahora solo se podían contestar abriendo la base de
 * datos, y por eso eran siempre un ticket de soporte:
 *
 *   1. ¿Llegó?          → el estado y el código de cada entrega
 *   2. ¿Qué mandaron?   → el cuerpo exacto, tal cual viajó
 *   3. ¿Puedo repetir?  → reenviar, y ver en el momento si el arreglo sirvió
 *
 * Y una cuarta que no existía en ningún sitio: «¿funciona mi URL?», sin tener
 * que esperar a que ocurra una compra de verdad para descubrirlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NADA DE LO QUE SE ENSEÑA AQUÍ ESTÁ SUAVIZADO
 *
 * Es la pantalla de quien depura: el código HTTP va con su número y el error
 * del servidor va con sus palabras. La traducción a lenguaje de negocio existe
 * —y es lo que hace el diagnóstico del botón de probar— pero un registro de
 * entregas que dijera «hubo un problema» sería inútil para lo único que sirve.
 */

const INIT: AccionState = {}
const INIT_DETALLE: DetalleEntregaState = {}

const ESTADO = {
  ENVIADO: { texto: 'Entregado', variante: 'success' as const, Icono: CheckCircle2 },
  PENDIENTE: { texto: 'Reintentando', variante: 'warning' as const, Icono: Clock },
  DEAD_LETTER: { texto: 'Se agotó', variante: 'destructive' as const, Icono: AlertCircle },
}

export interface EntregaVista {
  id: string
  evento: string
  estado: string
  intentos: number
  estadoHttp: number | null
  ultimoError: string | null
  enviadoAt: string | null
  proximoIntentoAt: string | null
  createdAt: string
}

export function EntregasWebhook({
  suscripcionId,
  entregas,
  puedeProbar,
  puedeReenviar,
  activo,
}: {
  suscripcionId: string
  entregas: EntregaVista[]
  puedeProbar: boolean
  puedeReenviar: boolean
  /** Un webhook pausado o apagado no se puede probar ni reenviar. */
  activo: boolean
}) {
  const [prueba, probar, probando] = useActionState(probarWebhookAction, INIT)
  const [detalle, verDetalle] = useActionState(detalleEntregaAction, INIT_DETALLE)
  const [abierta, setAbierta] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {puedeProbar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">¿Funciona tu dirección?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Mandamos a tu servidor un aviso de prueba con la misma forma y la misma firma que
              los de verdad, y te decimos exactamente qué contestó. No cuenta como entrega: no
              aparece en la lista de abajo.
            </p>
            <form action={probar}>
              <input type="hidden" name="id" value={suscripcionId} />
              <Button type="submit" disabled={probando || !activo}>
                <Send className="mr-2 size-4" aria-hidden />
                {probando ? 'Mandando…' : 'Mandar evento de prueba'}
              </Button>
            </form>
            {!activo && (
              <p className="text-caption text-muted-foreground">
                Este webhook está pausado. Reactívalo para poder probarlo.
              </p>
            )}

            {prueba.error && (
              <StatusBanner variant="destructive" title="No se pudo probar">
                {prueba.error}
              </StatusBanner>
            )}

            {prueba.prueba && (
              <StatusBanner
                variant={prueba.prueba.diagnostico.gravedad === 'ok' ? 'success' : 'destructive'}
                title={prueba.prueba.diagnostico.titulo}
              >
                <p>{prueba.prueba.diagnostico.detalle}</p>
                <p className="mt-2 font-medium">{prueba.prueba.diagnostico.siguiente}</p>
                {/*
                  El cuerpo crudo, debajo del diagnóstico y no en su lugar. La
                  frase sirve para decidir qué hacer; el cuerpo es lo que se le
                  reenvía a quien programó el servidor, y sin él esa
                  conversación empieza por «mándame el error exacto».
                */}
                {prueba.prueba.post.cuerpo && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted px-3 py-2 font-mono text-caption">
                    {prueba.prueba.post.cuerpo}
                  </pre>
                )}
              </StatusBanner>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Entregas recientes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {entregas.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              Todavía no te hemos mandado ningún evento por este webhook. Aparecerán aquí en
              cuanto pase algo en tu negocio.
            </p>
          ) : (
            <ul className="space-y-2">
              {entregas.map((e) => {
                const est = ESTADO[e.estado as keyof typeof ESTADO] ?? ESTADO.PENDIENTE
                const estaAbierta = abierta === e.id
                return (
                  <li key={e.id} className="rounded-xl border border-border/60 px-3 py-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                      <est.Icono className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <code className="font-mono text-sm font-medium">{e.evento}</code>
                      <Badge variant={est.variante}>{est.texto}</Badge>
                      {e.estadoHttp !== null && (
                        <span className="font-mono text-caption text-muted-foreground">
                          HTTP {e.estadoHttp}
                        </span>
                      )}
                      <time
                        dateTime={e.createdAt}
                        className="text-caption text-muted-foreground"
                      >
                        {formatDateTime(new Date(e.createdAt))}
                      </time>
                      <span className="flex gap-2 sm:ml-auto">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={estaAbierta}
                          onClick={() => setAbierta(estaAbierta ? null : e.id)}
                        >
                          {estaAbierta ? 'Ocultar' : 'Ver detalle'}
                        </Button>
                        {puedeReenviar && activo && (
                          <BotonConfirmado
                            accion={reenviarEntregaAction}
                            estadoInicial={INIT}
                            campos={{ id: e.id }}
                            variant="outline"
                            size="sm"
                            mensajeExito="Reenviado."
                          >
                            Reenviar
                          </BotonConfirmado>
                        )}
                      </span>
                    </div>

                    {/*
                      El error va SIEMPRE visible, sin tener que abrir el
                      detalle: es lo que se viene a buscar, y esconderlo un clic
                      más abajo convierte «ver qué pasó» en «ir abriendo a ver
                      cuál falló».
                    */}
                    {e.ultimoError && (
                      <p className="mt-1 break-all font-mono text-caption text-destructive">
                        {e.ultimoError}
                      </p>
                    )}
                    {e.estado === 'PENDIENTE' && e.proximoIntentoAt && (
                      <p className="mt-1 text-caption text-muted-foreground">
                        Siguiente intento: {formatDateTime(new Date(e.proximoIntentoAt))} · llevamos{' '}
                        {e.intentos} {e.intentos === 1 ? 'intento' : 'intentos'}
                      </p>
                    )}

                    {estaAbierta && (
                      <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
                        <form action={verDetalle}>
                          <input type="hidden" name="id" value={e.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Ver lo que te mandamos
                          </Button>
                        </form>
                        {detalle.id === e.id && detalle.cuerpo && (
                          <pre className="max-h-72 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-caption">
                            {detalle.cuerpo}
                          </pre>
                        )}
                        {detalle.id === e.id && detalle.error && (
                          <p className="text-caption text-destructive">{detalle.error}</p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
