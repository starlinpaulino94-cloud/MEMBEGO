'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearYPublicarOfertaAction } from '@/modules/supply-v2/actions-ofertas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { OfertaCreada } from '@/modules/supply-v2/offers/service'
import type { SupplyV2OfferPriceMode } from '@prisma/client'

export interface ProductoOfertable {
  id: string
  name: string
  proveedor: string
  unit: string
  currency: string
  publicPrice: string | null
  disponibles: number
  costoPromedio: number
}

const PASOS = ['Producto', 'Cantidad', 'Precio', 'Vigencia', 'Reglas', 'Resumen'] as const

function dinero(n: number | string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * MEMBEGO SUPPLY 2.0 · CREAR OFERTA (§10–§16). Seis pasos; al final se crea y
 * se PUBLICA en una transacción: el supply se aparta en ese momento, nunca
 * antes. Los cálculos de aquí son orientativos; el servidor los rehace.
 */
export function WizardOferta({ productos, productoInicial }: { productos: ProductoOfertable[]; productoInicial?: string }) {
  const router = useRouter()
  const [paso, setPaso] = useState(1)
  const inicial = productos.find((p) => p.id === productoInicial) ?? null
  const [productoId, setProductoId] = useState(inicial?.id ?? '')
  const [cantidad, setCantidad] = useState('')
  const [precioPublico, setPrecioPublico] = useState(inicial?.publicPrice ?? '')
  const [precioMembego, setPrecioMembego] = useState('')
  const [modo, setModo] = useState<SupplyV2OfferPriceMode>('FIXED')
  const [porcentaje, setPorcentaje] = useState('')
  const hoy = new Date().toISOString().slice(0, 10)
  const [inicio, setInicio] = useState(hoy)
  const [fin, setFin] = useState('')
  const [limite, setLimite] = useState('1')
  const [titulo, setTitulo] = useState(inicial?.name ?? '')
  const [descripcion, setDescripcion] = useState('')

  const producto = productos.find((p) => p.id === productoId) ?? null
  // Al elegir producto se rellenan los campos vacíos (precio público y título)
  // desde el propio cambio, sin efectos: lo ya escrito no se pisa.
  const elegirProducto = (id: string) => {
    setProductoId(id)
    const p = productos.find((x) => x.id === id)
    if (!p) return
    if (!precioPublico && p.publicPrice) setPrecioPublico(p.publicPrice)
    if (!titulo) setTitulo(p.name)
  }

  const [estado, accion, pendiente] = useActionState<EstadoAccion<OfertaCreada>, FormData>(crearYPublicarOfertaAction, {})
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.id || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    router.push(`/superadmin/supply-v2/ofertas/${estado.id}`)
  }, [estado, router])

  const moneda = producto?.currency ?? 'DOP'
  const q = Number(cantidad) || 0
  const pub = Number(precioPublico) || 0
  // El precio Membego es DERIVADO en los modos que no son fijo: el operador
  // escribe un porcentaje o nada, y el importe sale de ahí. Es la misma cuenta
  // que hace el servidor (redondea el descuento y luego resta), para que la
  // pantalla no prometa un número y el servidor cobre otro.
  const pctEscrito = Number(porcentaje) || 0
  const sale =
    modo === 'FREE' ? 0
    : modo === 'PERCENTAGE' ? Math.max(0, pub - Math.round(pub * pctEscrito) / 100)
    : Number(precioMembego) || 0
  const ahorro = pub - sale
  const pct = pub > 0 ? Math.round(((pub - sale) / pub) * 1000) / 10 : 0
  const margen = producto ? sale - producto.costoPromedio : 0
  const precioListo =
    pub > 0 &&
    (modo === 'FREE' ||
      (modo === 'PERCENTAGE' && pctEscrito > 0 && pctEscrito <= 100) ||
      (modo === 'FIXED' && precioMembego !== '' && sale >= 0 && sale <= pub))
  const listo = [
    Boolean(producto),
    q > 0 && Boolean(producto) && q <= (producto?.disponibles ?? 0),
    precioListo && precioPublico !== '',
    Boolean(inicio) && (!fin || fin >= inicio),
    Number(limite) > 0 && Number(limite) <= q && titulo.trim().length > 0,
    true,
  ]
  const siguiente = () => setPaso((p) => Math.min(6, p + 1))
  const anterior = () => setPaso((p) => Math.max(1, p - 1))
  const select = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <div className="space-y-5" data-testid="wizard-oferta">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Pasos">
        {PASOS.map((nombre, i) => {
          const n = i + 1
          const puedeIr = n <= paso || listo.slice(0, n - 1).every(Boolean)
          return (
            <li key={nombre}>
              <button type="button" disabled={!puedeIr} onClick={() => setPaso(n)} aria-current={paso === n ? 'step' : undefined} className={`rounded-full border px-3 py-1 ${paso === n ? 'border-primary bg-primary/10 text-primary' : listo[i] && n < paso ? 'border-success/40 text-success' : 'border-border'} disabled:opacity-50`}>
                {n}. {nombre}
              </button>
            </li>
          )
        })}
      </ol>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {paso === 1 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Qué producto vas a ofrecer?</h2>
              {productos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay productos con supply disponible. <Link href="/superadmin/supply-v2/compras/nueva" className="underline">Compra y recibe supply</Link> primero.
                </p>
              ) : (
                <div>
                  <Label htmlFor="ofertaProducto">Producto</Label>
                  <select id="ofertaProducto" className={select} value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
                    <option value="">Selecciona un producto…</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.proveedor} · {p.disponibles.toLocaleString('es-DO')} disponibles
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {producto && (
                <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-4" data-testid="oferta-producto-resumen">
                  <Dato k="Proveedor" v={producto.proveedor} />
                  <Dato k="Disponible" v={producto.disponibles.toLocaleString('es-DO')} />
                  <Dato k="Costo promedio" v={dinero(producto.costoPromedio, moneda)} />
                  <Dato k="Precio público" v={producto.publicPrice ? dinero(producto.publicPrice, moneda) : '—'} />
                </dl>
              )}
            </section>
          )}

          {paso === 2 && producto && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Cuántas unidades quieres destinar?</h2>
              <div className="max-w-xs">
                <Label htmlFor="ofertaCantidad">Unidades</Label>
                <Input id="ofertaCantidad" type="number" min={1} max={producto.disponibles} step={1} inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="100" />
              </div>
              <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-3">
                <Dato k="Disponibles antes" v={producto.disponibles.toLocaleString('es-DO')} />
                <Dato k="Se asignarán" v={q.toLocaleString('es-DO')} />
                <Dato k="Quedarán sin asignar" v={Math.max(0, producto.disponibles - q).toLocaleString('es-DO')} />
              </dl>
              {q > producto.disponibles && <p className="text-sm text-destructive">Solo hay {producto.disponibles.toLocaleString('es-DO')} disponibles.</p>}
              <p className="text-caption text-muted-foreground">Las unidades se apartan al publicar la oferta, no antes: un borrador no bloquea supply.</p>
            </section>
          )}

          {paso === 3 && producto && (
            <section className="space-y-3">
              <h2 className="text-h3">¿A qué precio?</h2>
              <div>
                <Label htmlFor="ofertaPrecioPublico">Precio público ({moneda})</Label>
                <Input id="ofertaPrecioPublico" type="number" min={0} step="0.01" inputMode="decimal" value={precioPublico} onChange={(e) => setPrecioPublico(e.target.value)} />
                <p className="text-caption text-muted-foreground">Lo que cuesta normalmente. Es el ancla de cualquier descuento, así que va siempre.</p>
              </div>

              <div>
                <Label htmlFor="ofertaModoPrecio">¿Cómo se fija el precio?</Label>
                <select
                  id="ofertaModoPrecio"
                  className={select}
                  value={modo}
                  onChange={(e) => setModo(e.target.value as SupplyV2OfferPriceMode)}
                  data-testid="oferta-modo-precio"
                >
                  <option value="FIXED">Un precio fijo</option>
                  <option value="PERCENTAGE">Un porcentaje de descuento</option>
                  <option value="FREE">Gratis</option>
                </select>
              </div>

              {modo === 'FIXED' && (
                <div>
                  <Label htmlFor="ofertaPrecioMembego">Precio Membego ({moneda})</Label>
                  <Input id="ofertaPrecioMembego" type="number" min={0} step="0.01" inputMode="decimal" value={precioMembego} onChange={(e) => setPrecioMembego(e.target.value)} placeholder="399" />
                </div>
              )}

              {modo === 'PERCENTAGE' && (
                <div>
                  <Label htmlFor="ofertaPorcentaje">Descuento (%)</Label>
                  <Input id="ofertaPorcentaje" type="number" min={0.01} max={100} step="0.01" inputMode="decimal" value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} placeholder="35" data-testid="oferta-porcentaje" />
                  <p className="text-caption text-muted-foreground">
                    Se guarda el porcentaje, no el importe: si mañana cambia el precio público, el descuento sigue siendo el que elegiste.
                  </p>
                </div>
              )}

              {modo === 'FREE' && (
                <p className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm" data-testid="oferta-gratis-aviso">
                  El cliente no paga nada y confirma su compra sin transferencia. Tú sigues pagando el costo del lote, así que el margen será negativo: es el costo de regalarla.
                </p>
              )}

              {modo === 'FIXED' && sale > pub && <p className="text-sm text-destructive">El precio Membego no puede ser mayor que el público.</p>}
              {modo === 'PERCENTAGE' && pctEscrito > 100 && <p className="text-sm text-destructive">Un porcentaje no puede superar 100.</p>}
              <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-4" data-testid="oferta-precio-resumen">
                <Dato k="Descuento" v={`${pct} %`} />
                <Dato k="Ahorro del cliente" v={dinero(ahorro, moneda)} />
                <Dato k="Costo estimado Membego" v={dinero(producto.costoPromedio, moneda)} />
                <Dato k="Margen estimado / unidad" v={dinero(margen, moneda)} />
              </dl>
              <p className="text-caption text-muted-foreground">El margen es estimado: el costo real lo fija el lote que financie cada venta.</p>
            </section>
          )}

          {paso === 4 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Cuándo estará vigente?</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ofertaInicio">Inicio</Label>
                  <Input id="ofertaInicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="ofertaFin">Fin (opcional)</Label>
                  <Input id="ofertaFin" type="date" value={fin} min={inicio} onChange={(e) => setFin(e.target.value)} />
                </div>
              </div>
              {fin && fin < inicio && <p className="text-sm text-destructive">La fecha de fin tiene que ser posterior a la de inicio.</p>}
              <p className="text-caption text-muted-foreground">Una oferta con inicio futuro se publica como programada y se activa sola ese día.</p>
            </section>
          )}

          {paso === 5 && (
            <section className="space-y-3">
              <h2 className="text-h3">Reglas y presentación</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="ofertaTitulo">Título que verá el cliente</Label>
                  <Input id="ofertaTitulo" maxLength={160} value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="ofertaLimite">Máximo por persona</Label>
                  <Input id="ofertaLimite" type="number" min={1} max={q || undefined} step={1} inputMode="numeric" value={limite} onChange={(e) => setLimite(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="ofertaDescripcion">Descripción (opcional)</Label>
                  <Textarea id="ofertaDescripcion" rows={3} maxLength={2000} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
                </div>
              </div>
              {Number(limite) > q && <p className="text-sm text-destructive">El máximo por persona no puede superar las {q} unidades de la oferta.</p>}
            </section>
          )}

          {paso === 6 && producto && (
            <form action={accion} className="space-y-4" data-testid="form-publicar-oferta">
              <h2 className="text-h3">Resumen de la oferta</h2>
              <input type="hidden" name="catalogItemId" value={producto.id} />
              <input type="hidden" name="title" value={titulo} />
              <input type="hidden" name="description" value={descripcion} />
              <input type="hidden" name="publicPrice" value={precioPublico} />
              {/* En PERCENTAGE y FREE no se manda importe: lo resuelve el
                  servidor desde el modo. Mandar el número de la pantalla
                  convertiría una estimación del navegador en el precio real. */}
              {modo === 'FIXED' && <input type="hidden" name="salePrice" value={precioMembego} />}
              <input type="hidden" name="priceMode" value={modo} />
              {modo === 'PERCENTAGE' && <input type="hidden" name="priceModePercentage" value={porcentaje} />}
              <input type="hidden" name="quantity" value={cantidad} />
              <input type="hidden" name="perCustomerLimit" value={limite} />
              <input type="hidden" name="startsAt" value={inicio} />
              <input type="hidden" name="endsAt" value={fin} />
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Fila k="Producto" v={`${producto.name} · ${producto.proveedor}`} />
                <Fila k="Título" v={titulo} />
                <Fila k="Unidades destinadas" v={q.toLocaleString('es-DO')} />
                <Fila k="Quedarán disponibles" v={Math.max(0, producto.disponibles - q).toLocaleString('es-DO')} />
                <Fila k="Precio público" v={dinero(pub, moneda)} />
                <Fila k="Precio Membego" v={dinero(sale, moneda)} destacado />
                <Fila k="Ahorro del cliente" v={`${dinero(ahorro, moneda)} (${pct} %)`} />
                <Fila k="Margen estimado / unidad" v={dinero(margen, moneda)} />
                <Fila k="Vigencia" v={`${inicio}${fin ? ` → ${fin}` : ' → sin fecha de fin'}`} />
                <Fila k="Máximo por persona" v={limite} />
              </dl>
              {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={anterior} disabled={pendiente}>Atrás</Button>
                <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-publicar-oferta">Publicar oferta</Button>
              </div>
              <p className="text-caption text-muted-foreground">Al publicar se apartan las {q.toLocaleString('es-DO')} unidades del supply disponible.</p>
            </form>
          )}

          {paso < 6 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {paso > 1 && <Button type="button" variant="outline" onClick={anterior}>Atrás</Button>}
              <Button type="button" onClick={siguiente} disabled={!listo[paso - 1]}>Continuar</Button>
              <Link href="/superadmin/supply-v2/ofertas" className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline">Cancelar</Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  )
}

function Fila({ k, v, destacado = false }: { k: string; v: string; destacado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={destacado ? 'text-h3 tabular-nums' : 'text-right font-medium'}>{v}</dd>
    </div>
  )
}
