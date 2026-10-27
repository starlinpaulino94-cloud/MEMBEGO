'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ScanBarcode, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { buscarProductosParaEntrada, registrarEntradaMultiple } from '@/modules/inventory/actions'
import { MAX_LINEAS_ENTRADA, MAX_NOTA, MAX_REFERENCIA } from '@/modules/inventory/entradas'
import { costoOpcional } from '@/modules/inventory/costos'
import { validarLotesDeLinea } from '@/modules/inventory/lotes'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'
import { EditorDeLotes, loteNuevo, lotesParaEnviar, sumaDeLotes, type LoteForm } from './EditorDeLotes'

export interface SucursalOpcionForm {
  id: string
  nombre: string
}

/** Lo que devuelve la búsqueda de productos (el mismo contorno que `VarianteBuscable`, sin importar el módulo de lecturas al navegador). */
interface ProductoBuscado {
  id: string
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  disponible: number | null
  exacto: boolean
  /** INV-5a: el producto lleva lotes. */
  llevaLotes: boolean
  exigeVencimiento: boolean
  llevaSeries: boolean
}

interface LineaForm {
  varianteId: string
  nombre: string
  sku: string
  /** Lo vendible en la sucursal elegida cuando se añadió (null = no se sabe). */
  disponible: number | null
  /** Texto del campo: puede estar a medias mientras se teclea. */
  cantidad: string
  /** INV-3a: costo unitario (sin impuestos), solo si quien captura puede registrar costos. Vacío = sin costo. */
  costo: string
  /** INV-5a: si el producto lleva lotes, la cantidad es la suma de sus lotes y cada lote dice su código, su vencimiento y cuántos son. */
  llevaLotes: boolean
  exigeVencimiento: boolean
  llevaSeries: boolean
  lotes: LoteForm[]
}

const entero = (t: string): number | null => (/^\d{1,7}$/.test(t.trim()) ? Number(t.trim()) : null)

/** Las unidades de una línea: su cantidad, o —si lleva lotes— la suma de los suyos. */
const unidadesDe = (l: LineaForm): number => (l.llevaLotes ? sumaDeLotes(l.lotes, l.llevaSeries) : (entero(l.cantidad) ?? 0))

/**
 * UNA entrada de mercancía con todas sus líneas: se escanea o se busca cada
 * producto, se ajusta la cantidad y se registra todo junto (todo o nada) como un
 * documento con número. Un lector de código de barras escribe el código y pulsa
 * Enter: la coincidencia exacta se añade sola; escanear el mismo producto otra
 * vez suma una unidad a su línea.
 */
export function EntradaMultipleForm({ sucursales, conCostos = false }: { sucursales: SucursalOpcionForm[]; conCostos?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '')
  const [referencia, setReferencia] = useState('')
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
      // Sin texto no hay nada que buscar; las sugerencias viejas no se enseñan (ver `visibles`) y la respuesta que venga en camino se descarta.
      peticion.current++
      return
    }
    const turno = ++peticion.current
    const espera = setTimeout(async () => {
      setBuscando(true)
      const r = await buscarProductosParaEntrada(texto, sucursalId || null)
      if (turno !== peticion.current) return
      setBuscando(false)
      setSugerencias(r.ok ? r.productos : [])
    }, 250)
    return () => clearTimeout(espera)
  }, [q, sucursalId])

  // Avisa antes de perder una entrada a medias.
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
      // Escanear otra vez el mismo producto suma una unidad (en su primer lote, si lleva lotes).
      if (i >= 0) {
        return actuales.map((l, k) =>
          k !== i ? l : l.llevaSeries ? l : l.llevaLotes ? { ...l, lotes: l.lotes.map((x, j) => (j === 0 ? { ...x, cantidad: String((entero(x.cantidad) ?? 0) + 1) } : x)) } : { ...l, cantidad: String((entero(l.cantidad) ?? 0) + 1) }
        )
      }
      if (actuales.length >= MAX_LINEAS_ENTRADA) {
        toast.error(`Una entrada admite hasta ${MAX_LINEAS_ENTRADA} productos. Regístrala y empieza otra.`)
        return actuales
      }
      return [
        ...actuales,
        {
          varianteId: p.id,
          nombre: nombreCompleto(p.itemNombre, p.nombreVariante, p.esDefault),
          sku: p.sku,
          disponible: p.disponible,
          cantidad: '1',
          costo: '',
          llevaLotes: p.llevaLotes,
          exigeVencimiento: p.exigeVencimiento,
          llevaSeries: p.llevaSeries,
          lotes: p.llevaLotes ? [loteNuevo()] : [],
        },
      ]
    })
    setQ('')
    setSugerencias([])
  }

  async function alPulsarEnter() {
    const texto = q.trim()
    if (texto === '') return
    setBuscando(true)
    const r = await buscarProductosParaEntrada(texto, sucursalId || null)
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
  const unidades = lineas.reduce((s, l) => s + unidadesDe(l), 0)

  function registrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!sucursalId) {
      toast.error('Elige la sucursal que recibe la mercancía.')
      return
    }
    if (lineas.length === 0) {
      toast.error('Agrega al menos un producto a la entrada.')
      return
    }
    const cuerpo = lineas.map((l) => ({
      varianteId: l.varianteId,
      cantidad: unidadesDe(l),
      ...(conCostos && l.costo.trim() !== '' ? { costo: l.costo.trim() } : {}),
      ...(l.llevaLotes ? { lotes: lotesParaEnviar(l.lotes, l.llevaSeries) } : {}),
    }))
    const mala = cuerpo.findIndex((l) => l.cantidad < 1)
    if (mala >= 0) {
      toast.error(`Revisa la cantidad de «${lineas[mala].nombre}»: es un entero de 1 en adelante.`)
      return
    }
    // Los lotes de cada producto que los lleva, con las mismas reglas del servidor (que las vuelve a aplicar).
    for (let i = 0; i < lineas.length; i++) {
      const lote = cuerpo[i].lotes
      if (!lineas[i].llevaLotes || !lote) continue
      const v = validarLotesDeLinea(lote, cuerpo[i].cantidad, { exigirVencimiento: lineas[i].exigeVencimiento, series: lineas[i].llevaSeries })
      if (!v.ok) {
        toast.error(`«${lineas[i].nombre}»: ${v.error}`)
        return
      }
    }
    // El servidor vuelve a validar todo; esto solo ahorra el viaje y señala cuál línea es.
    for (let i = 0; i < lineas.length; i++) {
      if (!conCostos) break
      const c = costoOpcional(lineas[i].costo)
      if (!c.ok) {
        toast.error(`Revisa el costo de «${lineas[i].nombre}»: ${c.error}`)
        return
      }
    }
    start(async () => {
      const r = await registrarEntradaMultiple({ sucursalId, lineas: cuerpo, referencia, nota, clave: clave.current })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      enviada.current = true
      clave.current = nuevaClave()
      toast.success(`Entrada ${r.numero} registrada: ${formatearCantidad(r.unidades)} unidades.`)
      router.push(`/admin/inventario/entradas/${r.entradaId}`)
    })
  }

  const campo = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
  return (
    <form onSubmit={registrar} className="space-y-6" aria-label="Nueva entrada de mercancía">
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="en-sucursal">Sucursal que recibe</Label>
            <select
              id="en-sucursal"
              value={sucursalId}
              onChange={(e) => {
                setSucursalId(e.target.value)
                // Lo vendible que se enseñó era de la otra sucursal.
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
            <Label htmlFor="en-referencia">Factura o referencia (opcional)</Label>
            <Input id="en-referencia" value={referencia} maxLength={MAX_REFERENCIA} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej: F-1045 del proveedor" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="en-nota">Nota (opcional)</Label>
            <Input id="en-nota" value={nota} maxLength={MAX_NOTA} onChange={(e) => setNota(e.target.value)} placeholder="Ej: llegó un bulto roto" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanBarcode className="h-4 w-4" aria-hidden />
            Productos que llegaron
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Label htmlFor="en-buscar" className="sr-only">
              Escanear o buscar un producto
            </Label>
            <Input
              id="en-buscar"
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
                      {p.disponible !== null && <span className="text-xs text-muted-foreground">hay {formatearCantidad(p.disponible)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {lineas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay productos. Escanea el primero para empezar.</p>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Productos de la entrada">
              {lineas.map((l, i) => (
                <li key={l.varianteId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      SKU {l.sku}
                      {l.disponible !== null && ` · hay ${formatearCantidad(l.disponible)} ahora`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {l.llevaLotes ? (
                      <p className="w-24 text-right text-sm tabular-nums" aria-label={`Total de ${l.nombre}`}>
                        {formatearCantidad(unidadesDe(l))}
                      </p>
                    ) : (
                      <>
                        <Label htmlFor={`en-cant-${i}`} className="sr-only">
                          Cantidad de {l.nombre}
                        </Label>
                        <Input
                          id={`en-cant-${i}`}
                          inputMode="numeric"
                          autoComplete="off"
                          value={l.cantidad}
                          aria-invalid={entero(l.cantidad) === null || entero(l.cantidad) === 0}
                          onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))}
                          className="w-24 text-right tabular-nums"
                        />
                      </>
                    )}
                    {conCostos && (
                      <>
                        <Label htmlFor={`en-costo-${i}`} className="sr-only">
                          Costo unitario de {l.nombre}
                        </Label>
                        <Input
                          id={`en-costo-${i}`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="Costo"
                          value={l.costo}
                          aria-invalid={!costoOpcional(l.costo).ok}
                          onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, costo: e.target.value } : x)))}
                          className="w-28 text-right tabular-nums"
                        />
                      </>
                    )}
                    <Button type="button" variant="ghost" size="icon" aria-label={`Quitar ${l.nombre}`} onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  {l.llevaLotes && (
                    <EditorDeLotes
                      nombre={l.nombre}
                      exigeVencimiento={l.exigeVencimiento}
                      series={l.llevaSeries}
                      lotes={l.lotes}
                      idBase="en"
                      indice={i}
                      onChange={(lotes) => setLineas((ls) => ls.map((y, k) => (k === i ? { ...y, lotes } : y)))}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {formatearCantidad(lineas.length)} producto{lineas.length === 1 ? '' : 's'} · {formatearCantidad(unidades)} unidad{unidades === 1 ? '' : 'es'}
            </p>
            <Button type="submit" disabled={pending || lineas.length === 0}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Registrar entrada
            </Button>
          </div>
          {conCostos && (
            <p className="text-xs text-muted-foreground">
              El costo es opcional y va por unidad, sin impuestos y con punto decimal (ej: 12.50). Un producto con costo actualiza su costo promedio; sin costo la entrada no lo cambia.
            </p>
          )}
          <p className="text-xs text-muted-foreground">Se registra todo junto: si un producto falla, no entra ninguno. Una entrada ya registrada no se edita; un error se corrige con un ajuste.</p>
        </CardContent>
      </Card>
    </form>
  )
}
