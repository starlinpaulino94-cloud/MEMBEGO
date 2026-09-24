'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearAcuerdoAction, type EstadoAccion } from '@/modules/supply/actions'
import {
  SUPPLY_MODALIDAD_PAGO_LABELS,
  SUPPLY_MODELO_EXPLICACION,
  SUPPLY_MODELO_LABELS,
  SUPPLY_POLITICA_SOBRANTE_LABELS,
  SUPPLY_TIPOS,
  SUPPLY_TIPO_EJEMPLOS,
  SUPPLY_TIPO_LABELS,
} from '@/modules/supply/catalogo'

interface Proveedor {
  id: string
  nombre: string
  sucursales: { id: string; nombre: string }[]
}

/**
 * MEMBEGO SUPPLY · alta de contrato (Fase 2).
 *
 * El formulario enseña la CONSECUENCIA de cada elección mientras se rellena,
 * no después:
 *
 *  · al elegir el tipo, el ejemplo de esa industria («una pizza», «500
 *    termos») — así queda claro que el modelo no es de comida;
 *  · al elegir el modelo comercial, quién le cobra al cliente. Es la
 *    confusión más cara del dominio y aquí es una línea de texto;
 *  · al escribir cantidad y costo, la inversión total. Nadie debería firmar
 *    RD$300.000 sin verlos escritos.
 */
export function FormAcuerdo({ proveedores }: { proveedores: Proveedor[] }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(crearAcuerdoAction, {})
  const [proveedorId, setProveedorId] = useState(proveedores[0]?.id ?? '')
  const [tipo, setTipo] = useState<(typeof SUPPLY_TIPOS)[number]>('ON_DEMAND')
  const [modelo, setModelo] = useState<'COMPRA_UNIDAD_COMPLETA' | 'SUBSIDIO'>(
    'COMPRA_UNIDAD_COMPLETA'
  )
  const [cantidad, setCantidad] = useState('')
  const [costo, setCosto] = useState('')

  const inversion = Number(cantidad) * Number(costo)
  const sucursales = proveedores.find((p) => p.id === proveedorId)?.sucursales ?? []

  if (proveedores.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ninguna empresa tiene todavía la capacidad <strong>Membego Supply: vender inventario a
        Membego</strong> encendida. Se activa desde{' '}
        <a href="/superadmin/capacidades" className="underline underline-offset-4">
          Capacidades
        </a>
        , sobre la empresa que ya opera como comercio: no hace falta crear una segunda.
      </p>
    )
  }

  return (
    <form action={accion} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="proveedorId">Proveedor</Label>
          <select
            id="proveedorId"
            name="proveedorId"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="tipo">Tipo de supply</Label>
          <select
            id="tipo"
            name="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as (typeof SUPPLY_TIPOS)[number])}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {SUPPLY_TIPOS.map((t) => (
              <option key={t} value={t}>
                {SUPPLY_TIPO_LABELS[t]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-caption text-muted-foreground">{SUPPLY_TIPO_EJEMPLOS[tipo]}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="itemNombre">Qué se compra</Label>
          <Input
            id="itemNombre"
            name="itemNombre"
            required
            maxLength={200}
            placeholder="Pizza Grande Pepperoni"
          />
        </div>
        <div>
          <Label htmlFor="varianteEtiqueta">Variante</Label>
          <Input id="varianteEtiqueta" name="varianteEtiqueta" maxLength={120} placeholder="Grande" />
        </div>
      </div>

      <div>
        <Label htmlFor="modeloComercial">Modelo comercial</Label>
        <select
          id="modeloComercial"
          name="modeloComercial"
          value={modelo}
          onChange={(e) => setModelo(e.target.value as typeof modelo)}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
        >
          {(['COMPRA_UNIDAD_COMPLETA', 'SUBSIDIO'] as const).map((m) => (
            <option key={m} value={m}>
              {SUPPLY_MODELO_LABELS[m]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-caption text-muted-foreground">
          {SUPPLY_MODELO_EXPLICACION[modelo]}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="cantidad">Cantidad</Label>
          <Input
            id="cantidad"
            name="cantidad"
            type="number"
            min={1}
            required
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            placeholder="1000"
          />
        </div>
        <div>
          <Label htmlFor="costoUnitario">Costo Membego</Label>
          <Input
            id="costoUnitario"
            name="costoUnitario"
            type="number"
            min={0}
            step="0.01"
            required
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
            placeholder="300"
          />
        </div>
        <div>
          <Label htmlFor="precioReferencia">Precio público</Label>
          <Input
            id="precioReferencia"
            name="precioReferencia"
            type="number"
            min={0}
            step="0.01"
            placeholder="700"
          />
        </div>
        {modelo === 'SUBSIDIO' && (
          <div>
            <Label htmlFor="aporteMembego">Aporte Membego</Label>
            <Input
              id="aporteMembego"
              name="aporteMembego"
              type="number"
              min={0}
              step="0.01"
              placeholder="300"
            />
          </div>
        )}
      </div>

      {inversion > 0 && (
        <p className="rounded-lg bg-muted/40 p-3 text-sm">
          Inversión total:{' '}
          <strong className="tabular-nums">
            RD${inversion.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </strong>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="inicioAt">Inicio de vigencia</Label>
          <Input id="inicioAt" name="inicioAt" type="date" required />
        </div>
        <div>
          <Label htmlFor="finAt">Fin de vigencia</Label>
          <Input id="finAt" name="finAt" type="date" required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="modalidadPago">Modalidad de pago</Label>
          <select
            id="modalidadPago"
            name="modalidadPago"
            defaultValue="PREPAGO_PARCIAL"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {(Object.keys(SUPPLY_MODALIDAD_PAGO_LABELS) as (keyof typeof SUPPLY_MODALIDAD_PAGO_LABELS)[]).map(
              (m) => (
                <option key={m} value={m}>
                  {SUPPLY_MODALIDAD_PAGO_LABELS[m]}
                </option>
              )
            )}
          </select>
        </div>
        <div>
          <Label htmlFor="anticipoPorcentaje">% de anticipo</Label>
          <Input
            id="anticipoPorcentaje"
            name="anticipoPorcentaje"
            type="number"
            min={1}
            max={99}
            placeholder="30"
          />
        </div>
        <div>
          <Label htmlFor="politicaSobrante">Qué pasa con lo que sobre</Label>
          <select
            id="politicaSobrante"
            name="politicaSobrante"
            defaultValue="EXPIRAR"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {(Object.keys(SUPPLY_POLITICA_SOBRANTE_LABELS) as (keyof typeof SUPPLY_POLITICA_SOBRANTE_LABELS)[]).map(
              (p) => (
                <option key={p} value={p}>
                  {SUPPLY_POLITICA_SOBRANTE_LABELS[p]}
                </option>
              )
            )}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="capacidadDiaria">Máximo por día</Label>
          <Input id="capacidadDiaria" name="capacidadDiaria" type="number" min={1} placeholder="50" />
        </div>
        <div>
          <Label htmlFor="capacidadHoraria">Máximo por hora</Label>
          <Input id="capacidadHoraria" name="capacidadHoraria" type="number" min={1} placeholder="10" />
        </div>
        <div>
          <Label htmlFor="horarioTexto">Horario</Label>
          <Input id="horarioTexto" name="horarioTexto" maxLength={120} placeholder="11:00-22:00" />
        </div>
      </div>

      {sucursales.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium">Sucursales donde se canjea</legend>
          <p className="mb-2 text-caption text-muted-foreground">
            Sin marcar ninguna, vale en todas las del proveedor.
          </p>
          <div className="flex flex-wrap gap-3">
            {sucursales.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="sucursalIds" value={s.id} />
                {s.nombre}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="reglasRedencion">Reglas de redención</Label>
          <Textarea
            id="reglasRedencion"
            name="reglasRedencion"
            rows={3}
            maxLength={2000}
            placeholder="QR de Membego obligatorio. No acumulable con otras promociones."
          />
        </div>
        <div>
          <Label htmlFor="reglasSustitucion">Sustituciones y extras</Label>
          <Textarea
            id="reglasSustitucion"
            name="reglasSustitucion"
            rows={3}
            maxLength={2000}
            placeholder="Sustituciones solo con aprobación. Los extras los paga el cliente."
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pendiente}>
          {pendiente ? 'Creando…' : 'Crear acuerdo en borrador'}
        </Button>
        <span className="text-caption text-muted-foreground">
          Nace en borrador: todavía no compromete nada. Comprar exige aprobar el contrato y después
          una orden de compra con su propio aprobador.
        </span>
      </div>

      {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
      {estado.success && <p className="text-sm text-success">{estado.success}</p>}
    </form>
  )
}
