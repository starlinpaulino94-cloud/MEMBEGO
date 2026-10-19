'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { guardarOrdenCompra } from '@/modules/inventory/actions'
import { MAX_LINEAS_ORDEN } from '@/modules/inventory/compras'
import { formatearMonto, parsearCosto, valorDe } from '@/modules/inventory/costos'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { NOTA_BORRADOR_REPOSICION } from '@/modules/inventory/reposicion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'

/** Una línea de la propuesta, ya lista para pintar (sin tipos de servidor: el costo viaja como el texto de su campo). */
export interface LineaReposicionVista {
  varianteId: string
  sku: string
  producto: string
  nombreVariante: string
  esDefault: boolean
  disponible: number
  pedido: number
  enCamino: number
  enBorrador: number
  umbral: number
  llenarHasta: number
  sugerida: number
  /** El último costo de su proveedor, tal como se escribe en el campo; '' = no se sabe. */
  costo: string
}

export interface GrupoReposicionVista {
  clave: string
  proveedor: { id: string; nombre: string } | null
  sucursalId: string
  sucursalNombre: string
  lineas: LineaReposicionVista[]
  borradores: Array<{ id: string; numero: string }>
}

interface EstadoLinea {
  incluir: boolean
  cantidad: string
  costo: string
}

/** Un entero de 1 a un millón (el tope de cualquier cantidad de inventario; el servidor lo vuelve a comprobar) escrito con dígitos, o null. */
function entero(t: string): number | null {
  if (!/^\d{1,7}$/.test(t.trim())) return null
  const n = Number(t.trim())
  return n >= 1 && n <= 1_000_000 ? n : null
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <span className="whitespace-nowrap">
      {etiqueta} <span className="font-medium tabular-nums text-foreground">{formatearCantidad(valor)}</span>
    </span>
  )
}

/**
 * Un grupo de la propuesta de Reposición: lo que hay que pedirle a UN proveedor para UNA sucursal. Cada producto trae su
 * cantidad sugerida y el último costo de ese proveedor, y se pueden corregir o dejar fuera antes de crear el BORRADOR de la
 * orden de compra (que no pide nada: se revisa y se pide desde su propia pantalla). Sin proveedor no hay orden que crear: se
 * manda a la ficha de cada producto a vincular uno.
 */
export function ReposicionGrupoCard({ grupo }: { grupo: GrupoReposicionVista }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // Una orden admite MAX_LINEAS_ORDEN productos: si el grupo trae más, solo los primeros vienen marcados.
  const [estado, setEstado] = useState<EstadoLinea[]>(() => grupo.lineas.map((l, i) => ({ incluir: i < MAX_LINEAS_ORDEN, cantidad: String(l.sugerida), costo: l.costo })))
  const clave = useRef(nuevaClave())
  const proveedor = grupo.proveedor

  const incluidas = estado.map((e, i) => ({ e, l: grupo.lineas[i] })).filter((x) => x.e.incluir)
  const unidades = incluidas.reduce((t, x) => t + (entero(x.e.cantidad) ?? 0), 0)
  let valor = BigInt(0)
  let incompletas = 0
  for (const { e } of incluidas) {
    const c = parsearCosto(e.costo)
    const n = entero(e.cantidad)
    if (n === null || !c.ok) incompletas++
    else valor += valorDe(n, c.valor)
  }
  const demasiadas = incluidas.length > MAX_LINEAS_ORDEN

  function cambiar(i: number, parte: Partial<EstadoLinea>) {
    setEstado((ls) => ls.map((x, k) => (k === i ? { ...x, ...parte } : x)))
  }

  function crear(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    if (!proveedor) return
    if (incluidas.length === 0) {
      toast.error('Marca al menos un producto para el borrador.')
      return
    }
    if (demasiadas) {
      toast.error(`Una orden admite hasta ${MAX_LINEAS_ORDEN} productos: desmarca algunos y crea otra orden con los demás.`)
      return
    }
    const lineas: { varianteId: string; cantidad: number; costo: string }[] = []
    for (const { e, l } of incluidas) {
      const nombre = nombreCompleto(l.producto, l.nombreVariante, l.esDefault)
      const n = entero(e.cantidad)
      if (n === null) {
        toast.error(`Revisa la cantidad de «${nombre}»: es un entero de 1 en adelante.`)
        return
      }
      const c = parsearCosto(e.costo)
      if (!c.ok) {
        toast.error(`«${nombre}»: ${e.costo.trim() === '' ? 'escribe el costo. Una orden de compra dice cuánto cuesta cada producto.' : c.error}`)
        return
      }
      lineas.push({ varianteId: l.varianteId, cantidad: n, costo: e.costo.trim() })
    }
    start(async () => {
      const r = await guardarOrdenCompra({ cabecera: { proveedorId: proveedor.id, sucursalId: grupo.sucursalId, nota: NOTA_BORRADOR_REPOSICION }, lineas, clave: clave.current })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      clave.current = nuevaClave()
      toast.success(`Borrador ${r.numero} creado para ${proveedor.nombre}: ${formatearCantidad(r.unidades)} unidades por ${r.valor}. Revísalo y pídelo cuando estés listo.`)
      router.push(`/admin/inventario/compras/${r.ordenId}`)
    })
  }

  const titulo = proveedor ? `${proveedor.nombre} → ${grupo.sucursalNombre}` : `Sin proveedor → ${grupo.sucursalNombre}`
  return (
    <Card data-grupo={grupo.clave}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <Badge variant="secondary">
          {formatearCantidad(grupo.lineas.length)} producto{grupo.lineas.length === 1 ? '' : 's'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {!proveedor && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Estos productos no tienen un proveedor al que pedirlos: ninguno marcado como preferido, o varios sin preferido. Abre cada uno y vincula su proveedor en «Proveedores de este producto» para que aparezcan en su grupo.
          </p>
        )}
        {proveedor && grupo.borradores.length > 0 && (
          <Alert role="status">
            <AlertDescription>
              Ya tienes {grupo.borradores.length === 1 ? 'un borrador' : `${grupo.borradores.length} borradores`} de este proveedor para esta sucursal:{' '}
              {grupo.borradores.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ', '}
                  <Link href={`/admin/inventario/compras/${b.id}`} className="font-medium underline underline-offset-2">
                    {b.numero}
                  </Link>
                </span>
              ))}
              . Revísalo antes de crear otro: un borrador no cuenta como pedido, y esta lista no lo descuenta.
            </AlertDescription>
          </Alert>
        )}
        {proveedor && grupo.lineas.length > MAX_LINEAS_ORDEN && (
          <Alert role="status">
            <AlertDescription>
              Este grupo tiene {formatearCantidad(grupo.lineas.length)} productos y una orden admite {MAX_LINEAS_ORDEN}: vienen marcados los primeros {MAX_LINEAS_ORDEN}. Crea esa orden y después otra con los demás.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={crear} aria-label={`Reposición de ${proveedor?.nombre ?? 'productos sin proveedor'} en ${grupo.sucursalNombre}`} className="space-y-4">
          <ul className="divide-y rounded-lg border" aria-label={`Productos por reponer: ${titulo}`}>
            {grupo.lineas.map((l, i) => {
              const nombre = nombreCompleto(l.producto, l.nombreVariante, l.esDefault)
              const e = estado[i]
              return (
                <li key={l.varianteId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">
                      <Link href={`/admin/inventario/${l.varianteId}`} className="underline-offset-2 hover:underline">
                        {nombre}
                      </Link>
                    </p>
                    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>SKU {l.sku}</span>
                      <Dato etiqueta="Hay" valor={l.disponible} />
                      {l.pedido > 0 && <Dato etiqueta="Pedido" valor={l.pedido} />}
                      {l.enCamino > 0 && <Dato etiqueta="En camino" valor={l.enCamino} />}
                      {l.enBorrador > 0 && <Dato etiqueta="En borrador" valor={l.enBorrador} />}
                      <Dato etiqueta="Llenar hasta" valor={l.llenarHasta} />
                      {l.umbral > 0 && <Dato etiqueta="Avisa en" valor={l.umbral} />}
                    </p>
                  </div>
                  {proveedor ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`rp-inc-${grupo.clave}-${i}`}
                        checked={e.incluir}
                        onChange={(ev) => cambiar(i, { incluir: ev.target.checked })}
                        aria-label={`Incluir ${nombre} en el borrador`}
                        className="h-4 w-4"
                      />
                      <Label htmlFor={`rp-cant-${grupo.clave}-${i}`} className="sr-only">
                        Cantidad de {nombre}
                      </Label>
                      <Input
                        id={`rp-cant-${grupo.clave}-${i}`}
                        inputMode="numeric"
                        autoComplete="off"
                        value={e.cantidad}
                        disabled={!e.incluir}
                        aria-invalid={e.incluir && entero(e.cantidad) === null}
                        onChange={(ev) => cambiar(i, { cantidad: ev.target.value })}
                        className="w-24 text-right tabular-nums"
                      />
                      <Label htmlFor={`rp-costo-${grupo.clave}-${i}`} className="sr-only">
                        Costo de {nombre}
                      </Label>
                      <Input
                        id={`rp-costo-${grupo.clave}-${i}`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={e.costo}
                        placeholder="Costo"
                        disabled={!e.incluir}
                        aria-invalid={e.incluir && !parsearCosto(e.costo).ok}
                        onChange={(ev) => cambiar(i, { costo: ev.target.value })}
                        className="w-28 text-right tabular-nums"
                      />
                    </div>
                  ) : (
                    <p className="text-sm tabular-nums">
                      Sugerido <span className="font-semibold">{formatearCantidad(l.sugerida)}</span>
                    </p>
                  )}
                </li>
              )
            })}
          </ul>

          {proveedor && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {formatearCantidad(incluidas.length)} de {formatearCantidad(grupo.lineas.length)} producto{grupo.lineas.length === 1 ? '' : 's'} · {formatearCantidad(unidades)} unidad{unidades === 1 ? '' : 'es'} ·{' '}
                {formatearMonto(valor)}
                {incompletas > 0 && ` (faltan cantidad o costo en ${incompletas} línea${incompletas === 1 ? '' : 's'})`}
              </p>
              <Button type="submit" disabled={pending || incluidas.length === 0 || demasiadas}>
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />}
                Crear borrador de orden
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
