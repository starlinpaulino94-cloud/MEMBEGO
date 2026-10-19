'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { buscarCandidatosAKit, buscarProductosParaEntrada, guardarRecetaDeKit, quitarRecetaDeKit } from '@/modules/inventory/actions'
import { MAX_COMPONENTES_POR_KIT, MAX_UNIDADES_POR_COMPONENTE } from '@/modules/inventory/kits'
import { nombreCompleto } from '@/modules/inventory/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface KitInicial {
  varianteId: string
  nombre: string
  componentes: { varianteId: string; nombre: string; sku: string; cantidad: number }[]
}

interface Opcion {
  varianteId: string
  nombre: string
  sku: string
}

interface Fila extends Opcion {
  cantidad: string
}

const entero = (t: string): number | null => (/^\d{1,7}$/.test(t.trim()) && Number(t) >= 1 && Number(t) <= MAX_UNIDADES_POR_COMPONENTE ? Number(t.trim()) : null)

/** Busca mientras se teclea (con pausa); las respuestas viejas se descartan porque llegan fuera de orden. */
function useBusqueda(buscar: (texto: string) => Promise<Opcion[]>) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<Opcion[]>([])
  const turno = useRef(0)
  useEffect(() => {
    const texto = q.trim()
    const mio = ++turno.current
    if (texto.length < 2) return
    const espera = setTimeout(async () => {
      const r = await buscar(texto)
      if (mio === turno.current) setResultados(r)
    }, 250)
    return () => clearTimeout(espera)
    // `buscar` es estable por construcción (se define fuera del render del formulario).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  return { q, setQ, resultados: q.trim().length < 2 ? [] : resultados }
}

const buscarKits = async (texto: string): Promise<Opcion[]> => {
  const r = await buscarCandidatosAKit(texto)
  return r.ok ? r.candidatos : []
}
const buscarComponentes = async (texto: string): Promise<Opcion[]> => {
  const r = await buscarProductosParaEntrada(texto, null)
  return r.ok ? r.productos.map((p) => ({ varianteId: p.id, nombre: nombreCompleto(p.itemNombre, p.nombreVariante, p.esDefault), sku: p.sku })) : []
}

/**
 * INV-5d · La RECETA de un kit: qué producto es el kit y cuántas unidades de cada componente lleva. Sirve para armar uno nuevo (se elige el
 * producto entre los que no controlan inventario por su cuenta) o para editar el de un kit que ya existe. El kit no lleva existencias:
 * venderlo aparta, vende, libera y devuelve sus componentes.
 */
export function KitForm({ inicial, alTerminar }: { inicial?: KitInicial; alTerminar?: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [kit, setKit] = useState<Opcion | null>(inicial ? { varianteId: inicial.varianteId, nombre: inicial.nombre, sku: '' } : null)
  const [filas, setFilas] = useState<Fila[]>(inicial ? inicial.componentes.map((c) => ({ ...c, cantidad: String(c.cantidad) })) : [])
  const kits = useBusqueda(buscarKits)
  const comps = useBusqueda(buscarComponentes)
  const idBase = inicial ? `kit-${inicial.varianteId}` : 'kit-nuevo'

  function agregarComponente(o: Opcion) {
    if (filas.some((f) => f.varianteId === o.varianteId)) {
      toast.error(`«${o.nombre}» ya está en la receta: cambia su cantidad.`)
      return
    }
    if (filas.length >= MAX_COMPONENTES_POR_KIT) {
      toast.error(`Un kit admite hasta ${MAX_COMPONENTES_POR_KIT} componentes.`)
      return
    }
    setFilas((fs) => [...fs, { ...o, cantidad: '1' }])
    comps.setQ('')
  }

  function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!kit) {
      toast.error('Elige el producto que será el kit.')
      return
    }
    if (filas.length === 0) {
      toast.error('Agrega al menos un componente.')
      return
    }
    const mala = filas.find((f) => entero(f.cantidad) === null)
    if (mala) {
      toast.error(`Revisa la cantidad de «${mala.nombre}»: es un entero de 1 en adelante.`)
      return
    }
    start(async () => {
      const r = await guardarRecetaDeKit({ kitVarianteId: kit.varianteId, componentes: filas.map((f) => ({ varianteId: f.varianteId, cantidad: entero(f.cantidad) as number })) })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.sinCambios ? 'La receta ya era esa: no cambió nada.' : r.nueva ? `Kit «${kit.nombre}» creado con ${r.componentes} componente${r.componentes === 1 ? '' : 's'}.` : `Receta de «${kit.nombre}» actualizada.`)
      if (!inicial) {
        setKit(null)
        setFilas([])
        kits.setQ('')
      }
      router.refresh()
      alTerminar?.()
    })
  }

  return (
    <form onSubmit={guardar} className="space-y-4" aria-label={inicial ? `Receta de ${inicial.nombre}` : 'Armar un kit nuevo'}>
      {!inicial && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-producto`}>Producto que será el kit *</Label>
          {kit ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span>
                {kit.nombre} {kit.sku && <span className="text-xs text-muted-foreground">SKU {kit.sku}</span>}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setKit(null)}>
                Cambiar
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input id={`${idBase}-producto`} value={kits.q} onChange={(e) => kits.setQ(e.target.value)} placeholder="Busca por nombre o SKU (un paquete, una caja, un combo…)" autoComplete="off" maxLength={80} />
              {kits.resultados.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-background shadow-md" aria-label="Productos que pueden ser kit">
                  {kits.resultados.map((o) => (
                    <li key={o.varianteId}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setKit(o)
                          kits.setQ('')
                        }}
                      >
                        <span>{o.nombre}</span>
                        <span className="text-xs text-muted-foreground">SKU {o.sku}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Sirve un producto que no controle inventario por su cuenta: el kit no lleva existencias, se arma de sus componentes.</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${idBase}-componente`}>Agregar un componente</Label>
        <div className="relative">
          <Input id={`${idBase}-componente`} value={comps.q} onChange={(e) => comps.setQ(e.target.value)} placeholder="Busca el producto por nombre, SKU o código de barras" autoComplete="off" maxLength={80} />
          {comps.resultados.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-background shadow-md" aria-label="Componentes encontrados">
              {comps.resultados.map((o) => (
                <li key={o.varianteId}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => agregarComponente(o)}>
                    <span className="inline-flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {o.nombre}
                    </span>
                    <span className="text-xs text-muted-foreground">SKU {o.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay componentes.</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Componentes del kit">
          {filas.map((f, i) => (
            <li key={f.varianteId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <span>
                {f.nombre} {f.sku && <span className="text-xs text-muted-foreground">SKU {f.sku}</span>}
              </span>
              <div className="flex items-center gap-2">
                <Label htmlFor={`${idBase}-cant-${i}`} className="text-xs text-muted-foreground">
                  Unidades por kit
                </Label>
                <Input
                  id={`${idBase}-cant-${i}`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={f.cantidad}
                  aria-invalid={entero(f.cantidad) === null}
                  onChange={(e) => setFilas((fs) => fs.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))}
                  className="w-20 text-right tabular-nums"
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Quitar ${f.nombre} de la receta`} onClick={() => setFilas((fs) => fs.filter((_, k) => k !== i))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
          {inicial ? 'Guardar la receta' : 'Crear el kit'}
        </Button>
        {inicial && alTerminar && (
          <Button type="button" size="sm" variant="outline" onClick={alTerminar} disabled={pending}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  )
}

/** Quita la receta de un kit (en dos pasos): el producto vuelve a ser uno cualquiera y lo ya apartado en pedidos no cambia. */
export function QuitarKit({ varianteId, nombre }: { varianteId: string; nombre: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmando, setConfirmando] = useState(false)
  function quitar() {
    start(async () => {
      const r = await quitarRecetaDeKit({ kitVarianteId: varianteId })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`«${nombre}» ya no es un kit.`)
      router.refresh()
    })
  }
  if (!confirmando) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmando(true)} aria-label={`Quitar la receta de ${nombre}`}>
        Quitar receta
      </Button>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={`Confirmar quitar la receta de ${nombre}`}>
      <span className="text-xs text-muted-foreground">Dejará de descontar componentes al venderse.</span>
      <Button type="button" size="sm" onClick={quitar} disabled={pending}>
        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
        Sí, quitarla
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setConfirmando(false)} disabled={pending}>
        Cancelar
      </Button>
    </span>
  )
}
