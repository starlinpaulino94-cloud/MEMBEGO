'use client'

import { useActionState, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Car, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { agregarVehiculoCliente, type VehiculoActionState } from '@/modules/cliente/vehiculosActions'
import { validarAnio, validarPlaca, normalizarPlaca } from '@/modules/onboarding/vehiculo'
import { buscarMarcas, COLORES_FRECUENTES } from '@/modules/onboarding/marcas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * Onboarding v2 · ASISTENTE DE VEHÍCULO del portal (Fase 5).
 *
 * La misma experiencia por pasos del registro (categoría → marca → modelo →
 * año → color → placa → confirmar), para el cliente YA logueado que llegó
 * aquí desde una acción que exige vehículo (§15: START_VEHICLE_ONBOARDING).
 * Con `?next=` vuelve exactamente a donde iba (p. ej. /cliente/planes).
 *
 * Es el hermano claro (tema del portal) del paso de vehículo del asistente de
 * registro: comparten el dominio (validadores, marcas, colores) y el server
 * action valida todo de nuevo.
 */

export interface TipoVehiculoOpcion {
  id: string
  nombre: string
  descripcion: string | null
  iconoUrl: string | null
}

type Paso = 'categoria' | 'marca' | 'modelo' | 'anio' | 'color' | 'placa' | 'confirmar'
const PASOS: Paso[] = ['categoria', 'marca', 'modelo', 'anio', 'color', 'placa', 'confirmar']

const TITULOS: Record<Paso, string> = {
  categoria: '¿Qué tipo de vehículo tienes?',
  marca: '¿Qué marca es?',
  modelo: '¿Qué modelo?',
  anio: '¿De qué año?',
  color: '¿De qué color?',
  placa: 'La placa de tu vehículo',
  confirmar: 'Revisa y confirma',
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
  const [idx, setIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const handledRef = useRef(false)
  const [datos, setDatos] = useState({
    tipoVehiculoId: '',
    marca: '',
    modelo: '',
    anio: '',
    color: '',
    placa: '',
  })

  const paso = PASOS[idx]
  const tipoElegido = tiposVehiculo.find((t) => t.id === datos.tipoVehiculoId)
  const sugerencias = useMemo(() => buscarMarcas(datos.marca), [datos.marca])

  useEffect(() => {
    if (handledRef.current) return
    if (state.success) {
      handledRef.current = true
      toast.success('Vehículo guardado.')
      router.push(next)
      router.refresh()
    }
  }, [state.success, router, next])

  function validar(p: Paso): string | null {
    switch (p) {
      case 'categoria':
        return datos.tipoVehiculoId ? null : 'Elige la categoría de tu vehículo.'
      case 'marca':
        return datos.marca.trim() ? null : 'Indica la marca (o escríbela si no aparece).'
      case 'modelo':
        return datos.modelo.trim() ? null : 'Indica el modelo de tu vehículo.'
      case 'anio': {
        const r = validarAnio(datos.anio)
        return r.ok ? null : r.error!
      }
      case 'color':
        return datos.color.trim() ? null : 'Indica el color de tu vehículo.'
      case 'placa': {
        const r = validarPlaca(datos.placa)
        return r.ok ? null : r.error!
      }
      case 'confirmar':
        return null
    }
  }

  function avanzar(e?: React.FormEvent) {
    e?.preventDefault()
    const problema = validar(paso)
    if (problema) return setError(problema)
    setError(null)
    setIdx((i) => Math.min(i + 1, PASOS.length - 1))
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    const fd = new FormData()
    fd.set('tipoVehiculoId', datos.tipoVehiculoId)
    fd.set('marca', datos.marca)
    fd.set('modelo', datos.modelo)
    fd.set('anio', datos.anio)
    fd.set('color', datos.color)
    fd.set('placa', datos.placa)
    fd.set('pais', 'DO')
    startTransition(() => dispatch(fd))
  }

  const pct = Math.round(((idx + 1) / PASOS.length) * 100)
  const set = (k: keyof typeof datos) => (v: string) => {
    setError(null)
    setDatos((d) => ({ ...d, [k]: v }))
  }

  const chip = (activo: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition ${
      activo ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-muted'
    }`

  return (
    <div className="space-y-4">
      <div aria-label={`Paso ${idx + 1} de ${PASOS.length}`} className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Paso {idx + 1} de {PASOS.length}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-slow" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* noValidate: la validación es la del dominio (mensajes propios). */}
          <form onSubmit={paso === 'confirmar' ? enviar : avanzar} noValidate className="space-y-5" key={paso}>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{TITULOS[paso]}</h1>

            {(error || state.error) && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error ?? state.error}</AlertDescription>
              </Alert>
            )}

            {paso === 'categoria' && (
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Categoría del vehículo">
                {tiposVehiculo.map((tv) => {
                  const activo = datos.tipoVehiculoId === tv.id
                  return (
                    <button
                      key={tv.id}
                      type="button"
                      role="radio"
                      aria-checked={activo}
                      onClick={() => set('tipoVehiculoId')(tv.id)}
                      className={`rounded-xl border p-4 text-left transition ${
                        activo ? 'border-primary bg-primary/5 ring-2 ring-primary' : 'border-border bg-card hover:bg-muted/50'
                      }`}
                    >
                      {tv.iconoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={tv.iconoUrl} alt="" className="mb-2 h-8 w-8 object-contain" />
                      ) : (
                        <Car className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
                      )}
                      <p className="font-semibold text-foreground">{tv.nombre}</p>
                      {tv.descripcion && <p className="mt-0.5 text-xs text-muted-foreground">{tv.descripcion}</p>}
                      {activo && <Check className="mt-1 h-4 w-4 text-primary" aria-hidden />}
                    </button>
                  )
                })}
              </div>
            )}

            {paso === 'marca' && (
              <div className="space-y-3">
                <Label htmlFor="marca" className="sr-only">Marca</Label>
                <Input
                  id="marca"
                  value={datos.marca}
                  onChange={(e) => set('marca')(e.target.value)}
                  autoFocus
                  placeholder="Busca o escribe la marca"
                  className="h-12 text-lg"
                />
                <div className="flex flex-wrap gap-2" aria-label="Marcas sugeridas">
                  {sugerencias.map((m) => (
                    <button key={m} type="button" onClick={() => set('marca')(m)} className={chip(datos.marca === m)}>
                      {m}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">¿No aparece? Escríbela tal cual — vale cualquier marca.</p>
              </div>
            )}

            {paso === 'modelo' && (
              <div className="space-y-2">
                <Label htmlFor="modelo" className="sr-only">Modelo</Label>
                <Input
                  id="modelo"
                  value={datos.modelo}
                  onChange={(e) => set('modelo')(e.target.value)}
                  autoFocus
                  placeholder={datos.marca ? `Modelo de tu ${datos.marca}` : 'Modelo'}
                  className="h-12 text-lg"
                />
              </div>
            )}

            {paso === 'anio' && (
              <div className="space-y-2">
                <Label htmlFor="anio" className="sr-only">Año</Label>
                <Input
                  id="anio"
                  type="number"
                  inputMode="numeric"
                  value={datos.anio}
                  onChange={(e) => set('anio')(e.target.value)}
                  autoFocus
                  placeholder={String(new Date().getFullYear())}
                  className="h-12 text-lg"
                />
              </div>
            )}

            {paso === 'color' && (
              <div className="space-y-3">
                <Label htmlFor="color" className="sr-only">Color</Label>
                <Input
                  id="color"
                  value={datos.color}
                  onChange={(e) => set('color')(e.target.value)}
                  autoFocus
                  placeholder="Color del vehículo"
                  className="h-12 text-lg"
                />
                <div className="flex flex-wrap gap-2" aria-label="Colores frecuentes">
                  {COLORES_FRECUENTES.map((c) => (
                    <button key={c} type="button" onClick={() => set('color')(c)} className={chip(datos.color === c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {paso === 'placa' && (
              <div className="space-y-2">
                <Label htmlFor="placa" className="sr-only">Placa</Label>
                <Input
                  id="placa"
                  value={datos.placa}
                  onChange={(e) => set('placa')(e.target.value)}
                  autoFocus
                  placeholder="A123456"
                  autoComplete="off"
                  className="h-12 text-lg"
                />
                <p className="text-xs text-muted-foreground">
                  Con ella identificamos tu vehículo al llegar.
                  {datos.placa.trim() && normalizarPlaca(datos.placa) !== datos.placa.trim() && (
                    <> Se guardará como <span className="font-mono">{normalizarPlaca(datos.placa)}</span>.</>
                  )}
                </p>
              </div>
            )}

            {paso === 'confirmar' && (
              <dl className="space-y-2 rounded-xl border border-border bg-muted/30 p-4 text-sm">
                {[
                  ['Categoría', tipoElegido?.nombre ?? '—'],
                  ['Vehículo', `${datos.marca} ${datos.modelo} ${datos.anio}`],
                  ['Color', datos.color],
                  ['Placa', normalizarPlaca(datos.placa)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right font-medium text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="flex items-center gap-3">
              {idx > 0 && (
                <Button type="button" variant="ghost" onClick={() => { setError(null); setIdx((i) => i - 1) }} disabled={pending}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
                </Button>
              )}
              <Button type="submit" disabled={pending} className="ml-auto h-11 px-6">
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {paso === 'confirmar' ? 'Guardar vehículo' : (
                  <>Continuar <ArrowRight className="ml-1.5 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
