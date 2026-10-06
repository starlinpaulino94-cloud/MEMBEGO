'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { SupplyV2BenefitFunding, SupplyV2CampaignAudience, SupplyV2CampaignOrganizer } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearCampanaAction } from '@/modules/supply-v2/actions-campanas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { CampanaCreada } from '@/modules/supply-v2/campaigns/service'
import {
  BENEFIT_FUNDING_EXPLICACION,
  BENEFIT_FUNDING_LABELS,
  CAMPAIGN_AUDIENCE_EXPLICACION,
  CAMPAIGN_AUDIENCE_LABELS,
  CAMPAIGN_ORGANIZER_LABELS,
  RUTA_CAMPANAS,
  TIPOS_DE_PROMOCION,
  type TipoDePromocion,
} from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY · SLICE 7 · ASISTENTE DE CAMPAÑAS, 8 pasos (§5).
 *
 * El asistente enseña la economía ANTES de guardar: cuánto puede gastar
 * Membego, cuánto pone el proveedor y qué paga el cliente. El ejemplo de aquí
 * es orientativo; el motor del servidor (`core/financiacion.ts`, Slice 6) es
 * el que manda y recalcula todo al reservar.
 *
 * La campaña nace BORRADOR y, cuando compromete dinero, pide aprobación de
 * otra persona autorizada antes de publicarse.
 */

const PASOS = ['Objetivo', 'Empresas', 'Productos', 'Promoción', 'Financiación', 'Público', 'Vigencia', 'Resumen'] as const

export interface OfertaParaCampana {
  id: string
  title: string
  proveedor: string
  supplierId: string
  producto: string
  salePrice: string
  currency: string
  sourceType: string
  commissionPercentage: string | null
}

export interface ProveedorParaCampana {
  id: string
  name: string
}

function dinero(n: number, moneda = 'DOP'): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const r2 = (n: number) => Math.round(n * 100) / 100

export function WizardCampana({ ofertas, proveedores }: { ofertas: OfertaParaCampana[]; proveedores: ProveedorParaCampana[] }) {
  const router = useRouter()
  const [paso, setPaso] = useState(1)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [description, setDescription] = useState('')
  const [organizer, setOrganizer] = useState<SupplyV2CampaignOrganizer>('MEMBEGO')
  const [supplierId, setSupplierId] = useState('')
  const [elegidas, setElegidas] = useState<string[]>([])
  const [tipo, setTipo] = useState<TipoDePromocion>('DESCUENTO_FIJO')
  const [funding, setFunding] = useState<SupplyV2BenefitFunding>('MEMBEGO')
  const [membegoValue, setMembegoValue] = useState('')
  const [supplierValue, setSupplierValue] = useState('')
  const [budgetTotal, setBudgetTotal] = useState('')
  const [budgetWaiverReason, setBudgetWaiverReason] = useState('')
  const [audience, setAudience] = useState<SupplyV2CampaignAudience>('ALL')
  const hoy = new Date().toISOString().slice(0, 10)
  const [startsAt, setStartsAt] = useState(hoy)
  const [endsAt, setEndsAt] = useState('')
  const [activeFrom, setActiveFrom] = useState('')
  const [activeTo, setActiveTo] = useState('')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [maxPerCustomer, setMaxPerCustomer] = useState('1')

  const [estado, accion, pendiente] = useActionState<EstadoAccion<CampanaCreada>, FormData>(crearCampanaAction, {})
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.id || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    // La campaña ya quedó guardada con sus ofertas y su promoción: la ficha
    // es la que manda a partir de aquí.
    router.push(`${RUTA_CAMPANAS}/${estado.id}`)
  }, [estado, router])

  // Un proveedor solo propone lo suyo; Membego puede mezclar empresas.
  const disponibles = useMemo(() => (supplierId ? ofertas.filter((o) => o.supplierId === supplierId) : ofertas), [ofertas, supplierId])
  // En el ORDEN en que se eligieron: el ejemplo económico usa la primera que
  // marcó la persona, no la primera que devuelve la base.
  const seleccionadas = useMemo(() => elegidas.flatMap((id) => ofertas.filter((o) => o.id === id)), [ofertas, elegidas])
  const moneda = seleccionadas[0]?.currency ?? 'DOP'

  // El tipo de promoción decide la forma: porcentaje o fijo, quién financia y
  // si hace falta código. Así el asistente no pide datos que no aplican.
  const esPorcentaje = tipo === 'DESCUENTO_PORCENTUAL' || tipo === 'CUPON_PORCENTUAL'
  const exigeCupon = tipo === 'CUPON_FIJO' || tipo === 'CUPON_PORCENTUAL'
  const exigeAsignacion = tipo === 'BONO_ASIGNADO'
  const esCompartida = tipo === 'COMPARTIDA'
  /**
   * Elegir el tipo de promoción arrastra lo que ese tipo implica: una
   * compartida necesita las dos partes, una de bienvenida es para clientes
   * nuevos y una de tiempo limitado nace con un horario. Se hace en el
   * manejador y no en un efecto: así quien lo cambie después manda.
   */
  const elegirTipo = (t: TipoDePromocion) => {
    setTipo(t)
    if (t === 'COMPARTIDA') setFunding('SHARED')
    else if (funding === 'SHARED') setFunding('MEMBEGO')
    if (t === 'BIENVENIDA' && audience === 'ALL') setAudience('NEW_CUSTOMERS')
    if (t === 'TIEMPO_LIMITADO' && !activeFrom) {
      setActiveFrom('18:00')
      setActiveTo('23:00')
    }
  }

  // Ejemplo económico (§5): sobre la primera oferta elegida.
  const precio = Number(seleccionadas[0]?.salePrice ?? 1000) || 1000
  const pct = Number(seleccionadas[0]?.commissionPercentage ?? 0) || 0
  const aComision = seleccionadas[0] ? seleccionadas[0].sourceType === 'COMMISSION' : true
  const parte = (v: string) => {
    const n = Number(v) || 0
    if (n <= 0) return 0
    return esPorcentaje ? r2((precio * n) / 100) : n
  }
  const descuentoProveedor = funding === 'MEMBEGO' ? 0 : Math.min(parte(supplierValue), precio)
  const bonoMembego = funding === 'SUPPLIER' ? 0 : Math.min(parte(membegoValue), precio - descuentoProveedor)
  const contractual = r2(precio - descuentoProveedor)
  const pagaCliente = r2(contractual - bonoMembego)
  const comision = aComision ? r2((contractual * pct) / 100) : 0
  const netoProveedor = aComision ? r2(contractual - comision) : 0
  const contribucion = r2(comision - bonoMembego)
  const aplicaciones = Number(budgetTotal) > 0 && bonoMembego > 0 ? Math.floor(Number(budgetTotal) / bonoMembego) : null

  const valorListo =
    funding === 'MEMBEGO'
      ? Number(membegoValue) > 0
      : funding === 'SUPPLIER'
        ? Number(supplierValue) > 0
        : Number(membegoValue) > 0 && Number(supplierValue) > 0
  const listo = [
    name.trim().length > 0,
    organizer === 'MEMBEGO' || Boolean(supplierId),
    elegidas.length > 0,
    valorListo && (!esPorcentaje || (Number(membegoValue || 0) <= 100 && Number(supplierValue || 0) <= 100)),
    funding === 'SUPPLIER' ? true : Boolean(budgetTotal) || budgetWaiverReason.trim().length > 0,
    true,
    Boolean(startsAt) && (!endsAt || endsAt > startsAt) && Number(maxPerCustomer) > 0 && (!activeFrom || Boolean(activeTo)),
    true,
  ]
  const siguiente = () => setPaso((p) => Math.min(8, p + 1))
  const anterior = () => setPaso((p) => Math.max(1, p - 1))
  const select = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <div className="space-y-5" data-testid="wizard-campana">
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
              <h2 className="text-h3">¿Qué campaña vas a montar?</h2>
              <div>
                <Label htmlFor="campanaNombre">Nombre que verá el cliente</Label>
                <Input id="campanaNombre" maxLength={140} value={name} onChange={(e) => setName(e.target.value)} placeholder="Semana Gastronómica Membego" required data-testid="campana-nombre" />
              </div>
              <div>
                <Label htmlFor="campanaObjetivo">¿Para qué? (interno, opcional)</Label>
                <Input id="campanaObjetivo" maxLength={300} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Llevar clientes a los restaurantes de la red en temporada baja" />
              </div>
              <div>
                <Label htmlFor="campanaDescripcion">Descripción para el cliente (opcional)</Label>
                <Textarea id="campanaDescripcion" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <p className="text-caption text-muted-foreground">Una campaña agrupa ofertas de una o varias empresas con una promoción común. No crea inventario: cada oferta sigue siendo de su proveedor, con su precio y su acuerdo.</p>
            </section>
          )}

          {paso === 2 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Quién la organiza?</h2>
              <div className="grid gap-2" role="radiogroup" aria-label="Organizador">
                {(['MEMBEGO', 'SUPPLIER'] as const).map((o) => (
                  <label key={o} className={`cursor-pointer rounded-lg border p-3 text-sm ${organizer === o ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} data-testid={`campana-organizador-${o}`}>
                    <input type="radio" name="organizerUi" value={o} checked={organizer === o} onChange={() => setOrganizer(o)} className="mr-2" />
                    <span className="font-medium">{CAMPAIGN_ORGANIZER_LABELS[o]}</span>
                  </label>
                ))}
              </div>
              <div>
                <Label htmlFor="campanaProveedor">{organizer === 'SUPPLIER' ? 'Proveedor que la propone' : 'Proveedor que participa o financia (opcional si lo pone todo Membego)'}</Label>
                <select id="campanaProveedor" className={select} value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setElegidas([]) }} data-testid="campana-proveedor">
                  <option value="">{organizer === 'SUPPLIER' ? 'Selecciona el proveedor…' : 'Varias empresas (lo pone Membego)'}</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-caption text-muted-foreground">Una propuesta de proveedor queda pendiente de revisión: Membego decide si se publica y con qué condiciones.</p>
            </section>
          )}

          {paso === 3 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Qué productos y servicios participan?</h2>
              {disponibles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay ofertas disponibles para esa selección. Publica una oferta primero.</p>
              ) : (
                <ul className="max-h-80 space-y-1 overflow-y-auto" data-testid="campana-ofertas">
                  {disponibles.map((o) => (
                    <li key={o.id}>
                      <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${elegidas.includes(o.id) ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}>
                        <input
                          type="checkbox"
                          checked={elegidas.includes(o.id)}
                          onChange={(e) => setElegidas((v) => (e.target.checked ? [...v, o.id] : v.filter((x) => x !== o.id)))}
                          className="mt-1"
                          data-testid="campana-oferta-check"
                        />
                        <span>
                          <span className="font-medium">{o.title}</span>
                          <span className="block text-caption text-muted-foreground">{o.proveedor} · {o.producto} · {dinero(Number(o.salePrice), o.currency)} · {o.sourceType === 'COMMISSION' ? `comisión ${o.commissionPercentage ?? '?'} %` : 'supply adquirido'}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-caption text-muted-foreground">{elegidas.length} oferta(s) elegida(s). Cada una conserva su proveedor, su precio y su disponibilidad.</p>
            </section>
          )}

          {paso === 4 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Qué tipo de promoción?</h2>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de promoción">
                {TIPOS_DE_PROMOCION.map((t) => (
                  <label key={t.clave} className={`cursor-pointer rounded-lg border p-3 text-sm ${tipo === t.clave ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} data-testid={`campana-tipo-${t.clave}`}>
                    <input type="radio" name="tipoUi" value={t.clave} checked={tipo === t.clave} onChange={() => elegirTipo(t.clave)} className="mr-2" />
                    <span className="font-medium">{t.label}</span>
                    <span className="block pl-5 text-caption text-muted-foreground">{t.explicacion}</span>
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {funding !== 'SUPPLIER' && (
                  <div>
                    <Label htmlFor="campanaValorMembego">Parte de Membego {esPorcentaje ? '(%)' : `(${moneda})`}</Label>
                    <Input id="campanaValorMembego" type="number" min={0} step="0.01" inputMode="decimal" value={membegoValue} onChange={(e) => setMembegoValue(e.target.value)} placeholder={esPorcentaje ? '15' : '300'} data-testid="campana-valor-membego" />
                  </div>
                )}
                {funding !== 'MEMBEGO' && (
                  <div>
                    <Label htmlFor="campanaValorProveedor">Parte del proveedor {esPorcentaje ? '(%)' : `(${moneda})`}</Label>
                    <Input id="campanaValorProveedor" type="number" min={0} step="0.01" inputMode="decimal" value={supplierValue} onChange={(e) => setSupplierValue(e.target.value)} placeholder={esPorcentaje ? '10' : '100'} data-testid="campana-valor-proveedor" />
                  </div>
                )}
              </div>
              {exigeCupon && <p className="rounded-lg border border-info/30 bg-info/5 p-3 text-caption">Esta promoción se abre con CÓDIGO: al publicarla, genera sus cupones desde la ficha de la campaña. Sin código no se puede aplicar.</p>}
              {exigeAsignacion && <p className="rounded-lg border border-info/30 bg-info/5 p-3 text-caption">Este bono se asigna cliente por cliente desde la ficha de la campaña.</p>}
            </section>
          )}

          {paso === 5 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿Quién pone el dinero y cuánto?</h2>
              <div className="grid gap-2" role="radiogroup" aria-label="Financiación">
                {(esCompartida ? (['SHARED'] as const) : (['MEMBEGO', 'SUPPLIER'] as const)).map((f) => (
                  <label key={f} className={`cursor-pointer rounded-lg border p-3 text-sm ${funding === f ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} data-testid={`campana-funding-${f}`}>
                    <input type="radio" name="fundingUi" value={f} checked={funding === f} onChange={() => setFunding(f)} className="mr-2" />
                    <span className="font-medium">{BENEFIT_FUNDING_LABELS[f]}</span>
                    <span className="block pl-5 text-caption text-muted-foreground">{BENEFIT_FUNDING_EXPLICACION[f]}</span>
                  </label>
                ))}
              </div>
              {funding === 'SUPPLIER' ? (
                <p className="text-sm text-muted-foreground">La financia el proveedor: no consume presupuesto de Membego.</p>
              ) : (
                <>
                  <div className="max-w-xs">
                    <Label htmlFor="campanaPresupuesto">Presupuesto máximo de Membego ({moneda})</Label>
                    <Input id="campanaPresupuesto" type="number" min={0} step="0.01" inputMode="decimal" value={budgetTotal} onChange={(e) => setBudgetTotal(e.target.value)} placeholder="50000" data-testid="campana-presupuesto" />
                  </div>
                  <p className="text-caption text-muted-foreground">
                    Obligatorio cuando Membego pone dinero.
                    {aplicaciones != null ? ` Con el bono del ejemplo alcanza para ${aplicaciones.toLocaleString('es-DO')} aplicación(es).` : ''}
                  </p>
                  {!budgetTotal && (
                    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                      <Label htmlFor="campanaSinTope">Autorización para ir SIN presupuesto máximo</Label>
                      <Input id="campanaSinTope" maxLength={500} value={budgetWaiverReason} onChange={(e) => setBudgetWaiverReason(e.target.value)} placeholder="Autorizado por finanzas el 1/10: campaña de lanzamiento con tope operativo semanal" data-testid="campana-sin-tope" />
                      <p className="text-caption text-muted-foreground">Una campaña sin tope puede subsidiar sin límite. Queda registrado quién lo autorizó y por qué.</p>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {paso === 6 && (
            <section className="space-y-3">
              <h2 className="text-h3">¿A qué público?</h2>
              <div className="grid gap-2" role="radiogroup" aria-label="Público">
                {(['ALL', 'NEW_CUSTOMERS', 'RETURNING_CUSTOMERS', 'PAST_CAMPAIGN', 'SELECTED'] as const).map((a) => (
                  <label key={a} className={`cursor-pointer rounded-lg border p-3 text-sm ${audience === a ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} data-testid={`campana-publico-${a}`}>
                    <input type="radio" name="audienceUi" value={a} checked={audience === a} onChange={() => setAudience(a)} className="mr-2" />
                    <span className="font-medium">{CAMPAIGN_AUDIENCE_LABELS[a]}</span>
                    <span className="block pl-5 text-caption text-muted-foreground">{CAMPAIGN_AUDIENCE_EXPLICACION[a]}</span>
                  </label>
                ))}
              </div>
              <p className="text-caption text-muted-foreground">Los grupos se calculan con lo que Membego ya sabe de su propia operación: si compró y si usó una promoción. No se deduce nada más sobre la persona.</p>
            </section>
          )}

          {paso === 7 && (
            <section className="space-y-3">
              <h2 className="text-h3">Vigencia y límites</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="campanaInicio">Desde</Label>
                  <Input id="campanaInicio" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="campanaFin">Hasta (opcional)</Label>
                  <Input id="campanaFin" type="date" value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="campanaDesdeHora">Hora de activación (opcional)</Label>
                  <Input id="campanaDesdeHora" type="time" value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)} data-testid="campana-hora-desde" />
                </div>
                <div>
                  <Label htmlFor="campanaHastaHora">Hora de desactivación</Label>
                  <Input id="campanaHastaHora" type="time" value={activeTo} min={activeFrom || undefined} onChange={(e) => setActiveTo(e.target.value)} data-testid="campana-hora-hasta" />
                </div>
                <div>
                  <Label htmlFor="campanaMaxTotal">Límite total de aplicaciones (opcional)</Label>
                  <Input id="campanaMaxTotal" type="number" min={1} step={1} inputMode="numeric" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="500" />
                </div>
                <div>
                  <Label htmlFor="campanaMaxCliente">Límite por cliente</Label>
                  <Input id="campanaMaxCliente" type="number" min={1} step={1} inputMode="numeric" value={maxPerCustomer} onChange={(e) => setMaxPerCustomer(e.target.value)} />
                </div>
              </div>
              {endsAt && endsAt <= startsAt && <p className="text-sm text-destructive">El fin tiene que ser posterior al inicio.</p>}
              {activeFrom && !activeTo && <p className="text-sm text-destructive">Si pones hora de activación, pon también la de desactivación.</p>}
              <p className="text-caption text-muted-foreground">El horario se comprueba en el servidor en cada compra: una promoción fuera de su hora no se aplica, aunque el cron vaya tarde.</p>
            </section>
          )}

          {paso === 8 && (
            <form action={accion} className="space-y-4" data-testid="form-crear-campana">
              <h2 className="text-h3">Resumen y vista previa económica</h2>
              <input type="hidden" name="name" value={name} />
              <input type="hidden" name="objective" value={objective} />
              <input type="hidden" name="description" value={description} />
              <input type="hidden" name="organizer" value={organizer} />
              <input type="hidden" name="supplierId" value={supplierId} />
              <input type="hidden" name="funding" value={funding} />
              <input type="hidden" name="budgetTotal" value={funding === 'SUPPLIER' ? '' : budgetTotal} />
              <input type="hidden" name="budgetWaiverReason" value={funding === 'SUPPLIER' ? '' : budgetWaiverReason} />
              <input type="hidden" name="audience" value={audience} />
              <input type="hidden" name="startsAt" value={startsAt} />
              <input type="hidden" name="endsAt" value={endsAt} />
              <input type="hidden" name="activeFrom" value={activeFrom} />
              <input type="hidden" name="activeTo" value={activeTo} />
              <input type="hidden" name="maxRedemptions" value={maxRedemptions} />
              <input type="hidden" name="maxPerCustomer" value={maxPerCustomer} />
              {/* Lo que se eligió en los pasos 3 y 4 viaja con el formulario: la
                  campaña nace con sus ofertas y su promoción en la MISMA
                  transacción, no a medias. */}
              {elegidas.map((id) => (
                <input key={id} type="hidden" name="offerIds" value={id} />
              ))}
              <input type="hidden" name="valueType" value={esPorcentaje ? 'PERCENTAGE' : 'FIXED_AMOUNT'} />
              <input type="hidden" name="membegoValue" value={funding === 'SUPPLIER' ? '' : membegoValue} />
              <input type="hidden" name="supplierValue" value={funding === 'MEMBEGO' ? '' : supplierValue} />
              <input type="hidden" name="requiresCoupon" value={exigeCupon ? 'si' : 'no'} />
              <input type="hidden" name="requiresAssignment" value={exigeAsignacion ? 'si' : 'no'} />

              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Fila k="Nombre" v={name} />
                <Fila k="Organiza" v={CAMPAIGN_ORGANIZER_LABELS[organizer]} />
                <Fila k="Ofertas participantes" v={`${elegidas.length}: ${seleccionadas.slice(0, 3).map((o) => o.title).join(', ')}${elegidas.length > 3 ? '…' : ''}`} />
                <Fila k="Tipo de promoción" v={TIPOS_DE_PROMOCION.find((t) => t.clave === tipo)!.label} />
                <Fila k="Quién financia" v={BENEFIT_FUNDING_LABELS[funding]} />
                <Fila k="Presupuesto de Membego" v={funding === 'SUPPLIER' ? 'No consume presupuesto' : budgetTotal ? dinero(Number(budgetTotal), moneda) : 'Sin tope (autorizado)'} />
                <Fila k="Público" v={CAMPAIGN_AUDIENCE_LABELS[audience]} />
                <Fila k="Vigencia" v={`${startsAt}${endsAt ? ` → ${endsAt}` : ' → sin fin'}${activeFrom ? ` · ${activeFrom}–${activeTo}` : ''}`} />
                <Fila k="Límites" v={`${maxRedemptions || 'sin tope'} en total · ${maxPerCustomer} por cliente`} />
              </dl>

              <div className="rounded-lg border border-border bg-muted/30 p-3" data-testid="campana-ejemplo">
                <p className="text-sm font-medium">Ejemplo con {seleccionadas[0] ? `«${seleccionadas[0].title}»` : 'un precio de muestra'} de {dinero(precio, moneda)}</p>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                  <Dato k="Precio Membego (GMV)" v={dinero(precio, moneda)} />
                  <Dato k="Descuento del proveedor" v={`−${dinero(descuentoProveedor, moneda)}`} />
                  <Dato k="Valor contractual" v={dinero(contractual, moneda)} />
                  <Dato k="Subsidio de Membego" v={`−${dinero(bonoMembego, moneda)}`} />
                  <Dato k="Paga el cliente" v={dinero(pagaCliente, moneda)} />
                  {aComision && <Dato k={`Comisión (${pct} %)`} v={dinero(comision, moneda)} />}
                  {aComision && <Dato k="Neto del proveedor" v={dinero(netoProveedor, moneda)} />}
                  {aComision && <Dato k="Contribución tras el subsidio" v={dinero(contribucion, moneda)} />}
                </dl>
                <p className="mt-2 text-caption text-muted-foreground">
                  La comisión se calcula sobre el valor contractual, no sobre lo que paga el cliente: el bono es costo de Membego y el proveedor cobra igual. El servidor rehace el cálculo con dos decimales al reservar.
                </p>
              </div>

              {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={anterior} disabled={pendiente}>Atrás</Button>
                <Button type="submit" disabled={pendiente} loading={pendiente} data-testid="btn-crear-campana">Crear como borrador</Button>
              </div>
              <p className="text-caption text-muted-foreground">Nace como borrador. En la ficha se añaden las ofertas con su promoción y se pide la aprobación de otra persona autorizada.</p>
            </form>
          )}

          {paso < 8 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {paso > 1 && <Button type="button" variant="outline" onClick={anterior}>Atrás</Button>}
              <Button type="button" onClick={siguiente} disabled={!listo[paso - 1]} data-testid="campana-continuar">Continuar</Button>
              <Link href={RUTA_CAMPANAS} className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline">Cancelar</Link>
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
