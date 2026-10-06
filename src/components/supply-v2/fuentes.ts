import { Inter, JetBrains_Mono } from 'next/font/google'

/**
 * Tipografías del rediseño de Supply 2.0 (Stitch): Inter para la interfaz y
 * JetBrains Mono para códigos (órdenes, lotes, SKU). Se cargan solo donde se
 * aplica `claseFuentesSupplyV2`, no en toda la aplicación.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-sv2-inter', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-sv2-jetbrains', display: 'swap' })

export const claseFuentesSupplyV2 = `${inter.variable} ${jetbrains.variable} font-sv2`
