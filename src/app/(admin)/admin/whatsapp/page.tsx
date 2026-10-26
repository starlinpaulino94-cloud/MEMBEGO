import { redirect } from 'next/navigation'
import { registrarAccesoLegado } from '@/modules/navegacion/legado'

// El módulo de WhatsApp fue reemplazado por "Comunicación y Soporte". Se registra cada acceso: es lo que dirá si se puede retirar
// (fase 6 · 6.4).
export default function WhatsAppRedirect() {
  registrarAccesoLegado('/admin/whatsapp')
  redirect('/admin/comunicacion')
}
