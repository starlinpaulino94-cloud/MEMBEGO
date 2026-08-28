'use client'

import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react'

export interface CartItem {
  id: string // Identificador único en el carrito
  excursionId: string
  companyId: string
  nombreExcursion: string
  portadaUrl: string | null
  varianteId: string
  varianteNombre: string
  fecha: string
  hora: string
  adultos: number
  ninos: number
  precioAdulto: number
  precioNino: number
  moneda: string
}

interface ExcursionCarritoContextType {
  items: CartItem[]
  isOpen: boolean
  addItem: (item: Omit<CartItem, 'id'>) => void
  removeItem: (id: string) => void
  updateItem: (id: string, updates: Partial<CartItem>) => void
  clearCart: () => void
  openCart: () => void
  closeCart: () => void
  subtotal: number
}

const ExcursionCarritoContext = createContext<ExcursionCarritoContextType | null>(null)

export function ExcursionCarritoProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    // La excepción es deliberada: `localStorage` no existe en el servidor, así que el carrito guardado solo puede leerse DESPUÉS de montar. Hacerlo en el inicializador de useState rompería la hidratación.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsClient(true)
    try {
      const saved = localStorage.getItem('mg_exc_cart')
      if (saved) {
        setItems(JSON.parse(saved))
      }
    } catch {
      // Ignorar
    }
  }, [])

  useEffect(() => {
    if (isClient) {
      localStorage.setItem('mg_exc_cart', JSON.stringify(items))
    }
  }, [items, isClient])

  const subtotal = useMemo(() => {
    return items.reduce((acc, item) => {
      return acc + (item.adultos * item.precioAdulto) + (item.ninos * item.precioNino)
    }, 0)
  }, [items])

  const addItem = (item: Omit<CartItem, 'id'>) => {
    // Misma excursión + variante + fecha → sumar pasajeros (ignorar hora)
    const idx = items.findIndex(
      i => i.excursionId === item.excursionId && 
           i.varianteId === item.varianteId && 
           i.fecha === item.fecha
    )

    if (idx >= 0) {
      const newItems = [...items]
      newItems[idx].adultos += item.adultos
      newItems[idx].ninos += item.ninos
      setItems(newItems)
    } else {
      const id = Math.random().toString(36).substring(2, 9)
      setItems([...items, { ...item, id }])
    }
    setIsOpen(true)
  }

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id))
  
  const updateItem = (id: string, updates: Partial<CartItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
  }

  const clearCart = () => setItems([])
  const openCart = () => setIsOpen(true)
  const closeCart = () => setIsOpen(false)

  return (
    <ExcursionCarritoContext.Provider value={{
      items, isOpen, addItem, removeItem, updateItem, clearCart, openCart, closeCart, subtotal
    }}>
      {children}
    </ExcursionCarritoContext.Provider>
  )
}

export function useExcursionCart() {
  const ctx = useContext(ExcursionCarritoContext)
  if (!ctx) throw new Error('useExcursionCart must be used within ExcursionCarritoProvider')
  return ctx
}
