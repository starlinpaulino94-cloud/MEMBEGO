import { cardnetDirectoRetirado } from '@/lib/payments/cardnet-retirado'

// No leer el cuerpo: esta ruta retirada no admite PAN, CVV ni datos de 3DS.
export function POST() {
  return cardnetDirectoRetirado()
}
