'use client'

/**
 * Alta de una regla de comisión. El formulario solo pide lo que el ámbito
 * elegido necesita: preguntar por una excursión en una regla general es
 * ofrecer un dato que después se descarta en el servidor.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearRegla,
  type ComisionActionState,
} from '@/modules/excursiones/comisiones/actions'
import {
  AMBITOS_REGLA,
  AMBITO_REGLA_LABEL,
  TIPOS_CALCULO,
  TIPO_CALCULO_LABEL,
  type AmbitoRegla,
  type TipoCalculo,
} from '@/modules/excursiones/comisiones/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: ComisionActionState = {}

export function ReglaComisionForm({
  excursiones,
  vendedores,
}: {
  excursiones: { id: string; nombre: string }[]
  vendedores: { id: string; nombre: string; codigo: string }[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearRegla, init)
  const [ambito, setAmbito] = useState<AmbitoRegla>('GENERAL')
  const [tipoCalculo, setTipoCalculo] = useState<TipoCalculo>('PORCENTAJE')
  const [escalones, setEscalones] = useState([{ desde: '1', hasta: '', pct: '' }])

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state, router])

  const pideExcursion = ambito === 'EXCURSION' || ambito === 'VENDEDOR_EXCURSION'
  const pideVendedor = ambito === 'VENDEDOR' || ambito === 'VENDEDOR_EXCURSION'
  const pideCategoria = ambito === 'CATEGORIA'

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-h3 text-foreground">Nueva regla</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rc-ambito">¿A qué se aplica?</Label>
          <select
            id="rc-ambito"
            name="ambito"
            value={ambito}
            onChange={(e) => setAmbito(e.target.value as AmbitoRegla)}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            {AMBITOS_REGLA.map((a) => (
              <option key={a} value={a}>{AMBITO_REGLA_LABEL[a]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="rc-tipo">¿Cómo se calcula?</Label>
          <select
            id="rc-tipo"
            name="tipoCalculo"
            value={tipoCalculo}
            onChange={(e) => setTipoCalculo(e.target.value as TipoCalculo)}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            {TIPOS_CALCULO.map((t) => (
              <option key={t} value={t}>{TIPO_CALCULO_LABEL[t]}</option>
            ))}
          </select>
        </div>
      </div>

      {pideExcursion ? (
        <div>
          <Label htmlFor="rc-excursion">Excursión</Label>
          <select
            id="rc-excursion"
            name="excursionId"
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            <option value="">Elige la excursión…</option>
            {excursiones.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        </div>
      ) : null}

      {pideVendedor ? (
        <div>
          <Label htmlFor="rc-vendedor">Vendedor</Label>
          <select
            id="rc-vendedor"
            name="vendedorId"
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            <option value="">Elige el vendedor…</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>{v.nombre} ({v.codigo})</option>
            ))}
          </select>
        </div>
      ) : null}

      {pideCategoria ? (
        <div>
          <Label htmlFor="rc-categoria">Categoría</Label>
          <Input id="rc-categoria" name="categoria" placeholder="La misma que pusiste en la excursión" />
        </div>
      ) : null}

      {tipoCalculo === 'ESCALON' ? (
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Escalones por pasajeros
          </legend>
          <div className="space-y-2">
            {escalones.map((e, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor={`esc-desde-${i}`} className="text-caption">Desde</Label>
                  <Input
                    id={`esc-desde-${i}`}
                    name="escalonDesde"
                    type="number"
                    min="1"
                    value={e.desde}
                    onChange={(ev) =>
                      setEscalones((xs) =>
                        xs.map((x, j) => (j === i ? { ...x, desde: ev.target.value } : x))
                      )
                    }
                    className="h-9 w-24"
                  />
                </div>
                <div>
                  <Label htmlFor={`esc-hasta-${i}`} className="text-caption">Hasta</Label>
                  <Input
                    id={`esc-hasta-${i}`}
                    name="escalonHasta"
                    type="number"
                    min="1"
                    value={e.hasta}
                    onChange={(ev) =>
                      setEscalones((xs) =>
                        xs.map((x, j) => (j === i ? { ...x, hasta: ev.target.value } : x))
                      )
                    }
                    placeholder="sin tope"
                    className="h-9 w-24"
                  />
                </div>
                <div>
                  <Label htmlFor={`esc-pct-${i}`} className="text-caption">%</Label>
                  <Input
                    id={`esc-pct-${i}`}
                    name="escalonPct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={e.pct}
                    onChange={(ev) =>
                      setEscalones((xs) =>
                        xs.map((x, j) => (j === i ? { ...x, pct: ev.target.value } : x))
                      )
                    }
                    className="h-9 w-20"
                  />
                </div>
                {escalones.length > 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Quitar escalón ${i + 1}`}
                    onClick={() => setEscalones((xs) => xs.filter((_, j) => j !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 gap-1.5"
            onClick={() => setEscalones((xs) => [...xs, { desde: '', hasta: '', pct: '' }])}
          >
            <Plus className="h-3.5 w-3.5" /> Añadir escalón
          </Button>
        </fieldset>
      ) : (
        <div>
          <Label htmlFor="rc-valor">
            {tipoCalculo === 'PORCENTAJE' ? 'Porcentaje' : 'Monto'}
          </Label>
          <Input
            id="rc-valor"
            name="valor"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder={tipoCalculo === 'PORCENTAJE' ? '10' : '250.00'}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rc-desde">Vigente desde</Label>
          <Input id="rc-desde" name="vigenciaDesde" type="date" />
        </div>
        <div>
          <Label htmlFor="rc-hasta">Vigente hasta</Label>
          <Input id="rc-hasta" name="vigenciaHasta" type="date" />
        </div>
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Crear regla
      </Button>
    </form>
  )
}
