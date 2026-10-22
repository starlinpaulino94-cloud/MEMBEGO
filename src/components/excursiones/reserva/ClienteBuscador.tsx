'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, Search, UserCheck, UserPlus } from 'lucide-react'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  LIMITE_BUSQUEDA_CLIENTE,
  MIN_BUSQUEDA_CLIENTE,
  detalleDeCliente,
  leerBusquedaCliente,
  moverActivo,
  type ClienteOpcion,
} from '@/modules/excursiones/reservas/formulario'

export type ResultadoBusqueda = { clientes: ClienteOpcion[]; hayMas: boolean } | { error: string }

type Estado =
  | { fase: 'inactivo' }
  | { fase: 'buscando' }
  | { fase: 'listo'; clientes: ClienteOpcion[]; hayMas: boolean }
  | { fase: 'error'; mensaje: string }

/** Lo que dijo la búsqueda y para QUÉ texto lo dijo: si el texto cambió después, esa respuesta ya no vale. */
interface Respuesta {
  q: string
  resultado: ResultadoBusqueda
}

/** Espera que se deje de teclear antes de buscar: una consulta por pausa, no una por letra. */
const PAUSA_MS = 250

/**
 * BUSCAR UN CLIENTE POR NOMBRE, TELÉFONO O CORREO (auditoría admin · fase 7, 7.2 y 7.4).
 *
 * Reemplaza la lista de los 200 clientes más recientes: se busca en la base, sobre TODOS los clientes de la empresa. Es un
 * «combobox» accesible: la lista se anuncia, se recorre con las flechas, se elige con Intro (que NO envía el formulario) y se
 * cierra con Escape. Si hay más resultados de los que caben, lo dice; si no hay ninguno, ofrece crear el cliente.
 */
export function ClienteBuscador({
  buscar,
  seleccionado,
  alElegir,
  alLimpiar,
  alCrearNuevo,
  error,
}: {
  /** Quien busca de verdad (la acción de servidor). Se pasa por propiedad para que el componente no dependa del servidor. */
  buscar: (q: string) => Promise<ResultadoBusqueda>
  seleccionado: ClienteOpcion | null
  alElegir: (c: ClienteOpcion) => void
  alLimpiar: () => void
  /** «Crear cliente nuevo» con lo escrito: pasa al modo de cliente nuevo. */
  alCrearNuevo: (textoBuscado: string) => void
  error?: string
}) {
  const idLista = useId()
  const [texto, setTexto] = useState('')
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null)
  const [activo, setActivo] = useState(-1)
  const [abierto, setAbierto] = useState(false)
  const ultimaPeticion = useRef(0)

  const q = leerBusquedaCliente(texto)

  // El estado se DERIVA de lo escrito y de la última respuesta: nada se «sincroniza» en un efecto, que solo hace la consulta.
  const estado: Estado = !q
    ? { fase: 'inactivo' }
    : respuesta?.q !== q
      ? { fase: 'buscando' }
      : 'error' in respuesta.resultado
        ? { fase: 'error', mensaje: respuesta.resultado.error }
        : { fase: 'listo', clientes: respuesta.resultado.clientes, hayMas: respuesta.resultado.hayMas }

  useEffect(() => {
    if (!q) return
    const numero = ++ultimaPeticion.current
    const temporizador = setTimeout(() => {
      buscar(q)
        .then((resultado) => {
          if (numero === ultimaPeticion.current) setRespuesta({ q, resultado }) // si llegó tarde, ya se escribió otra cosa
        })
        .catch(() => {
          if (numero === ultimaPeticion.current) setRespuesta({ q, resultado: { error: 'No se pudo buscar. Inténtalo de nuevo.' } })
        })
    }, PAUSA_MS)
    return () => clearTimeout(temporizador)
  }, [q, buscar])

  if (seleccionado) {
    return (
      <div className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <UserCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground">{seleccionado.nombre}</p>
            <p className="truncate text-xs text-muted-foreground">{detalleDeCliente(seleccionado) || 'Sin correo ni teléfono'}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={alLimpiar}>
          Cambiar<span className="sr-only"> de cliente</span>
        </Button>
      </div>
    )
  }

  const clientes = estado.fase === 'listo' ? estado.clientes : []
  const listaVisible = abierto && estado.fase === 'listo' && clientes.length > 0
  const elegir = (c: ClienteOpcion) => {
    alElegir(c)
    setTexto('')
    setAbierto(false)
  }

  let anuncio = ''
  if (estado.fase === 'buscando') anuncio = 'Buscando clientes…'
  else if (estado.fase === 'listo') anuncio = clientes.length === 0 ? 'Ningún cliente coincide.' : `${clientes.length}${estado.hayMas ? ' o más' : ''} clientes. Usa las flechas para recorrerlos.`

  return (
    <div className="w-full min-w-0 space-y-2">
      <Campo
        id="reserva-cliente-buscar"
        etiqueta="Buscar cliente"
        ayuda={`Escribe al menos ${MIN_BUSQUEDA_CLIENTE} letras del nombre, el teléfono o el correo.`}
        error={error}
      >
        {(control) => (
          <div className="relative w-full min-w-0">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              role="combobox"
              autoComplete="off"
              aria-expanded={listaVisible}
              aria-controls={idLista}
              aria-autocomplete="list"
              aria-activedescendant={listaVisible && activo >= 0 ? `${idLista}-${activo}` : undefined}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value)
                setActivo(-1)
                setAbierto(true)
              }}
              onFocus={() => setAbierto(true)}
              onBlur={() => setAbierto(false)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  setAbierto(true)
                  setActivo((a) => moverActivo(a, clientes.length, e.key === 'ArrowDown' ? 1 : -1))
                } else if (e.key === 'Enter') {
                  // Intro en un formulario lo envía: aquí solo elige (o no hace nada).
                  e.preventDefault()
                  if (listaVisible && activo >= 0 && clientes[activo]) elegir(clientes[activo])
                } else if (e.key === 'Escape') {
                  setAbierto(false)
                }
              }}
              placeholder="Ej: Laura, 809… o laura@correo.com"
              className="h-12 w-full bg-background pl-9 text-sm font-medium"
              {...control}
            />
            {estado.fase === 'buscando' && <Loader2 className="absolute right-3 top-3.5 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
          </div>
        )}
      </Campo>

      <ul
        id={idLista}
        role="listbox"
        aria-label="Clientes que coinciden"
        hidden={!listaVisible}
        className="max-h-72 w-full min-w-0 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card shadow-sm"
      >
        {clientes.map((c, i) => (
          <li
            key={c.id}
            id={`${idLista}-${i}`}
            role="option"
            aria-selected={i === activo}
            // `mousedown` y no `click`: el campo pierde el foco antes del clic y la lista se cerraría sin elegir.
            onMouseDown={(e) => {
              e.preventDefault()
              elegir(c)
            }}
            className={`cursor-pointer px-3.5 py-2.5 ${i === activo ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
          >
            <p className="truncate text-sm font-semibold text-foreground">{c.nombre}</p>
            <p className="truncate text-xs text-muted-foreground">{detalleDeCliente(c) || 'Sin correo ni teléfono'}</p>
          </li>
        ))}
      </ul>

      <p role="status" className="sr-only">
        {anuncio}
      </p>

      {estado.fase === 'listo' && estado.hayMas && (
        <p className="text-xs text-muted-foreground">
          Hay más de {LIMITE_BUSQUEDA_CLIENTE} clientes que coinciden: escribe más del nombre, el teléfono o el correo para afinar.
        </p>
      )}
      {estado.fase === 'error' && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {estado.mensaje}
        </p>
      )}
      {estado.fase === 'listo' && clientes.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-3.5 text-sm">
          <span className="text-muted-foreground">Ningún cliente coincide con «{q}».</span>
          <Button type="button" variant="outline" size="sm" onClick={() => alCrearNuevo(texto.trim())} className="gap-1.5">
            <UserPlus className="h-4 w-4" aria-hidden /> Crear cliente nuevo
          </Button>
        </div>
      )}
    </div>
  )
}
