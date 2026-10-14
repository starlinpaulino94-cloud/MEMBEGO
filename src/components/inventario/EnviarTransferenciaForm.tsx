'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ScanBarcode, Trash2, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { buscarProductosParaTransferencia, enviarTransferencia } from '@/modules/inventory/actions'
import { MAX_LINEAS_TRASLADO, MAX_NOTA_TRASLADO } from '@/modules/inventory/traslados'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'
import type { SucursalOpcionForm } from './EntradaMultipleForm'

/** Lo que devuelve la búsqueda (el mismo contorno que `VarianteBuscable`, sin importar el módulo de lecturas al navegador). */
interface ProductoBuscado {
  id: string
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  disponible: number | null
  exacto: boolean
}

interface LineaForm {
  varianteId: string
  nombre: string
  sku: string
  /** Lo vendible en el ORIGEN cuando se añadió (null = no se sabe). */
  disponible: number | null
  /** Texto del campo: puede estar a medias mientras se teclea. */
  cantidad: string
}

const entero = (t: string): number | null => (/^\d{1,7}$/.test(t.trim()) ? Number(t.trim()) : null)

/**
 * ENVIAR una transferencia a otra sucursal: se escanea o se busca cada producto, se
 * ajusta la cantidad y se envía todo junto (todo o nada). Las unidades SALEN del
 * origen al enviar y quedan en tránsito hasta que el destino las recibe. Aquí SÍ se
 * ve lo que hay en el origen: no es un conteo a ciegas.
 */
export function EnviarTransferenciaForm({ sucursales }: { sucursales: SucursalOpcionForm[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [origenId, setOrigenId] = useState(sucursales[0]?.id ?? '')
  const [destinoId, setDestinoId] = useState(sucursales[1]?.id ?? '')
  const [nota, setNota] = useState('')
  const [lineas, setLineas] = useState<LineaForm[]>([])
  const [q, setQ] = useState('')
  const [sugerencias, setSugerencias] = useState<ProductoBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const clave = useRef(nuevaClave())
  const peticion = useRef(0)
  const enviada = useRef(false)

  // Búsqueda mientras se teclea (con pausa). Las respuestas viejas se descartan: llegan fuera de orden.
  useEffect(() => {
    const texto = q.trim()
    if (texto === '') {
      peticion.current++
      return
    }
    const turno = ++peticion.current
    const espera = setTimeout(async () => {
      setBuscando(true)
      const r = await buscarProductosParaTransferencia(texto, origenId || null)
      if (turno !== peticion.current) return
      setBuscando(false)
      setSugerencias(r.ok ? r.productos : [])
    }, 250)
    return () => clearTimeout(espera)
  }, [q, origenId])

  // Avisa antes de perder un envío a medias.
  useEffect(() => {
    if (lineas.length === 0) return
    const avisar = (e: BeforeUnloadEvent) => {
      if (enviada.current) return
      e.preventDefault()
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [lineas.length])

  function agregar(p: ProductoBuscado) {
    setLineas((actuales) => {
      const i = actuales.findIndex((l) => l.varianteId === p.id)
      if (i >= 0) return actuales.map((l, k) => (k === i ? { ...l, cantidad: String((entero(l.cantidad) ?? 0) + 1) } : l))
      if (actuales.length >= MAX_LINEAS_TRASLADO) {
        toast.error(`Un envío admite hasta ${MAX_LINEAS_TRASLADO} productos. Envíalo y empieza otro.`)
        return actuales
      }
      return [...actuales, { varianteId: p.id, nombre: nombreCompleto(p.itemNombre, p.nombreVariante, p.esDefault), sku: p.sku, disponible: p.disponible, cantidad: '1' }]
    })
    setQ('')
    setSugerencias([])
  }

  async function alPulsarEnter() {
    const texto = q.trim()
    if (texto === '') return
    setBuscando(true)
    const r = await buscarProductosParaTransferencia(texto, origenId || null)
    setBuscando(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    if (r.productos.length === 0) {
      toast.error(`No encontré ningún producto que controle inventario con «${texto}».`)
      return
    }
    // Un lector: la coincidencia exacta se añade sola. Si hay duda, se elige de la lista.
    if (r.productos[0].exacto || r.productos.length === 1) agregar(r.productos[0])
    else setSugerencias(r.productos)
  }

  const visibles = q.trim() === '' ? [] : sugerencias
  const unidades = lineas.reduce((s, l) => s + (entero(l.cantidad) ?? 0), 0)
  const origen = sucursales.find((s) => s.id === origenId)?.nombre ?? ''
  const destino = sucursales.find((s) => s.id === destinoId)?.nombre ?? ''

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!origenId || !destinoId) {
      toast.error('Elige la sucursal que envía y la que recibe.')
      return
    }
    if (origenId === destinoId) {
      toast.error('El origen y el destino tienen que ser sucursales distintas.')
      return
    }
    if (lineas.length === 0) {
      toast.error('Agrega al menos un producto al envío.')
      return
    }
    const cuerpo = lineas.map((l) => ({ varianteId: l.varianteId, cantidad: entero(l.cantidad) ?? 0 }))
    const mala = cuerpo.findIndex((l) => l.cantidad < 1)
    if (mala >= 0) {
      toast.error(`Revisa la cantidad de «${lineas[mala].nombre}»: es un entero de 1 en adelante.`)
      return
    }
    start(async () => {
      const r = await enviarTransferencia({ origenId, destinoId, lineas: cuerpo, nota, clave: clave.current })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      enviada.current = true
      clave.current = nuevaClave()
      toast.success(`Transferencia ${r.numero} enviada: ${formatearCantidad(r.unidades)} unidades en camino a ${destino}.`)
      router.push(`/admin/inventario/transferencias/${r.trasladoId}`)
    })
  }

  const campo = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
  return (
    <form onSubmit={enviar} className="space-y-6" aria-label="Nueva transferencia con envío">
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="tr-origen">Sucursal que envía</Label>
            <select
              id="tr-origen"
              value={origenId}
              onChange={(e) => {
                setOrigenId(e.target.value)
                if (e.target.value === destinoId) setDestinoId(sucursales.find((s) => s.id !== e.target.value)?.id ?? '')
                // Lo disponible que se enseñó era de la otra sucursal.
                setLineas((ls) => ls.map((l) => ({ ...l, disponible: null })))
              }}
              className={campo}
            >
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-destino">Sucursal que recibe</Label>
            <select id="tr-destino" value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className={campo}>
              {sucursales
                .filter((s) => s.id !== origenId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-nota">Nota (opcional)</Label>
            <Input id="tr-nota" value={nota} maxLength={MAX_NOTA_TRASLADO} onChange={(e) => setNota(e.target.value)} placeholder="Ej: reposición del fin de semana" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanBarcode className="h-4 w-4" aria-hidden />
            Productos que se envían
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Label htmlFor="tr-buscar" className="sr-only">
              Escanear o buscar un producto para enviar
            </Label>
            <Input
              id="tr-buscar"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void alPulsarEnter()
                }
              }}
              placeholder="Escanea el código de barras, o escribe el SKU o el nombre, y pulsa Enter"
              autoComplete="off"
              maxLength={80}
            />
            {buscando && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-label="Buscando" />}
            {visibles.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-background shadow-md" aria-label="Productos encontrados">
                {visibles.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => agregar(p)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                      <span>
                        {nombreCompleto(p.itemNombre, p.nombreVariante, p.esDefault)} <span className="text-xs text-muted-foreground">SKU {p.sku}</span>
                      </span>
                      {p.disponible !== null && <span className="text-xs text-muted-foreground">hay {formatearCantidad(p.disponible)} en {origen}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {lineas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay productos. Escanea el primero para empezar.</p>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Productos del envío">
              {lineas.map((l, i) => (
                <li key={l.varianteId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      SKU {l.sku}
                      {l.disponible !== null && ` · hay ${formatearCantidad(l.disponible)} disponibles en ${origen}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`tr-cant-${i}`} className="sr-only">
                      Cantidad de {l.nombre}
                    </Label>
                    <Input
                      id={`tr-cant-${i}`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={l.cantidad}
                      aria-invalid={entero(l.cantidad) === null || entero(l.cantidad) === 0 || (l.disponible !== null && (entero(l.cantidad) ?? 0) > l.disponible)}
                      onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))}
                      className="w-24 text-right tabular-nums"
                    />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Quitar ${l.nombre}`} onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {formatearCantidad(lineas.length)} producto{lineas.length === 1 ? '' : 's'} · {formatearCantidad(unidades)} unidad{unidades === 1 ? '' : 'es'}
              {origen && destino && ` · de ${origen} a ${destino}`}
            </p>
            <Button type="submit" disabled={pending || lineas.length === 0}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Truck className="mr-2 h-4 w-4" aria-hidden />}
              Enviar transferencia
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Al enviar, las unidades salen de {origen || 'el origen'} y quedan en camino: no están disponibles en ninguna sucursal hasta que {destino || 'el destino'} las reciba. Si no llegan, se cancela y vuelven al origen.
          </p>
        </CardContent>
      </Card>
    </form>
  )
}
