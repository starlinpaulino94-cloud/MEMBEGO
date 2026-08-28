'use client'

import { useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  CreditCard,
  Lock,
  CheckCircle2,
  Loader2,
  X,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/button'

interface PasarelaSimuladaModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirmPayment: () => Promise<void> | void
  montoTotal: number
  moneda: string
  tituloConcepto: string
  esEmpresaDemo?: boolean
  detallesItems?: Array<{
    nombre: string
    cantidad: number
    subtotal: number
  }>
}

export function PasarelaSimuladaModal({
  isOpen,
  onClose,
  onConfirmPayment,
  montoTotal,
  moneda,
  tituloConcepto,
  esEmpresaDemo,
  detallesItems,
}: PasarelaSimuladaModalProps) {
  /**
   * ¿Estamos ya en el navegador?
   *
   * Antes era `useState(false)` más un efecto que lo ponía a `true` al montar:
   * un render entero desperdiciado, y un `setState` síncrono dentro de un
   * efecto —que es justo lo que dispara renders en cascada—. `useSyncExternal-
   * Store` responde lo mismo sin efecto y sin render de más: en el servidor
   * devuelve `false`, en el cliente `true`, y la hidratación no se rompe.
   */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const [procesando, setProcesando] = useState(false)
  const [pagado, setPagado] = useState(false)
  const numeroTarjeta = '4242 •••• •••• 4242'
  const titular = 'CLIENTE MEMBEGO'
  const expiracion = '12/28'

  if (!mounted || !isOpen) return null

  const handleSimularPago = async () => {
    setProcesando(true)
    // Simular 1.2 segundos de latencia de red bancaria
    await new Promise((r) => setTimeout(r, 1200))
    setPagado(true)
    await new Promise((r) => setTimeout(r, 600))
    await onConfirmPayment()
    setProcesando(false)
    setPagado(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-base">
      <div className="relative w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden rounded-2xl bg-card border border-border shadow-2xl animate-in zoom-in-95 duration-base">
        {/* Header con badge de simulación */}
        <div className="bg-gradient-to-r from-primary/15 via-primary/5 to-transparent p-5 border-b border-border/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-base font-bold text-foreground">Pasarela de Pago</h3>
                <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning border border-warning/20">
                  {esEmpresaDemo ? 'Empresa de Prueba' : 'Modo Sandbox'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {esEmpresaDemo
                  ? 'Entorno de práctica y demostración'
                  : 'Pago seguro simulado (Entorno Sandbox)'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={procesando}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-50"
            aria-label="Cerrar modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Contenido con scroll independiente si es necesario */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Tarjeta Visual */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-card via-muted to-background p-5 text-white shadow-md border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-muted-foreground">MEMBEGO PAY</span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/80 px-2 py-0.5 rounded-full border border-border">
                <Sparkles className="h-3 w-3 text-warning" />
                Tarjeta de Prueba
              </div>
            </div>

            <div className="my-4 font-mono text-lg font-medium tracking-widest text-foreground">
              {numeroTarjeta}
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div>
                <span className="block text-xs uppercase tracking-wider text-muted-foreground">Titular</span>
                <span className="font-medium text-foreground">{titular}</span>
              </div>
              <div className="text-right">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground">Vence</span>
                <span className="font-medium text-foreground">{expiracion}</span>
              </div>
            </div>
          </div>

          {/* Resumen del cobro */}
          <div className="rounded-xl border border-border/80 bg-muted/40 p-4 space-y-2">
            <div className="flex justify-between items-center text-sm font-medium text-muted-foreground">
              <span>Concepto</span>
              <span className="text-foreground font-semibold text-right truncate max-w-[200px]">
                {tituloConcepto}
              </span>
            </div>

            {detallesItems && detallesItems.length > 0 && (
              <div className="border-t border-border/60 pt-2 space-y-1 text-xs text-muted-foreground">
                {detallesItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="truncate max-w-[220px]">
                      {item.cantidad}x {item.nombre}
                    </span>
                    <span>{formatMoney(item.subtotal, { moneda })}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-2 flex justify-between items-center">
              <span className="text-sm font-bold text-foreground">Total a Cobrar</span>
              <span className="text-lg font-extrabold text-primary font-mono">
                {formatMoney(montoTotal, { moneda })}
              </span>
            </div>
          </div>

          {/* Advertencia Sandbox */}
          <div className="flex items-start gap-2.5 rounded-lg bg-warning/10 p-3 text-xs text-warning border border-warning/20">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
            <p>
              Esta es una <strong>transacción simulada de prueba</strong>. No se realizará ningún cargo real en tu tarjeta. Al confirmar, tu reserva quedará marcada automáticamente como <strong>PAGADA</strong> con su código QR de embarque emitido.
            </p>
          </div>
        </div>

        {/* Footer / Botones */}
        <div className="bg-muted/30 p-5 border-t border-border/80 flex flex-col gap-2 shrink-0">
          <Button
            onClick={handleSimularPago}
            disabled={procesando || pagado}
            className="w-full h-12 text-base font-semibold shadow-md bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {procesando ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Contactando pasarela bancaria...
              </span>
            ) : pagado ? (
              <span className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-5 w-5" />
                ¡Pago Simulado Exitoso!
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Lock className="h-4 w-4" />
                Pagar {formatMoney(montoTotal, { moneda })}
              </span>
            )}
          </Button>

          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-1">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            <span>Encriptación SSL de 256 bits • Sandbox Integrado</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
