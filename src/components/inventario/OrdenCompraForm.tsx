'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PackagePlus, ScanBarcode, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { buscarProductosParaOrden, guardarOrdenCompra, pedirOrdenCompra } from '@/modules/inventory/actions'
import { MAX_LINEAS_ORDEN, MAX_NOTA_ORDEN, MAX_REFERENCIA_ORDEN } from '@/modules/inventory/compras'
import { formatearMonto, parsearCosto, valorDe } from '@/modules/inventory/costos'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'
import type { SucursalOpcionForm } from './EntradaMultipleForm'

/** Lo que devuelve la búsqueda (el mismo contorno que `ProductoParaOrden`, sin importar el módulo de lecturas al navegador). */
interface ProductoBuscado {
  id: string
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  disponible: number | null
  exacto: boolean
  costoSugerido: string | null
}

interface LineaForm {
  varianteId: string
  nombre: string
  sku: string
  /** Texto del campo: puede estar a medias mientras se teclea. */
  cantidad: string
  costo: string
}

export interface OrdenInicial {
  ordenId: string
  proveedorId: string
  sucursalId: string
  referencia: string
  nota: string
  fechaPrevista: string
  lineas: LineaForm[]
}

export interface ProveedorOpcionForm {
  id: string
  nombre: string
}

const entero = (t: string): number | null => (/^\d{1,7}$/.test(t.trim()) ? Number(t.trim()) : null)

/**
 * ARMAR una orden de compra (nueva, o editar un borrador): se elige el proveedor y la sucursal que recibe, se escanea o
 * se busca cada producto y se le pone cantidad y COSTO (el último al que se le compró a ese proveedor, si lo hay). Un
 * borrador no mueve stock ni costos. «Guardar y pedir» lo manda al proveedor de una vez: desde ahí las líneas no cambian.
 */
export function OrdenCompraForm({ proveedores, sucursales, inicial }: { proveedores: ProveedorOpcionForm[]; sucursales: SucursalOpcionForm[]; inicial?: OrdenInicial }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // Al editar un borrador, el proveedor o la sucursal que ya no están activos no se ofrecen: se elige otro.
  const [proveedorId, setProveedorId] = useState(proveedores.some((p) => p.id === inicial?.proveedorId) ? (inicial?.proveedorId ?? '') : (proveedores[0]?.id ?? ''))
  const [sucursalId, setSucursalId] = useState(sucursales.some((s) => s.id === inicial?.sucursalId) ? (inicial?.sucursalId ?? '') : (sucursales[0]?.id ?? ''))
  const [referencia, setReferencia] = useState(inicial?.referencia ?? '')
  const [nota, setNota] = useState(inicial?.nota ?? '')
  const [fechaPrevista, setFechaPrevista] = useState(inicial?.fechaPrevista ?? '')
  const [lineas, setLineas] = useState<LineaForm[]>(inicial?.lineas ?? [])
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
      const r = await buscarProductosParaOrden(texto, sucursalId || null, proveedorId || null)
      if (turno !== peticion.current) return
      setBuscando(false)
      setSugerencias(r.ok ? r.productos : [])
    }, 250)
    return () => clearTimeout(espera)
  }, [q, sucursalId, proveedorId])

  // Avisa antes de perder una orden a medias.
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
      if (actuales.length >= MAX_LINEAS_ORDEN) {
        toast.error(`Una orden admite hasta ${MAX_LINEAS_ORDEN} productos. Guárdala y empieza otra.`)
        return actuales
      }
      return [...actuales, { varianteId: p.id, nombre: nombreCompleto(p.itemNombre, p.nombreVariante, p.esDefault), sku: p.sku, cantidad: '1', costo: p.costoSugerido ?? '' }]
    })
    setQ('')
    setSugerencias([])
  }

  async function alPulsarEnter() {
    const texto = q.trim()
    if (texto === '') return
    setBuscando(true)
    const r = await buscarProductosParaOrden(texto, sucursalId || null, proveedorId || null)
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
  // El valor de lo que ya tiene cantidad y costo válidos; si falta alguno, se dice (no se cuenta como cero en silencio).
  let valor = BigInt(0)
  let sinCosto = 0
  for (const l of lineas) {
    const c = parsearCosto(l.costo)
    const n = entero(l.cantidad)
    if (!c.ok || n === null) sinCosto++
    else valor += valorDe(n, c.valor)
  }
  const proveedor = proveedores.find((p) => p.id === proveedorId)?.nombre ?? ''
  const sucursal = sucursales.find((s) => s.id === sucursalId)?.nombre ?? ''

  function guardar(pedir: boolean) {
    if (!proveedorId) {
      toast.error('Elige el proveedor de la orden.')
      return
    }
    if (!sucursalId) {
      toast.error('Elige la sucursal que recibe la mercancía.')
      return
    }
    if (lineas.length === 0) {
      toast.error('Agrega al menos un producto a la orden.')
      return
    }
    const cuerpo = lineas.map((l) => ({ varianteId: l.varianteId, cantidad: entero(l.cantidad) ?? 0, costo: l.costo.trim() }))
    const mala = cuerpo.findIndex((l) => l.cantidad < 1)
    if (mala >= 0) {
      toast.error(`Revisa la cantidad de «${lineas[mala].nombre}»: es un entero de 1 en adelante.`)
      return
    }
    const sinPrecio = cuerpo.findIndex((l) => !parsearCosto(l.costo).ok)
    if (sinPrecio >= 0) {
      const c = parsearCosto(cuerpo[sinPrecio].costo)
      toast.error(`«${lineas[sinPrecio].nombre}»: ${cuerpo[sinPrecio].costo === '' ? 'escribe el costo. Una orden de compra dice cuánto cuesta cada producto.' : c.ok ? '' : c.error}`)
      return
    }
    start(async () => {
      const r = await guardarOrdenCompra({
        ordenId: inicial?.ordenId ?? null,
        cabecera: { proveedorId, sucursalId, referencia, nota, fechaPrevista },
        lineas: cuerpo,
        clave: inicial ? null : clave.current,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      enviada.current = true
      clave.current = nuevaClave()
      if (pedir) {
        const p = await pedirOrdenCompra({ ordenId: r.ordenId })
        if (!p.ok) {
          toast.error(`Se guardó ${r.numero} como borrador, pero no se pudo pedir: ${p.error}`)
          router.push(`/admin/inventario/compras/${r.ordenId}`)
          return
        }
        toast.success(`Orden ${r.numero} pedida a ${proveedor}: ${formatearCantidad(r.unidades)} unidades por ${r.valor}.`)
      } else {
        toast.success(`Orden ${r.numero} guardada como borrador.`)
      }
      router.push(`/admin/inventario/compras/${r.ordenId}`)
    })
  }

  const campo = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        guardar(false)
      }}
      className="space-y-6"
      aria-label={inicial ? 'Editar orden de compra' : 'Nueva orden de compra'}
    >
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="oc-proveedor">Proveedor</Label>
            <select id="oc-proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className={campo}>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oc-sucursal">Sucursal que recibe</Label>
            <select id="oc-sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={campo}>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oc-prevista">Fecha prevista (opcional)</Label>
            <Input id="oc-prevista" type="date" value={fechaPrevista} onChange={(e) => setFechaPrevista(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oc-referencia">Cotización o referencia (opcional)</Label>
            <Input id="oc-referencia" value={referencia} maxLength={MAX_REFERENCIA_ORDEN} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej: cotización 2231" />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="oc-nota">Nota (opcional)</Label>
            <Input id="oc-nota" value={nota} maxLength={MAX_NOTA_ORDEN} onChange={(e) => setNota(e.target.value)} placeholder="Ej: urgente, para el fin de semana" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanBarcode className="h-4 w-4" aria-hidden />
            Productos que se piden
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Label htmlFor="oc-buscar" className="sr-only">
              Escanear o buscar un producto para pedir
            </Label>
            <Input
              id="oc-buscar"
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
                      <span className="text-xs text-muted-foreground">
                        {p.disponible !== null && `hay ${formatearCantidad(p.disponible)} en ${sucursal}`}
                        {p.costoSugerido && ` · último costo ${p.costoSugerido}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {lineas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay productos. Escanea o busca el primero para empezar.</p>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Productos de la orden">
              {lineas.map((l, i) => (
                <li key={l.varianteId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.nombre}</p>
                    <p className="text-xs text-muted-foreground">SKU {l.sku}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`oc-cant-${i}`} className="sr-only">
                      Cantidad de {l.nombre}
                    </Label>
                    <Input
                      id={`oc-cant-${i}`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={l.cantidad}
                      aria-invalid={entero(l.cantidad) === null || entero(l.cantidad) === 0}
                      onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))}
                      className="w-24 text-right tabular-nums"
                    />
                    <Label htmlFor={`oc-costo-${i}`} className="sr-only">
                      Costo de {l.nombre}
                    </Label>
                    <Input
                      id={`oc-costo-${i}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={l.costo}
                      placeholder="Costo"
                      aria-invalid={!parsearCosto(l.costo).ok}
                      onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, costo: e.target.value } : x)))}
                      className="w-28 text-right tabular-nums"
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
              {formatearCantidad(lineas.length)} producto{lineas.length === 1 ? '' : 's'} · {formatearCantidad(unidades)} unidad{unidades === 1 ? '' : 'es'} · {formatearMonto(valor)}
              {sinCosto > 0 && ` (faltan cantidad o costo en ${sinCosto} línea${sinCosto === 1 ? '' : 's'})`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline" disabled={pending || lineas.length === 0}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Guardar borrador
              </Button>
              <Button type="button" onClick={() => guardar(true)} disabled={pending || lineas.length === 0}>
                <PackagePlus className="mr-2 h-4 w-4" aria-hidden />
                Guardar y pedir
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            El costo es el que cobra el proveedor, sin impuestos. Un borrador no mueve el inventario ni los costos: eso pasa cuando llega la mercancía. Una vez pedida, las líneas ya no se editan.
          </p>
        </CardContent>
      </Card>
    </form>
  )
}
