'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Car, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { agregarVehiculoCliente, type VehiculoActionState } from '@/modules/cliente/vehiculosActions'
import { normalizarPlaca } from '@/modules/onboarding/vehiculo'
import { buscarMarcas, COLORES_FRECUENTES } from '@/modules/onboarding/marcas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * Alta de vehículo en UNA sola pantalla.
 *
 * Obligatorios: placa + categoría. Marca, modelo, año y color son opcionales
 * (el servidor los rellena con defaults) y viajan vacíos si no se tocan.
 * Con `?next=` vuelve exactamente a donde iba (p. ej. /cliente/planes).
 *
 * No hay validación bloqueante en el cliente: todo se envía a la server
 * action y su error se muestra en pantalla (nunca en blanco).
 */

export interface TipoVehiculoOpcion {
  id: string
  nombre: string
  descripcion: string | null
  iconoUrl: string | null
}

const initial: VehiculoActionState = {}

export function AgregarVehiculoWizard({
  tiposVehiculo,
  next,
}: {
  tiposVehiculo: TipoVehiculoOpcion[]
  next: string
}) {
  const router = useRouter()
  const [state, dispatch, pending] = useActionState(agregarVehiculoCliente, initial)
  const handledRef = useRef(false)
  const [marca, setMarca] = useState('')
  const [color, setColor] = useState('')
  const [placa, setPlaca] = useState('')
  const sugerencias = useMemo(() => buscarMarcas(marca), [marca])

  useEffect(() => {
    if (handledRef.current) return
    if (state.success) {
      handledRef.current = true
      toast.success('Vehículo guardado.')
      router.push(next)
      router.refresh()
    }
  }, [state.success, router, next])

  const chip = (activo: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition ${
      activo ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-muted'
    }`

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          {/* noValidate: la validación es la del servidor (mensajes propios). */}
          <form action={dispatch} noValidate className="space-y-5">
            <input type="hidden" name="pais" value="DO" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Registra tu vehículo</h1>

            {state.error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="placa">Placa (obligatorio)</Label>
              <Input
                id="placa"
                name="placa"
                value={placa}
                onChange={(e) => setPlaca(e.target.value)}
                placeholder="p. ej. A123456"
                autoComplete="off"
                aria-required="true"
                className="h-12 text-lg"
              />
              <p className="text-xs text-muted-foreground">
                Con ella identificamos tu vehículo al llegar.
                {placa.trim() && normalizarPlaca(placa) !== placa.trim() && (
                  <> Se guardará como <span className="font-mono">{normalizarPlaca(placa)}</span>.</>
                )}
              </p>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">
                Categoría (obligatorio)
              </legend>
              {tiposVehiculo.length === 1 ? (
                // Una sola categoría activa: preseleccionada y bloqueada.
                // El cliente no elige algo que no tiene alternativa.
                <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                  {tiposVehiculo[0].iconoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tiposVehiculo[0].iconoUrl} alt="" className="h-8 w-8 shrink-0 object-contain" />
                  ) : (
                    <Car className="h-6 w-6 shrink-0 text-primary" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{tiposVehiculo[0].nombre}</p>
                    {tiposVehiculo[0].descripcion && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{tiposVehiculo[0].descripcion}</p>
                    )}
                  </div>
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <input type="hidden" name="tipoVehiculoId" value={tiposVehiculo[0].id} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Categoría del vehículo">
                  {tiposVehiculo.map((tv) => (
                    <label
                      key={tv.id}
                      className="rounded-xl border border-border bg-card p-4 text-left transition has-checked:border-primary has-checked:bg-primary/5 has-checked:ring-2 has-checked:ring-primary hover:bg-muted/50"
                    >
                      <input
                        type="radio"
                        name="tipoVehiculoId"
                        value={tv.id}
                        className="peer sr-only"
                      />
                      {tv.iconoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={tv.iconoUrl} alt="" className="mb-2 h-8 w-8 object-contain" />
                      ) : (
                        <Car className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
                      )}
                      <p className="font-semibold text-foreground">{tv.nombre}</p>
                      {tv.descripcion && <p className="mt-0.5 text-xs text-muted-foreground">{tv.descripcion}</p>}
                      <Check className="mt-1 hidden h-4 w-4 text-primary peer-checked:block" aria-hidden />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
              <legend className="px-1 text-sm font-medium text-foreground">
                Datos opcionales
              </legend>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="marca">Marca (opcional)</Label>
                  <Input
                    id="marca"
                    name="marca"
                    value={marca}
                    onChange={(e) => setMarca(e.target.value)}
                    placeholder="p. ej. Toyota"
                    autoComplete="off"
                    className="h-12 text-lg"
                  />
                  <div className="flex flex-wrap gap-2" aria-label="Marcas sugeridas">
                    {sugerencias.map((m) => (
                      <button key={m} type="button" onClick={() => setMarca(m)} className={chip(marca === m)}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">¿No aparece? Escríbela tal cual — vale cualquier marca.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modelo">Modelo (opcional)</Label>
                  <Input
                    id="modelo"
                    name="modelo"
                    placeholder={marca ? `p. ej. Corolla (${marca})` : 'p. ej. Corolla'}
                    autoComplete="off"
                    className="h-12 text-lg"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="anio">Año (opcional)</Label>
                  <Input
                    id="anio"
                    name="anio"
                    type="number"
                    inputMode="numeric"
                    placeholder={`p. ej. ${new Date().getFullYear()}`}
                    className="h-12 text-lg"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="color">Color (opcional)</Label>
                  <Input
                    id="color"
                    name="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="p. ej. Blanco"
                    autoComplete="off"
                    className="h-12 text-lg"
                  />
                  <div className="flex flex-wrap gap-2" aria-label="Colores frecuentes">
                    {COLORES_FRECUENTES.map((c) => (
                      <button key={c} type="button" onClick={() => setColor(c)} className={chip(color === c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </fieldset>

            <Button type="submit" disabled={pending} className="h-11 w-full px-6">
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar vehículo
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
