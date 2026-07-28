/**
 * Presentación unificada de los estados de una compra/beneficio digital
 * (compartida cliente/admin/escáner).
 *
 * Fase E5 definió los estados base del ciclo (CompraEstado en Prisma).
 * Fase E8 añade la capa visual completa que pide el producto — etiqueta,
 * color e ícono — y dos estados DERIVADOS de presentación que no son valores
 * nuevos en la base sino lecturas del mismo dato:
 *   · "Parcialmente utilizada": ACTIVA con parte de los usos ya consumidos.
 *   · "Suspendida": beneficio de una empresa suspendida (bandera externa).
 * Así la UI puede crecer (cupones, gift cards, bonos, eventos) sin tocar el
 * enum ni el motor de estados.
 */

import {
  Ban,
  CalendarX,
  CheckCircle2,
  CreditCard,
  FileClock,
  Hourglass,
  PauseCircle,
  PieChart,
  ShieldCheck,
  Sparkles,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

export type CompraBadgeTone =
  | 'success'
  | 'warning'
  | 'destructive'
  | 'secondary'
  | 'info'

export interface CompraEstadoVisual {
  /** Clave estable de presentación (incluye los derivados PARCIAL/SUSPENDIDA). */
  key: string
  label: string
  badge: CompraBadgeTone
  icon: LucideIcon
  /** Clase de color para un punto/acento de estado en tarjetas. */
  dot: string
  /** Descripción corta para tooltips o subtítulos. */
  hint: string
}

// Estados base del enum CompraEstado (Prisma).
const BASE: Record<string, CompraEstadoVisual> = {
  SOLICITADA: {
    key: 'SOLICITADA',
    label: 'Solicitada',
    badge: 'secondary',
    icon: Sparkles,
    dot: 'bg-muted-foreground',
    hint: 'Solicitada; lista para completar la adquisición.',
  },
  PENDIENTE_PAGO: {
    key: 'PENDIENTE_PAGO',
    label: 'Pendiente de pago',
    badge: 'warning',
    icon: CreditCard,
    dot: 'bg-warning',
    hint: 'Falta completar el pago para activarla.',
  },
  EN_VALIDACION: {
    key: 'EN_VALIDACION',
    label: 'En validación',
    badge: 'info',
    icon: Hourglass,
    dot: 'bg-info',
    hint: 'El comprobante está en revisión por la empresa.',
  },
  APROBADA: {
    key: 'APROBADA',
    label: 'Aprobada',
    badge: 'info',
    icon: ShieldCheck,
    dot: 'bg-info',
    hint: 'Pago aprobado; a punto de activarse.',
  },
  ACTIVA: {
    key: 'ACTIVA',
    label: 'Activa',
    badge: 'success',
    icon: CheckCircle2,
    dot: 'bg-success',
    hint: 'Lista para canjear con tu QR.',
  },
  RECHAZADA: {
    key: 'RECHAZADA',
    label: 'Rechazada',
    badge: 'destructive',
    icon: XCircle,
    dot: 'bg-destructive',
    hint: 'El comprobante fue rechazado; puedes reintentar.',
  },
  CONSUMIDA: {
    key: 'CONSUMIDA',
    label: 'Usada',
    badge: 'secondary',
    icon: CheckCircle2,
    dot: 'bg-muted-foreground',
    hint: 'Ya usaste todos los canjes de este beneficio.',
  },
  EXPIRADA: {
    key: 'EXPIRADA',
    label: 'Vencida',
    badge: 'secondary',
    icon: CalendarX,
    dot: 'bg-muted-foreground',
    hint: 'La vigencia terminó sin usarse por completo.',
  },
  CANCELADA: {
    key: 'CANCELADA',
    label: 'Cancelada',
    badge: 'secondary',
    icon: Ban,
    dot: 'bg-muted-foreground',
    hint: 'La compra fue cancelada.',
  },
}

// Estados derivados de presentación (no son valores del enum).
const PARCIAL: CompraEstadoVisual = {
  key: 'PARCIAL',
  label: 'Parcialmente usada',
  badge: 'info',
  icon: PieChart,
  dot: 'bg-info',
  hint: 'Activa, con parte de los usos ya canjeados.',
}

const SUSPENDIDA: CompraEstadoVisual = {
  key: 'SUSPENDIDA',
  label: 'Suspendida',
  badge: 'warning',
  icon: PauseCircle,
  dot: 'bg-warning',
  hint: 'Suspendida temporalmente por la empresa.',
}

const PENDIENTE_HIST: CompraEstadoVisual = {
  key: 'HISTORIAL',
  label: 'Historial',
  badge: 'secondary',
  icon: FileClock,
  dot: 'bg-muted-foreground',
  hint: 'Registro histórico.',
}

function fallback(estado: string): CompraEstadoVisual {
  return {
    key: estado,
    label: estado,
    badge: 'secondary',
    icon: PENDIENTE_HIST.icon,
    dot: 'bg-muted-foreground',
    hint: '',
  }
}

export interface CompraEstadoContext {
  usosRestantes?: number
  usosTotales?: number
  /** Beneficio de una empresa suspendida (bandera resuelta por el llamador). */
  suspendida?: boolean
}

/**
 * Resuelve la presentación completa (label/color/ícono) de un estado de compra,
 * aplicando los derivados de presentación cuando corresponde:
 *   suspendida → Suspendida · ACTIVA con usos consumidos → Parcialmente utilizada.
 */
export function compraEstadoVisual(
  estado: string,
  ctx: CompraEstadoContext = {}
): CompraEstadoVisual {
  if (ctx.suspendida) return SUSPENDIDA

  if (estado === 'ACTIVA') {
    const total = ctx.usosTotales ?? 0
    const rest = ctx.usosRestantes ?? total
    if (total > 0 && rest > 0 && rest < total) return PARCIAL
  }

  return BASE[estado] ?? fallback(estado)
}

/**
 * Compat Fase E5: forma reducida { label, badge }. Mantiene a los llamadores
 * previos funcionando; internamente usa la capa visual nueva.
 */
export const COMPRA_ESTADO_UI: Record<
  string,
  { label: string; badge: CompraBadgeTone }
> = Object.fromEntries(
  Object.entries(BASE).map(([k, v]) => [k, { label: v.label, badge: v.badge }])
)

export function compraEstadoUi(estado: string) {
  const v = BASE[estado] ?? fallback(estado)
  return { label: v.label, badge: v.badge }
}
