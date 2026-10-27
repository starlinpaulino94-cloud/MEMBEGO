'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Minus, Plus, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { cerrarVisitaAction, registrarVentaAdicionalAction, type VisitaCerrada } from '@/modules/visitas-membego/actions'
import type { VentaAdicionalRegistrada, VisitaAbierta } from '@/modules/visitas-membego/service'
import { RUTA_PORTAL_CONFIGURACION, RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

export interface ExtraDelPanel {
  id: string
  name: string
  price: string
}

const dinero = (n: string | number) => `RD$${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const hora = (d: Date | string) => new Intl.DateTimeFormat('es-DO', { timeStyle: 'short' }).format(new Date(d))

function claveNueva(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * SUPPLIER & FULFILLMENT COMMERCE · la visita en el escáner (§25–§27, §55, §66).
 *
 * Tras «Confirmar entrega» el operador ve lo que Membego incluyó (ya
 * pagado) y, si el cliente compró algo más, lo marca desde su mini catálogo
 * o escribe una línea personalizada. Lo que manda son ids y cantidades: el
 * precio de catálogo lo relee el servidor (§55); la línea personalizada va
 * con precio y queda marcada y auditada. «Cerrar visita» cierra la ventana
 * de atribución; si no compró nada más, se cierra y ya.
 */
export function PanelVisita({ visita, extras, puedeVenderExtras, alReiniciar }: { visita: VisitaAbierta; extras: ExtraDelPanel[]; puedeVenderExtras: boolean; alReiniciar: () => void }) {
  const [venta, registrar, registrando] = useActionState<EstadoAccion<VentaAdicionalRegistrada>, FormData>(registrarVentaAdicionalAction, {})
  const [cierre, cerrar, cerrando] = useActionState<EstadoAccion<VisitaCerrada>, FormData>(cerrarVisitaAction, {})
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  const [personalizadas, setPersonalizadas] = useState<{ description: string; unitPrice: string; quantity: number }[]>([])
  const [nuevaLinea, setNuevaLinea] = useState(false)
  const [clave, setClave] = useState(claveNueva)
  const [registradas, setRegistradas] = useState<VentaAdicionalRegistrada[]>([])

  // Una venta registrada con éxito se apunta y se limpia la selección con una clave nueva.
  useEffect(() => {
    const r = venta.data
    if (!r) return
    setRegistradas((previas) => (previas.some((x) => x.id === r.id) ? previas : [...previas, r]))
    setCantidades({})
    setPersonalizadas([])
    setNuevaLinea(false)
    setClave(claveNueva())
  }, [venta.data])

  const lineas = useMemo(() => {
    const l: { supplyCatalogItemId?: string; description?: string; quantity: number; unitPrice?: string }[] = []
    for (const e of extras) {
      const q = cantidades[e.id] ?? 0
      if (q > 0) l.push({ supplyCatalogItemId: e.id, quantity: q })
    }
    for (const p of personalizadas) l.push({ description: p.description, quantity: p.quantity, unitPrice: p.unitPrice })
    return l
  }, [extras, cantidades, personalizadas])

  const subtotalSeleccion = useMemo(() => {
    let t = 0
    for (const e of extras) t += (cantidades[e.id] ?? 0) * Number(e.price)
    for (const p of personalizadas) t += p.quantity * (Number(p.unitPrice) || 0)
    return t
  }, [extras, cantidades, personalizadas])

  const totalRegistrado = registradas.reduce((t, r) => t + Number(r.subtotal), 0)
  const ultimoTotal = registradas.length ? registradas[registradas.length - 1]!.visita.ancillaryTotal : visita.ancillaryTotal
  const cambiar = (id: string, delta: number) => setCantidades((c) => ({ ...c, [id]: Math.max(0, Math.min(99, (c[id] ?? 0) + delta)) }))

  if (cierre.data) {
    const total = Number(cierre.data.ancillaryTotal)
    return (
      <div className="space-y-3 rounded-xl border border-success/40 bg-success/5 p-4" data-testid="visita-cerrada">
        <p className="flex items-center gap-2 text-h4 text-success">
          <CheckCircle2 className="size-5" aria-hidden />
          Visita cerrada
        </p>
        <dl className="space-y-1 text-sm">
          <Dato label="Visita"><span className="font-mono">{cierre.data.number}</span></Dato>
          <Dato label="Incluido por Membego">{visita.incluido.producto} ×{visita.incluido.cantidad}</Dato>
          <Dato label="Compras adicionales"><span data-testid="visita-cerrada-extras">{dinero(cierre.data.ancillaryTotal)}</span></Dato>
        </dl>
        <p className="text-caption text-muted-foreground">
          {total > 0 ? 'El cliente recibirá un aviso para confirmar lo que compró.' : 'Sin compras adicionales: nada que confirmar ni comisionar.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={alReiniciar} data-testid="btn-escanear-otro">Escanear otro</Button>
          <Button asChild variant="ghost"><Link href={RUTA_PORTAL_PROVEEDOR}>Ver entregas</Link></Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="panel-visita">
      <div className="rounded-xl border border-border p-3 text-sm">
        <p className="flex items-center justify-between gap-2">
          <span className="font-medium">Visita <span className="font-mono">{visita.number}</span></span>
          <span className="text-caption text-muted-foreground">abierta hasta las {hora(visita.ventanaHasta)}</span>
        </p>
        <p className="mt-2 flex items-center justify-between gap-2" data-testid="visita-incluido">
          <span>
            <span className="block text-caption uppercase tracking-wide text-muted-foreground">Incluido por Membego</span>
            {visita.incluido.producto} ×{visita.incluido.cantidad}
          </span>
          <span className="font-medium text-success">Pagado</span>
        </p>
      </div>

      {registradas.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="ventas-registradas">
          {registradas.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-success-soft px-3 py-2" data-testid="venta-registrada">
              <span>
                <span className="font-mono text-caption text-muted-foreground">{r.number}</span>
                <span className="block">{r.lineas.map((l) => `${l.description} ×${l.quantity}`).join(', ')}</span>
              </span>
              <span className="font-medium">{dinero(r.subtotal)}</span>
            </li>
          ))}
        </ul>
      )}

      {puedeVenderExtras ? (
        <form action={registrar} className="space-y-3">
          <input type="hidden" name="visitId" value={visita.id} />
          <input type="hidden" name="idempotencyKey" value={clave} />
          <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
          <p className="text-h4">¿El cliente compró algo más?</p>
          {extras.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              No tienes extras configurados. <Link href={RUTA_PORTAL_CONFIGURACION} className="underline">Añádelos en Configuración</Link> o escribe una línea aquí.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border" data-testid="extras">
              {extras.map((e) => {
                const q = cantidades[e.id] ?? 0
                return (
                  <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="extra" data-extra-id={e.id}>
                    <span>
                      <span className="block font-medium">{e.name}</span>
                      <span className="text-caption text-muted-foreground">{dinero(e.price)}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Button type="button" variant="outline" size="icon" aria-label={`Quitar ${e.name}`} onClick={() => cambiar(e.id, -1)} disabled={q === 0}>
                        <Minus className="size-4" aria-hidden />
                      </Button>
                      <span className="w-6 text-center font-medium" data-testid="extra-cantidad">{q}</span>
                      <Button type="button" variant="outline" size="icon" aria-label={`Añadir ${e.name}`} onClick={() => cambiar(e.id, 1)} data-testid="btn-extra-mas">
                        <Plus className="size-4" aria-hidden />
                      </Button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {personalizadas.length > 0 && (
            <ul className="space-y-1 text-sm" data-testid="lineas-personalizadas">
              {personalizadas.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
                  <span>{p.description} ×{p.quantity} <span className="text-caption text-muted-foreground">(línea personalizada)</span></span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{dinero(p.quantity * (Number(p.unitPrice) || 0))}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPersonalizadas((l) => l.filter((_, j) => j !== i))}>Quitar</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {nuevaLinea ? (
            <LineaPersonalizada
              onAdd={(l) => {
                setPersonalizadas((p) => [...p, l])
                setNuevaLinea(false)
              }}
              onCancel={() => setNuevaLinea(false)}
            />
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setNuevaLinea(true)} data-testid="btn-linea-personalizada">
              <Plus className="mr-1 size-4" aria-hidden />
              Otra cosa que no está en la lista
            </Button>
          )}

          {venta.error && (
            <p className="flex items-center gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger-ink" role="alert" data-testid="venta-error">
              <XCircle className="size-4 shrink-0" aria-hidden />
              {venta.error}
            </p>
          )}

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Seleccionado</span>
            <span className="font-medium" data-testid="seleccion-total">{dinero(subtotalSeleccion)}</span>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={registrando || lineas.length === 0} loading={registrando} data-testid="btn-registrar-extras">
            Registrar compras ({dinero(subtotalSeleccion)})
          </Button>
          {visita.politica.ancillaryCommissionEnabled && (
            <p className="text-caption text-muted-foreground">
              Membego cobra {Number(visita.politica.ancillaryCommissionRate).toLocaleString('es-DO')} % solo sobre las compras adicionales; nunca sobre lo que Membego incluyó.
            </p>
          )}
        </form>
      ) : (
        <p className="text-caption text-muted-foreground">Tu rol no registra compras adicionales. Si el cliente compró algo más, avísale a quien administra el portal.</p>
      )}

      <form action={cerrar} className="space-y-2 border-t border-border pt-3">
        <input type="hidden" name="visitId" value={visita.id} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Compras adicionales de la visita</span>
          <span className="font-medium" data-testid="visita-total-extras">{dinero(Number(ultimoTotal) > totalRegistrado ? ultimoTotal : totalRegistrado)}</span>
        </div>
        {cierre.error && <p className="text-sm text-destructive" role="alert" data-testid="cierre-error">{cierre.error}</p>}
        <Button type="submit" size="lg" variant={registradas.length ? 'default' : 'outline'} className="w-full" disabled={cerrando || registrando} loading={cerrando} data-testid="btn-cerrar-visita">
          {registradas.length ? 'Confirmar visita' : 'Sin compras adicionales · cerrar visita'}
        </Button>
      </form>
    </div>
  )
}

function LineaPersonalizada({ onAdd, onCancel }: { onAdd: (l: { description: string; unitPrice: string; quantity: number }) => void; onCancel: () => void }) {
  const [description, setDescription] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [quantity, setQuantity] = useState(1)
  const valida = description.trim().length >= 2 && Number(unitPrice) > 0 && quantity > 0
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="form-linea-personalizada">
      <div>
        <Label htmlFor="lineaDescripcion">Qué compró</Label>
        <Input id="lineaDescripcion" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} autoFocus data-testid="linea-descripcion" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="lineaPrecio">Precio (RD$)</Label>
          <Input id="lineaPrecio" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} data-testid="linea-precio" />
        </div>
        <div>
          <Label htmlFor="lineaCantidad">Cantidad</Label>
          <Input id="lineaCantidad" type="number" min={1} max={99} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
        </div>
      </div>
      <p className="text-caption text-muted-foreground">Esta línea queda marcada como personalizada y auditada.</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!valida} onClick={() => onAdd({ description: description.trim(), unitPrice, quantity })} data-testid="btn-linea-anadir">Añadir</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
