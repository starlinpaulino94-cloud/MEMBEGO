'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FormSection, FormActions } from '@/components/ui/form-section'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  crearCampanaAction,
  actualizarCampanaAction,
  type ActionState,
} from '@/modules/geo/segmentacion/actions'
import type { CampanaCanal } from '@prisma/client'

/**
 * Formulario de campaña dirigida (docs/GEOLOCALIZACION.md §25-28): audiencia
 * por segmento guardado o por radio de sucursal (excluyentes), canales
 * in-app/email y controles de frecuencia.
 */

interface SegmentoOp {
  id: string
  nombre: string
}

interface SucursalOp {
  id: string
  nombre: string
  radioServicioKm: number
}

interface Props {
  segmentos: SegmentoOp[]
  sucursales: SucursalOp[]
  campanaId?: string
  initial?: {
    nombre?: string
    mensaje?: string
    canales?: CampanaCanal[]
    programadaEn?: string | null
    maxPorDia?: number | null
    maxPorSemana?: number | null
    prioridad?: number
    segmentoId?: string | null
    sucursalId?: string | null
    radioKm?: number | null
  }
}

export default function CampanaForm({ segmentos, sucursales, campanaId, initial }: Props) {
  const router = useRouter()
  const action = campanaId ? actualizarCampanaAction : crearCampanaAction
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {})

  const [nombre, setNombre] = useState(initial?.nombre ?? '')
  const [mensaje, setMensaje] = useState(initial?.mensaje ?? '')
  const [canales, setCanales] = useState<CampanaCanal[]>(initial?.canales ?? ['IN_APP'])
  const [modo, setModo] = useState<'segmento' | 'radio'>(
    initial?.sucursalId ? 'radio' : 'segmento'
  )
  const [segmentoId, setSegmentoId] = useState(initial?.segmentoId ?? '')
  const [sucursalId, setSucursalId] = useState(initial?.sucursalId ?? '')
  const [radioKm, setRadioKm] = useState(initial?.radioKm ?? 3)
  const [maxPorDia, setMaxPorDia] = useState(initial?.maxPorDia ?? 1)
  const [maxPorSemana, setMaxPorSemana] = useState(initial?.maxPorSemana ?? 2)
  const [programadaEn, setProgramadaEn] = useState(initial?.programadaEn ?? '')
  const [prioridad, setPrioridad] = useState(initial?.prioridad ?? 0)

  function onFormAction(formData: FormData) {
    formData.set('nombre', nombre)
    formData.set('mensaje', mensaje)
    formData.set('canales', JSON.stringify(canales))
    formData.set('maxPorDia', String(maxPorDia))
    formData.set('maxPorSemana', String(maxPorSemana))
    formData.set('prioridad', String(prioridad))
    if (modo === 'segmento') {
      formData.set('segmentoId', segmentoId)
      formData.set('sucursalId', '')
      formData.set('radioKm', '')
    } else {
      formData.set('segmentoId', '')
      formData.set('sucursalId', sucursalId)
      formData.set('radioKm', String(radioKm))
    }
    formData.set('programadaEn', programadaEn || '')
    formAction(formData)
  }

  function toggleCanal(canal: CampanaCanal) {
    setCanales((prev) =>
      prev.includes(canal) ? prev.filter((c) => c !== canal) : [...prev, canal]
    )
  }

  return (
    // §49 · Las secciones siguen el orden en que se piensa una campaña: qué
    // digo → a quién → cuándo. Antes eran tarjetas sueltas sin nombre, así que
    // "Audiencia" era el único bloque que se anunciaba y el resto había que
    // deducirlo mirando los campos.
    <form action={onFormAction} className="max-w-2xl space-y-8">
      <FormSection
        title="Contenido"
        description="Qué le llega al cliente y por dónde."
      >
          <div>
            <Label htmlFor="nombre">Nombre de la campaña</Label>
            <Input
              id="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Bienvenida a clientes de Punta Cana"
              maxLength={120}
            />
          </div>
          <div>
            <Label htmlFor="mensaje">Mensaje</Label>
            <Textarea
              id="mensaje"
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="Lo que verá el cliente en la notificación y el correo."
              rows={3}
              maxLength={600}
            />
          </div>
          <div>
            <Label>Canales</Label>
            <div className="flex gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={canales.includes('IN_APP')}
                  onChange={() => toggleCanal('IN_APP')}
                />
                Notificación in-app
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={canales.includes('EMAIL')}
                  onChange={() => toggleCanal('EMAIL')}
                />
                Email
              </label>
            </div>
          </div>
      </FormSection>

      <FormSection
        title="Audiencia"
        description="A quién llega. Un segmento guardado, o todos los clientes en un radio alrededor de una sucursal."
      >
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={modo === 'segmento'}
                onChange={() => setModo('segmento')}
              />
              Segmento guardado
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={modo === 'radio'} onChange={() => setModo('radio')} />
              Radio alrededor de una sucursal
            </label>
          </div>

          {modo === 'segmento' ? (
            <div>
              <Label htmlFor="segmentoId">Segmento</Label>
              <select
                id="segmentoId"
                className="w-full rounded border bg-background px-2 py-1 text-sm"
                value={segmentoId}
                onChange={(e) => setSegmentoId(e.target.value)}
              >
                <option value="">Seleccionar segmento…</option>
                {segmentos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px]">
                <Label htmlFor="sucursalId">Sucursal</Label>
                <select
                  id="sucursalId"
                  className="w-full rounded border bg-background px-2 py-1 text-sm"
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                >
                  <option value="">Seleccionar sucursal…</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="radioKm">Radio (km)</Label>
                <Input
                  id="radioKm"
                  type="number"
                  min={1}
                  max={200}
                  value={radioKm}
                  onChange={(e) => setRadioKm(Number(e.target.value))}
                  className="w-24"
                />
              </div>
            </div>
          )}
      </FormSection>

      <FormSection
        title="Frecuencia"
        description="Cuántos envíos tolera un cliente antes de que la campaña deje de ayudar."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="maxPorDia">Máximo por día</Label>
            <Input
              id="maxPorDia"
              type="number"
              min={1}
              value={maxPorDia}
              onChange={(e) => setMaxPorDia(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="maxPorSemana">Máximo por semana</Label>
            <Input
              id="maxPorSemana"
              type="number"
              min={1}
              value={maxPorSemana}
              onChange={(e) => setMaxPorSemana(Number(e.target.value))}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Programación" description="Cuándo sale y con qué prioridad.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="programadaEn">Programar para</Label>
            <Input
              id="programadaEn"
              type="datetime-local"
              value={programadaEn}
              onChange={(e) => setProgramadaEn(e.target.value)}
            />
            <p className="mt-1 text-caption">Opcional. Sin fecha, sale al lanzarla.</p>
          </div>
          <div>
            <Label htmlFor="prioridad">Prioridad (0–10)</Label>
            <Input
              id="prioridad"
              type="number"
              min={0}
              max={10}
              value={prioridad}
              onChange={(e) => setPrioridad(Number(e.target.value))}
            />
          </div>
        </div>
      </FormSection>

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {campanaId ? <input type="hidden" name="campanaId" value={campanaId} /> : null}

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending} disabled={!nombre.trim() || !mensaje.trim()}>
          {campanaId ? 'Guardar cambios' : 'Crear campaña'}
        </Button>
      </FormActions>
    </form>
  )
}
