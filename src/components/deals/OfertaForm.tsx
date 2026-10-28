'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { crearOferta, editarOferta } from '@/modules/deals/actions'
import { AYUDA_TIPO_DESCUENTO, ETIQUETA_TIPO_DESCUENTO } from '@/modules/deals/formato'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Campo } from '@/components/ui/campo'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { SelectNativo } from '@/components/ui/select-nativo'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'

export interface ProductoParaOferta {
  id: string
  etiqueta: string
  precio: string
  currency: string
  itemId?: string
  sinStock?: boolean
}

/**
 * Vista previa del precio con la oferta. Es la MISMA regla que `precioDeLaOferta` del dominio
 * (porcentaje, monto fijo o precio final, acotado entre 0 y el precio de lista), repetida aquí
 * solo para enseñarla mientras se escribe: el servidor la recalcula y es el único que manda.
 */
export function previsualizarPrecio(precioLista: string, tipo: ValoresDeOferta['discountType'], valor: string): { precio: number; ahorro: number } | null {
  const lista = Number(precioLista)
  const v = Number(valor)
  if (!Number.isFinite(lista) || !Number.isFinite(v) || valor.trim() === '') return null
  let precio = tipo === 'PERCENT' ? (lista * (100 - v)) / 100 : tipo === 'AMOUNT_OFF' ? lista - v : v
  precio = Math.min(Math.max(precio, 0), lista)
  return { precio: Math.round(precio * 100) / 100, ahorro: Math.round((lista - precio) * 100) / 100 }
}

export interface ValoresDeOferta {
  title: string
  description: string
  promotionId: string
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
  promotionId: '',
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
  promociones?: { id: string; nombre: string }[]
  /** Cuota que Membego cobra por canje (de la tarifa de la cuenta), o null si aún no hay cuenta. */
  cuota: string | null
  moneda: string
  /** Sin `ofertaId` se crea; con él se edita. */
  ofertaId?: string
  inicial?: Partial<ValoresDeOferta>
  /** En una oferta ya publicada solo se cambian el título, la descripción, el fin y los cupos. */
  soloAjustes?: boolean
}

/** Al crear, cada sección lleva su título a la izquierda; al editar dentro de la ficha (una tarjeta) va compacta. Fuera del componente: definida dentro se volvería a montar en cada tecla y los campos perderían el foco. */
function Seccion({ compacta, title, description, children }: { compacta: boolean; title: string; description: string; children: React.ReactNode }) {
  return compacta ? <div className="space-y-4">{children}</div> : <FormSection title={title} description={description}>{children}</FormSection>
}

/**
 * Alta o edición de una oferta. Todo lo que se escribe es TEXTO: el servidor lo lee, lo valida y
 * calcula (el navegador no manda precios finales, cuotas ni estados). La cuota por canje se
 * enseña para que la empresa vea de antemano lo que le cuesta cada canje y cuántos alcanzan.
 */
export function OfertaForm({ productos, promociones = [], cuota, moneda, ofertaId, inicial, soloAjustes = false }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [v, setV] = useState<ValoresDeOferta>({ ...VACIO, ...inicial })
  const set = <K extends keyof ValoresDeOferta>(k: K, valor: ValoresDeOferta[K]) => setV((a) => ({ ...a, [k]: valor }))

  const producto = productos.find((p) => p.id === v.catalogVariantId)
  const vista = useMemo(() => (producto ? previsualizarPrecio(producto.precio, v.discountType, v.discountValue) : null), [producto, v.discountType, v.discountValue])
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

  const accion = (
    <Button type="submit" loading={pending}>
      {ofertaId ? 'Guardar cambios' : 'Crear borrador'}
    </Button>
  )

  return (
    <form onSubmit={enviar} className={ofertaId ? 'max-w-2xl space-y-5' : 'space-y-8'}>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Seccion compacta={Boolean(ofertaId)} title="La oferta" description="Cómo se llama y qué ve el cliente en el marketplace.">
        <Campo id="title" etiqueta="Título">
          {(control) => (
            <Input value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={120} placeholder="20 % en el lavado básico" required {...control} />
          )}
        </Campo>
        <Campo id="description" etiqueta="Descripción" opcional>
          {(control) => <Textarea value={v.description} onChange={(e) => set('description', e.target.value)} maxLength={600} rows={3} {...control} />}
        </Campo>
      </Seccion>

      {!soloAjustes && (
        <>
          <Seccion compacta={Boolean(ofertaId)} title="Qué ofreces" description="El producto o servicio de tu catálogo y quién puede obtener la oferta.">
            <Campo
              id="catalogVariantId"
              etiqueta="Producto o servicio"
              ayuda={
                productos.length === 0
                  ? 'No tienes productos o servicios publicados que se vendan por el marketplace. Publica uno en el catálogo primero.'
                  : undefined
              }
            >
              {(control) => (
                <SelectNativo value={v.catalogVariantId} onChange={(e) => set('catalogVariantId', e.target.value)} required {...control}>
                  <option value="">Elige un producto o servicio de tu catálogo…</option>
                  {productos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.etiqueta} — {p.precio} {p.currency}
                    </option>
                  ))}
                </SelectNativo>
              )}
            </Campo>

            {!ofertaId && promociones.length > 0 && (
              <Campo
                id="promotionId"
                etiqueta="Condición de acceso"
                opcional
                ayuda="Las reglas activas se validan en el servidor al reclamar. Los cupones ya emitidos conservan sus condiciones de canje."
              >
                {(control) => (
                  <SelectNativo value={v.promotionId} onChange={(e) => set('promotionId', e.target.value)} {...control}>
                    <option value="">Disponible para todos los clientes elegibles</option>
                    {promociones.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </SelectNativo>
                )}
              </Campo>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 rounded border-input" checked={v.newCustomersOnly} onChange={(e) => set('newCustomersOnly', e.target.checked)} />
              Solo para clientes nuevos (quien nunca ha completado un pedido contigo)
            </label>
          </Seccion>

          <Seccion compacta={Boolean(ofertaId)} title="El descuento" description="Cuánto rebajas. Abajo ves cómo lo verá el cliente.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id="discountType" etiqueta="Tipo de descuento">
                {(control) => (
                  <SelectNativo value={v.discountType} onChange={(e) => set('discountType', e.target.value as ValoresDeOferta['discountType'])} {...control}>
                    {(Object.keys(ETIQUETA_TIPO_DESCUENTO) as ValoresDeOferta['discountType'][]).map((t) => (
                      <option key={t} value={t}>
                        {ETIQUETA_TIPO_DESCUENTO[t]}
                      </option>
                    ))}
                  </SelectNativo>
                )}
              </Campo>
              <Campo id="discountValue" etiqueta="Descuento" ayuda={AYUDA_TIPO_DESCUENTO[v.discountType]}>
                {(control) => <Input inputMode="decimal" value={v.discountValue} onChange={(e) => set('discountValue', e.target.value)} required {...control} />}
              </Campo>
            </div>
            {producto && (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm" aria-live="polite">
                <p className="text-caption text-muted-foreground">Así lo verá el cliente</p>
                <p className="mt-0.5">
                  <span className="text-muted-foreground">Antes:</span>{' '}
                  <span className={vista && vista.ahorro > 0 ? 'line-through' : ''}>{producto.precio} {producto.currency}</span>
                  {vista && vista.ahorro > 0 && (
                    <>
                      {' · '}
                      <span className="text-muted-foreground">Ahora:</span> <strong>{vista.precio.toFixed(2)} {producto.currency}</strong>
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">ahorra {vista.ahorro.toFixed(2)}</span>
                    </>
                  )}
                </p>
                {producto.sinStock && (
                  <p className="mt-1 text-xs text-warning-ink">
                    Este producto está agotado ahora mismo. La oferta se crea igual, pero el marketplace la mostrará como «Agotado» y nadie podrá obtenerla hasta que entres existencias en Inventario. Crear la oferta no cambia el stock.
                  </p>
                )}
              </div>
            )}
          </Seccion>

          <Seccion compacta={Boolean(ofertaId)} title="Cupos y presupuesto" description="Cuántos clientes la obtienen y cuánto estás dispuesto a pagar por traerlos.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id="maxClaims" etiqueta="Cuántos clientes pueden obtenerla">
                {(control) => <Input inputMode="numeric" value={v.maxClaims} onChange={(e) => set('maxClaims', e.target.value)} required {...control} />}
              </Campo>
              <Campo
                id="budgetTotal"
                etiqueta={`Presupuesto máximo (${moneda})`}
                ayuda={
                  cuota
                    ? `Membego cobra ${cuota} ${moneda} por cada oferta canjeada${canjes !== null ? `: con este presupuesto alcanzan ${canjes} canjes` : ''}. Es un tope, no un pago por adelantado.`
                    : 'La cuota por canje se toma de la tarifa de tu cuenta Membego al crear la oferta. El presupuesto es un tope, no un pago por adelantado.'
                }
              >
                {(control) => <Input inputMode="decimal" value={v.budgetTotal} onChange={(e) => set('budgetTotal', e.target.value)} required {...control} />}
              </Campo>
            </div>
          </Seccion>

          <Seccion compacta={Boolean(ofertaId)} title="Cuándo" description="Las fechas en que está disponible y el plazo para canjear el cupón.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id="startsAt" etiqueta="Empieza" opcional ayuda="Vacío = en cuanto la publiques.">
                {(control) => <Input type="date" value={v.startsAt} onChange={(e) => set('startsAt', e.target.value)} {...control} />}
              </Campo>
              <Campo id="endsAt" etiqueta="Termina" opcional ayuda="Vale hasta el final de ese día. Vacío = sin fecha de fin.">
                {(control) => <Input type="date" value={v.endsAt} onChange={(e) => set('endsAt', e.target.value)} {...control} />}
              </Campo>
            </div>
            <Campo id="voucherDays" etiqueta="Días para canjear el cupón" ayuda="De 1 a 60 días desde que el cliente la obtiene." className="sm:max-w-xs">
              {(control) => <Input inputMode="numeric" value={v.voucherDays} onChange={(e) => set('voucherDays', e.target.value)} {...control} />}
            </Campo>
          </Seccion>
        </>
      )}

      {soloAjustes && (
        <Seccion compacta={Boolean(ofertaId)} title="Cupos y fin" description="Lo único que cambia en una oferta ya publicada.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo id="endsAt" etiqueta="Termina" opcional ayuda="Vale hasta el final de ese día. Vacío = sin fecha de fin.">
              {(control) => <Input type="date" value={v.endsAt} onChange={(e) => set('endsAt', e.target.value)} {...control} />}
            </Campo>
            <Campo id="maxClaims" etiqueta="Cuántos clientes pueden obtenerla">
              {(control) => <Input inputMode="numeric" value={v.maxClaims} onChange={(e) => set('maxClaims', e.target.value)} required {...control} />}
            </Campo>
          </div>
        </Seccion>
      )}

      {ofertaId ? accion : <FormActions>{accion}</FormActions>}
    </form>
  )
}
