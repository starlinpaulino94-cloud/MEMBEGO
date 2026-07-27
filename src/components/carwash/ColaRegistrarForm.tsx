'use client'

/**
 * App Car Wash — alta en la cola, con el dueño del carro.
 *
 * EL ORDEN DE LA PANTALLA ES EL ORDEN DE LA REALIDAD: primero la placa, porque
 * es lo primero que el encargado ve. Si esa placa ya vino antes, el sistema
 * reconoce al dueño solo y no hay nada más que escribir.
 *
 * Si es un carro nuevo, se puede buscar al cliente por nombre o teléfono, o
 * darlo de alta ahí mismo escribiendo su nombre. Nunca se abandona la pantalla
 * de la pista para registrar a alguien: cada paso extra es una razón para
 * volver al cuaderno.
 *
 * Y REGISTRAR AL CLIENTE NUNCA ES OBLIGATORIO. Un carro se puede recibir
 * anónimo, como siempre. Lo que no puede pasar es que falten los datos del
 * dueño y por eso no se pueda atender el carro.
 */

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Search, UserPlus, X } from 'lucide-react'
import { registrarEnCola, type ColaActionState } from '@/modules/carwash/cola-actions'
import { buscarParaPista } from '@/modules/carwash/mostrador-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ClienteEncontrado {
  id: string
  nombre: string
  telefono: string | null
  esLocal: boolean
  placas: string[]
}

export function ColaRegistrarForm() {
  const [state, action, pending] = useActionState<ColaActionState, FormData>(registrarEnCola, {})
  const formRef = useRef<HTMLFormElement>(null)

  // 'ninguno' = carro anónimo (comportamiento de siempre).
  // 'buscar'  = elegir un cliente que ya existe.
  // 'nuevo'   = darlo de alta de mostrador aquí mismo.
  const [modo, setModo] = useState<'ninguno' | 'buscar' | 'nuevo'>('ninguno')
  const [elegido, setElegido] = useState<ClienteEncontrado | null>(null)

  // El selector de cliente se limpia DURANTE EL RENDER cuando llega un estado
  // nuevo con éxito, no desde el efecto. `useActionState` devuelve un objeto
  // distinto en cada envío, así que la comparación por identidad es fiable, y
  // ajustar estado en el render es el patrón que React recomienda para esto:
  // hacerlo en un efecto encadena un render extra en cada carro que entra.
  const [ultimoEstado, setUltimoEstado] = useState(state)
  if (state !== ultimoEstado) {
    setUltimoEstado(state)
    if (state.success) {
      setModo('ninguno')
      setElegido(null)
    }
  }

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      // Limpiar los campos del DOM sí es un efecto: toca algo fuera de React.
      formRef.current?.reset()
    }
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-3 rounded-2xl border border-border/70 bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* Pista (F4): el teclado del celular abre en MAYÚSCULAS y sin corrector,
            que es como se escribe una placa. Sin esto había que pulsar shift en
            cada letra y el corrector "arreglaba" la placa. */}
        <Input
          name="placa"
          placeholder="Placa (ej. A123456)"
          className="min-h-11 uppercase"
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <Input
          name="descripcion"
          placeholder="Vehículo (ej. Corolla gris)"
          className="min-h-11"
          maxLength={120}
          autoComplete="off"
        />
        <Input
          name="servicio"
          placeholder="Servicio (ej. Lavado full)"
          className="min-h-11"
          maxLength={120}
        />
        <Input
          name="notaInterna"
          placeholder="Nota interna (opcional)"
          className="min-h-11"
          maxLength={300}
        />
        <Button type="submit" disabled={pending} className="min-h-11 gap-1.5">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Agregar a la cola
        </Button>
      </div>

      {/* ── El dueño del carro ───────────────────────────────────────────── */}
      {elegido ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {elegido.nombre}
              {elegido.esLocal && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  mostrador
                </span>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[elegido.telefono, elegido.placas.join(' · ')].filter(Boolean).join(' · ') ||
                'Sin datos adicionales'}
            </p>
          </div>
          <input type="hidden" name="clienteId" value={elegido.id} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            onClick={() => {
              setElegido(null)
              setModo('ninguno')
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : modo === 'ninguno' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Si la placa ya vino antes, el dueño se reconoce solo. Si no:
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setModo('buscar')}>
            <Search className="mr-1.5 h-3.5 w-3.5" /> Buscar cliente
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setModo('nuevo')}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Cliente nuevo
          </Button>
        </div>
      ) : modo === 'buscar' ? (
        <Buscador onElegir={setElegido} onCancelar={() => setModo('ninguno')} />
      ) : (
        <div className="grid gap-2 rounded-xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            name="clienteNombre"
            placeholder="Nombre del cliente"
            className="min-h-11"
            maxLength={80}
            autoComplete="off"
          />
          <Input
            name="clienteTelefono"
            placeholder="Teléfono (opcional)"
            className="min-h-11"
            maxLength={30}
            inputMode="tel"
            autoComplete="off"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setModo('ninguno')}
          >
            <X className="h-4 w-4" />
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Se registra como cliente de mostrador junto con esta placa. La próxima vez que entre
            ese carro, se reconoce solo.
          </p>
        </div>
      )}
    </form>
  )
}

function Buscador({
  onElegir,
  onCancelar,
}: {
  onElegir: (c: ClienteEncontrado) => void
  onCancelar: () => void
}) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ClienteEncontrado[]>([])
  const [buscando, start] = useTransition()

  // Búsqueda al enviar, no mientras se escribe: en la pista la conexión no
  // siempre es buena, y una consulta por tecla la vuelve inservible.
  function buscar() {
    const termino = q.trim()
    if (termino.length < 2) {
      toast.error('Escribe al menos dos letras.')
      return
    }
    start(async () => {
      const r = await buscarParaPista(termino)
      setResultados(r)
      if (r.length === 0) toast.error('Nadie con ese nombre, teléfono o placa.')
    })
  }

  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter busca, no envía el formulario de la cola.
            if (e.key === 'Enter') {
              e.preventDefault()
              buscar()
            }
          }}
          placeholder="Nombre, teléfono o placa"
          className="min-h-11"
          autoComplete="off"
        />
        <Button type="button" size="sm" disabled={buscando} onClick={buscar} className="shrink-0">
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          onClick={onCancelar}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {resultados.length > 0 && (
        <ul className="space-y-1">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onElegir(c)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-left hover:bg-primary/5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {c.nombre}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.telefono, c.placas.join(' · ')].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                {c.esLocal && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                    mostrador
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
