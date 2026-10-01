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
import { crearYPublicarOfertaComisionAction } from '@/modules/supply-v2/actions-ofertas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { OfertaCreada } from '@/modules/supply-v2/offers/service'
import { AVAILABILITY_MODE_EXPLICACION, AVAILABILITY_MODE_LABELS } from '@/modules/supply-v2/core/catalogo'

export interface ProductoComisionable {
  id: string
  name: string
  category: string | null
  proveedor: string
  unit: string
  currency: string
  publicPrice: string | null
  commissionPercentage: string
  agreementCode: string
  agreementScope: 'ITEM' | 'CATEGORY' | 'CATALOG'
}

const PASOS = ['Producto', 'Disponibilidad', 'Precio', 'Vigencia', 'Reglas', 'Resumen'] as const
const ALCANCE: Record<ProductoComisionable['agreementScope'], string> = { ITEM: 'regla por producto', CATEGORY: 'regla por categoría', CATALOG: 'regla de todo el catálogo' }

function dinero(n: number | string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 5 · VENDER A COMISIÓN (§10–§12, §63).
 * Sin lote ni asignación: el producto trae su acuerdo a comisión resuelto en
 * el servidor (ITEM > CATEGORY > CATALOG) y la disponibilidad la declara el
 * proveedor. El reparto de aquí es orientativo; el servidor lo rehace.
 */
export function WizardOfertaComision({ productos, productoInicial }: { productos: ProductoComisionable[]; productoInicial?: string }) {
  const router = useRouter()
  const [paso, setPaso] = useState(1)
  const inicial = productos.find((p) => p.id === productoInicial) ?? null
  const [productoId, setProductoId] = useState(inicial?.id ?? '')
  const [modo, setModo] = useState<'UNLIMITED' | 'FIXED_QUANTITY' | 'CAPACITY'>('FIXED_QUANTITY')
  const [cantidad, setCantidad] = useState('')
  const [precioPublico, setPrecioPublico] = useState(inicial?.publicPrice ?? '')
  const [precioMembego, setPrecioMembego] = useState('')
  const hoy = new Date().toISOString().slice(0, 10)
  const [inicio, setInicio] = useState(hoy)
  const [fin, setFin] = useState('')
  const [limite, setLimite] = useState('1')
  const [titulo, setTitulo] = useState(inicial?.name ?? '')
  const [descripcion, setDescripcion] = useState('')

  const producto = productos.find((p) => p.id === productoId) ?? null
  const elegirProducto = (id: string) => {
    setProductoId(id)
    const p = productos.find((x) => x.id === id)
    if (!p) return
    if (!precioPublico && p.publicPrice) setPrecioPublico(p.publicPrice)
    if (!titulo) setTitulo(p.name)
  }

  const [estado, accion, pendiente] = useActionState<EstadoAccion<OfertaCreada>, FormData>(crearYPublicarOfertaComisionAction, {})
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.id || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    router.push(`/superadmin/supply-v2/ofertas/${estado.id}`)
  }, [estado, router])

  const moneda = producto?.currency ?? 'DOP'
  const sinTope = modo === 'UNLIMITED'
  const q = Number(cantidad) || 0
  const pub = Number(precioPublico) || 0
  const sale = Number(precioMembego) || 0
  const pct = producto ? Number(producto.commissionPercentage) : 0
  const comision = Math.round(sale * pct) / 100
  const neto = Math.round((sale - comision) * 100) / 100
  const descuento = pub > 0 ? Math.round(((pub - sale) / pub) * 1000) / 10 : 0
  const listo = [
    Boolean(producto),
    sinTope || q > 0,
    pub >= 0 && sale >= 0 && sale <= pub && precioMembego !== '' && precioPublico !== '',
    Boolean(inicio) && (!fin || fin >= inicio),
    Number(limite) > 0 && (sinTope || Number(limite) <= q) && titulo.trim().length > 0,
    true,
  ]
  const siguiente = () => setPaso((p) => Math.min(6, p + 1))
  const anterior = () => setPaso((p) => Math.max(1, p - 1))
  const select = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <div className="space-y-5" data-testid="wizard-oferta-comision">
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
              <h2 className="text-h3">¿Qué producto del proveedor vas a vender?</h2>
              {productos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ningún producto tiene un acuerdo a comisión vigente. <Link href="/superadmin/supply-v2/proveedores" className="underline">Crea un acuerdo a comisión</Link> (por producto, categoría o catálogo) en la ficha del proveedor.
                </p>
              ) : (
                <div>
                  <Label htmlFor="ofertaProductoComision">Producto</Label>
                  <select id="ofertaProductoComision" className={select} value={productoId} onChange={(e) => elegirProducto(e.target.value)} data-testid="comision-producto">
                    <option value="">Selecciona un producto…</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.proveedor} · comisión {p.commissionPercentage} %
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {producto && (
                <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-4" data-testid="comision-regla">
                  <Dato k="Proveedor" v={producto.proveedor} />
                  <Dato k="Comisión de Membego" v={`${producto.commissionPercentage} %`} />
                  <Dato k="Acuerdo que la fija" v={`${producto.agreementCode} (${ALCANCE[producto.agreementScope]})`} />
                  <Dato k="Precio público" v={producto.publicPrice ? dinero(producto.publicPrice, moneda) : '—'} />
                </dl>
              )}
              <p className="text-caption text-muted-foreground">Membego no compra nada: el proveedor sigue siendo dueño del inventario. Membego vende, cobra, retiene su comisión y le liquida el neto al entregar.</p>
            </section>
          )}

          {paso === 2 && producto && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Cuánto puede entregar el proveedor?</h2>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Disponibilidad">
                {(['UNLIMITED', 'FIXED_QUANTITY', 'CAPACITY'] as const).map((m) => (
                  <label key={m} className={`cursor-pointer rounded-lg border p-3 text-sm ${modo === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} data-testid={`comision-modo-${m}`}>
                    <input type="radio" name="modo" value={m} checked={modo === m} onChange={() => setModo(m)} className="mr-2" />
                    <span className="font-medium">{AVAILABILITY_MODE_LABELS[m]}</span>
                    <span className="block pl-5 text-caption text-muted-foreground">{AVAILABILITY_MODE_EXPLICACION[m]}</span>
                  </label>
                ))}
              </div>
              {!sinTope && (
                <div className="max-w-xs">
                  <Label htmlFor="ofertaCapacidad">{modo === 'CAPACITY' ? 'Capacidad (cupos)' : 'Unidades'}</Label>
                  <Input id="ofertaCapacidad" type="number" min={1} step={1} inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="100" data-testid="comision-cantidad" />
                </div>
              )}
              <p className="text-caption text-muted-foreground">No se aparta ningún lote: cada compra reserva su cupo y lo consume al pagarse; cancelar o expirar lo devuelve.</p>
            </section>
          )}

          {paso === 3 && producto && (
            <section className="space-y-3">
              <h2 className="text-h3">¿A qué precio?</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ofertaPrecioPublicoC">Precio público ({moneda})</Label>
                  <Input id="ofertaPrecioPublicoC" type="number" min={0} step="0.01" inputMode="decimal" value={precioPublico} onChange={(e) => setPrecioPublico(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="ofertaPrecioMembegoC">Precio Membego ({moneda})</Label>
                  <Input id="ofertaPrecioMembegoC" type="number" min={0} step="0.01" inputMode="decimal" value={precioMembego} onChange={(e) => setPrecioMembego(e.target.value)} placeholder="1000" data-testid="comision-precio" />
                </div>
              </div>
              {sale > pub && <p className="text-sm text-destructive">El precio Membego no puede ser mayor que el público.</p>}
              <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-4" data-testid="comision-reparto">
                <Dato k="Descuento" v={`${descuento} %`} />
                <Dato k="Cliente paga (GMV)" v={dinero(sale, moneda)} />
                <Dato k={`Comisión Membego (${pct} %)`} v={dinero(comision, moneda)} />
                <Dato k="Neto del proveedor" v={dinero(neto, moneda)} />
              </dl>
              <p className="text-caption text-muted-foreground">El ingreso de Membego es la comisión; el neto se le debe al proveedor cuando entrega. El servidor recalcula el reparto con dos decimales.</p>
            </section>
          )}

          {paso === 4 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Cuándo estará vigente?</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ofertaInicioC">Inicio</Label>
                  <Input id="ofertaInicioC" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="ofertaFinC">Fin (opcional)</Label>
                  <Input id="ofertaFinC" type="date" value={fin} min={inicio} onChange={(e) => setFin(e.target.value)} />
                </div>
              </div>
              {fin && fin < inicio && <p className="text-sm text-destructive">La fecha de fin tiene que ser posterior a la de inicio.</p>}
              <p className="text-caption text-muted-foreground">Los beneficios vendidos valen hasta el fin de la oferta; sin fecha de fin, no vencen.</p>
            </section>
          )}

          {paso === 5 && (
            <section className="space-y-3">
              <h2 className="text-h3">Reglas y presentación</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="ofertaTituloC">Título que verá el cliente</Label>
                  <Input id="ofertaTituloC" maxLength={160} value={titulo} onChange={(e) => setTitulo(e.target.value)} required data-testid="comision-titulo" />
                </div>
                <div>
                  <Label htmlFor="ofertaLimiteC">Máximo por persona</Label>
                  <Input id="ofertaLimiteC" type="number" min={1} max={sinTope ? undefined : q || undefined} step={1} inputMode="numeric" value={limite} onChange={(e) => setLimite(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="ofertaDescripcionC">Descripción (opcional)</Label>
                  <Textarea id="ofertaDescripcionC" rows={3} maxLength={2000} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
                </div>
              </div>
              {!sinTope && Number(limite) > q && <p className="text-sm text-destructive">El máximo por persona no puede superar las {q} unidades disponibles.</p>}
            </section>
          )}

          {paso === 6 && producto && (
            <form action={accion} className="space-y-4" data-testid="form-publicar-oferta-comision">
              <h2 className="text-h3">Resumen de la oferta a comisión</h2>
              <input type="hidden" name="catalogItemId" value={producto.id} />
              <input type="hidden" name="title" value={titulo} />
              <input type="hidden" name="description" value={descripcion} />
              <input type="hidden" name="publicPrice" value={precioPublico} />
              <input type="hidden" name="salePrice" value={precioMembego} />
              <input type="hidden" name="availabilityMode" value={modo} />
              <input type="hidden" name="availabilityQuantity" value={sinTope ? '' : cantidad} />
              <input type="hidden" name="perCustomerLimit" value={limite} />
              <input type="hidden" name="startsAt" value={inicio} />
              <input type="hidden" name="endsAt" value={fin} />
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Fila k="Producto" v={`${producto.name} · ${producto.proveedor}`} />
                <Fila k="Título" v={titulo} />
                <Fila k="Modelo" v="Vender a comisión (sin lote)" />
                <Fila k="Comisión" v={`${producto.commissionPercentage} % · ${producto.agreementCode} (${ALCANCE[producto.agreementScope]})`} />
                <Fila k="Disponibilidad" v={sinTope ? 'Sin tope' : `${q.toLocaleString('es-DO')} (${AVAILABILITY_MODE_LABELS[modo]})`} />
                <Fila k="Precio público" v={dinero(pub, moneda)} />
                <Fila k="Precio Membego" v={dinero(sale, moneda)} destacado />
                <Fila k="Comisión / unidad" v={dinero(comision, moneda)} />
                <Fila k="Neto del proveedor / unidad" v={dinero(neto, moneda)} />
                <Fila k="Vigencia" v={`${inicio}${fin ? ` → ${fin}` : ' → sin fecha de fin'}`} />
                <Fila k="Máximo por persona" v={limite} />
              </dl>
              {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={anterior} disabled={pendiente}>Atrás</Button>
                <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-publicar-oferta-comision">Publicar oferta a comisión</Button>
              </div>
              <p className="text-caption text-muted-foreground">Al publicar NO se aparta ningún lote: el acuerdo y la comisión quedan congelados en la oferta.</p>
            </form>
          )}

          {paso < 6 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {paso > 1 && <Button type="button" variant="outline" onClick={anterior}>Atrás</Button>}
              <Button type="button" onClick={siguiente} disabled={!listo[paso - 1]} data-testid="comision-continuar">Continuar</Button>
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
