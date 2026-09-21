'use client'

import { useActionState, useState } from 'react'
import { Waypoints } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import {
  archivarReglaAction,
  cambiarEstadoReglaAction,
  crearReglaHttpAction,
  type AccionState,
} from '@/modules/connect/adminActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBanner } from '@/components/ui/status-banner'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'

/**
 * REGLAS «cuando pase X, llama a Y» (hallazgo B-1, la pieza que une las dos
 * mitades).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTO NO ES UN CONSTRUCTOR DE REGLAS
 *
 * Es lo más pequeño que cierra el circuito: un evento, una llamada. El motor
 * soporta condiciones, pasos encadenados, horarios y límites, y nada de eso está
 * aquí. Construir el constructor entero antes de que nadie hubiera podido probar
 * el circuito habría sido el orden inverso — y la forma más cara de descubrir
 * que faltaba otra cosa.
 *
 * LO QUE SÍ SE EXPLICA es de dónde salen las variables: sin `{{...}}` esto solo
 * sirve para mandar cuerpos fijos, que es la mitad de inútil.
 */

const INIT: AccionState = {}

const ESTADO = {
  PUBLISHED: { texto: 'Activa', variante: 'default' as const },
  PAUSED: { texto: 'Pausada', variante: 'secondary' as const },
  DRAFT: { texto: 'Borrador', variante: 'secondary' as const },
}

const METODOS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'] as const

export interface ReglaVista {
  id: string
  nombre: string
  evento: string
  estado: string
  host: string
  createdAt: string
}

export function ReglasHttpPanel({
  reglas,
  eventos,
  puedeGestionar,
}: {
  reglas: ReglaVista[]
  /** Lo que se puede escuchar: eventos del negocio y webhooks entrantes. */
  eventos: { valor: string; label: string }[]
  puedeGestionar: boolean
}) {
  const [estado, crear, creando] = useActionState(crearReglaHttpAction, INIT)
  const [abierto, setAbierto] = useState(false)
  const [cabeceras, setCabeceras] = useState(1)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-h3">
          <Waypoints className="size-4" aria-hidden />
          Cuando pase algo, llamar a otra app
        </CardTitle>
        {puedeGestionar && !abierto && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(true)}>
            Crear regla
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-caption text-muted-foreground">
          Elige un evento y a qué dirección llamamos cuando ocurra. Sirve para conectar con
          cualquier herramienta, aunque no esté en el catálogo de integraciones.
        </p>

        {estado.success && <StatusBanner variant="success" title={estado.success} />}
        {estado.error && (
          <StatusBanner variant="destructive" title="No se pudo crear">
            {estado.error}
          </StatusBanner>
        )}

        {abierto && puedeGestionar && (
          <form action={crear} className="space-y-3 rounded-xl border border-border/60 p-4">
            <div className="space-y-1">
              <Label htmlFor="rg-nombre">Nombre</Label>
              <Input id="rg-nombre" name="nombre" placeholder="Avisar a mi ERP" required />
            </div>

            <div className="space-y-1">
              <Label htmlFor="rg-evento">Cuándo</Label>
              <select
                id="rg-evento"
                name="evento"
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {eventos.map((e) => (
                  <option key={e.valor} value={e.valor}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <div className="w-32 space-y-1">
                <Label htmlFor="rg-metodo">Método</Label>
                <select
                  id="rg-metodo"
                  name="metodo"
                  defaultValue="POST"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {METODOS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="rg-url">Dirección</Label>
                <Input
                  id="rg-url"
                  name="url"
                  type="url"
                  inputMode="url"
                  placeholder="https://tu-app.com/hook"
                  required
                />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Cabeceras (opcional)</legend>
              <p className="text-caption text-muted-foreground">
                Aquí va la autorización de tu herramienta, si la pide.
              </p>
              {Array.from({ length: cabeceras }, (_, i) => (
                <div key={i} className="flex gap-2">
                  <Input name="cabeceraNombre" placeholder="Authorization" aria-label="Nombre" />
                  <Input name="cabeceraValor" placeholder="Bearer …" aria-label="Valor" />
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCabeceras((n) => n + 1)}
              >
                Añadir otra
              </Button>
            </fieldset>

            <div className="space-y-1">
              <Label htmlFor="rg-cuerpo">Qué mandamos (opcional)</Label>
              <textarea
                id="rg-cuerpo"
                name="cuerpo"
                rows={4}
                placeholder={'{\n  "cliente": "{{cliente.nombre}}"\n}'}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-caption"
              />
              {/*
                Las variables son lo que separa esto de mandar un cuerpo fijo.
                Sin decirlo, nadie las descubre — y con un cuerpo fijo la regla
                avisa de que «pasó algo» sin decir de quién.
              */}
              <p className="text-caption text-muted-foreground">
                Puedes usar variables entre llaves dobles, como{' '}
                <code className="font-mono">{'{{cliente.nombre}}'}</code>. Se sustituyen por los
                datos del evento justo antes de llamar.
              </p>
            </div>

            <Button type="submit" disabled={creando}>
              {creando ? 'Creando…' : 'Crear regla'}
            </Button>
          </form>
        )}

        {reglas.length === 0 ? (
          <p className="text-caption text-muted-foreground">Todavía no has creado ninguna.</p>
        ) : (
          <ul className="space-y-2">
            {reglas.map((r) => {
              const est = ESTADO[r.estado as keyof typeof ESTADO] ?? ESTADO.DRAFT
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 rounded-xl border border-border/60 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3"
                >
                  <span className="font-medium">{r.nombre}</span>
                  <Badge variant={est.variante}>{est.texto}</Badge>
                  <span className="text-caption text-muted-foreground sm:w-full">
                    Cuando ocurre <code className="font-mono">{r.evento}</code> llamamos a{' '}
                    {/*
                      Solo el host. Una dirección de webhook lleva a menudo un
                      token en la ruta o en la query, y esta lista la ve todo el
                      equipo.
                    */}
                    <code className="font-mono">{r.host}</code> · creada el{' '}
                    {formatDateTime(new Date(r.createdAt))}
                  </span>
                  {puedeGestionar && (
                    <span className="flex gap-2 sm:ml-auto">
                      <BotonConfirmado
                        accion={cambiarEstadoReglaAction}
                        estadoInicial={INIT}
                        campos={{
                          id: r.id,
                          estado: r.estado === 'PUBLISHED' ? 'PAUSED' : 'PUBLISHED',
                        }}
                        variant="outline"
                        size="sm"
                        mensajeExito={r.estado === 'PUBLISHED' ? 'Pausada.' : 'Reactivada.'}
                      >
                        {r.estado === 'PUBLISHED' ? 'Pausar' : 'Reactivar'}
                      </BotonConfirmado>
                      <BotonConfirmado
                        accion={archivarReglaAction}
                        estadoInicial={INIT}
                        campos={{ id: r.id }}
                        variant="ghost"
                        size="sm"
                        confirmacion={{
                          titulo: '¿Archivar esta regla?',
                          descripcion:
                            'Dejará de dispararse y desaparecerá de esta lista. El historial de lo que ya llamó se conserva.',
                          textoConfirmar: 'Archivar',
                        }}
                        mensajeExito="Archivada."
                      >
                        Archivar
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
