'use client'

import { useExcursionCart } from './ExcursionCarritoContext'
import { useRouter } from 'next/navigation'
import { useTransition, useState } from 'react'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { X, Trash2, CalendarDays, Clock, Users, Loader2, ShoppingCart } from 'lucide-react'
import { reservarCarritoAction } from '@/modules/excursiones/reservas/cliente-actions'
import { toast } from 'sonner'
import Image from 'next/image'

export function ExcursionCarritoDrawer() {
  const { items, isOpen, closeCart, openCart, removeItem, subtotal, clearCart } = useExcursionCart()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  
  if (items.length === 0 && isOpen) {
    // Si se queda vacío estando abierto, mejor cerrarlo (opcional, pero limpio)
    // closeCart()
  }

  const handleCheckout = () => {
    startTransition(async () => {
      const payload = items.map(item => ({
        excursionId: item.excursionId,
        varianteId: item.varianteId,
        fecha: item.fecha,
        horaSalida: item.hora,
        adultos: item.adultos,
        ninos: item.ninos,
        notas: '',
      }))

      // Llama a la acción que reserva en lote
      const res = await reservarCarritoAction({ items: payload })
      
      if (res.error) {
        if (res.error === 'unauthenticated') {
          // Guardar intent y redirigir
          toast.error('Debes iniciar sesión para confirmar las reservas.')
          const currentUrl = window.location.pathname + window.location.search
          router.push(`/login?next=${encodeURIComponent(currentUrl)}`)
        } else {
          toast.error(res.error)
        }
        return
      }

      if (res.success) {
        clearCart()
        closeCart()
        toast.success(res.success)
        if (res.redirectUrl) {
          router.push(res.redirectUrl)
        } else {
          router.push('/cliente/mis-excursiones')
        }
      }
    })
  }

  return (
    <>
    <Sheet open={isOpen} onOpenChange={closeCart}>
      <SheetContent className="flex flex-col w-full sm:max-w-md p-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <SheetHeader className="mb-6 text-left">
            <SheetTitle className="flex items-center gap-2 text-xl">
              <ShoppingCart className="h-5 w-5" />
              Tu Carrito de Excursiones
            </SheetTitle>
            <SheetDescription>
              Tienes {items.length} {items.length === 1 ? 'reserva' : 'reservas'} pendientes.
            </SheetDescription>
          </SheetHeader>

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground space-y-3">
              <ShoppingCart className="h-10 w-10 opacity-20" />
              <p>Tu carrito está vacío.</p>
              <Button variant="outline" onClick={closeCart}>Explorar Excursiones</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex gap-4 p-4 rounded-xl border bg-card/50 shadow-sm relative group">
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
                      <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {item.fecha}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {item.hora}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>{item.adultos} Ad. {item.ninos > 0 ? `• ${item.ninos} Ni.` : ''}</span>
                    </div>
                    
                    <p className="font-semibold text-primary mt-2">
                      {formatMoney((item.adultos * item.precioAdulto) + (item.ninos * item.precioNino), { moneda: item.moneda })}
                    </p>
                  </div>
                  
                  <button 
                    onClick={() => removeItem(item.id)}
                    className="absolute top-2 right-2 p-1.5 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t bg-card p-6 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
            <div className="flex justify-between items-center mb-4">
              <span className="font-medium text-muted-foreground">Total (impuestos incl.)</span>
              <span className="text-xl font-bold text-foreground">
                {formatMoney(subtotal, { moneda: items[0]?.moneda || 'DOP' })}
              </span>
            </div>
            
            <Button 
              className="w-full h-12 text-base font-semibold" 
              onClick={handleCheckout}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Procesando...
                </>
              ) : (
                'Confirmar Reservas'
              )}
            </Button>
            <p className="text-xs text-center text-muted-foreground mt-3">
              Recibirás confirmación inmediata de todas tus reservas.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
    
    {/* Floating Cart Button */}
    {items.length > 0 && !isOpen && (
      <button 
        onClick={openCart}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform"
        aria-label="Abrir carrito"
      >
        <ShoppingCart className="h-6 w-6" />
        <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground shadow-sm">
          {items.length}
        </span>
      </button>
    )}
    </>
  )
}
