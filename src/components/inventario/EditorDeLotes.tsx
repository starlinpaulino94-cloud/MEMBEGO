'use client'

import { Plus, Trash2 } from 'lucide-react'
import { CODIGO_SIN_LOTE, MAX_LOTES_POR_LINEA, MAX_SERIES_POR_LINEA, separarSeries } from '@/modules/inventory/lotes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Un lote de una línea, tal como se teclea (todo texto: puede estar a medias). */
export interface LoteForm {
  codigo: string
  vence: string
  cantidad: string
}

const entero = (t: string): number | null => (/^\d{1,7}$/.test(t.trim()) ? Number(t.trim()) : null)

export const loteNuevo = (cantidad: number | string = 1): LoteForm => ({ codigo: '', vence: '', cantidad: String(cantidad) })

/**
 * INV-5c · En un producto con SERIES la línea guarda lo tecleado (una serie por renglón, o separadas por coma) en el `codigo` del único
 * renglón del formulario; estas son las series que ese texto contiene.
 */
export const seriesDeLotes = (lotes: readonly LoteForm[]): string[] => separarSeries(lotes.map((x) => x.codigo).join('\n'))

/** Las unidades que suman los lotes de una línea (un renglón a medias o vacío cuenta cero); con `series`, las que se teclearon. */
export const sumaDeLotes = (lotes: readonly LoteForm[], series = false): number => (series ? seriesDeLotes(lotes).length : lotes.reduce((s, x) => s + (entero(x.cantidad) ?? 0), 0))

/** Los lotes como los recibe el servidor: `[{ codigo, vencimiento, cantidad }]`; con `series`, una serie por unidad. */
export const lotesParaEnviar = (lotes: readonly LoteForm[], series = false) =>
  series ? seriesDeLotes(lotes).map((codigo) => ({ codigo, vencimiento: null, cantidad: 1 })) : lotes.map((x) => ({ codigo: x.codigo, vencimiento: x.vence === '' ? null : x.vence, cantidad: entero(x.cantidad) ?? 0 }))

/**
 * Los LOTES de UNA línea de un producto que los lleva: por cada lote, su código, su vencimiento y cuántas unidades son. «SIN LOTE» es el
 * lote para lo que no trae (no lleva vencimiento). Lo comparten la entrada de mercancía y la recepción de una orden de compra: en las dos,
 * la cantidad de la línea es la suma de sus lotes. `idBase` y `indice` arman los `id` de los campos (únicos en el formulario).
 */
export function EditorDeLotes({
  nombre,
  exigeVencimiento,
  lotes,
  onChange,
  idBase,
  indice,
  series = false,
}: {
  nombre: string
  exigeVencimiento: boolean
  /** INV-5c: el producto lleva series: un número de serie por unidad en vez de lotes. */
  series?: boolean
  lotes: LoteForm[]
  onChange: (lotes: LoteForm[]) => void
  idBase: string
  indice: number
}) {
  const cambiar = (j: number, parcial: Partial<LoteForm>) => onChange(lotes.map((z, m) => (m === j ? { ...z, ...parcial } : z)))
  if (series) {
    const cuantas = seriesDeLotes(lotes).length
    return (
      <div className="basis-full space-y-2 rounded-lg border border-dashed p-3" role="group" aria-label={`Series de ${nombre}`}>
        <p className="text-xs text-muted-foreground">
          Este producto lleva series: escribe o pega el número de serie de cada unidad que llegó, uno por renglón. Cada serie es una sola unidad y no se puede repetir (hasta {MAX_SERIES_POR_LINEA} por línea).
        </p>
        <Label htmlFor={`${idBase}-series-${indice}`} className="sr-only">
          Números de serie de {nombre}
        </Label>
        <Textarea
          id={`${idBase}-series-${indice}`}
          rows={4}
          autoComplete="off"
          spellCheck={false}
          placeholder={'SN-0001\nSN-0002'}
          value={lotes[0]?.codigo ?? ''}
          onChange={(e) => onChange([{ codigo: e.target.value, vence: '', cantidad: '1' }])}
        />
        <p className="text-xs text-muted-foreground tabular-nums">
          {cuantas} {cuantas === 1 ? 'serie' : 'series'}
        </p>
      </div>
    )
  }
  return (
    <div className="basis-full space-y-2 rounded-lg border border-dashed p-3" role="group" aria-label={`Lotes de ${nombre}`}>
      <p className="text-xs text-muted-foreground">
        Este producto lleva lotes: indica de qué lote es lo que llegó{exigeVencimiento ? ' y cuándo vence' : ''}. Escribe {CODIGO_SIN_LOTE} si no trae.
      </p>
      {lotes.map((x, j) => (
        <div key={j} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_6rem_auto]">
          <div>
            <Label htmlFor={`${idBase}-lote-${indice}-${j}`} className="sr-only">
              Código del lote {j + 1} de {nombre}
            </Label>
            <Input id={`${idBase}-lote-${indice}-${j}`} placeholder="Código del lote" autoComplete="off" maxLength={60} value={x.codigo} onChange={(e) => cambiar(j, { codigo: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${idBase}-vence-${indice}-${j}`} className="sr-only">
              Vencimiento del lote {j + 1} de {nombre}
            </Label>
            <Input id={`${idBase}-vence-${indice}-${j}`} type="date" value={x.vence} disabled={x.codigo.trim().toUpperCase() === CODIGO_SIN_LOTE} onChange={(e) => cambiar(j, { vence: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${idBase}-lote-cant-${indice}-${j}`} className="sr-only">
              Cantidad del lote {j + 1} de {nombre}
            </Label>
            <Input
              id={`${idBase}-lote-cant-${indice}-${j}`}
              inputMode="numeric"
              autoComplete="off"
              value={x.cantidad}
              aria-invalid={entero(x.cantidad) === null || entero(x.cantidad) === 0}
              onChange={(e) => cambiar(j, { cantidad: e.target.value })}
              className="text-right tabular-nums"
            />
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={`Quitar el lote ${j + 1} de ${nombre}`} disabled={lotes.length === 1} onClick={() => onChange(lotes.filter((_, m) => m !== j))}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ))}
      {lotes.length < MAX_LOTES_POR_LINEA && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lotes, loteNuevo()])}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Agregar otro lote
        </Button>
      )}
    </div>
  )
}
