'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearReservaVendedor,
  type ReservaVendedorState,
} from '@/modules/excursiones/reservas/vendedor-actions'
import { calcularTotales } from '@/modules/excursiones/reservas/nucleo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatMoney } from '@/lib/format'

const init: ReservaVendedorState = {}

export interface ExcursionOpcion {
  id: string
  nombre: string
  moneda: string
  impuestoPct: number | null
  variantes: { id: string; nombre: string; precioAdulto: number; precioNino: number | null }[]
  horarios: { id: string; horaSalida: string; diasSemana: number[] }[]
}

export function ReservaVendedorForm({
  excursiones,
  companyId,
}: {
  excursiones: ExcursionOpcion[]
  companyId: string
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(crearReservaVendedor, init)
  const [excursionId, setExcursionId] = useState(excursiones[0]?.id ?? '')
  const [varianteId, setVarianteId] = useState(excursiones[0]?.variantes[0]?.id ?? '')
  const [hora, setHora] = useState(excursiones[0]?.horarios?.[0]?.horaSalida ?? '')
  const [adultos, setAdultos] = useState('2')
  const [ninos, setNinos] = useState('0')

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
    if (state.success) {
      toast.success(state.success)
      // Dar tiempo para que el usuario lea el mensaje de éxito antes de redirigir
      const timer = setTimeout(() => {
        router.push('/vendedor/reservas')
        router.refresh()
      }, 2500)
      return () => clearTimeout(timer)
    }
  }, [state, router])

  const totales = useMemo(() => {
    if (!variante) return null
    return calcularTotales({
      precioAdulto: variante.precioAdulto,
      precioNino: variante.precioNino,
      impuestoPct: excursion.impuestoPct ?? 0,
      adultos: Number(adultos) || 0,
      ninos: Number(ninos) || 0,
      descuentoFijo: 0,
    })
  }, [variante, excursion.impuestoPct, adultos, ninos])

  if (excursiones.length === 0) {
    return (
      <Alert>
        <AlertDescription>No hay excursiones activas en esta empresa.</AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={formAction} className="space-y-8 rounded-2xl border bg-card p-6">
      <input type="hidden" name="companyId" value={companyId} />
      
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state.success && (
        <Alert className="bg-green-50 text-green-900 border-green-200">
          <AlertDescription>{state.success}</AlertDescription>
        </Alert>
      )}

      {/* SECCIÓN 1: DATOS DEL CLIENTE */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold">Datos del cliente</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Si el cliente ya existe se usará su cuenta. De lo contrario, se creará una cuenta nueva y se le enviará un correo para acceder.
        </p>
        
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="clienteNombre">Nombre del cliente *</Label>
            <Input id="clienteNombre" name="clienteNombre" required placeholder="Ej: Juan Pérez" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clienteEmail">Correo electrónico *</Label>
            <Input id="clienteEmail" name="clienteEmail" type="email" required placeholder="juan@ejemplo.com" />
          </div>
        </div>
      </div>

      {/* SECCIÓN 2: EXCURSIÓN */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold">Excursión</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="excursionId">Excursión *</Label>
            <select
              id="excursionId"
              name="excursionId"
              value={excursionId}
              onChange={(e) => setExcursionId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              {excursiones.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="varianteId">Opción (Variante) *</Label>
            <select
              id="varianteId"
              name="varianteId"
              value={varianteId}
              onChange={(e) => setVarianteId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              {excursion.variantes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre} ({formatMoney(v.precioAdulto, { moneda: excursion.moneda })})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* SECCIÓN 3: FECHA Y PASAJEROS */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold">Fecha y pasajeros</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fecha">Fecha de salida *</Label>
            <Input id="fecha" name="fecha" type="date" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hora">Hora de salida *</Label>
            <select
              id="hora"
              name="hora"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              {excursion.horarios?.length > 0 ? (
                excursion.horarios.map((h) => (
                  <option key={h.id} value={h.horaSalida}>
                    {h.horaSalida}
                  </option>
                ))
              ) : (
                <option value="">Sin horarios disponibles</option>
              )}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adultos">Adultos *</Label>
            <Input
              id="adultos"
              name="adultos"
              type="number"
              min="1"
              value={adultos}
              onChange={(e) => setAdultos(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ninos">Niños</Label>
            <Input
              id="ninos"
              name="ninos"
              type="number"
              min="0"
              value={ninos}
              onChange={(e) => setNinos(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* SECCIÓN 4: EXTRAS */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="notas">Notas / Solicitudes especiales (opcional)</Label>
          <Input id="notas" name="notas" placeholder="Ej: Alergias, solicitudes de recogida..." />
        </div>
      </div>

      {/* SECCIÓN 5: TOTALES (Solo lectura) */}
      <div className="rounded-lg bg-muted/50 p-4">
        <h4 className="mb-2 font-semibold text-muted-foreground">Resumen de costos</h4>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatMoney(totales?.subtotal ?? 0, { moneda: excursion.moneda })}</span>
          </div>
          <div className="flex justify-between">
            <span>Impuestos ({excursion.impuestoPct ?? 0}%)</span>
            <span>{formatMoney(totales?.impuestos ?? 0, { moneda: excursion.moneda })}</span>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-foreground">
            <span>Total a pagar</span>
            <span>{formatMoney(totales?.total ?? 0, { moneda: excursion.moneda })}</span>
          </div>
        </div>
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Crear Reserva y Enviar Acceso al Cliente
      </Button>
    </form>
  )
}
