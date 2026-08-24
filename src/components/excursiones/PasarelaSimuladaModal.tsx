'use client'

import { useState } from 'react'
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
  detallesItems,
}: PasarelaSimuladaModalProps) {
  const [procesando, setProcesando] = useState(false)
  const [pagado, setPagado] = useState(false)
  const numeroTarjeta = '4242 •••• •••• 4242'
  const titular = 'CLIENTE MEMBEGO'
  const expiracion = '12/28'

  if (!isOpen) return null

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-card border shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header con badge de simulación */}
        <div className="bg-gradient-to-r from-primary/15 via-primary/5 to-transparent p-5 border-b flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-base font-bold text-foreground">Pasarela de Pago</h3>
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  Modo Sandbox
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Pago seguro simulado (Entorno Develop)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={procesando}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-5">
          {/* Tarjeta Visual */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-950 p-5 text-white shadow-md border border-zinc-700/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-zinc-400">MEMBEGO PAY</span>
              <div className="flex items-center gap-1 text-[10px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded-full border border-zinc-700">
                <Sparkles className="h-3 w-3 text-amber-400" />
                Tarjeta de Prueba
              </div>
            </div>

            <div className="my-4 font-mono text-lg font-medium tracking-widest text-zinc-100">
              {numeroTarjeta}
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-400">
              <div>
                <span className="block text-[9px] uppercase tracking-wider text-zinc-500">Titular</span>
                <span className="font-medium text-zinc-200">{titular}</span>
              </div>
              <div className="text-right">
                <span className="block text-[9px] uppercase tracking-wider text-zinc-500">Vence</span>
                <span className="font-medium text-zinc-200">{expiracion}</span>
              </div>
            </div>
          </div>

          {/* Resumen del cobro */}
          <div className="rounded-xl border bg-muted/40 p-4 space-y-2">
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
              <span className="text-lg font-extrabold text-primary">
                {formatMoney(montoTotal, { moneda })}
              </span>
            </div>
          </div>

          {/* Advertencia Sandbox */}
          <div className="flex items-start gap-2.5 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
            <p>
              Esta es una <strong>transacción de prueba</strong>. No se realizará ningún cargo real en tu tarjeta. Al confirmar, tu reserva quedará marcada automáticamente como <strong>PAGADA</strong> con su código QR de embarque.
            </p>
          </div>
        </div>

        {/* Footer / Botones */}
        <div className="bg-muted/30 p-5 border-t flex flex-col gap-2">
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
              <span className="flex items-center gap-2 text-emerald-100">
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

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground mt-1">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Encriptación SSL de 256 bits • Sandbox Integrado</span>
          </div>
        </div>
      </div>
    </div>
  )
}
