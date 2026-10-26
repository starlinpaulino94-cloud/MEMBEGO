import { BadgeCheck } from 'lucide-react'
import { StatusChip } from '@/components/ui/status-chip'

/**
 * LO ÚNICO que un NEGOCIO ve de la verificación de identidad de una persona: que está verificada y desde cuándo. Nada más:
 * ni la cédula, ni la selfie, ni el número de documento, ni un rechazo (una ficha sin insignia es «no consta», no «rechazada»).
 *
 * Solo se pinta si la persona permitió que los negocios lo vean (la proyección a la ficha ya viene filtrada por eso) y si la
 * empresa tiene encendida la capacidad `VERIFICACION_IDENTIDAD`. Ningún negocio puede descargar documentos de nadie: Membego
 * no los tiene (el proveedor los borra al concluir) y esta capa no los toca.
 */
export function IdentidadVerificadaBadge({ desde }: { desde: string | null }) {
  return (
    <StatusChip tone="success" title={desde ? `Identidad verificada por Membego el ${desde}` : 'Identidad verificada por Membego'}>
      <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
      Identidad verificada
    </StatusChip>
  )
}
