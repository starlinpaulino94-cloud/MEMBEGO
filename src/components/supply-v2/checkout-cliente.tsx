'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { avisarPagoAction, cancelarCompraAction, confirmarCoberturaTotalAction } from '@/modules/supply-v2/actions-cliente'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { CompraCliente } from '@/modules/supply-v2/commerce/queries'
import { ENTITLEMENT_STATUS_LABELS, PAYMENT_METHODS_CLIENTE, PAYMENT_METHOD_LABELS, RUTA_MEMBRESIAS_PUBLICAS } from '@/modules/supply-v2/core/catalogo'

function dinero(n: string, moneda: string): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
}

function CuentaAtras({ hasta }: { hasta: Date }) {
  const [restante, setRestante] = useState(() => hasta.getTime() - Date.now())
  useEffect(() => {
    const t = setInterval(() => setRestante(hasta.getTime() - Date.now()), 1000)
    return () => clearInterval(t)
  }, [hasta])
  if (restante <= 0) return <span className="text-destructive">La reserva venció.</span>
  const m = Math.floor(restante / 60_000)
  const s = Math.floor((restante % 60_000) / 1000)
  return (
    <span data-testid="cuenta-atras">
      Tu unidad está reservada {m}:{String(s).padStart(2, '0')} más.
    </span>
  )
}

/**
 * MEMBEGO SUPPLY 2.0 · CHECKOUT del cliente (§27, §29, §36; Slice 6 §17, §21).
 *
 * Desglose con los precios y la financiación CONGELADOS: precio regular,
 * descuento Membego, descuento del proveedor, beneficio aplicado y lo que
 * queda por pagar. Si el beneficio cubre el total no hay cuenta bancaria ni
 * aviso de pago: el propio cliente confirma y recibe su código.
 */
export function CheckoutCliente({ compra }: { compra: CompraCliente }) {
  const [aviso, avisar, avisando] = useActionState<EstadoAccion, FormData>(avisarPagoAction, {})
  const [cancel, cancelar, cancelando] = useActionState<EstadoAccion, FormData>(cancelarCompraAction, {})
  const [cobertura, confirmarCobertura, confirmandoCobertura] = useActionState<EstadoAccion, FormData>(confirmarCoberturaTotalAction, {})
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    const exito = aviso.success ?? cancel.success ?? cobertura.success
    if (exito && visto.current !== exito) {
      visto.current = exito
      toast.success(exito)
      router.refresh()
    }
  }, [aviso, cancel, cobertura, router])
  const select = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm'
  const enCurso = compra.status === 'PENDING' || compra.status === 'AWAITING_PAYMENT'
  // Slice 6: cubierta por completo = no hay saldo que pagar y hay un beneficio detrás.
  const cubiertaPorBeneficio = Number(compra.total) === 0
  const beneficioTotal = (Number(compra.supplierDiscountTotal) + Number(compra.membegoSubsidyTotal)).toFixed(2)

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        {/* Slice 8 (§16): una membresía no lleva líneas. Lo que se compra es el
            plan, y la pantalla lo dice en lugar de enseñar un carrito vacío. */}
        {compra.kind === 'MEMBERSHIP' && compra.membresia && (
          <div className="space-y-1 text-sm" data-testid="checkout-membresia">
            <p className="font-semibold" data-testid="checkout-producto">{compra.membresia.plan}</p>
            <p className="text-caption text-muted-foreground">{compra.membresia.negocio ?? compra.membresia.programa}</p>
            <dl className="mt-2 space-y-1">
              <Fila t="Qué es" v="Membresía" />
              <Fila t="Duración" v={`${compra.membresia.dias} días`} />
              <Fila t="Precio" v={dinero(compra.total, compra.currency)} />
            </dl>
            <p className="text-caption text-muted-foreground">
              Al confirmarse el pago empieza tu membresía y sus beneficios quedan en tu cuenta. No hay nada que recoger: no lleva voucher ni QR.
            </p>
          </div>
        )}
        {compra.lineas.map((l, i) => (
          <div key={i} className="space-y-1 text-sm">
            <p className="font-semibold" data-testid="checkout-producto">{l.titulo}</p>
            <p className="text-caption text-muted-foreground">{l.proveedor}</p>
            <dl className="mt-2 space-y-1">
              <Fila t="Cantidad" v={String(l.quantity)} />
              <Fila t="Precio regular" v={dinero(l.publicUnitPrice, compra.currency)} />
              <Fila t="Descuento Membego" v={`−${dinero(String(Number(l.publicUnitPrice) - Number(l.saleUnitPrice)), compra.currency)}`} />
              <Fila t="Precio Membego" v={dinero(String(Number(l.saleUnitPrice) * l.quantity), compra.currency)} />
              {Number(l.supplierDiscountAmount) > 0 && (
                <Fila t="Descuento del proveedor" v={`−${dinero(l.supplierDiscountAmount, compra.currency)}`} />
              )}
              {Number(l.membegoSubsidyAmount) > 0 && (
                <Fila t={`Beneficio aplicado${compra.beneficio ? `: ${compra.beneficio.name}` : ''}`} v={`−${dinero(l.membegoSubsidyAmount, compra.currency)}`} testid="checkout-beneficio" />
              )}
              <Fila t="Subtotal" v={dinero(l.total, compra.currency)} />
            </dl>
          </div>
        ))}
        {Number(beneficioTotal) > 0 && (
          <p className="mt-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-success" data-testid="checkout-beneficio-aviso">
            Beneficio aplicado: ahorras {dinero(beneficioTotal, compra.currency)}
            {compra.beneficio ? ` con «${compra.beneficio.name}»` : ''}
            {compra.cupon ? ` (cupón ${compra.cupon})` : ''}.
            {compra.campana ? <span className="block text-caption" data-testid="checkout-campana">Campaña: {compra.campana.name}</span> : null}
          </p>
        )}
        <div className="mt-3 flex items-baseline justify-between border-t border-border pt-2">
          <span className="font-medium">{cubiertaPorBeneficio ? 'A pagar' : 'Total'}</span>
          <span className="text-h2 tabular-nums" data-testid="checkout-total">{dinero(compra.total, compra.currency)}</span>
        </div>
      </div>

      {compra.status === 'PENDING' && cubiertaPorBeneficio && (
        <>
          <p className="text-sm text-muted-foreground"><CuentaAtras hasta={compra.expiresAt} /></p>
          <form action={confirmarCobertura} className="space-y-2 rounded-xl border border-success/30 bg-success/5 p-4" data-testid="form-cobertura-total">
            <input type="hidden" name="orderId" value={compra.id} />
            <p className="text-sm font-medium">Tu beneficio cubre el total: no tienes que pagar nada.</p>
            <p className="text-caption text-muted-foreground">No hay transferencia que hacer ni cuenta a la que pagar. Confirma y tu código queda activo al instante.</p>
            <Button type="submit" className="w-full" disabled={confirmandoCobertura} loading={confirmandoCobertura} data-testid="btn-confirmar-cobertura">Confirmar y recibir mi código</Button>
            {cobertura.error && <p className="text-sm text-destructive" role="alert">{cobertura.error}</p>}
          </form>
        </>
      )}

      {compra.status === 'PENDING' && !cubiertaPorBeneficio && (
        <>
          <p className="text-sm text-muted-foreground"><CuentaAtras hasta={compra.expiresAt} /></p>
          {compra.cuenta && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm" data-testid="checkout-cuenta">
              <p className="font-medium">Paga a Membego por transferencia o depósito</p>
              {Number(beneficioTotal) > 0 && <p className="text-caption text-muted-foreground">El beneficio no se paga en el banco: transfiere solo la diferencia.</p>}
              <dl className="mt-2 space-y-1">
                <Fila t="Cuenta" v={compra.cuenta.nombre} />
                {compra.cuenta.titular && <Fila t="Titular" v={compra.cuenta.titular} />}
                {compra.cuenta.numeroCuenta && <Fila t="Número" v={compra.cuenta.numeroCuenta} />}
                {compra.cuenta.tipoCuenta && <Fila t="Tipo" v={compra.cuenta.tipoCuenta} />}
                <Fila t="Monto exacto" v={dinero(compra.total, compra.currency)} />
              </dl>
              {compra.cuenta.instrucciones && <p className="mt-2 text-caption text-muted-foreground">{compra.cuenta.instrucciones}</p>}
            </div>
          )}
          <form action={avisar} className="space-y-3 rounded-xl border border-border p-4" data-testid="form-avisar-pago">
            <input type="hidden" name="orderId" value={compra.id} />
            <p className="text-sm font-medium">Ya pagué</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="metodoPago">¿Cómo pagaste?</Label>
                <select id="metodoPago" name="method" defaultValue="TRANSFER" className={select}>
                  {PAYMENT_METHODS_CLIENTE.map((m) => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="referenciaPago">Referencia (opcional)</Label>
                <Input id="referenciaPago" name="reference" maxLength={120} placeholder="Nº de transferencia" />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={avisando} loading={avisando} data-testid="btn-avisar-pago">Confirmar que pagué</Button>
            {aviso.error && <p className="text-sm text-destructive" role="alert">{aviso.error}</p>}
          </form>
        </>
      )}

      {compra.status === 'AWAITING_PAYMENT' && (
        <div className="rounded-xl border border-info/30 bg-info/5 p-4 text-sm" data-testid="checkout-en-revision">
          <p className="font-medium">Pago en revisión</p>
          <p className="text-muted-foreground">Membego está revisando tu pago{compra.paymentReference ? ` (ref. ${compra.paymentReference})` : ''}. Tu unidad sigue reservada; cuando se confirme, tu beneficio aparecerá aquí.</p>
        </div>
      )}

      {compra.status === 'PAID' && (
        <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm" data-testid="checkout-pagada">
          <p className="text-h4">Compra confirmada.</p>
          <p className="text-muted-foreground">
            {compra.paymentStatus === 'COVERED_BY_BENEFIT'
              ? 'Tu beneficio cubrió el total: no hubo pago. Tu código ya está activo.'
              : 'Tu beneficio está disponible.'}
          </p>
          <ul className="mt-2 space-y-1">
            {compra.derechos.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-3" data-testid="derecho">
                <span>
                  <span className="font-medium">{d.producto}</span> · {d.proveedor}
                  {d.expiresAt ? <span className="block text-caption text-muted-foreground">Válido hasta {new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(d.expiresAt))}</span> : null}
                </span>
                <span className="rounded-full border border-success/30 px-2 py-0.5 text-caption text-success" data-testid="derecho-estado">{ENTITLEMENT_STATUS_LABELS[d.status as keyof typeof ENTITLEMENT_STATUS_LABELS] ?? d.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(compra.status === 'CANCELLED' || compra.status === 'EXPIRED') && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm" data-testid="checkout-cerrada">
          <p className="font-medium">{compra.status === 'EXPIRED' ? 'La reserva venció.' : 'Compra cancelada.'}</p>
          {compra.paymentRejectedReason && <p className="text-muted-foreground">Motivo: {compra.paymentRejectedReason}</p>}
          <p className="text-muted-foreground">Si todavía la quieres, vuelve y {compra.kind === 'MEMBERSHIP' ? 'contrátala' : 'compra'} de nuevo.</p>
          {compra.kind === 'MEMBERSHIP' ? (
            <Link href={RUTA_MEMBRESIAS_PUBLICAS} className="mt-2 inline-block text-primary underline-offset-4 hover:underline">Ver las membresías</Link>
          ) : (
            <Link href={`/promociones/membego/${compra.lineas[0]?.offerSlug ?? ''}`} className="mt-2 inline-block text-primary underline-offset-4 hover:underline">Ver la oferta</Link>
          )}
        </div>
      )}

      {enCurso && (
        <form action={cancelar}>
          <input type="hidden" name="orderId" value={compra.id} />
          <Button type="submit" variant="ghost" size="sm" disabled={cancelando} data-testid="btn-cancelar-compra">Cancelar compra</Button>
          {cancel.error && <p className="text-sm text-destructive" role="alert">{cancel.error}</p>}
        </form>
      )}
    </div>
  )
}

function Fila({ t, v, testid }: { t: string; v: string; testid?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{t}</dt>
      <dd className="text-right font-medium tabular-nums" data-testid={testid}>{v}</dd>
    </div>
  )
}
