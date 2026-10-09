'use client'

import { ReactNode } from 'react'
import { ExcursionCarritoProvider } from './ExcursionCarritoContext'

/**
 * El carrito de excursiones de la APP: solo el proveedor. Ya no hay cajón lateral: hay UN carrito visible
 * (`/cliente/carrito`, con productos y excursiones) y al agregar se avisa con un enlace a él.
 */
export function ExcursionCarritoWrapper({ children }: { children: ReactNode }) {
  return <ExcursionCarritoProvider>{children}</ExcursionCarritoProvider>
}
