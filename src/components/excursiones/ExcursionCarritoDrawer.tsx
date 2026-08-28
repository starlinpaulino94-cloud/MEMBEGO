'use client'

import { useExcursionCart } from './ExcursionCarritoContext'
import { useRouter } from 'next/navigation'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Trash2, CalendarDays, Clock, Users, ShoppingCart, ArrowRight, Minus, Plus } from 'lucide-react'
import Image from 'next/image'

export function ExcursionCarritoDrawer() {
  const { items, isOpen, closeCart, openCart, removeItem, updateItem, subtotal } = useExcursionCart()
  const router = useRouter()

  const handleCheckout = () => {
    closeCart()
    router.push('/checkout')
  }

  return (
    <>
    <Sheet open={isOpen} onOpenChange={closeCart}>
      <SheetContent className="flex flex-col w-full sm:max-w-md p-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <SheetHeader className="mb-6 text-left">
            <SheetTitle className="flex items-center gap-2 text-xl">
              <ShoppingCart className="h-5 w-5" />
              Tu Carrito de Actividades
            </SheetTitle>
            <SheetDescription>
              Tienes {items.length} {items.length === 1 ? 'reserva' : 'reservas'} pendientes.
            </SheetDescription>
          </SheetHeader>

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground space-y-3">
              <ShoppingCart className="h-10 w-10 opacity-20" />
              <p>Tu carrito está vacío.</p>
              <Button variant="outline" onClick={closeCart}>Explorar Actividades</Button>
            </div>
          ) : (
            <div className="space-y-4">
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
                        <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {item.fecha}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {item.hora}</span>
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
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t bg-card p-6 shadow-lg space-y-4">
            <div className="flex justify-between items-center pt-1 border-t">
              <span className="font-medium text-sm text-muted-foreground">Total a pagar</span>
              <span className="text-xl font-bold text-foreground">
                {formatMoney(subtotal, { moneda: items[0]?.moneda || 'DOP' })}
              </span>
            </div>
            
            <Button 
              className="w-full h-12 text-base font-semibold" 
              onClick={handleCheckout}
            >
              <span className="flex items-center gap-2">
                Proceder al Checkout
                <ArrowRight className="h-4 w-4" />
              </span>
            </Button>
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
