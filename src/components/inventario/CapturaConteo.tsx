'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, ScanBarcode, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { buscarProductosParaConteo, contarProductoEnConteo, lotesParaContarProducto } from '@/modules/inventory/actions'
import { etiquetaDeLote } from '@/modules/inventory/conteos'
import { nombreCompleto } from '@/modules/inventory/formato'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Lo que devuelve la búsqueda (el mismo contorno que `VarianteBuscable`, sin importar el módulo de lecturas al navegador). */
interface ProductoBuscado {
  id: string
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  exacto: boolean
  /** INV-5b3: el producto lleva lotes: se cuenta lote por lote. */
  llevaLotes: boolean
}

/** Un lote entre los que se elige al contar (sin cantidades: es un conteo a ciegas). */
interface LoteElegible {
  loteId: string
  codigo: string
  vencimiento: string | null
  legado: boolean
  contado: boolean
}

interface Ultimo {
  ok: boolean
  texto: string
}

const entero = (t: string): number | null => (/^\d{1,4}$/.test(t.trim()) && Number(t) >= 1 ? Number(t.trim()) : null)

/**
 * La captura del conteo: se escanea (o se busca) un producto y se SUMA a lo
 * contado. Un lector escribe el código y pulsa Enter, varias veces por segundo,
 * así que cada captura entra en una COLA que se atiende en orden: el campo nunca
 * se bloquea y ningún escaneo se pierde. Cuando la cola se vacía, se refresca la
 * lista de abajo.
 *
 * A CIEGAS: no hay ni una cifra del sistema en esta pantalla; la búsqueda ni
 * siquiera pide sucursal. «Unidades por escaneo» sirve para contar por cajas.
 *
 * INV-5b3 · Un producto que LLEVA LOTES no se suma solo: al escanearlo se abre la lista de sus lotes (código y vencimiento, sin
 * cantidades) y cada clic cuenta las unidades indicadas en ESE lote. La lista sigue abierta para contar varios lotes del mismo producto.
 */
export function CapturaConteo({ conteoId }: { conteoId: string }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [porEscaneo, setPorEscaneo] = useState('1')
  const [sugerencias, setSugerencias] = useState<ProductoBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [pendientes, setPendientes] = useState(0)
  const [ultimo, setUltimo] = useState<Ultimo | null>(null)
  const [eligiendo, setEligiendo] = useState<{ producto: ProductoBuscado; lotes: LoteElegible[] } | null>(null)
  const cola = useRef<Promise<void>>(Promise.resolve())
  const enCurso = useRef(0)
  const peticion = useRef(0)

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
      const r = await buscarProductosParaConteo(texto)
      if (turno !== peticion.current) return
      setBuscando(false)
      setSugerencias(r.ok ? r.productos : [])
    }, 250)
    return () => clearTimeout(espera)
  }, [q])

  function encolar(tarea: () => Promise<void>) {
    enCurso.current++
    setPendientes(enCurso.current)
    cola.current = cola.current
      .then(tarea)
      .catch(() => undefined)
      .finally(() => {
        enCurso.current--
        setPendientes(enCurso.current)
        if (enCurso.current === 0) router.refresh()
      })
  }

  /** Cuenta `unidades` más de un producto; si lleva lotes, abre la lista de sus lotes para elegir en cuál. */
  async function sumar(p: ProductoBuscado, unidades: number) {
    const nombre = nombreCompleto(p.itemNombre, p.nombreVariante, p.esDefault)
    if (p.llevaLotes) {
      const l = await lotesParaContarProducto({ conteoId, varianteId: p.id })
      if (!l.ok) {
        setUltimo({ ok: false, texto: `${nombre}: ${l.error}` })
        toast.error(l.error)
        return
      }
      setEligiendo({ producto: p, lotes: l.lotes })
      setUltimo({ ok: true, texto: `${nombre} lleva lotes: elige el lote que estás contando.` })
      return
    }
    setEligiendo(null)
    const r = await contarProductoEnConteo({ conteoId, varianteId: p.id, cantidad: unidades, modo: 'SUMAR' })
    if (r.ok) setUltimo({ ok: true, texto: `${nombre}: ahora ${r.contado.toLocaleString('es-DO')} contados` })
    else {
      setUltimo({ ok: false, texto: `${nombre}: ${r.error}` })
      toast.error(r.error)
    }
  }

  /** Cuenta `unidades` más EN UN LOTE de un producto con lotes. */
  async function sumarEnLote(p: ProductoBuscado, lote: LoteElegible, unidades: number) {
    const nombre = nombreCompleto(p.itemNombre, p.nombreVariante, p.esDefault)
    const etiqueta = etiquetaDeLote(lote.codigo, lote.vencimiento)
    const r = await contarProductoEnConteo({ conteoId, varianteId: p.id, loteId: lote.loteId, cantidad: unidades, modo: 'SUMAR' })
    if (r.ok) {
      setUltimo({ ok: true, texto: `${nombre} · ${etiqueta}: ahora ${r.contado.toLocaleString('es-DO')} contados` })
      setEligiendo((e) => (e && e.producto.id === p.id ? { ...e, lotes: e.lotes.map((x) => (x.loteId === lote.loteId ? { ...x, contado: true } : x)) } : e))
    } else {
      setUltimo({ ok: false, texto: `${nombre} · ${etiqueta}: ${r.error}` })
      toast.error(r.error)
    }
  }

  function contarEnLote(p: ProductoBuscado, lote: LoteElegible) {
    const unidades = entero(porEscaneo)
    if (unidades === null) {
      toast.error('«Unidades por escaneo» debe ser un entero de 1 en adelante.')
      return
    }
    encolar(() => sumarEnLote(p, lote, unidades))
  }

  function contar(p: ProductoBuscado) {
    const unidades = entero(porEscaneo)
    if (unidades === null) {
      toast.error('«Unidades por escaneo» debe ser un entero de 1 en adelante.')
      return
    }
    setQ('')
    setSugerencias([])
    encolar(() => sumar(p, unidades))
  }

  function alPulsarEnter() {
    const texto = q.trim()
    if (texto === '') return
    const unidades = entero(porEscaneo)
    if (unidades === null) {
      toast.error('«Unidades por escaneo» debe ser un entero de 1 en adelante.')
      return
    }
    setQ('')
    setSugerencias([])
    encolar(async () => {
      const r = await buscarProductosParaConteo(texto)
      if (!r.ok) {
        setUltimo({ ok: false, texto: r.error })
        toast.error(r.error)
        return
      }
      if (r.productos.length === 0) {
        setUltimo({ ok: false, texto: `No encontré ningún producto que controle inventario con «${texto}».` })
        toast.error(`No encontré ningún producto que controle inventario con «${texto}».`)
        return
      }
      // Un lector: la coincidencia exacta se cuenta sola. Si hay duda, se elige de la lista.
      if (r.productos[0].exacto || r.productos.length === 1) {
        await sumar(r.productos[0], unidades)
        return
      }
      setQ(texto)
      setSugerencias(r.productos)
    })
  }

  const visibles = q.trim() === '' ? [] : sugerencias
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanBarcode className="h-4 w-4" aria-hidden />
          Contar productos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Label htmlFor="cc-buscar" className="sr-only">
              Escanear o buscar un producto para contar
            </Label>
            <Input
              id="cc-buscar"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  alPulsarEnter()
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
                    <button type="button" onClick={() => contar(p)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                      <span>
                        {nombreCompleto(p.itemNombre, p.nombreVariante, p.esDefault)} <span className="text-xs text-muted-foreground">SKU {p.sku}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-por-escaneo" className="text-xs text-muted-foreground">
              Unidades por escaneo
            </Label>
            <Input id="cc-por-escaneo" inputMode="numeric" autoComplete="off" value={porEscaneo} onChange={(e) => setPorEscaneo(e.target.value)} aria-invalid={entero(porEscaneo) === null} className="w-28 text-right tabular-nums" />
          </div>
        </div>
        {eligiendo && (
          <div className="space-y-2 rounded-lg border border-dashed p-3" role="group" aria-label={`Lotes de ${nombreCompleto(eligiendo.producto.itemNombre, eligiendo.producto.nombreVariante, eligiendo.producto.esDefault)}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {nombreCompleto(eligiendo.producto.itemNombre, eligiendo.producto.nombreVariante, eligiendo.producto.esDefault)} <span className="text-xs font-normal text-muted-foreground">lleva lotes: ¿en cuál cuentas?</span>
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEligiendo(null)}>
                Cerrar lotes
              </Button>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Lotes para contar">
              {eligiendo.lotes.map((l) => (
                <li key={l.loteId}>
                  <Button type="button" variant={l.contado ? 'secondary' : 'outline'} size="sm" onClick={() => contarEnLote(eligiendo.producto, l)}>
                    {etiquetaDeLote(l.codigo, l.vencimiento)}
                    {l.contado && <CheckCircle2 className="ml-1.5 h-3.5 w-3.5" aria-label="ya tiene conteo" />}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Cada clic suma las unidades de «Unidades por escaneo» al lote elegido. Si encuentras algo sin lote, cuéntalo en «SIN LOTE».</p>
          </div>
        )}
        <div className="min-h-6 text-sm" role="status" aria-live="polite">
          {pendientes > 0 ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Guardando {pendientes} captura{pendientes === 1 ? '' : 's'}…
            </span>
          ) : ultimo ? (
            <span className={ultimo.ok ? 'inline-flex items-center gap-2 text-success' : 'inline-flex items-center gap-2 text-destructive'}>
              {ultimo.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
              {ultimo.texto}
            </span>
          ) : (
            <span className="text-muted-foreground">Cada escaneo suma las unidades indicadas al producto. Para corregir un número, edítalo en la lista de abajo.</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
