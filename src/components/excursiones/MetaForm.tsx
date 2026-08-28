'use client'

/**
 * Poner una meta. Todas las cifras son opcionales salvo que haya al menos una:
 * a un promotor se le pide captar, a un hotel vender — pedirles lo mismo a los
 * dos sería llenar su pantalla de barras que no significan nada.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { crearMeta, type MetaActionState } from '@/modules/excursiones/metricas/actions'
import {
  PERIODOS_META,
  PERIODO_META_LABEL,
  type PeriodoMeta,
} from '@/modules/excursiones/metricas/nucleo'
import { TIPOS_VENDEDOR_SEMILLA } from '@/modules/excursiones/vendedores/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: MetaActionState = {}

export function MetaForm({
  vendedores,
  excursiones = [],
}: {
  vendedores: { id: string; nombre: string; codigo: string }[]
  excursiones?: { id: string; nombre: string; tipoItem?: string }[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearMeta, init)
  const [periodo, setPeriodo] = useState<PeriodoMeta>('MENSUAL')
  const [ambito, setAmbito] = useState<'VENDEDOR' | 'TIPO_VENDEDOR' | 'GENERAL'>('VENDEDOR')
  const [vendedoresSeleccionados, setVendedoresSeleccionados] = useState<string[]>([])
  const [tipoVendedor, setTipoVendedor] = useState<string>(TIPOS_VENDEDOR_SEMILLA[0] || 'Touroperador')

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state, router])

  const toggleVendedor = (id: string) => {
    setVendedoresSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const seleccionarTodos = () => {
    setVendedoresSeleccionados(vendedores.map((v) => v.id))
  }

  const limpiarVendedores = () => {
    setVendedoresSeleccionados([])
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-h3 text-foreground">Nueva meta</h2>

      {/* Ámbito de la Meta */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="meta-ambito">Ámbito de aplicación</Label>
          <select
            id="meta-ambito"
            name="ambito"
            value={ambito}
            onChange={(e) => setAmbito(e.target.value as 'VENDEDOR' | 'TIPO_VENDEDOR' | 'GENERAL')}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            <option value="VENDEDOR">Vendedores específicos</option>
            <option value="TIPO_VENDEDOR">Por tipo de vendedor (ej: Touroperadores)</option>
            <option value="GENERAL">Toda la empresa (Meta global)</option>
          </select>
        </div>

        <div>
          <Label htmlFor="meta-excursion">Producto / Actividad del Catálogo (Opcional)</Label>
          <select
            id="meta-excursion"
            name="excursionId"
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            <option value="">Todo el catálogo (Sin filtrar producto)</option>
            {excursiones.map((e) => (
              <option key={e.id} value={e.id}>
                {e.tipoItem === 'COMBO' ? '📦 [COMBO] ' : '🎯 '} {e.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Selector de Tipo de Vendedor */}
      {ambito === 'TIPO_VENDEDOR' ? (
        <div>
          <Label htmlFor="meta-tipo-vendedor">Tipo de Vendedor *</Label>
          <select
            id="meta-tipo-vendedor"
            name="tipoVendedor"
            value={tipoVendedor}
            onChange={(e) => setTipoVendedor(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            {TIPOS_VENDEDOR_SEMILLA.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Selector múltiple de vendedores */}
      {ambito === 'VENDEDOR' ? (
        <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="font-semibold text-foreground">
              Vendedores ({vendedoresSeleccionados.length} de {vendedores.length} seleccionados)
            </Label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={seleccionarTodos}
                className="text-caption text-primary hover:underline"
              >
                Seleccionar todos
              </button>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                onClick={limpiarVendedores}
                className="text-caption text-muted-foreground hover:underline"
              >
                Limpiar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {vendedores.map((v) => {
              const checked = vendedoresSeleccionados.includes(v.id)
              return (
                <label
                  key={v.id}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    checked
                      ? 'border-primary/40 bg-primary/5 text-foreground font-medium'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      name="vendedorId"
                      value={v.id}
                      checked={checked}
                      onChange={() => toggleVendedor(v.id)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span>{v.nombre}</span>
                  </div>
                  <span className="font-mono text-caption text-muted-foreground">{v.codigo}</span>
                </label>
              )
            })}
          </div>
          {vendedoresSeleccionados.length === 0 ? (
            <p className="text-caption text-warning">
              * Selecciona al menos un vendedor al que asignarle la meta.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="meta-periodo">Período de evaluación</Label>
          <select
            id="meta-periodo"
            name="periodo"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as PeriodoMeta)}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            {PERIODOS_META.map((p) => (
              <option key={p} value={p}>{PERIODO_META_LABEL[p]}</option>
            ))}
          </select>
        </div>

        {periodo === 'RANGO' ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="meta-desde">Desde *</Label>
              <Input id="meta-desde" name="desde" type="date" required />
            </div>
            <div>
              <Label htmlFor="meta-hasta">Hasta *</Label>
              <Input id="meta-hasta" name="hasta" type="date" required />
            </div>
          </div>
        ) : null}
      </div>

      <fieldset className="rounded-xl border border-border p-3">
        <legend className="px-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          Qué se le pide (al menos una)
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="meta-registros">Clientes captados</Label>
            <Input id="meta-registros" name="metaRegistros" type="number" min="1" placeholder="—" />
          </div>
          <div>
            <Label htmlFor="meta-reservas">Reservas</Label>
            <Input id="meta-reservas" name="metaReservas" type="number" min="1" placeholder="—" />
          </div>
          <div>
            <Label htmlFor="meta-ventas">Ventas</Label>
            <Input id="meta-ventas" name="metaVentas" type="number" min="1" placeholder="—" />
          </div>
          <div>
            <Label htmlFor="meta-pasajeros">Pasajeros</Label>
            <Input id="meta-pasajeros" name="metaPasajeros" type="number" min="1" placeholder="—" />
          </div>
          <div>
            <Label htmlFor="meta-ingresos">Ingresos</Label>
            <Input id="meta-ingresos" name="metaIngresos" type="number" min="1" step="0.01" placeholder="—" />
          </div>
        </div>
      </fieldset>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Crear meta
      </Button>
    </form>
  )
}
