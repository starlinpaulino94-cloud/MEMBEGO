// Fuente ÚNICA de verdad de estados de MembeGo (label + color por estado).
// Ver docs/GUIA_LENGUAJE_MEMBEGO.md. Regla de color:
//   success=activo/listo · info=en proceso · warning=requiere acción ·
//   secondary/outline=terminado/neutro · destructive=SOLO error/rechazo.
// Para compras/beneficios (CompraEstado) la fuente es
// `components/cliente/compra-estado.ts` (ya centralizada).

import type { MembershipEstado } from '@/types'
import type { TonoEstado } from '@/components/ui/estado-chip'

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

// ── Fase 4 · el contrato único «estado de dominio → etiqueta y tono» ────────────────────────────────────────────────
// docs/auditoria-admin/07 · FE-03: hay 54 mapas «estado → clases de color» repartidos y este archivo solo cubría tres
// dominios. `estadoUi` es el punto de entrada de TODOS: devuelve lo que el `EstadoChip` necesita (etiqueta y tono). Los mapas
// de arriba siguen siendo su fuente y se conservan tal cual para los 13 sitios que ya los usan; cada dominio nuevo se añade
// AQUÍ, no en la pantalla.

/** Los dominios con contrato de estado. Se amplía con cada módulo que migra (fases 5 a 7). */
export type DominioEstado = 'membresia' | 'campana' | 'referido'

export interface EstadoChipUi {
  label: string
  tono: TonoEstado
}

/** El `variant` de `Badge` de los mapas de arriba, traducido al tono del `EstadoChip`. */
const TONO_DE_VARIANTE: Record<BadgeVariant, TonoEstado> = {
  default: 'info',
  success: 'exito',
  warning: 'aviso',
  info: 'info',
  destructive: 'peligro',
  secondary: 'neutro',
  outline: 'neutro',
}

/**
 * Etiqueta y tono de un estado, para el `EstadoChip`. Un estado que el dominio no conoce (un valor nuevo en la base antes
 * de que alguien lo agregue aquí) se muestra con su propio texto y tono neutro: nunca en blanco y nunca con un color que
 * prometa algo.
 *
 *   const { label, tono } = estadoUi('membresia', m.estado)
 *   <EstadoChip tono={tono}>{label}</EstadoChip>
 *
 * `cliente: true` usa el texto pensado para el cliente final donde el dominio lo distingue (membresía, referido).
 */
export function estadoUi(dominio: DominioEstado, estado: string, opciones: { cliente?: boolean } = {}): EstadoChipUi {
  switch (dominio) {
    case 'membresia': {
      const e = membresiaEstadoUi(estado)
      return { label: opciones.cliente ? e.labelCliente : e.label, tono: TONO_DE_VARIANTE[e.variant] }
    }
    case 'campana': {
      const e = campanaEstadoUi(estado)
      return { label: e.label, tono: TONO_DE_VARIANTE[e.variant] }
    }
    case 'referido': {
      const e = referidoEstadoUi(estado)
      return { label: opciones.cliente ? e.labelCliente : e.label, tono: TONO_DE_VARIANTE[e.variant] }
    }
  }
}
