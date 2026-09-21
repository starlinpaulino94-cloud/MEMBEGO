'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Inbox } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import {
  cambiarEstadoEntranteAction,
  crearEntranteAction,
  eliminarEntranteAction,
  type AccionState,
} from '@/modules/connect/adminActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBanner } from '@/components/ui/status-banner'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { CandadoPlan, LimiteAlcanzado } from '@/components/connect/EstadoPlanConnect'

/**
 * WEBHOOKS ENTRANTES: que algo de fuera avise hacia dentro (hallazgo B-1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES COSAS QUE LA PANTALLA TIENE QUE DEJAR CLARAS
 *
 *  1. LA DIRECCIÓN ES EL SECRETO. No hay contraseña aparte: quien tenga la URL
 *     puede mandarnos avisos. Se enseña una sola vez, como una clave de API, y
 *     se dice en voz alta que no se puede volver a ver.
 *  2. EL NOMBRE DEL EVENTO es lo que hay que poner en la automatización que lo
 *     escuche. Va visible en cada fila, no escondido: sin él, recibir un aviso
 *     no sirve de nada porque no hay forma de referirse a él.
 *  3. PAUSADO SIGUE ACEPTANDO. Es lo contrario de lo que la gente espera de un
 *     «pausar», así que se explica: si devolviéramos un error, la herramienta
 *     del otro lado se pondría a reintentar y a llenar de avisos de fallo el
 *     panel de su dueño por algo que la empresa apagó a propósito.
 */

const INIT: AccionState = {}

const ESTADO = {
  ACTIVE: { texto: 'Activo', variante: 'default' as const },
  PAUSED: { texto: 'Pausado', variante: 'secondary' as const },
}

export interface EntranteVista {
  id: string
  nombre: string
  /** El evento que emite: `entrante.<slug>`. */
  evento: string
  estado: string
  recibidos: number
  ultimoAt: string | null
}

export function EntrantesPanel({
  entrantes,
  limite,
  puedeCrear: concedido,
  puedeGestionar,
}: {
  entrantes: EntranteVista[]
  limite: number | null
  /** ¿Tiene el permiso? Distinto de tener cupo: son dos «no» distintos. */
  puedeCrear: boolean
  puedeGestionar: boolean
}) {
  const [estado, crear, creando] = useActionState(crearEntranteAction, INIT)
  const [abierto, setAbierto] = useState(false)

  const hayCupo = limite === null || entrantes.length < limite
  const sinConcesion = limite === 0
  const puedeCrear = concedido && hayCupo && !sinConcesion

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-h3">
          <Inbox className="size-4" aria-hidden />
          Webhooks entrantes
        </CardTitle>
        {puedeCrear && !abierto && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(true)}>
            Crear
          </Button>
        )}
        {sinConcesion && <CandadoPlan titulo="Tu plan no incluye webhooks entrantes" />}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-caption text-muted-foreground">
          Una dirección secreta a la que tu herramienta —tu tienda, tu formulario, Zapier— nos
          manda un aviso por POST. Lo que llegue queda guardado y entra como un evento que tus
          automatizaciones pueden escuchar.
        </p>

        {!sinConcesion && !hayCupo && limite !== null && (
          <LimiteAlcanzado que="entrantes" limite={limite} />
        )}

        {estado.secretoNuevo && (
          <StatusBanner variant="success" title="Copia esta dirección: no se puede volver a ver">
            <p>{estado.success}</p>
            <code className="mt-2 block break-all rounded-lg bg-muted px-3 py-2 font-mono text-caption">
              {estado.secretoNuevo}
            </code>
            <p className="mt-2">
              Trátala como una contraseña: quien la tenga puede mandarnos avisos en tu nombre.
            </p>
          </StatusBanner>
        )}
        {estado.error && (
          <StatusBanner variant="destructive" title="No se pudo crear">
            {estado.error}
          </StatusBanner>
        )}

        {abierto && puedeCrear && (
          <form action={crear} className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="space-y-1">
              <Label htmlFor="ent-nombre">Nombre</Label>
              <Input
                id="ent-nombre"
                name="nombre"
                placeholder="Pedidos de mi tienda"
                required
              />
              <p className="text-caption text-muted-foreground">
                De aquí sale el nombre del evento. No cambia aunque renombres el webhook después,
                para no dejar mudas a las automatizaciones que ya lo escuchen.
              </p>
            </div>
            <Button type="submit" disabled={creando}>
              {creando ? 'Creando…' : 'Crear webhook entrante'}
            </Button>
          </form>
        )}

        {entrantes.length === 0 ? (
          <p className="text-caption text-muted-foreground">Todavía no has creado ninguno.</p>
        ) : (
          <ul className="space-y-2">
            {entrantes.map((e) => {
              const est = ESTADO[e.estado as keyof typeof ESTADO] ?? ESTADO.ACTIVE
              return (
                <li
                  key={e.id}
                  className="flex flex-col gap-2 rounded-xl border border-border/60 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3"
                >
                  <span className="font-medium">{e.nombre}</span>
                  <Badge variant={est.variante}>{est.texto}</Badge>
                  {/*
                    El nombre del evento, visible y copiable. Es lo que hay que
                    escribir en la automatización que lo escuche: esconderlo
                    convierte «recibí un aviso» en algo con lo que no se puede
                    hacer nada.
                  */}
                  <code className="break-all font-mono text-caption text-muted-foreground">
                    {e.evento}
                  </code>
                  <span className="text-caption text-muted-foreground sm:w-full">
                    {e.recibidos === 0
                      ? 'Todavía no hemos recibido nada por aquí.'
                      : `${e.recibidos} ${e.recibidos === 1 ? 'aviso recibido' : 'avisos recibidos'}` +
                        (e.ultimoAt ? ` · último: ${formatDateTime(new Date(e.ultimoAt))}` : '')}
                  </span>
                  {e.estado === 'PAUSED' && (
                    <span className="text-caption text-muted-foreground sm:w-full">
                      Pausado: seguimos aceptando los avisos para que tu herramienta no se llene de
                      errores, pero no hacemos nada con ellos.
                    </span>
                  )}

                  <span className="flex gap-2 sm:ml-auto">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/integraciones/desarrolladores/entrantes/${e.id}`}>
                        Ver lo recibido
                      </Link>
                    </Button>
                    {puedeGestionar && (
                      <>
                        <BotonConfirmado
                          accion={cambiarEstadoEntranteAction}
                          estadoInicial={INIT}
                          campos={{ id: e.id, estado: e.estado === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }}
                          variant="outline"
                          size="sm"
                          mensajeExito={e.estado === 'ACTIVE' ? 'Pausado.' : 'Reactivado.'}
                        >
                          {e.estado === 'ACTIVE' ? 'Pausar' : 'Reactivar'}
                        </BotonConfirmado>
                        <BotonConfirmado
                          accion={eliminarEntranteAction}
                          estadoInicial={INIT}
                          campos={{ id: e.id }}
                          variant="ghost"
                          size="sm"
                          confirmacion={{
                            titulo: '¿Eliminar este webhook entrante?',
                            descripcion:
                              'Su dirección deja de funcionar y no se puede recuperar: tendrías que crear otro y volver a pegar la URL nueva en tu herramienta. Lo que ya recibiste se conserva.',
                            textoConfirmar: 'Eliminar',
                          }}
                          mensajeExito="Eliminado."
                        >
                          Eliminar
                        </BotonConfirmado>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
