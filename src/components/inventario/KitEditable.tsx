'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { KitForm, QuitarKit, type KitInicial } from './KitForm'

/** INV-5d · Editar o quitar la receta de un kit que ya existe, sin salir de la lista. */
export function KitEditable({ kit }: { kit: KitInicial }) {
  const [editando, setEditando] = useState(false)
  if (editando) return <KitForm inicial={kit} alTerminar={() => setEditando(false)} />
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setEditando(true)} aria-label={`Editar la receta de ${kit.nombre}`}>
        Editar receta
      </Button>
      <QuitarKit varianteId={kit.varianteId} nombre={kit.nombre} />
    </div>
  )
}
