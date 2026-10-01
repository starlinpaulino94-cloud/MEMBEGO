'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { SupplyV2BenefitFunding, SupplyV2BenefitScope, SupplyV2BenefitValueType } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearBeneficioAction } from '@/modules/supply-v2/actions-beneficios'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { BeneficioCreado } from '@/modules/supply-v2/benefits/service'
import type { OpcionesBeneficio } from '@/modules/supply-v2/benefits/queries'
import { BENEFIT_FUNDING_EXPLICACION, BENEFIT_FUNDING_LABELS, BENEFIT_SCOPE_LABELS, BENEFIT_VALUE_TYPE_LABELS, RUTA_BENEFICIOS } from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · ASISTENTE DE BENEFICIOS, 7 pasos (§30).
 *
 * El asistente enseña la economía ANTES de guardar: quién financia, cuánto
 * rebaja, qué paga el cliente, sobre qué se calcula la comisión, qué cobra
 * Membego y qué le queda al proveedor. El ejemplo de aquí es orientativo; el
 * motor del servidor (`core/financiacion`) es el que manda y recalcula todo
 * con dos decimales al reservar.
 *
 * Nace como BORRADOR: para que valga, otra persona autorizada lo aprueba.
 */

const PASOS = ['Qué es', 'Quién financia', 'Cuánto', 'A qué aplica', 'Presupuesto', 'Vigencia y usos', 'Resumen'] as const

function dinero(n: number, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const r2 = (n: number) => Math.round(n * 100) / 100

export function WizardBeneficio({ opciones }: { opciones: OpcionesBeneficio }) {
  const router = useRouter()
  const [paso, setPaso] = useState(1)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [description, setDescription] = useState('')
  const [funding, setFunding] = useState<SupplyV2BenefitFunding>('MEMBEGO')
  const [valueType, setValueType] = useState<SupplyV2BenefitValueType>('FIXED_AMOUNT')
  const [membegoValue, setMembegoValue] = useState('')
  const [supplierValue, setSupplierValue] = useState('')
  const [maxMembego, setMaxMembego] = useState('')
  const [maxSupplier, setMaxSupplier] = useState('')
  const [scope, setScope] = useState<SupplyV2BenefitScope>('SPECIFIC_OFFER')
  const [offerId, setOfferId] = useState('')
  const [catalogItemId, setCatalogItemId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [budgetTotal, setBudgetTotal] = useState('')
  const hoy = new Date().toISOString().slice(0, 10)
  const [startsAt, setStartsAt] = useState(hoy)
  const [endsAt, setEndsAt] = useState('')
  const [perCustomerLimit, setPerCustomerLimit] = useState('1')
  const [requiresAssignment, setRequiresAssignment] = useState(true)

  const [estado, accion, pendiente] = useActionState<EstadoAccion<BeneficioCreado>, FormData>(crearBeneficioAction, {})
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.id || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    router.push(`${RUTA_BENEFICIOS}/${estado.id}`)
  }, [estado, router])

  // Solo las ofertas a comisión admiten descuento del proveedor (§25): en precompra
  // Membego ya pagó la unidad y el proveedor no tiene precio que rebajar.
  const ofertasElegibles = useMemo(() => (funding === 'MEMBEGO' ? opciones.ofertas : opciones.ofertas.filter((o) => o.sourceType === 'COMMISSION')), [funding, opciones.ofertas])
  const oferta = ofertasElegibles.find((o) => o.id === offerId) ?? null
  const producto = opciones.productos.find((p) => p.id === catalogItemId) ?? null
  const proveedor = opciones.proveedores.find((s) => s.id === supplierId) ?? null
  const moneda = oferta?.currency ?? producto?.currency ?? proveedor?.currency ?? 'DOP'

  // El proveedor que financia se fija al elegir la oferta o el producto: el
  // alcance ya dice de quién es, y pedirlo dos veces invita a equivocarse.
  const elegirOferta = (id: string) => {
    setOfferId(id)
    const o = ofertasElegibles.find((x) => x.id === id)
    if (o && funding !== 'MEMBEGO') setSupplierId(o.supplierId)
  }
  const elegirProducto = (id: string) => {
    setCatalogItemId(id)
    const i = opciones.productos.find((x) => x.id === id)
    if (i && funding !== 'MEMBEGO') setSupplierId(i.supplierId)
  }

  // Ejemplo económico (§30): sobre la oferta elegida o sobre un precio de muestra.
  const precio = Number(oferta?.salePrice ?? 1000) || 1000
  const pct = Number(oferta?.commissionPercentage ?? 0) || 0
  const esComision = oferta ? oferta.sourceType === 'COMMISSION' : funding !== 'MEMBEGO'
  const bruto = (valor: string, tope: string) => {
    const v = Number(valor) || 0
    if (v <= 0) return 0
    const base = valueType === 'FIXED_AMOUNT' ? v : r2((precio * v) / 100)
    const t = Number(tope) || 0
    return t > 0 ? Math.min(base, t) : base
  }
  const descuentoProveedor = Math.min(bruto(supplierValue, maxSupplier), precio)
  const bonoMembego = Math.min(bruto(membegoValue, maxMembego), precio - descuentoProveedor)
  const contractual = r2(precio - descuentoProveedor)
  const pagaCliente = r2(contractual - bonoMembego)
  const comision = esComision ? r2((contractual * pct) / 100) : 0
  const netoProveedor = esComision ? r2(contractual - comision) : 0
  const contribucion = r2(comision - bonoMembego)

  const alcanceListo = scope === 'SPECIFIC_OFFER' ? Boolean(offerId) : scope === 'CATALOG_ITEM' ? Boolean(catalogItemId) : Boolean(supplierId)
  const valorListo =
    funding === 'MEMBEGO'
      ? Number(membegoValue) > 0 && !supplierValue
      : funding === 'SUPPLIER'
        ? Number(supplierValue) > 0 && !membegoValue
        : Number(membegoValue) > 0 && Number(supplierValue) > 0
  const listo = [
    name.trim().length > 0,
    true,
    valorListo && (valueType !== 'PERCENTAGE' || (Number(membegoValue || 0) <= 100 && Number(supplierValue || 0) <= 100)),
    alcanceListo && (funding === 'MEMBEGO' || Boolean(supplierId)),
    funding === 'SUPPLIER' ? !budgetTotal : !budgetTotal || Number(budgetTotal) > 0,
    Boolean(startsAt) && (!endsAt || endsAt > startsAt) && Number(perCustomerLimit) > 0,
    true,
  ]
  const siguiente = () => setPaso((p) => Math.min(7, p + 1))
  const anterior = () => setPaso((p) => Math.max(1, p - 1))
  const select = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <div className="space-y-5" data-testid="wizard-beneficio">
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
              <h2 className="text-h3">¿Qué beneficio vas a crear?</h2>
              <div>
                <Label htmlFor="beneficioNombre">Nombre que verá el cliente</Label>
                <Input id="beneficioNombre" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bono de bienvenida RD$500" required data-testid="beneficio-nombre" />
              </div>
              <div>
                <Label htmlFor="beneficioObjetivo">¿Para qué? (interno, opcional)</Label>
                <Input id="beneficioObjetivo" maxLength={300} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Activar clientes nuevos en octubre" />
              </div>
              <div>
                <Label htmlFor="beneficioDescripcion">Descripción para el cliente (opcional)</Label>
                <Textarea id="beneficioDescripcion" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <p className="text-caption text-muted-foreground">Un beneficio rebaja lo que paga el cliente. No es un cupón público ni una campaña: se asigna y se controla uno por uno.</p>
            </section>
          )}

          {paso === 2 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Quién pone el dinero?</h2>
              <div className="grid gap-2" role="radiogroup" aria-label="Quién financia">
                {(['MEMBEGO', 'SUPPLIER', 'SHARED'] as const).map((f) => (
                  <label key={f} className={`cursor-pointer rounded-lg border p-3 text-sm ${funding === f ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} data-testid={`beneficio-funding-${f}`}>
                    <input type="radio" name="fundingUi" value={f} checked={funding === f} onChange={() => setFunding(f)} className="mr-2" />
                    <span className="font-medium">{BENEFIT_FUNDING_LABELS[f]}</span>
                    <span className="block pl-5 text-caption text-muted-foreground">{BENEFIT_FUNDING_EXPLICACION[f]}</span>
                  </label>
                ))}
              </div>
              <p className="text-caption text-muted-foreground">Esta elección cambia la contabilidad: el bono de Membego es costo promocional y el descuento del proveedor baja el valor contractual de la venta.</p>
            </section>
          )}

          {paso === 3 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Cuánto rebaja?</h2>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de valor">
                {(['FIXED_AMOUNT', 'PERCENTAGE'] as const).map((t) => (
                  <label key={t} className={`cursor-pointer rounded-lg border p-3 text-sm ${valueType === t ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} data-testid={`beneficio-tipo-${t}`}>
                    <input type="radio" name="valueTypeUi" value={t} checked={valueType === t} onChange={() => setValueType(t)} className="mr-2" />
                    <span className="font-medium">{BENEFIT_VALUE_TYPE_LABELS[t]}</span>
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {funding !== 'SUPPLIER' && (
                  <div>
                    <Label htmlFor="beneficioValorMembego">Parte de Membego {valueType === 'PERCENTAGE' ? '(%)' : `(${moneda})`}</Label>
                    <Input id="beneficioValorMembego" type="number" min={0} step="0.01" inputMode="decimal" value={membegoValue} onChange={(e) => setMembegoValue(e.target.value)} placeholder={valueType === 'PERCENTAGE' ? '15' : '500'} data-testid="beneficio-valor-membego" />
                  </div>
                )}
                {funding !== 'MEMBEGO' && (
                  <div>
                    <Label htmlFor="beneficioValorProveedor">Parte del proveedor {valueType === 'PERCENTAGE' ? '(%)' : `(${moneda})`}</Label>
                    <Input id="beneficioValorProveedor" type="number" min={0} step="0.01" inputMode="decimal" value={supplierValue} onChange={(e) => setSupplierValue(e.target.value)} placeholder={valueType === 'PERCENTAGE' ? '10' : '100'} data-testid="beneficio-valor-proveedor" />
                  </div>
                )}
                {valueType === 'PERCENTAGE' && funding !== 'SUPPLIER' && (
                  <div>
                    <Label htmlFor="beneficioTopeMembego">Tope de la parte de Membego ({moneda}, opcional)</Label>
                    <Input id="beneficioTopeMembego" type="number" min={0} step="0.01" inputMode="decimal" value={maxMembego} onChange={(e) => setMaxMembego(e.target.value)} placeholder="300" />
                  </div>
                )}
                {valueType === 'PERCENTAGE' && funding !== 'MEMBEGO' && (
                  <div>
                    <Label htmlFor="beneficioTopeProveedor">Tope de la parte del proveedor ({moneda}, opcional)</Label>
                    <Input id="beneficioTopeProveedor" type="number" min={0} step="0.01" inputMode="decimal" value={maxSupplier} onChange={(e) => setMaxSupplier(e.target.value)} />
                  </div>
                )}
              </div>
              <p className="text-caption text-muted-foreground">Un beneficio nunca deja el total por debajo de cero: si vale más que la compra, cubre el 100 % y no se paga la diferencia. Los importes fijos y los topes son por aplicación, no por unidad.</p>
            </section>
          )}

          {paso === 4 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿A qué aplica?</h2>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Alcance">
                {(['SPECIFIC_OFFER', 'CATALOG_ITEM', 'SUPPLIER'] as const).map((s) => (
                  <label key={s} className={`cursor-pointer rounded-lg border p-3 text-sm ${scope === s ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} data-testid={`beneficio-alcance-${s}`}>
                    <input type="radio" name="scopeUi" value={s} checked={scope === s} onChange={() => setScope(s)} className="mr-2" />
                    <span className="font-medium">{BENEFIT_SCOPE_LABELS[s]}</span>
                  </label>
                ))}
              </div>
              {scope === 'SPECIFIC_OFFER' && (
                <div>
                  <Label htmlFor="beneficioOferta">Oferta</Label>
                  <select id="beneficioOferta" className={select} value={offerId} onChange={(e) => elegirOferta(e.target.value)} data-testid="beneficio-oferta">
                    <option value="">Selecciona una oferta…</option>
                    {ofertasElegibles.map((o) => (
                      <option key={o.id} value={o.id}>{o.title} · {o.supplierName} · {o.salePrice} {o.currency}</option>
                    ))}
                  </select>
                  {funding !== 'MEMBEGO' && <p className="text-caption text-muted-foreground">Solo se listan ofertas a comisión: un descuento del proveedor no cabe en una oferta de supply ya comprado.</p>}
                </div>
              )}
              {scope === 'CATALOG_ITEM' && (
                <div>
                  <Label htmlFor="beneficioProducto">Producto</Label>
                  <select id="beneficioProducto" className={select} value={catalogItemId} onChange={(e) => elegirProducto(e.target.value)} data-testid="beneficio-producto">
                    <option value="">Selecciona un producto…</option>
                    {opciones.productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · {p.supplierName}</option>
                    ))}
                  </select>
                </div>
              )}
              {(scope === 'SUPPLIER' || funding !== 'MEMBEGO') && (
                <div>
                  <Label htmlFor="beneficioProveedor">{scope === 'SUPPLIER' ? 'Proveedor cuyas ofertas son elegibles' : 'Proveedor que asume el descuento'}</Label>
                  <select id="beneficioProveedor" className={select} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} data-testid="beneficio-proveedor">
                    <option value="">Selecciona un proveedor…</option>
                    {opciones.proveedores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </section>
          )}

          {paso === 5 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Cuánto dinero pone Membego en total?</h2>
              {funding === 'SUPPLIER' ? (
                <p className="text-sm text-muted-foreground">Este beneficio lo financia el proveedor: no consume presupuesto de Membego, así que no lleva tope de presupuesto.</p>
              ) : (
                <>
                  <div className="max-w-xs">
                    <Label htmlFor="beneficioPresupuesto">Presupuesto total ({moneda}, opcional)</Label>
                    <Input id="beneficioPresupuesto" type="number" min={0} step="0.01" inputMode="decimal" value={budgetTotal} onChange={(e) => setBudgetTotal(e.target.value)} placeholder="50000" data-testid="beneficio-presupuesto" />
                  </div>
                  <p className="text-caption text-muted-foreground">
                    Cada checkout aparta su parte y la consume al confirmarse; cancelar o expirar la devuelve. Cuando se agota, el beneficio pasa a «Agotado» solo. Sin presupuesto: sin tope (úsalo con cuidado).
                    {Number(budgetTotal) > 0 && bonoMembego > 0 ? ` Con el bono del ejemplo alcanza para ${Math.floor(Number(budgetTotal) / bonoMembego).toLocaleString('es-DO')} aplicación(es).` : ''}
                  </p>
                </>
              )}
            </section>
          )}

          {paso === 6 && (
            <section className="space-y-3">
              <h2 className="text-h3">Vigencia y usos</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="beneficioInicio">Desde</Label>
                  <Input id="beneficioInicio" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="beneficioFin">Hasta (opcional)</Label>
                  <Input id="beneficioFin" type="date" value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="beneficioLimite">Usos por cliente</Label>
                  <Input id="beneficioLimite" type="number" min={1} step={1} inputMode="numeric" value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="beneficioAsignacion">¿Hace falta asignarlo?</Label>
                  <select id="beneficioAsignacion" className={select} value={requiresAssignment ? 'si' : 'no'} onChange={(e) => setRequiresAssignment(e.target.value === 'si')} data-testid="beneficio-asignacion">
                    <option value="si">Sí: solo lo usan los clientes a quienes se lo asignes</option>
                    <option value="no">No: lo puede usar cualquier cliente</option>
                  </select>
                </div>
              </div>
              {endsAt && endsAt <= startsAt && <p className="text-sm text-destructive">La fecha de vencimiento tiene que ser posterior al inicio.</p>}
              <p className="text-caption text-muted-foreground">Los usos cuentan las aplicaciones consolidadas y las reservas vivas: dos checkouts a la vez con el mismo bono no pasan.</p>
            </section>
          )}

          {paso === 7 && (
            <form action={accion} className="space-y-4" data-testid="form-crear-beneficio">
              <h2 className="text-h3">Resumen y ejemplo económico</h2>
              <input type="hidden" name="name" value={name} />
              <input type="hidden" name="objective" value={objective} />
              <input type="hidden" name="description" value={description} />
              <input type="hidden" name="funding" value={funding} />
              <input type="hidden" name="valueType" value={valueType} />
              <input type="hidden" name="membegoValue" value={funding === 'SUPPLIER' ? '' : membegoValue} />
              <input type="hidden" name="supplierValue" value={funding === 'MEMBEGO' ? '' : supplierValue} />
              <input type="hidden" name="maxMembegoAmount" value={valueType === 'PERCENTAGE' ? maxMembego : ''} />
              <input type="hidden" name="maxSupplierAmount" value={valueType === 'PERCENTAGE' ? maxSupplier : ''} />
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="offerId" value={scope === 'SPECIFIC_OFFER' ? offerId : ''} />
              <input type="hidden" name="catalogItemId" value={scope === 'CATALOG_ITEM' ? catalogItemId : ''} />
              <input type="hidden" name="supplierId" value={funding === 'MEMBEGO' && scope !== 'SUPPLIER' ? '' : supplierId} />
              <input type="hidden" name="budgetTotal" value={funding === 'SUPPLIER' ? '' : budgetTotal} />
              <input type="hidden" name="perCustomerLimit" value={perCustomerLimit} />
              <input type="hidden" name="requiresAssignment" value={requiresAssignment ? 'si' : 'no'} />
              <input type="hidden" name="startsAt" value={startsAt} />
              <input type="hidden" name="endsAt" value={endsAt} />

              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Fila k="Nombre" v={name} />
                <Fila k="Quién financia" v={BENEFIT_FUNDING_LABELS[funding]} />
                <Fila k="Valor" v={valueType === 'FIXED_AMOUNT' ? `${funding !== 'SUPPLIER' ? `Membego ${dinero(Number(membegoValue) || 0, moneda)}` : ''}${funding === 'SHARED' ? ' · ' : ''}${funding !== 'MEMBEGO' ? `Proveedor ${dinero(Number(supplierValue) || 0, moneda)}` : ''}` : `${funding !== 'SUPPLIER' ? `Membego ${membegoValue || 0} %` : ''}${funding === 'SHARED' ? ' · ' : ''}${funding !== 'MEMBEGO' ? `Proveedor ${supplierValue || 0} %` : ''}`} />
                <Fila k="Aplica a" v={`${BENEFIT_SCOPE_LABELS[scope]}: ${oferta?.title ?? producto?.name ?? proveedor?.name ?? '—'}`} />
                <Fila k="Presupuesto de Membego" v={funding === 'SUPPLIER' ? 'No consume presupuesto' : budgetTotal ? dinero(Number(budgetTotal), moneda) : 'Sin tope'} />
                <Fila k="Vigencia" v={`${startsAt}${endsAt ? ` → ${endsAt}` : ' → sin vencimiento'}`} />
                <Fila k="Usos por cliente" v={perCustomerLimit} />
                <Fila k="Asignación" v={requiresAssignment ? 'Solo clientes asignados' : 'Cualquier cliente'} />
              </dl>

              <div className="rounded-lg border border-border bg-muted/30 p-3" data-testid="beneficio-ejemplo">
                <p className="text-sm font-medium">Ejemplo con {oferta ? `la oferta «${oferta.title}»` : 'un precio de muestra'} de {dinero(precio, moneda)}</p>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                  <Dato k="Precio Membego (GMV)" v={dinero(precio, moneda)} />
                  <Dato k="Descuento del proveedor" v={`−${dinero(descuentoProveedor, moneda)}`} />
                  <Dato k="Valor contractual" v={dinero(contractual, moneda)} />
                  <Dato k="Bono de Membego (subsidio)" v={`−${dinero(bonoMembego, moneda)}`} />
                  <Dato k="Paga el cliente" v={dinero(pagaCliente, moneda)} />
                  {esComision && <Dato k={`Comisión de Membego (${pct} %)`} v={dinero(comision, moneda)} />}
                  {esComision && <Dato k="Neto del proveedor" v={dinero(netoProveedor, moneda)} />}
                  {esComision && <Dato k="Contribución tras el subsidio" v={dinero(contribucion, moneda)} />}
                </dl>
                <p className="mt-2 text-caption text-muted-foreground">
                  {pagaCliente === 0
                    ? 'El beneficio cubre el 100 %: el cliente confirma sin pagar y no se registra ningún pago bancario.'
                    : 'El cliente paga la diferencia por transferencia; el beneficio no se cobra en el banco.'}
                  {esComision ? ' La comisión se calcula sobre el valor contractual según la versión del acuerdo.' : ' En supply ya comprado, el proveedor cobró su importe contractual cuando Membego compró el lote.'}
                </p>
              </div>

              {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={anterior} disabled={pendiente}>Atrás</Button>
                <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-crear-beneficio">Crear como borrador</Button>
              </div>
              <p className="text-caption text-muted-foreground">Nace como borrador y no rebaja nada hasta que otra persona autorizada lo apruebe.</p>
            </form>
          )}

          {paso < 7 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {paso > 1 && <Button type="button" variant="outline" onClick={anterior}>Atrás</Button>}
              <Button type="button" onClick={siguiente} disabled={!listo[paso - 1]} data-testid="beneficio-continuar">Continuar</Button>
              <Link href={RUTA_BENEFICIOS} className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline">Cancelar</Link>
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

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  )
}
