'use client'

/**
 * Alta de reserva. El total que se ve mientras se llena es un ADELANTO: usa la
 * misma función pura que el servidor, con los precios que el servidor mandó.
 * El importe que se guarda lo recalcula la acción con los precios del catálogo
 * en ese instante — la pantalla informa, no decide (§57).
 */

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearReserva,
  type ReservaActionState,
} from '@/modules/excursiones/reservas/actions'
import { calcularTotales, calcularPrecioEfectivo } from '@/modules/excursiones/reservas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatMoney } from '@/lib/format'

const init: ReservaActionState = {}

export interface ClienteOpcion {
  id: string
  nombre: string
  telefono: string | null
}

export interface ExcursionOpcion {
  id: string
  nombre: string
  moneda: string
  impuestoPct: number | null
  tipoItem?: string
  variantes: { id: string; nombre: string; precioAdulto: number; precioNino: number | null; preciosDinamicos?: any[] }[]
  horarios: { id: string; horaSalida: string; diasSemana: number[] }[]
}

export function ReservaForm({
  clientes,
  excursiones,
}: {
  clientes: ClienteOpcion[]
  excursiones: ExcursionOpcion[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearReserva, init)
  const [excursionId, setExcursionId] = useState(excursiones[0]?.id ?? '')
  const [varianteId, setVarianteId] = useState(excursiones[0]?.variantes[0]?.id ?? '')
  const [hora, setHora] = useState(excursiones[0]?.horarios?.[0]?.horaSalida ?? '')
  const [fecha, setFecha] = useState('')
  const [adultos, setAdultos] = useState('2')
  const [ninos, setNinos] = useState('0')
  const [descuento, setDescuento] = useState('')

  const excursion = excursiones.find((e) => e.id === excursionId) ?? excursiones[0]
  const variante =
    excursion?.variantes.find((v) => v.id === varianteId) ?? excursion?.variantes[0]

  useEffect(() => {
    if (excursion && !excursion.variantes.find((v) => v.id === varianteId)) {
      setVarianteId(excursion.variantes[0]?.id ?? '')
    }
    if (excursion && !excursion.horarios?.find((h) => h.horaSalida === hora)) {
      setHora(excursion.horarios?.[0]?.horaSalida ?? '')
    }
  }, [excursion, varianteId, hora])

  useEffect(() => {
    if (state.creada) {
      toast.success(state.success ?? 'Reserva creada.')
      router.push(`/admin/excursiones/reservas/${state.creada.reservaId}`)
    }
  }, [state, router])

  const totales = useMemo(() => {
    if (!variante) return null
    const fechaObj = fecha ? new Date(`${fecha}T12:00:00.000Z`) : new Date()
    const reglas = variante.preciosDinamicos ?? null
    const { precioAdulto, precioNino } = calcularPrecioEfectivo(fechaObj, hora, variante.precioAdulto, variante.precioNino, reglas)

    return calcularTotales({
      adultos: Number(adultos) || 0,
      ninos: Number(ninos) || 0,
      precioAdulto,
      precioNino,
      descuento: Number(descuento) || 0,
      impuestoPct: excursion?.impuestoPct ?? null,
    })
  }, [variante, adultos, ninos, descuento, excursion, fecha, hora])

  const moneda = excursion?.moneda ?? 'DOP'

  if (excursiones.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Para reservar hace falta al menos una excursión activa con una variante con precio.
          Créala en el catálogo y vuelve aquí.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="res-cliente">Cliente *</Label>
        <select
          id="res-cliente"
          name="clienteId"
          required
          className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
        >
          <option value="">Elige el cliente…</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {c.telefono ? ` · ${c.telefono}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="res-excursion">Excursión *</Label>
          <select
            id="res-excursion"
            name="excursionId"
            value={excursionId}
            onChange={(e) => {
              setExcursionId(e.target.value)
              const nueva = excursiones.find((x) => x.id === e.target.value)
              setVarianteId(nueva?.variantes[0]?.id ?? '')
            }}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            {excursiones.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="res-variante">Variante</Label>
          <select
            id="res-variante"
            name="varianteId"
            value={varianteId}
            onChange={(e) => setVarianteId(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
          >
            {(excursion?.variantes ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre} · {formatMoney(v.precioAdulto, { moneda }, 2)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="res-fecha">Fecha *</Label>
          <Input
            id="res-fecha"
            name="fecha"
            type="date"
            min={new Date().toISOString().split('T')[0]}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="res-hora">Hora de salida</Label>
          <select
            id="res-hora"
            name="hora"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {excursion?.tipoItem === 'PASE_DIA' ? (
              <option value="">Pase de Día — Todo el día / Acceso Libre</option>
            ) : excursion?.horarios?.length > 0 ? (
              excursion.horarios.map((h) => (
                <option key={h.id} value={h.horaSalida}>
                  {h.horaSalida}
                </option>
              ))
            ) : (
              <option value="">Sin horarios (Todo el día)</option>
            )}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="res-adultos">Adultos *</Label>
          <Input
            id="res-adultos"
            name="adultos"
            type="number"
            min="0"
            value={adultos}
            onChange={(e) => setAdultos(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="res-ninos">Niños</Label>
          <Input
            id="res-ninos"
            name="ninos"
            type="number"
            min="0"
            value={ninos}
            onChange={(e) => setNinos(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="res-descuento">Descuento</Label>
          <Input
            id="res-descuento"
            name="descuento"
            type="number"
            min="0"
            step="0.01"
            value={descuento}
            onChange={(e) => setDescuento(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="res-notas">Notas</Label>
        <Input id="res-notas" name="notas" placeholder="Punto de recogida, alergias, equipaje…" />
      </div>

      {totales ? (
        <dl className="rounded-2xl border border-border bg-card p-4 text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-foreground">{formatMoney(totales.subtotal, { moneda }, 2)}</dd>
          </div>
          {totales.descuento > 0 ? (
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Descuento</dt>
              <dd className="text-foreground">−{formatMoney(totales.descuento, { moneda }, 2)}</dd>
            </div>
          ) : null}
          {totales.impuestos > 0 ? (
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Impuestos</dt>
              <dd className="text-foreground">{formatMoney(totales.impuestos, { moneda }, 2)}</dd>
            </div>
          ) : null}
          <div className="mt-1 flex justify-between border-t border-border pt-2">
            <dt className="font-semibold text-foreground">Total</dt>
            <dd className="text-h3 text-foreground">{formatMoney(totales.total, { moneda }, 2)}</dd>
          </div>
        </dl>
      ) : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Crear reserva
      </Button>
    </form>
  )
}
