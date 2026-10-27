'use client'

import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { EstadoAccionIdentidad } from '@/modules/superadmin/identidadActions'

type Accion = (prev: EstadoAccionIdentidad, formData: FormData) => Promise<EstadoAccionIdentidad>

/**
 * Una acción del equipo que pide TEXTO antes de ejecutarse: un motivo, una respuesta a la persona. Va en dos pasos
 * (un botón, y al pulsarlo el formulario con su texto obligatorio y el botón de confirmar), porque «un clic y ya» no deja
 * constancia de por qué y varias de estas acciones no se deshacen.
 *
 * El servidor repite todas las comprobaciones. El aviso de éxito o de error sale en un toast desde el cierre de la acción
 * (no desde un efecto), para sobrevivir al `revalidatePath` que recarga la lista.
 */
export function AccionConTexto({
  accion,
  campos,
  boton,
  etiquetaTexto,
  nombreTexto = 'motivo',
  maximo = 200,
  multilinea = false,
  peligrosa = false,
  confirmar,
  opcion,
  casilla,
  sinTexto = false,
}: {
  accion: Accion
  /** Campos ocultos que viajan con el formulario (ids). */
  campos: Record<string, string>
  boton: string
  etiquetaTexto: string
  nombreTexto?: string
  maximo?: number
  multilinea?: boolean
  peligrosa?: boolean
  /** El texto del botón que confirma (por defecto, el mismo del primero). */
  confirmar?: string
  /** Una lista cerrada a elegir (la decisión, el disparador). */
  opcion?: {
    nombre: string
    etiqueta: string
    valores: readonly { valor: string; etiqueta: string }[]
  }
  /** Una casilla que hay que marcar para poder confirmar (p. ej. «entiendo que es definitivo»). */
  casilla?: { nombre: string; etiqueta: string }
  /** Sin texto ni segundo paso: un botón que ejecuta al pulsarlo (para lo que no necesita explicación, como tomar una incidencia). */
  sinTexto?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [marcada, setMarcada] = useState(false)
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const idTexto = useId()
  const idOpcion = useId()
  const idCasilla = useId()

  async function enviar(formData: FormData) {
    setOcupado(true)
    try {
      const r = await accion({}, formData)
      if (r.error) toast.error(r.error)
      else {
        toast.success(r.success ?? 'Hecho.')
        setAbierto(false)
        setTexto('')
        setMarcada(false)
      }
    } finally {
      setOcupado(false)
    }
  }

  if (sinTexto) {
    return (
      <form action={enviar}>
        {Object.entries(campos).map(([nombre, valor]) => (
          <input key={nombre} type="hidden" name={nombre} value={valor} />
        ))}
        <Button type="submit" size="sm" variant="outline" disabled={ocupado}>
          {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {boton}
        </Button>
      </form>
    )
  }
  if (!abierto) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(true)} className={peligrosa ? 'text-destructive' : undefined}>
        {boton}
      </Button>
    )
  }
  // Una etiqueta vacía = sin campo de texto (solo la lista cerrada y, si la hay, la casilla).
  const sinCampo = etiquetaTexto === ''
  const listo = (sinCampo || texto.trim().length > 0) && (!casilla || marcada)
  return (
    <form action={enviar} className="w-full max-w-xl space-y-3 rounded-xl border border-border/70 bg-card p-4">
      {Object.entries(campos).map(([nombre, valor]) => (
        <input key={nombre} type="hidden" name={nombre} value={valor} />
      ))}
      {opcion && (
        <div className="space-y-1.5">
          <Label htmlFor={idOpcion}>{opcion.etiqueta}</Label>
          <select
            id={idOpcion}
            name={opcion.nombre}
            required
            defaultValue=""
            className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="" disabled>
              Elige una opción
            </option>
            {opcion.valores.map((v) => (
              <option key={v.valor} value={v.valor}>
                {v.etiqueta}
              </option>
            ))}
          </select>
        </div>
      )}
      {!sinCampo && (
        <div className="space-y-1.5">
          <Label htmlFor={idTexto}>{etiquetaTexto}</Label>
          {multilinea ? (
            <textarea
              id={idTexto}
              name={nombreTexto}
              required
              maxLength={maximo}
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <Input id={idTexto} name={nombreTexto} required maxLength={maximo} value={texto} onChange={(e) => setTexto(e.target.value)} />
          )}
          <p className="text-xs text-muted-foreground">
            {texto.length}/{maximo}
          </p>
        </div>
      )}
      {casilla && (
        <label htmlFor={idCasilla} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input
            id={idCasilla}
            name={casilla.nombre}
            type="checkbox"
            checked={marcada}
            onChange={(e) => setMarcada(e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-primary"
          />
          <span>{casilla.etiqueta}</span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant={peligrosa ? 'destructive' : 'default'} disabled={!listo || ocupado}>
          {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {confirmar ?? boton}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)} disabled={ocupado}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
