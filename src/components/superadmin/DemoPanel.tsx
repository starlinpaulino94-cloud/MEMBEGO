'use client'

/**
 * Centro de las empresas de DEMOSTRACIÓN.
 *
 * Tres cosas por empresa, y en este orden por una razón:
 *   1. EL ENLACE, arriba y copiable de un toque. Es lo que se usa cada vez que
 *      empieza un entrenamiento; todo lo demás se usa una vez al mes.
 *   2. Reiniciar, con confirmación escrita y el inventario de lo que se lleva
 *      por delante a la vista ANTES de escribirla.
 *   3. Convertir en real, la operación rara, la última y la que puede negarse.
 */

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { Check, Copy, FlaskConical, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { marcarComoDemo, reiniciarDemo, type DemoState } from '@/modules/demo/actions'
import type { InventarioDemo } from '@/modules/demo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface EmpresaDemoUI {
  id: string
  name: string
  slug: string
  clientes: number
  enlaceRegistro: string
  inventario: InventarioDemo
}

const init: DemoState = {}

function Enviar({ children, variant }: { children: React.ReactNode; variant?: 'destructive' | 'outline' }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  )
}

export function DemoPanel({ empresas }: { empresas: EmpresaDemoUI[] }) {
  if (empresas.length === 0) {
    return (
      <Card className="border-border/60 shadow-card">
        <CardContent className="py-10 text-center">
          <FlaskConical className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">Todavía no hay empresas de práctica.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Crea una y compártele el enlace de registro a tu personal: podrán hacer el recorrido
            completo —registrar clientes, vender, cobrar, canjear— sin que nada de eso sea real.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {empresas.map((e) => (
        <TarjetaDemo key={e.id} e={e} />
      ))}
    </div>
  )
}

function TarjetaDemo({ e }: { e: EmpresaDemoUI }) {
  const [reinicio, accionReinicio] = useActionState(reiniciarDemo, init)
  const [marca, accionMarca] = useActionState(marcarComoDemo, init)

  useEffect(() => {
    if (reinicio.success) toast.success(reinicio.mensaje ?? 'Empresa reiniciada.')
    if (reinicio.error) toast.error(reinicio.error)
  }, [reinicio])

  useEffect(() => {
    if (marca.success) toast.success(marca.mensaje ?? 'Marca actualizada.')
    if (marca.error) toast.error(marca.error)
  }, [marca])

  const total = Object.values(e.inventario).reduce((s, n) => s + n, 0)

  return (
    <Card className="border-amber-500/30 shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-amber-500" />
          {e.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EnlaceRegistro url={e.enlaceRegistro} />

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Datos de práctica acumulados
          </p>
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">Limpia — lista para el siguiente grupo.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {(
                [
                  ['clientes', 'clientes'],
                  ['membresias', 'membresías'],
                  ['compras', 'compras'],
                  ['transacciones', 'cobros'],
                  ['colaVehiculos', 'vehículos en pista'],
                  ['incidencias', 'incidencias'],
                  ['turnos', 'turnos'],
                ] as [keyof InventarioDemo, string][]
              )
                .filter(([k]) => e.inventario[k] > 0)
                .map(([k, etiqueta]) => (
                  <li
                    key={k}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {e.inventario[k]} {etiqueta}
                  </li>
                ))}
            </ul>
          )}
        </div>

        {/* Reiniciar */}
        <form action={accionReinicio} className="space-y-2 rounded-xl border border-border/70 p-3">
          <input type="hidden" name="companyId" value={e.id} />
          <p className="text-sm font-medium text-foreground">Dejarla lista para el siguiente grupo</p>
          <p className="text-xs text-muted-foreground">
            Borra los {total} registro(s) de práctica de arriba. Conserva la configuración: planes,
            promociones, servicios, precios, empleados y capacidades se quedan como están.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              name="confirmacion"
              placeholder="Escribe REINICIAR"
              className="h-9 max-w-[190px]"
              autoComplete="off"
            />
            <Enviar variant="destructive">
              <RotateCcw className="mr-1.5 h-4 w-4" /> Reiniciar
            </Enviar>
          </div>
        </form>

        {/* Convertir en real */}
        <form action={accionMarca} className="flex flex-wrap items-center justify-between gap-2">
          <input type="hidden" name="companyId" value={e.id} />
          <input type="hidden" name="activar" value="0" />
          <p className="text-xs text-muted-foreground">
            {total === 0
              ? 'Está vacía: puede convertirse en una empresa real.'
              : 'Para convertirla en real hay que reiniciarla primero.'}
          </p>
          <Enviar variant="outline">
            <ShieldCheck className="mr-1.5 h-4 w-4" /> Convertir en real
          </Enviar>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * El enlace, en grande y copiable.
 *
 * El texto se guarda en estado y el "Copiado" se apaga solo: sin la
 * confirmación visible, en un celular no hay forma de saber si el toque
 * funcionó, y la gente lo copia tres veces.
 */
function EnlaceRegistro({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar. Selecciona el enlace a mano.')
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Enlace de registro para el entrenamiento
      </p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
          {url}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={copiar} className="shrink-0">
          {copiado ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Quien se registre por aquí es un cliente de práctica: sus datos y sus cobros existen solo
        dentro de esta empresa.
      </p>
    </div>
  )
}
