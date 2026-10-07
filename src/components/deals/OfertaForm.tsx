'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { crearOferta, editarOferta } from '@/modules/deals/actions'
import { AYUDA_TIPO_DESCUENTO, ETIQUETA_TIPO_DESCUENTO } from '@/modules/deals/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'

const campoSelector = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'

export interface ProductoParaOferta {
  id: string
  etiqueta: string
  precio: string
  currency: string
}

export interface ValoresDeOferta {
  title: string
  description: string
  catalogVariantId: string
  discountType: 'PERCENT' | 'AMOUNT_OFF' | 'FIXED_PRICE'
  discountValue: string
  /** `AAAA-MM-DD` */
  startsAt: string
  endsAt: string
  voucherDays: string
  newCustomersOnly: boolean
  maxClaims: string
  budgetTotal: string
}

const VACIO: ValoresDeOferta = {
  title: '',
  description: '',
  catalogVariantId: '',
  discountType: 'PERCENT',
  discountValue: '',
  startsAt: '',
  endsAt: '',
  voucherDays: '7',
  newCustomersOnly: false,
  maxClaims: '',
  budgetTotal: '',
}

interface Props {
  productos: ProductoParaOferta[]
  /** Cuota que Membego cobra por canje (de la tarifa de la cuenta), o null si aún no hay cuenta. */
  cuota: string | null
  moneda: string
  /** Sin `ofertaId` se crea; con él se edita. */
  ofertaId?: string
  inicial?: Partial<ValoresDeOferta>
  /** En una oferta ya publicada solo se cambian el título, la descripción, el fin y los cupos. */
  soloAjustes?: boolean
}

/**
 * Alta o edición de una oferta. Todo lo que se escribe es TEXTO: el servidor lo lee, lo valida y
 * calcula (el navegador no manda precios finales, cuotas ni estados). La cuota por canje se
 * enseña para que la empresa vea de antemano lo que le cuesta cada canje y cuántos alcanzan.
 */
export function OfertaForm({ productos, cuota, moneda, ofertaId, inicial, soloAjustes = false }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [v, setV] = useState<ValoresDeOferta>({ ...VACIO, ...inicial })
  const set = <K extends keyof ValoresDeOferta>(k: K, valor: ValoresDeOferta[K]) => setV((a) => ({ ...a, [k]: valor }))

  const producto = productos.find((p) => p.id === v.catalogVariantId)
  const canjes = useMemo(() => {
    const total = Number(v.budgetTotal)
    const c = Number(cuota)
    if (!cuota || !Number.isFinite(total) || !Number.isFinite(c) || c <= 0 || total <= 0) return null
    return Math.floor(total / c)
  }, [v.budgetTotal, cuota])

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    start(async () => {
      const datos = soloAjustes ? { title: v.title, description: v.description, endsAt: v.endsAt, maxClaims: v.maxClaims } : { ...v }
      if (ofertaId) {
        const r = await editarOferta(ofertaId, datos)
        if (!r.ok) {
          setError(r.error)
          return
        }
        toast.success('Cambios guardados.')
        router.refresh()
        return
      }
      const r = await crearOferta(datos)
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast.success('Oferta creada como borrador. Revísala y publícala cuando esté lista.')
      router.push(`/admin/deals/${r.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={enviar} className="max-w-2xl space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="title">Título</Label>
        <Input id="title" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={120} placeholder="20 % en el lavado básico" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Descripción (opcional)</Label>
        <Textarea id="description" value={v.description} onChange={(e) => set('description', e.target.value)} maxLength={600} rows={3} />
      </div>

      {!soloAjustes && (
        <>
          <div className="space-y-2">
            <Label htmlFor="catalogVariantId">Qué ofreces</Label>
            <select id="catalogVariantId" className={campoSelector} value={v.catalogVariantId} onChange={(e) => set('catalogVariantId', e.target.value)} required>
              <option value="">Elige un producto o servicio de tu catálogo…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.etiqueta} — {p.precio} {p.currency}
                </option>
              ))}
            </select>
            {productos.length === 0 && <p className="text-xs text-muted-foreground">No tienes productos o servicios publicados que se vendan por el marketplace. Publica uno en el catálogo primero.</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="discountType">Tipo de descuento</Label>
              <select id="discountType" className={campoSelector} value={v.discountType} onChange={(e) => set('discountType', e.target.value as ValoresDeOferta['discountType'])}>
                {(Object.keys(ETIQUETA_TIPO_DESCUENTO) as ValoresDeOferta['discountType'][]).map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO_DESCUENTO[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="discountValue">Descuento</Label>
              <Input id="discountValue" inputMode="decimal" value={v.discountValue} onChange={(e) => set('discountValue', e.target.value)} required />
              <p className="text-xs text-muted-foreground">{AYUDA_TIPO_DESCUENTO[v.discountType]}</p>
            </div>
          </div>
          {producto && <p className="text-xs text-muted-foreground">Precio de lista: {producto.precio} {producto.currency}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxClaims">Cuántos clientes pueden obtenerla</Label>
              <Input id="maxClaims" inputMode="numeric" value={v.maxClaims} onChange={(e) => set('maxClaims', e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="budgetTotal">Presupuesto máximo ({moneda})</Label>
              <Input id="budgetTotal" inputMode="decimal" value={v.budgetTotal} onChange={(e) => set('budgetTotal', e.target.value)} required />
              <p className="text-xs text-muted-foreground">
                {cuota
                  ? `Membego cobra ${cuota} ${moneda} por cada oferta canjeada${canjes !== null ? `: con este presupuesto alcanzan ${canjes} canjes` : ''}. Es un tope, no un pago por adelantado.`
                  : 'La cuota por canje se toma de la tarifa de tu cuenta Membego al crear la oferta. El presupuesto es un tope, no un pago por adelantado.'}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startsAt">Empieza (opcional)</Label>
              <Input id="startsAt" type="date" value={v.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
              <p className="text-xs text-muted-foreground">Vacío = en cuanto la publiques.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voucherDays">Días para canjear el cupón</Label>
              <Input id="voucherDays" inputMode="numeric" value={v.voucherDays} onChange={(e) => set('voucherDays', e.target.value)} />
              <p className="text-xs text-muted-foreground">De 1 a 60 días desde que el cliente la obtiene.</p>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="endsAt">Termina (opcional)</Label>
        <Input id="endsAt" type="date" value={v.endsAt} onChange={(e) => set('endsAt', e.target.value)} className="max-w-48" />
        <p className="text-xs text-muted-foreground">Vale hasta el final de ese día. Vacío = sin fecha de fin.</p>
      </div>
      {soloAjustes && (
        <div className="space-y-2">
          <Label htmlFor="maxClaims">Cuántos clientes pueden obtenerla</Label>
          <Input id="maxClaims" inputMode="numeric" value={v.maxClaims} onChange={(e) => set('maxClaims', e.target.value)} className="max-w-48" required />
        </div>
      )}

      {!soloAjustes && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.newCustomersOnly} onChange={(e) => set('newCustomersOnly', e.target.checked)} />
          Solo para clientes nuevos (quien nunca ha completado un pedido contigo)
        </label>
      )}

      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {ofertaId ? 'Guardar cambios' : 'Crear borrador'}
      </Button>
    </form>
  )
}
