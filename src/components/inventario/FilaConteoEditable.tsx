'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { contarProductoEnConteo, quitarProductoDelConteo } from '@/modules/inventory/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const entero = (t: string): number | null => (/^\d{1,7}$/.test(t.trim()) ? Number(t.trim()) : null)

/**
 * Una línea del conteo abierto: lo contado de un producto, que se corrige
 * escribiendo el número (Enter o salir del campo guarda) o se quita. Muestra SOLO
 * lo contado: lo que dice el sistema no llega a esta pantalla (conteo a ciegas).
 */
export function FilaConteoEditable(p: { conteoId: string; varianteId: string; nombre: string; sku: string; barcode: string | null; contado: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [valor, setValor] = useState(String(p.contado))

  function guardar() {
    if (valor.trim() === String(p.contado)) return
    const n = entero(valor)
    if (n === null || n > 1_000_000) {
      toast.error(`Revisa lo contado de «${p.nombre}»: es un entero de 0 a 1.000.000.`)
      setValor(String(p.contado))
      return
    }
    start(async () => {
      const r = await contarProductoEnConteo({ conteoId: p.conteoId, varianteId: p.varianteId, cantidad: n, modo: 'FIJAR' })
      if (!r.ok) {
        toast.error(r.error)
        setValor(String(p.contado))
        return
      }
      router.refresh()
    })
  }

  function quitar() {
    start(async () => {
      const r = await quitarProductoDelConteo({ conteoId: p.conteoId, varianteId: p.varianteId })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{p.nombre}</p>
        <p className="text-xs text-muted-foreground">
          SKU {p.sku}
          {p.barcode && ` · ${p.barcode}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={`fc-${p.varianteId}`} className="sr-only">
          Contado de {p.nombre}
        </Label>
        <Input
          id={`fc-${p.varianteId}`}
          inputMode="numeric"
          autoComplete="off"
          value={valor}
          disabled={pending}
          aria-invalid={entero(valor) === null}
          onChange={(e) => setValor(e.target.value)}
          onBlur={guardar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          className="w-24 text-right tabular-nums"
        />
        <Button type="button" variant="ghost" size="icon" disabled={pending} aria-label={`Quitar ${p.nombre} del conteo`} onClick={quitar}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
    </li>
  )
}
