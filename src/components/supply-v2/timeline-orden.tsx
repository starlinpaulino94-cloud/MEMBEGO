import type { SupplyV2PurchaseOrderStatus } from '@prisma/client'
import { formatDateTime } from '@/lib/format'

export interface EventoOrden {
  type: string
  reason: string | null
  createdAt: Date
  actor: { name: string | null; email: string } | null
}

/**
 * MEMBEGO SUPPLY · TIMELINE de la orden (§34), derivado de datos reales:
 * el estado actual, los eventos y las cantidades recibidas. Nada escrito a
 * mano.
 */
export function TimelineOrden({
  estado,
  eventos,
  compradas,
  recibidas,
}: {
  estado: SupplyV2PurchaseOrderStatus
  eventos: EventoOrden[]
  compradas: number
  recibidas: number
}) {
  const quien = (e?: EventoOrden) => (e?.actor ? ` por ${e.actor.name ?? e.actor.email}` : '')
  const cuando = (e?: EventoOrden) => (e ? ` · ${formatDateTime(e.createdAt)}` : '')
  const ultimo = (tipo: string) => [...eventos].reverse().find((e) => e.type === tipo)
  const creada = ultimo('CREATED')
  const aprobada = ultimo('APPROVED')
  const rechazada = ultimo('REJECTED')
  const cancelada = ultimo('CANCELLED')
  const recepciones = eventos.filter((e) => e.type === 'RECEIPT_CONFIRMED' || e.type === 'RECEIVED')

  type Paso = { etiqueta: string; estado: 'hecho' | 'actual' | 'pendiente' | 'fallido' }
  const pasos: Paso[] = []
  pasos.push({ etiqueta: `Orden creada${quien(creada)}${cuando(creada)}`, estado: 'hecho' })

  if (estado === 'CANCELLED') {
    pasos.push({ etiqueta: `Cancelada${quien(cancelada)}${cuando(cancelada)}${cancelada?.reason ? ` · ${cancelada.reason}` : ''}`, estado: 'fallido' })
  } else {
    if (estado === 'DRAFT') {
      pasos.push({
        etiqueta: rechazada ? `Rechazada${quien(rechazada)}${cuando(rechazada)} · ${rechazada.reason ?? ''}` : 'Pendiente de enviar a aprobación',
        estado: rechazada ? 'fallido' : 'actual',
      })
      pasos.push({ etiqueta: 'Aprobada', estado: 'pendiente' })
    } else if (estado === 'PENDING_APPROVAL') {
      pasos.push({ etiqueta: 'Pendiente de aprobación', estado: 'actual' })
      pasos.push({ etiqueta: 'Aprobada', estado: 'pendiente' })
    } else {
      // `reason` solo viene cuando se aprobó sin segunda persona: el recorrido lo dice, igual que en un rechazo.
      pasos.push({ etiqueta: `Aprobada${quien(aprobada)}${cuando(aprobada)}${aprobada?.reason ? ` · ${aprobada.reason}` : ''}`, estado: 'hecho' })
    }

    const aprobadaYa = !['DRAFT', 'PENDING_APPROVAL'].includes(estado)
    if (estado === 'RECEIVED' || estado === 'CLOSED') {
      pasos.push({ etiqueta: `${recibidas.toLocaleString('es-DO')} / ${compradas.toLocaleString('es-DO')} recibidas en ${recepciones.length} ${recepciones.length === 1 ? 'recepción' : 'recepciones'}`, estado: 'hecho' })
      pasos.push({ etiqueta: 'Orden completada · supply disponible', estado: 'hecho' })
    } else if (aprobadaYa && recibidas > 0) {
      pasos.push({ etiqueta: `${recibidas.toLocaleString('es-DO')} / ${compradas.toLocaleString('es-DO')} recibidas`, estado: 'actual' })
      pasos.push({ etiqueta: 'Orden completada', estado: 'pendiente' })
    } else {
      pasos.push({ etiqueta: 'Recepción', estado: aprobadaYa ? 'actual' : 'pendiente' })
      pasos.push({ etiqueta: 'Supply disponible', estado: 'pendiente' })
    }
  }

  const ICONO: Record<Paso['estado'], string> = { hecho: '✓', actual: '●', pendiente: '○', fallido: '✕' }
  const COLOR: Record<Paso['estado'], string> = {
    hecho: 'text-success',
    actual: 'text-primary',
    pendiente: 'text-muted-foreground',
    fallido: 'text-destructive',
  }

  return (
    <ol className="space-y-2 text-sm" aria-label="Recorrido de la orden" data-testid="timeline-orden">
      {pasos.map((p, i) => (
        <li key={i} className={`flex gap-2 ${COLOR[p.estado]}`}>
          <span aria-hidden className="w-4 shrink-0 text-center">{ICONO[p.estado]}</span>
          <span className={p.estado === 'pendiente' ? '' : 'text-foreground'}>{p.etiqueta}</span>
        </li>
      ))}
    </ol>
  )
}
