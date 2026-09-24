'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  crearOrdenAction,
  enmendarAcuerdoAction,
  moverAcuerdoAction,
  type EstadoAccion,
} from '@/modules/supply/actions'
import { SUPPLY_ACUERDO_ESTADO_LABELS } from '@/modules/supply/catalogo'

interface Props {
  acuerdoId: string
  estadosPosibles: string[]
  puedeComprar: boolean
  itemNombre: string
  cantidadSugerida: number
  costoSugerido: number
  lotes: { id: string; codigo: string }[]
  finAt: string
}

/**
 * MEMBEGO SUPPLY · las tres acciones sobre un contrato.
 *
 * Están juntas porque son las tres respuestas posibles a «¿y ahora qué?» en la
 * ficha de un acuerdo: moverlo de estado, comprar contra él o enmendarlo. La
 * alternativa —tres pantallas distintas— obliga a recordar en cuál estaba la
 * que hace falta.
 *
 * Solo se ofrecen los estados que la máquina permite desde el actual: un botón
 * «Activar» sobre un borrador sin aprobar es un botón que contesta un error.
 */
export function AccionesAcuerdo({
  acuerdoId,
  estadosPosibles,
  puedeComprar,
  itemNombre,
  cantidadSugerida,
  costoSugerido,
  lotes,
  finAt,
}: Props) {
  const [estadoMover, accionMover, moviendo] = useActionState<EstadoAccion, FormData>(
    moverAcuerdoAction,
    {}
  )
  const [estadoOrden, accionOrden, creandoOrden] = useActionState<EstadoAccion, FormData>(
    crearOrdenAction,
    {}
  )
  const [estadoEnm, accionEnm, enmendando] = useActionState<EstadoAccion, FormData>(
    enmendarAcuerdoAction,
    {}
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ciclo de vida</CardTitle>
        </CardHeader>
        <CardContent>
          {estadosPosibles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este contrato llegó al final de su vida: ya no se mueve.
            </p>
          ) : (
            <form action={accionMover} className="space-y-3">
              <input type="hidden" name="acuerdoId" value={acuerdoId} />
              <Label htmlFor="estado">Pasar a</Label>
              <select
                id="estado"
                name="estado"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              >
                {estadosPosibles.map((e) => (
                  <option key={e} value={e}>
                    {SUPPLY_ACUERDO_ESTADO_LABELS[e as keyof typeof SUPPLY_ACUERDO_ESTADO_LABELS] ??
                      e}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" disabled={moviendo}>
                {moviendo ? 'Aplicando…' : 'Aplicar'}
              </Button>
              {estadoMover.error && (
                <p className="text-caption text-destructive">{estadoMover.error}</p>
              )}
              {estadoMover.success && (
                <p className="text-caption text-success">{estadoMover.success}</p>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Orden de compra</CardTitle>
        </CardHeader>
        <CardContent>
          {!puedeComprar ? (
            <p className="text-sm text-muted-foreground">
              Aprueba el contrato antes de comprar contra él.
            </p>
          ) : (
            <form action={accionOrden} className="space-y-3">
              <input type="hidden" name="acuerdoId" value={acuerdoId} />
              <input type="hidden" name="lineaItem" value={itemNombre} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="lineaCantidad">Cantidad</Label>
                  <Input
                    id="lineaCantidad"
                    name="lineaCantidad"
                    type="number"
                    min={1}
                    defaultValue={cantidadSugerida}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="lineaCosto">Costo unitario</Label>
                  <Input
                    id="lineaCosto"
                    name="lineaCosto"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={costoSugerido}
                    required
                  />
                </div>
              </div>
              <Button type="submit" size="sm" disabled={creandoOrden}>
                {creandoOrden ? 'Creando…' : 'Crear orden en borrador'}
              </Button>
              <p className="text-caption text-muted-foreground">
                La orden nace en borrador. Para que el supply exista hay que aprobarla —con un
                aprobador distinto de quien la creó—, confirmarla y activarla.
              </p>
              {estadoOrden.error && (
                <p className="text-caption text-destructive">{estadoOrden.error}</p>
              )}
              {estadoOrden.success && (
                <p className="text-caption text-success">{estadoOrden.success}</p>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enmendar</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={accionEnm} className="space-y-3">
            <input type="hidden" name="acuerdoId" value={acuerdoId} />
            <div>
              <Label htmlFor="campo">Qué se cambia</Label>
              <select
                id="campo"
                name="campo"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              >
                <option value="VIGENCIA">Extender la vigencia</option>
                <option value="CANTIDAD">Añadir unidades</option>
                <option value="CAPACIDAD">Cambiar capacidad</option>
                <option value="SUCURSALES">Añadir sucursal</option>
                <option value="SUSTITUCION">Producto sustituto</option>
                <option value="POLITICA">Política de sobrantes</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="nuevoFinAt">Nueva fecha fin</Label>
                <Input id="nuevoFinAt" name="nuevoFinAt" type="date" defaultValue={finAt} />
              </div>
              <div>
                <Label htmlFor="unidadesExtra">Unidades extra</Label>
                <Input id="unidadesExtra" name="unidadesExtra" type="number" min={1} />
              </div>
            </div>

            {lotes.length > 0 && (
              <div>
                <Label htmlFor="loteId">Sobre qué lote</Label>
                <select
                  id="loteId"
                  name="loteId"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">—</option>
                  {lotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.codigo}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label htmlFor="motivo">Motivo</Label>
              <Textarea id="motivo" name="motivo" rows={2} required maxLength={1000} />
            </div>

            <Button type="submit" size="sm" variant="secondary" disabled={enmendando}>
              {enmendando ? 'Registrando…' : 'Registrar enmienda'}
            </Button>
            {estadoEnm.error && <p className="text-caption text-destructive">{estadoEnm.error}</p>}
            {estadoEnm.success && <p className="text-caption text-success">{estadoEnm.success}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
