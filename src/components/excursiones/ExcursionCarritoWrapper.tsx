'use client'

import { ReactNode } from 'react'
import { ExcursionCarritoProvider } from './ExcursionCarritoContext'
import { ExcursionCarritoDrawer } from './ExcursionCarritoDrawer'

export function ExcursionCarritoWrapper({ children }: { children: ReactNode }) {
  return (
    <ExcursionCarritoProvider>
      {children}
      <ExcursionCarritoDrawer />
    </ExcursionCarritoProvider>
  )
}
