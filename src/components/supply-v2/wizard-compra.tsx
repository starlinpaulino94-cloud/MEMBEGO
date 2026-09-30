'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearOrdenAction, type AcuerdoResumen, type EstadoAccion } from '@/modules/supply-v2/actions'
import type { OrdenCreada } from '@/modules/supply-v2/procurement/orders'
import type { ProveedorCreado } from '@/modules/supply-v2/suppliers/service'
import type { ItemCreado } from '@/modules/supply-v2/catalog/service'
import { acuerdoCompatible } from '@/modules/supply-v2/agreements/domain'
import {
  AGREEMENT_TYPE_LABELS,
  CATALOG_ITEM_TYPE_LABELS,
  PAYMENT_MODES_SLICE1,
  PAYMENT_MODE_LABELS,
} from '@/modules/supply-v2/core/catalogo'
import { FormProveedor } from './form-proveedor'
import { FormProducto } from './form-producto'
import { FormAcuerdo } from './form-acuerdo'

/** Lo que el servidor manda al wizard: proveedores activos con catálogo y acuerdos vigentes. */
export interface ProveedorWizard {
  id: string
  commercialName: string
  source: 'REGISTERED_COMPANY' | 'EXTERNAL'
  currency: string
  catalogItems: ItemWizard[]
  agreements: AcuerdoResumen[]
}

export interface ItemWizard {
  id: string
  name: string
  type: string
  sku: string | null
  category: string | null
  publicPrice: string | null
  currency: string
  unit: string
}

const PASOS = ['Proveedor', 'Producto', 'Acuerdo', 'Compra', 'Pago', 'Resumen'] as const

function dinero(n: number | string, moneda: string): string {
  const v = Number(n)
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${v.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * MEMBEGO SUPPLY 2.0 · NUEVA COMPRA (§32). Seis pasos; crear proveedor,
 * producto o acuerdo no saca a nadie del wizard: lo creado se añade a las
 * listas y se selecciona. Los totales que se ven aquí son orientativos; el
 * servidor los recalcula al crear la orden.
 */
export function WizardCompra({ proveedores: iniciales }: { proveedores: ProveedorWizard[] }) {
  const router = useRouter()
  const [proveedores, setProveedores] = useState(iniciales)
  const [paso, setPaso] = useState(1)
  const [proveedorId, setProveedorId] = useState('')
  const [productoId, setProductoId] = useState('')
  const [acuerdoId, setAcuerdoId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [costo, setCosto] = useState('')
  const [impuesto, setImpuesto] = useState('0')
  const [pago, setPago] = useState<string>('PREPAID')
  const [notas, setNotas] = useState('')
  const [creando, setCreando] = useState<'proveedor' | 'producto' | 'acuerdo' | null>(null)

  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null
  const producto = proveedor?.catalogItems.find((i) => i.id === productoId) ?? null
  const compatibles = useMemo(
    () =>
      proveedor && producto
        ? proveedor.agreements.filter((a) =>
            acuerdoCompatible(
              { ...a, startsAt: new Date(a.startsAt), endsAt: a.endsAt ? new Date(a.endsAt) : null },
              { id: producto.id, category: producto.category }
            )
          )
        : [],
    [proveedor, producto]
  )
  const acuerdo = compatibles.find((a) => a.id === acuerdoId) ?? null
  const moneda = acuerdo?.currency ?? proveedor?.currency ?? 'DOP'

  const [estado, accion, pendiente] = useActionState<EstadoAccion<OrdenCreada>, FormData>(crearOrdenAction, {})
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.id || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    router.push(`/superadmin/supply-v2/compras/${estado.id}`)
  }, [estado, router])

  const subtotal = (Number(cantidad) || 0) * (Number(costo) || 0)
  const impuestos = Math.round(subtotal * ((Number(impuesto) || 0) / 100) * 100) / 100
  const total = subtotal + impuestos

  const listo = [
    Boolean(proveedor),
    Boolean(producto),
    Boolean(acuerdo),
    Number(cantidad) > 0 && Number(costo) >= 0 && costo !== '',
    Boolean(pago),
    true,
  ]

  // ── Altas sin salir del wizard ─────────────────────────────────────────
  const alCrearProveedor = (p: ProveedorCreado) => {
    setProveedores((ls) => (ls.some((x) => x.id === p.id) ? ls : [...ls, { id: p.id, commercialName: p.commercialName, source: p.source, currency: p.currency, catalogItems: [], agreements: [] }]))
    setProveedorId(p.id)
    setProductoId('')
    setAcuerdoId('')
    setCreando(null)
    setPaso(2)
  }
  const alCrearProducto = (i: ItemCreado) => {
    setProveedores((ls) =>
      ls.map((p) => (p.id === proveedorId ? { ...p, catalogItems: [...p.catalogItems, { ...i, category: null }] } : p))
    )
    setProductoId(i.id)
    setAcuerdoId('')
    setCreando(null)
    setPaso(3)
  }
  const alCrearAcuerdo = (a: AcuerdoResumen) => {
    setProveedores((ls) => ls.map((p) => (p.id === proveedorId ? { ...p, agreements: [a, ...p.agreements] } : p)))
    setAcuerdoId(a.id)
    if (a.negotiatedUnitCost) setCosto(a.negotiatedUnitCost)
    setCreando(null)
    setPaso(4)
  }

  const elegirAcuerdo = (id: string) => {
    setAcuerdoId(id)
    const a = compatibles.find((x) => x.id === id)
    if (a?.negotiatedUnitCost && !costo) setCosto(a.negotiatedUnitCost)
  }

  const select = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm'
  const siguiente = () => setPaso((p) => Math.min(6, p + 1))
  const anterior = () => setPaso((p) => Math.max(1, p - 1))

  return (
    <div className="space-y-5" data-testid="wizard-compra">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Pasos">
        {PASOS.map((nombre, i) => {
          const n = i + 1
          const puedeIr = n <= paso || listo.slice(0, n - 1).every(Boolean)
          return (
            <li key={nombre}>
              <button
                type="button"
                disabled={!puedeIr}
                onClick={() => setPaso(n)}
                aria-current={paso === n ? 'step' : undefined}
                className={`rounded-full border px-3 py-1 ${paso === n ? 'border-primary bg-primary/10 text-primary' : listo[i] && n < paso ? 'border-success/40 text-success' : 'border-border'} disabled:opacity-50`}
              >
                {n}. {nombre}
              </button>
            </li>
          )
        })}
      </ol>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {/* ── 1 · Proveedor ─────────────────────────────────────────── */}
          {paso === 1 && (
            <section className="space-y-3" aria-labelledby="paso-proveedor">
              <h2 id="paso-proveedor" className="text-h3">¿A quién vamos a comprar?</h2>
              {creando === 'proveedor' ? (
                <div className="rounded-lg border border-border p-4">
                  <FormProveedor onCreado={alCrearProveedor} compacto />
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setCreando(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  {proveedores.length > 0 ? (
                    <div>
                      <Label htmlFor="wizardProveedor">Proveedor</Label>
                      <select
                        id="wizardProveedor"
                        className={select}
                        value={proveedorId}
                        onChange={(e) => {
                          setProveedorId(e.target.value)
                          setProductoId('')
                          setAcuerdoId('')
                        }}
                      >
                        <option value="">Selecciona un proveedor…</option>
                        {proveedores.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.commercialName}
                            {p.source === 'EXTERNAL' ? ' (externo)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Todavía no hay proveedores. Crea el primero aquí mismo.</p>
                  )}
                  <Button type="button" variant="outline" onClick={() => setCreando('proveedor')}>
                    + Crear proveedor
                  </Button>
                </>
              )}
            </section>
          )}

          {/* ── 2 · Producto ──────────────────────────────────────────── */}
          {paso === 2 && proveedor && (
            <section className="space-y-3" aria-labelledby="paso-producto">
              <h2 id="paso-producto" className="text-h3">¿Qué vamos a comprar a {proveedor.commercialName}?</h2>
              {creando === 'producto' ? (
                <div className="rounded-lg border border-border p-4">
                  <FormProducto supplierId={proveedor.id} moneda={proveedor.currency} onCreado={alCrearProducto} />
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setCreando(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  {proveedor.catalogItems.length > 0 ? (
                    <div>
                      <Label htmlFor="wizardProducto">Producto o servicio</Label>
                      <select
                        id="wizardProducto"
                        className={select}
                        value={productoId}
                        onChange={(e) => {
                          setProductoId(e.target.value)
                          setAcuerdoId('')
                        }}
                      >
                        <option value="">Selecciona un producto…</option>
                        {proveedor.catalogItems.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                            {i.sku ? ` · ${i.sku}` : ''} · {CATALOG_ITEM_TYPE_LABELS[i.type as keyof typeof CATALOG_ITEM_TYPE_LABELS] ?? i.type}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Este proveedor todavía no tiene productos. Crea el primero aquí mismo.</p>
                  )}
                  <Button type="button" variant="outline" onClick={() => setCreando('producto')}>
                    + Crear producto
                  </Button>
                </>
              )}
            </section>
          )}

          {/* ── 3 · Acuerdo ───────────────────────────────────────────── */}
          {paso === 3 && proveedor && producto && (
            <section className="space-y-3" aria-labelledby="paso-acuerdo">
              <h2 id="paso-acuerdo" className="text-h3">¿Bajo qué condiciones?</h2>
              {creando === 'acuerdo' ? (
                <div className="rounded-lg border border-border p-4">
                  <FormAcuerdo
                    supplierId={proveedor.id}
                    proveedorNombre={proveedor.commercialName}
                    productos={proveedor.catalogItems.map((i) => ({ id: i.id, name: i.name }))}
                    productoId={producto.id}
                    moneda={proveedor.currency}
                    onCreado={alCrearAcuerdo}
                  />
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setCreando(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  {compatibles.length > 0 ? (
                    <div className="grid gap-2" role="radiogroup" aria-label="Acuerdos vigentes">
                      {compatibles.map((a) => (
                        <label
                          key={a.id}
                          className={`cursor-pointer rounded-lg border p-3 text-sm ${acuerdoId === a.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
                        >
                          <input type="radio" name="acuerdo" value={a.id} checked={acuerdoId === a.id} onChange={() => elegirAcuerdo(a.id)} className="mr-2" />
                          <span className="font-medium">Acuerdo vigente · {AGREEMENT_TYPE_LABELS[a.type]}</span>
                          <span className="block pl-5 text-caption text-muted-foreground">
                            {a.code} · v{a.version}
                            {a.negotiatedUnitCost ? ` · costo negociado ${dinero(a.negotiatedUnitCost, a.currency)}` : ''}
                            {a.endsAt ? ` · vence ${new Date(a.endsAt).toLocaleDateString('es-DO')}` : ''}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No hay un acuerdo vigente que cubra {producto.name}. Crea uno aquí mismo.</p>
                  )}
                  <Button type="button" variant="outline" onClick={() => setCreando('acuerdo')}>
                    + Crear acuerdo
                  </Button>
                </>
              )}
            </section>
          )}

          {/* ── 4 · Compra ────────────────────────────────────────────── */}
          {paso === 4 && acuerdo && producto && (
            <section className="space-y-3" aria-labelledby="paso-compra">
              <h2 id="paso-compra" className="text-h3">¿Cuánto?</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="wizardCantidad">Cantidad</Label>
                  <Input id="wizardCantidad" type="number" min={1} step={1} inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="1000" />
                </div>
                <div>
                  <Label htmlFor="wizardCosto">Costo unitario ({moneda})</Label>
                  <Input id="wizardCosto" type="number" min={0} step="0.01" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} />
                  {acuerdo.negotiatedUnitCost && Number(costo) !== Number(acuerdo.negotiatedUnitCost) && (
                    <p className="mt-1 text-caption text-warning">El acuerdo dice {dinero(acuerdo.negotiatedUnitCost, moneda)} por unidad.</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="wizardImpuesto">% impuestos</Label>
                  <Input id="wizardImpuesto" type="number" min={0} max={100} step="0.01" inputMode="decimal" value={impuesto} onChange={(e) => setImpuesto(e.target.value)} />
                </div>
              </div>
              <dl className="grid gap-1 rounded-lg border border-border p-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="font-medium tabular-nums">{dinero(subtotal, moneda)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Impuestos</dt>
                  <dd className="font-medium tabular-nums">{dinero(impuestos, moneda)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">TOTAL</dt>
                  <dd className="text-h3 tabular-nums" data-testid="wizard-total">{dinero(total, moneda)}</dd>
                </div>
              </dl>
            </section>
          )}

          {/* ── 5 · Pago ──────────────────────────────────────────────── */}
          {paso === 5 && (
            <section className="space-y-3" aria-labelledby="paso-pago">
              <h2 id="paso-pago" className="text-h3">¿Cómo se pagará?</h2>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Forma de pago">
                {PAYMENT_MODES_SLICE1.map((m) => (
                  <label key={m} className={`cursor-pointer rounded-lg border p-3 text-sm ${pago === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}>
                    <input type="radio" name="pago" value={m} checked={pago === m} onChange={() => setPago(m)} className="mr-2" />
                    <span className="font-medium">{PAYMENT_MODE_LABELS[m]}</span>
                  </label>
                ))}
              </div>
              <p className="text-caption text-muted-foreground">Los pagos parciales y los depósitos llegan en una versión posterior.</p>
              <div>
                <Label htmlFor="wizardNotas">Notas</Label>
                <Textarea id="wizardNotas" rows={2} maxLength={2000} value={notas} onChange={(e) => setNotas(e.target.value)} />
              </div>
            </section>
          )}

          {/* ── 6 · Resumen ───────────────────────────────────────────── */}
          {paso === 6 && proveedor && producto && acuerdo && (
            <form action={accion} className="space-y-4" aria-labelledby="paso-resumen" data-testid="form-crear-orden">
              <h2 id="paso-resumen" className="text-h3">Resumen de la compra</h2>
              <input type="hidden" name="supplierId" value={proveedor.id} />
              <input type="hidden" name="catalogItemId" value={producto.id} />
              <input type="hidden" name="agreementId" value={acuerdo.id} />
              <input type="hidden" name="quantity" value={cantidad} />
              <input type="hidden" name="unitCost" value={costo} />
              <input type="hidden" name="taxRate" value={impuesto} />
              <input type="hidden" name="paymentMode" value={pago} />
              <input type="hidden" name="notes" value={notas} />
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Fila k="Proveedor" v={proveedor.commercialName} />
                <Fila k="Producto" v={producto.name} />
                <Fila k="Cantidad" v={Number(cantidad).toLocaleString('es-DO')} />
                <Fila k="Costo unitario" v={dinero(costo, moneda)} />
                <Fila k="Subtotal" v={dinero(subtotal, moneda)} />
                <Fila k="Impuestos" v={`${dinero(impuestos, moneda)} (${impuesto || 0} %)`} />
                <Fila k="Total" v={dinero(total, moneda)} destacado />
                <Fila k="Forma de pago" v={PAYMENT_MODE_LABELS[pago as keyof typeof PAYMENT_MODE_LABELS]} />
                <Fila k="Acuerdo" v={`${acuerdo.code} · ${AGREEMENT_TYPE_LABELS[acuerdo.type]} · v${acuerdo.version}`} />
              </dl>
              {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={anterior} disabled={pendiente}>
                  Atrás
                </Button>
                <Button type="submit" disabled={pendiente} loading={pendiente}>
                  Crear orden de compra
                </Button>
              </div>
            </form>
          )}

          {paso < 6 && !creando && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {paso > 1 && (
                <Button type="button" variant="outline" onClick={anterior}>
                  Atrás
                </Button>
              )}
              <Button type="button" onClick={siguiente} disabled={!listo[paso - 1]}>
                Continuar
              </Button>
              <Link href="/superadmin/supply-v2/compras" className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline">
                Cancelar
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
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
