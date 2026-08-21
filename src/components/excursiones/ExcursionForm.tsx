'use client'

/**
 * Formulario de excursión (crear y editar). Al CREAR pide además el precio
 * base (que nace como variante «Estándar»); al editar, los precios viven en
 * el editor de variantes. El servidor revalida todo (nucleo.validarExcursion).
 */

import { useActionState, useEffect, useState, useRef, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearExcursion,
  actualizarExcursion,
  type CatalogoActionState,
} from '@/modules/excursiones/catalogo/actions'
import { MONEDAS } from '@/modules/excursiones/catalogo/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { calcularDuracion, calcularHoraRegreso, formatearDuracion } from '@/modules/excursiones/catalogo/nucleo'

const init: CatalogoActionState = {}

export interface ExcursionEditable {
  id: string
  nombre: string
  descripcion: string | null
  duracionMin: number | null
  ubicacion: string | null
  categoria: string | null
  moneda: string
  impuestoPct: unknown
  capacidad: number | null
  puntoSalida: string | null
  horaSalida: string | null
  horaRegreso: string | null
  incluye: string | null
  noIncluye: string | null
  politicas: string | null
}

export function ExcursionForm({ excursion }: { excursion?: ExcursionEditable }) {
  const router = useRouter()
  const accion = excursion ? actualizarExcursion : crearExcursion
  const [state, formAction, pending] = useActionState(accion, init)

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      if (state.excursionId) router.replace(`/admin/excursiones/catalogo/${state.excursionId}`)
      else router.refresh()
    }
  }, [state, router])

  return (
    <form action={formAction} className="space-y-4">
      {excursion ? <input type="hidden" name="excursionId" value={excursion.id} /> : null}

      <div>
        <Label htmlFor="exc-nombre">Nombre *</Label>
        <Input id="exc-nombre" name="nombre" defaultValue={excursion?.nombre ?? ''} placeholder="Ej.: Isla Saona" required />
      </div>
      <div>
        <Label htmlFor="exc-desc">Descripción</Label>
        <Textarea id="exc-desc" name="descripcion" defaultValue={excursion?.descripcion ?? ''} placeholder="Lo que el cliente vive en esta excursión." />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="exc-categoria">Categoría</Label>
          <Input id="exc-categoria" name="categoria" defaultValue={excursion?.categoria ?? ''} placeholder="Playa, aventura…" />
        </div>
        <div className="sm:col-span-2">
          <DuracionInput
            duracionMin={excursion?.duracionMin ?? null}
            horaSalida={excursion?.horaSalida ?? null}
            horaRegreso={excursion?.horaRegreso ?? null}
          />
        </div>
        <div>
          <Label htmlFor="exc-capacidad">Capacidad por salida</Label>
          <Input id="exc-capacidad" name="capacidad" type="number" min="1" defaultValue={excursion?.capacidad ?? ''} />
        </div>
      </div>

      {!excursion ? (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <p className="text-sm font-semibold text-foreground">Precio base (variante «Estándar»)</p>
          <p className="mb-3 text-caption text-muted-foreground">
            Después podrás agregar más variantes (doble, familiar, VIP…) con sus precios.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="exc-precio-adulto">Precio por adulto *</Label>
              <Input id="exc-precio-adulto" name="precioAdulto" type="number" min="0.01" step="0.01" placeholder="80.00" required />
            </div>
            <div>
              <Label htmlFor="exc-precio-nino">Precio por niño</Label>
              <Input id="exc-precio-nino" name="precioNino" type="number" min="0" step="0.01" placeholder="40.00" />
            </div>
            <div>
              <Label htmlFor="exc-moneda">Moneda</Label>
              <select
                id="exc-moneda"
                name="moneda"
                defaultValue="DOP"
                className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
              >
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="exc-moneda">Moneda</Label>
            <select
              id="exc-moneda"
              name="moneda"
              defaultValue={excursion.moneda}
              className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
            >
              {MONEDAS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="exc-impuesto">Impuesto (%)</Label>
            <Input id="exc-impuesto" name="impuestoPct" type="number" min="0" max="100" step="0.01" defaultValue={excursion.impuestoPct != null ? String(excursion.impuestoPct) : ''} />
          </div>
        </div>
      )}
      {!excursion ? <input type="hidden" name="impuestoPct" value="" /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="exc-ubicacion">Ubicación</Label>
          <Input id="exc-ubicacion" name="ubicacion" defaultValue={excursion?.ubicacion ?? ''} placeholder="Bayahíbe, La Romana" />
        </div>
        <div>
          <Label htmlFor="exc-punto">Punto de salida</Label>
          <Input id="exc-punto" name="puntoSalida" defaultValue={excursion?.puntoSalida ?? ''} placeholder="Muelle de Bayahíbe" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="exc-hsalida">Hora de salida</Label>
          <Input id="exc-hsalida" name="horaSalida" type="time" defaultValue={excursion?.horaSalida ?? ''} />
        </div>
        <div>
          <Label htmlFor="exc-hregreso">Hora estimada de regreso</Label>
          <Input id="exc-hregreso" name="horaRegreso" type="time" defaultValue={excursion?.horaRegreso ?? ''} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="exc-incluye">Incluye</Label>
          <Textarea id="exc-incluye" name="incluye" defaultValue={excursion?.incluye ?? ''} placeholder="Transporte, almuerzo, bebidas…" />
        </div>
        <div>
          <Label htmlFor="exc-noincluye">No incluye</Label>
          <Textarea id="exc-noincluye" name="noIncluye" defaultValue={excursion?.noIncluye ?? ''} placeholder="Propinas, fotos…" />
        </div>
      </div>
      <div>
        <Label htmlFor="exc-politicas">Políticas y condiciones</Label>
        <Textarea id="exc-politicas" name="politicas" defaultValue={excursion?.politicas ?? ''} placeholder="Cancelaciones, menores, qué llevar…" />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {excursion ? 'Guardar cambios' : 'Crear excursión'}
      </Button>
    </form>
  )
}

function DuracionInput({
  duracionMin,
  horaSalida,
  horaRegreso,
}: {
  duracionMin: number | null
  horaSalida: string | null
  horaRegreso: string | null
}) {
  const [duracion, setDuracion] = useState<number | null>(duracionMin)
  const [hSalida, setHSalida] = useState<string>(horaSalida ?? '')
  const [hRegreso, setHRegreso] = useState<string>(horaRegreso ?? '')

  // Refs para evitar bucles infinitos
  /**
   * DURACIÓN Y HORAS: se sincronizan al ESCRIBIR, no con efectos.
   *
   * Antes eran dos `useEffect` que se escuchaban entre sí —duración escribía
   * la hora de regreso, la hora de regreso escribía la duración— y cada uno
   * llevaba un `useRef` de «me toca a mí saltarme este turno» para no
   * rebotarse. Ese es el diseño que produjo el bucle infinito del último
   * commit de esta rama; el ref lo tapa mientras el orden de los renders
   * coopere, y deja de taparlo en cuanto no.
   *
   * Aquí el modelo es explícito: los tres campos son la misma información
   * (salida + duración = regreso), así que EL QUE SE TOCA manda y los otros se
   * recalculan en ese mismo momento. Sin efectos no hay ciclo posible, y el
   * usuario puede seguir editando cualquiera de los tres.
   */
  const enMinutos = (hhmm: string): number | null => {
    const [h, m] = hhmm.split(':').map(Number)
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
  }

  const aHora = (minutos: number): string => {
    const total = ((minutos % (24 * 60)) + 24 * 60) % (24 * 60)
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  /** Minutos entre dos horas, cruzando la medianoche si hace falta. */
  const diferencia = (desde: number, hasta: number): number => {
    const diff = hasta - desde
    return diff < 0 ? diff + 24 * 60 : diff
  }

  const alCambiarDuracion = (valor: number | null) => {
    setDuracion(valor)
    const ini = hSalida ? enMinutos(hSalida) : null
    if (valor !== null && ini !== null) setHRegreso(aHora(ini + valor))
  }

  const alCambiarSalida = (valor: string) => {
    setHSalida(valor)
    const ini = enMinutos(valor)
    if (ini === null) return
    // Con una duración puesta, mover la salida mueve el regreso. Si no la hay
    // pero sí un regreso, lo que queda determinado es la duración.
    if (duracion !== null) setHRegreso(aHora(ini + duracion))
    else if (hRegreso) {
      const fin = enMinutos(hRegreso)
      if (fin !== null) setDuracion(diferencia(ini, fin))
    }
  }

  const alCambiarRegreso = (valor: string) => {
    setHRegreso(valor)
    const ini = hSalida ? enMinutos(hSalida) : null
    const fin = enMinutos(valor)
    if (ini !== null && fin !== null) setDuracion(diferencia(ini, fin))
  }

  const formatear = (min: number) => {
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h === 0) return `${m}m`
    if (min % 60 === 0) return `${min / 60}h`
    return `${Math.floor(min / 60)}h ${min % 60}m`
  }

  return (
    <Fragment>
      <div className="space-y-3">
      <Label htmlFor="exc-duracion">Duración</Label>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Label htmlFor="exc-duracion" className="text-sm font-medium">
            Duración ({duracion !== null ? formatear(duracion) : '—'})
          </Label>
          <Input
            id="exc-duracion"
            name="duracionMin"
            type="number"
            min="1"
            step="30"
            value={duracion ?? ''}
            onChange={(e) => {
              alCambiarDuracion(e.target.value ? Number(e.target.value) : null)
            }}
            placeholder="Ej: 120"
          />
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {duracion !== null ? `≈ ${formatear(duracion)}` : ''}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="exc-hsalida">Hora de salida</Label>
          <Input
            id="exc-hsalida"
            name="horaSalida"
            type="time"
            value={hSalida}
            onChange={(e) => alCambiarSalida(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="exc-hregreso">Hora estimada de regreso</Label>
          <Input
            id="exc-hregreso"
            name="horaRegreso"
            type="time"
            value={hRegreso}
            onChange={(e) => alCambiarRegreso(e.target.value)}
          />
        </div>
      </div>
    </div>
    </Fragment>
  )
}
