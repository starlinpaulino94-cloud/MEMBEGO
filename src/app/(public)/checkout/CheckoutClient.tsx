'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useExcursionCart } from '@/components/excursiones/ExcursionCarritoContext'
import { reservarCarritoAction } from '@/modules/excursiones/reservas/cliente-actions'
import { PasarelaSimuladaModal } from '@/components/excursiones/PasarelaSimuladaModal'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Trash2,
  CalendarDays,
  Clock,
  CreditCard,
  Banknote,
  Check,
  Loader2,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  LogIn,
  UserPlus,
  ShoppingBag,
  Minus,
  Plus,
} from 'lucide-react'
import { toast } from 'sonner'

interface CheckoutClientProps {
  isAuthenticated: boolean
}

type Paso = 'resumen' | 'pago' | 'confirmar'

const PASOS: { key: Paso; label: string }[] = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'pago', label: 'Pago' },
  { key: 'confirmar', label: 'Confirmar' },
]

export function CheckoutClient({ isAuthenticated }: CheckoutClientProps) {
  const { items, removeItem, updateItem, clearCart, subtotal } = useExcursionCart()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [paso, setPaso] = useState<Paso>('resumen')
  const [metodoPago, setMetodoPago] = useState<'DESTINO' | 'ONLINE_SIMULADO'>('DESTINO')
  const [isModalPagoOpen, setIsModalPagoOpen] = useState(false)

  const moneda = useMemo(() => items[0]?.moneda || 'DOP', [items])
  const totalItems = useMemo(() => items.length, [items])

  const pasoActual = PASOS.findIndex((p) => p.key === paso)

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <ShoppingBag className="h-16 w-16 mx-auto text-muted-foreground/30" />
          <h1 className="text-xl font-bold">Tu carrito está vacío</h1>
          <p className="text-sm text-muted-foreground">
            Agrega actividades desde el catálogo para continuar.
          </p>
          <Button onClick={() => router.push('/excursiones')} className="mt-4">
            Explorar Actividades
          </Button>
        </div>
      </div>
    )
  }

  const doCheckout = (metodo: 'DESTINO' | 'ONLINE_SIMULADO') => {
    startTransition(async () => {
      const payload = items.map((item) => ({
        excursionId: item.excursionId,
        varianteId: item.varianteId,
        fecha: item.fecha,
        horaSalida: item.hora,
        adultos: item.adultos,
        ninos: item.ninos,
        notas: '',
      }))

      const res = await reservarCarritoAction(payload, metodo)

      if (res.error) {
        if (res.error.includes('iniciar sesión') || res.error === 'unauthenticated') {
          toast.error('Debes iniciar sesión para confirmar las reservas.')
          router.push(`/login?redirect=${encodeURIComponent('/checkout')}`)
        } else {
          toast.error(res.error)
        }
        return
      }

      if (res.success) {
        clearCart()
        toast.success(res.success)
        if (res.redirectUrl) {
          router.push(res.redirectUrl)
        } else {
          router.push('/cliente/mis-excursiones')
        }
      }
    })
  }

  const handleConfirmar = () => {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent('/checkout')}`)
      return
    }
    if (metodoPago === 'ONLINE_SIMULADO') {
      setIsModalPagoOpen(true)
    } else {
      doCheckout('DESTINO')
    }
  }

  const handlePasoSiguiente = () => {
    if (paso === 'resumen') setPaso('pago')
    else if (paso === 'pago') setPaso('confirmar')
  }

  const handlePasoAnterior = () => {
    if (paso === 'confirmar') setPaso('pago')
    else if (paso === 'pago') setPaso('resumen')
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-4">
          <Link
            href="/excursiones"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Seguir explorando
          </Link>
          <h1 className="text-lg font-bold ml-auto">Checkout</h1>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 pb-32 lg:pb-8">
        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {PASOS.map((p, i) => (
            <div key={p.key} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition ${
                  i < pasoActual
                    ? 'bg-primary text-primary-foreground'
                    : i === pasoActual
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {i < pasoActual ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`text-xs font-medium hidden sm:block ${
                  i <= pasoActual ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {p.label}
              </span>
              {i < PASOS.length - 1 && (
                <div
                  className={`w-8 h-0.5 rounded ${
                    i < pasoActual ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Contenido del paso */}
        {paso === 'resumen' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">Tu Carrito ({totalItems} {totalItems === 1 ? 'reserva' : 'reservas'})</h2>

            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="p-4 rounded-xl border bg-card/50 shadow-sm relative group">
                  <div className="flex gap-4">
                    {item.portadaUrl ? (
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted relative">
                        <Image src={item.portadaUrl} alt={item.nombreExcursion} fill className="object-cover" />
                      </div>
                    ) : (
                      <div className="h-20 w-20 shrink-0 rounded-lg bg-muted flex items-center justify-center">
                        <CalendarDays className="h-6 w-6 opacity-30" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-sm line-clamp-1">{item.nombreExcursion}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.varianteNombre}</p>

                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" /> {item.fecha}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {item.hora}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Controles de pasajeros */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
                    <div className="flex items-center gap-4">
                      {/* Adultos */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground w-12">Adultos</span>
                        <button
                          onClick={() => updateItem(item.id, { adultos: Math.max(1, item.adultos - 1) })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border bg-muted/50 hover:bg-muted transition text-foreground"
                          disabled={item.adultos <= 1}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{item.adultos}</span>
                        <button
                          onClick={() => updateItem(item.id, { adultos: item.adultos + 1 })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border bg-muted/50 hover:bg-muted transition text-foreground"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      {/* Niños */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground w-10">Niños</span>
                        <button
                          onClick={() => updateItem(item.id, { ninos: Math.max(0, item.ninos - 1) })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border bg-muted/50 hover:bg-muted transition text-foreground"
                          disabled={item.ninos <= 0}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{item.ninos}</span>
                        <button
                          onClick={() => updateItem(item.id, { ninos: item.ninos + 1 })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border bg-muted/50 hover:bg-muted transition text-foreground"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <p className="font-semibold text-primary text-sm">
                      {formatMoney((item.adultos * item.precioAdulto) + (item.ninos * item.precioNino), { moneda: item.moneda })}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="flex justify-between items-center pt-4 border-t">
              <span className="font-medium text-muted-foreground">Total</span>
              <span className="text-2xl font-bold">{formatMoney(subtotal, { moneda })}</span>
            </div>

            <Button onClick={handlePasoSiguiente} className="w-full h-12 text-base font-semibold mt-4">
              Continuar al Pago
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {paso === 'pago' && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold">Método de Pago</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMetodoPago('DESTINO')}
                className={`flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition ${
                  metodoPago === 'DESTINO'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-muted/20 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Banknote className="h-5 w-5 text-success" />
                  Pagar en Destino
                </div>
                <p className="text-sm text-muted-foreground">
                  Pagas el día del tour en el punto de encuentro.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMetodoPago('ONLINE_SIMULADO')}
                className={`flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition ${
                  metodoPago === 'ONLINE_SIMULADO'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-muted/20 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <CreditCard className="h-5 w-5 text-primary" />
                  Pagar en Línea
                  <span className="text-xs bg-warning/15 text-warning px-1.5 py-0.5 rounded font-bold">
                    Prueba
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Tarjeta de crédito/débito. Emisión inmediata de QR.
                </p>
              </button>
            </div>

            {/* Resumen rápido */}
            <div className="rounded-xl border bg-card/50 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{totalItems} {totalItems === 1 ? 'reserva' : 'reservas'}</span>
                <span className="font-semibold">{formatMoney(subtotal, { moneda })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Método de pago</span>
                <span className="font-semibold">
                  {metodoPago === 'DESTINO' ? 'En destino' : 'En línea'}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={handlePasoAnterior} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Atrás
              </Button>
              <Button onClick={handlePasoSiguiente} className="flex-1 h-12 text-base font-semibold">
                Revisar y Confirmar
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {paso === 'confirmar' && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold">Confirmar Reserva</h2>

            {/* Resumen final */}
            <div className="rounded-xl border bg-card/50 p-4 space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between items-start text-sm">
                  <div>
                    <p className="font-medium">{item.nombreExcursion}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.fecha} • {item.hora} • {item.adultos} Ad.{item.ninos > 0 ? ` ${item.ninos} Ni.` : ''}
                    </p>
                  </div>
                  <span className="font-semibold whitespace-nowrap">
                    {formatMoney((item.adultos * item.precioAdulto) + (item.ninos * item.precioNino), { moneda: item.moneda })}
                  </span>
                </div>
              ))}
              <div className="border-t pt-3 flex justify-between items-center">
                <span className="font-semibold">Total a pagar</span>
                <span className="text-xl font-bold text-primary">{formatMoney(subtotal, { moneda })}</span>
              </div>
            </div>

            {/* Pago */}
            <div className="rounded-xl border bg-card/50 p-4">
              <p className="text-sm text-muted-foreground">Método de pago</p>
              <p className="font-semibold mt-1 flex items-center gap-2">
                {metodoPago === 'DESTINO' ? (
                  <><Banknote className="h-4 w-4 text-success" /> Pago en destino</>
                ) : (
                  <><CreditCard className="h-4 w-4 text-primary" /> Pago en línea (simulado)</>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {metodoPago === 'ONLINE_SIMULADO'
                  ? 'Se emitirá un código QR de abordaje inmediatamente.'
                  : 'Pagarás cada excursión en su punto de encuentro el día asignado.'}
              </p>
            </div>

            {/* Auth gate */}
            {!isAuthenticated && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 space-y-3">
                <p className="text-sm font-semibold text-warning">
                  Necesitas iniciar sesión para confirmar tu reserva.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Link
                    href={`/login?redirect=${encodeURIComponent('/checkout')}`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-card py-2.5 text-sm font-semibold transition hover:bg-muted"
                  >
                    <LogIn className="h-4 w-4" />
                    Iniciar sesión
                  </Link>
                  <Link
                    href={`/registro/cuenta?next=${encodeURIComponent('/checkout')}`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                  >
                    <UserPlus className="h-4 w-4" />
                    Crear cuenta
                  </Link>
                </div>
              </div>
            )}

            {isAuthenticated && (
              <div className="rounded-xl border border-success/40 bg-success/10 p-3 flex items-center gap-2 text-sm text-success">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Sesión activa — tu reserva se creará a tu nombre.
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={handlePasoAnterior} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Atrás
              </Button>
              <Button
                onClick={handleConfirmar}
                disabled={isPending}
                className="flex-1 h-12 text-base font-semibold"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Procesando...
                  </>
                ) : !isAuthenticated ? (
                  'Iniciar sesión para reservar'
                ) : metodoPago === 'ONLINE_SIMULADO' ? (
                  <span className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Pagar y Confirmar
                  </span>
                ) : (
                  'Confirmar Reservas'
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Pago Online Simulado */}
      <PasarelaSimuladaModal
        isOpen={isModalPagoOpen}
        onClose={() => setIsModalPagoOpen(false)}
        onConfirmPayment={async () => {
          setIsModalPagoOpen(false)
          doCheckout('ONLINE_SIMULADO')
        }}
        montoTotal={subtotal}
        moneda={moneda}
        tituloConcepto={`Carrito (${totalItems} ${totalItems === 1 ? 'excursión' : 'excursiones'})`}
        detallesItems={items.map((item) => ({
          nombre: item.nombreExcursion,
          cantidad: item.adultos + item.ninos,
          subtotal: item.adultos * item.precioAdulto + item.ninos * item.precioNino,
        }))}
      />
    </div>
  )
}
