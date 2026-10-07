'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { asignarCategoriasCatalogo, crearCategoriaCatalogo, eliminarCategoriaCatalogo } from '@/modules/catalog/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeleteButton } from '@/components/ui/delete-button'

export interface CategoriaVista {
  id: string
  name: string
  items: number
}

/** Categorías PROPIAS de la empresa: las asigna al ítem, y puede crear o borrar las suyas. */
export function CategoriasPanel({
  itemId,
  categorias,
  asignadas,
  editable,
}: {
  itemId: string
  categorias: CategoriaVista[]
  asignadas: string[]
  editable: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(asignadas))
  const [nueva, setNueva] = useState('')

  function guardar() {
    start(async () => {
      const r = await asignarCategoriasCatalogo(itemId, [...marcadas])
      if (!r.ok) toast.error(r.error)
      else {
        toast.success('Categorías guardadas.')
        router.refresh()
      }
    })
  }

  function crear() {
    start(async () => {
      const r = await crearCategoriaCatalogo(nueva)
      if (!r.ok) return void toast.error(r.error)
      setNueva('')
      setMarcadas((m) => new Set(m).add(r.id))
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {categorias.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no tienes categorías. Crea la primera abajo.</p>
      ) : (
        <ul className="space-y-2">
          {categorias.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={!editable}
                  checked={marcadas.has(c.id)}
                  onChange={(e) =>
                    setMarcadas((m) => {
                      const n = new Set(m)
                      if (e.target.checked) n.add(c.id)
                      else n.delete(c.id)
                      return n
                    })
                  }
                />
                {c.name}
                <span className="text-xs text-muted-foreground">({c.items})</span>
              </label>
              {editable && (
                <DeleteButton
                  label={`Borrar la categoría ${c.name}`}
                  title={`¿Borrar la categoría «${c.name}»?`}
                  description="Los productos no se borran: solo pierden esta etiqueta."
                  successMessage="Categoría borrada."
                  action={async () => {
                    const r = await eliminarCategoriaCatalogo(c.id)
                    if (r.ok) {
                      setMarcadas((m) => {
                        const n = new Set(m)
                        n.delete(c.id)
                        return n
                      })
                      router.refresh()
                    }
                    return r.ok ? undefined : { error: r.error }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <>
          <div className="flex gap-2">
            <Input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva categoría" aria-label="Nombre de la nueva categoría" maxLength={80} className="max-w-xs" />
            <Button type="button" variant="outline" size="sm" disabled={pending || !nueva.trim()} onClick={crear}>
              Crear
            </Button>
          </div>
          <Button type="button" size="sm" disabled={pending} onClick={guardar}>
            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Guardar categorías
          </Button>
        </>
      )}
    </div>
  )
}
