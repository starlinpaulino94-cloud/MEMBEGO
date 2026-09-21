// Fuente ÚNICA de verdad de estados de MembeGo (label + color por estado).
// Ver docs/GUIA_LENGUAJE_MEMBEGO.md. Regla de color:
//   success=activo/listo · info=en proceso · warning=requiere acción ·
//   secondary/outline=terminado/neutro · destructive=SOLO error/rechazo.
// Para compras/beneficios (CompraEstado) la fuente es
// `components/cliente/compra-estado.ts` (ya centralizada).

import type { MembershipEstado } from '@/types'

/** Variantes válidas del componente Badge. */
export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info'

export interface EstadoUi {
  label: string
  variant: BadgeVariant
}

// ── Membresías (MembershipEstado) ───────────────────────────────────────────
// "Activa" (nunca "Activo"/"Activas"); "En validación" para pago en revisión;
// "Vencida" en gris (no es error); "Rechazada" en rojo (sí es rechazo).
export interface MembresiaEstadoUi extends EstadoUi {
  /** Texto más corto/informal para tarjetas del cliente (vs. `label` de admin). */
  labelCliente: string
}

export const MEMBRESIA_ESTADO: Record<MembershipEstado, MembresiaEstadoUi> = {
  PENDIENTE: { label: 'Pendiente de pago', labelCliente: 'Pendiente', variant: 'warning' },
  PENDIENTE_PAGO: { label: 'En validación', labelCliente: 'Esperando pago', variant: 'info' },
  ACTIVA: { label: 'Activa', labelCliente: 'Activa', variant: 'success' },
  VENCIDA: { label: 'Vencida', labelCliente: 'Vencida', variant: 'secondary' },
  RECHAZADA: { label: 'Rechazada', labelCliente: 'Rechazada', variant: 'destructive' },
  /**
   * «Cancelada» es lenguaje de administración: dice que ALGUIEN la canceló, y
   * al cliente eso solo le plantea una pregunta que la pantalla no le responde
   * —¿quién?, ¿por qué?—. Lo que necesita saber es que se acabó y que puede
   * volver a adquirirla, y eso es lo que le ofrece la pantalla debajo.
   *
   * El panel sigue diciendo «Cancelada», que es lo correcto ahí: para el
   * equipo la diferencia entre vencer y cancelar es exactamente lo que hay que
   * ver, y el historial ya dice quién la canceló y cuándo.
   */
  CANCELADA: { label: 'Cancelada', labelCliente: 'Finalizada', variant: 'secondary' },
}

export function membresiaEstadoUi(estado: string): MembresiaEstadoUi {
  return (
    MEMBRESIA_ESTADO[estado as MembershipEstado] ?? {
      label: estado,
      labelCliente: estado,
      variant: 'secondary',
    }
  )
}

// ── Campañas (CampanaInvitacion / MarketingCampaign) ────────────────────────
// "Activa" en VERDE (no azul); "Finalizada" en GRIS (no rojo: es fin normal).
export const CAMPANA_ESTADO: Record<string, EstadoUi> = {
  BORRADOR: { label: 'Borrador', variant: 'outline' },
  ACTIVA: { label: 'Activa', variant: 'success' },
  PAUSADA: { label: 'Pausada', variant: 'warning' },
  FINALIZADA: { label: 'Finalizada', variant: 'secondary' },
}

export function campanaEstadoUi(estado: string): EstadoUi {
  return CAMPANA_ESTADO[estado] ?? { label: estado, variant: 'secondary' }
}

// ── Referidos (ReferidoEstado) ──────────────────────────────────────────────
// PENDIENTE/COMPLETADO son los ÚNICOS estados. "Sospechoso" es una MARCA
// (boolean) aparte, no un estado (ver REFERIDO_MARCA_SOSPECHOSO).
export interface ReferidoEstadoUi extends EstadoUi {
  /** Texto más humano para el cliente (vs. el término de admin en `label`). */
  labelCliente: string
}

export const REFERIDO_ESTADO: Record<string, ReferidoEstadoUi> = {
  PENDIENTE: { label: 'Pendiente', labelCliente: 'Invitación enviada', variant: 'warning' },
  COMPLETADO: { label: 'Convertido', labelCliente: 'Ya se registró', variant: 'success' },
}

export function referidoEstadoUi(estado: string): ReferidoEstadoUi {
  return (
    REFERIDO_ESTADO[estado] ?? {
      label: estado,
      labelCliente: estado,
      variant: 'secondary',
    }
  )
}

/** Marca (no estado) para un referido bajo sospecha de fraude. */
export const REFERIDO_MARCA_SOSPECHOSO: EstadoUi = {
  label: 'Sospechoso',
  variant: 'warning',
}
