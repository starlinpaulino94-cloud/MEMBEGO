import type { SupplyLoteEstado, SupplyOrigenDerecho } from '@prisma/client'

/**
 * MEMBEGO SUPPLY · ELEGIBILIDAD (Fase 57).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PROTEGER EL SUPPLY ANTES DE COMPROMETERLO
 *
 * La regla del prompt es explícita: no se permite «reclamar» y verificar
 * después. Cuando una persona pulsa «Obtener mi pizza», la comprobación entera
 * ocurre ANTES de mover una sola unidad del lote, y dentro de la misma
 * transacción que la mueve.
 *
 * Verificar después tiene un costo concreto: una campaña de 200 unidades con
 * el límite «una por persona» comprobado a posteriori reparte 260 vouchers y
 * deja a Membego eligiendo a quién decepcionar.
 *
 * PURO: recibe los hechos ya leídos y dice sí o no, con motivo. Quien lee la
 * base es `derechos.ts`, que llama a esto con la transacción abierta.
 */

export const MOTIVOS_RECHAZO = [
  'LOTE_NO_ACTIVO',
  'LOTE_VENCIDO',
  'LOTE_NO_INICIADO',
  'SIN_UNIDADES',
  'CAMPANA_SIN_CUPO',
  'CAMPANA_INACTIVA',
  'LIMITE_POR_CLIENTE',
  'YA_TIENE_ACTIVO',
  'SUCURSAL_NO_CUBIERTA',
  'CLIENTE_NO_ELEGIBLE',
  'MEMBRESIA_REQUERIDA',
  'FUERA_DE_VENTANA',
] as const
export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[number]

export const MOTIVO_RECHAZO_LABELS: Record<MotivoRechazo, string> = {
  LOTE_NO_ACTIVO: 'Este beneficio ya no está disponible.',
  LOTE_VENCIDO: 'Este beneficio venció.',
  LOTE_NO_INICIADO: 'Este beneficio todavía no ha comenzado.',
  SIN_UNIDADES: 'Se agotaron las unidades disponibles.',
  CAMPANA_SIN_CUPO: 'La campaña ya repartió todas sus unidades.',
  CAMPANA_INACTIVA: 'La campaña ya no está activa.',
  LIMITE_POR_CLIENTE: 'Ya alcanzaste el máximo de este beneficio.',
  YA_TIENE_ACTIVO: 'Ya tienes este beneficio disponible para usar.',
  SUCURSAL_NO_CUBIERTA: 'Este beneficio no aplica en la sucursal elegida.',
  CLIENTE_NO_ELEGIBLE: 'No cumples las condiciones de esta campaña.',
  MEMBRESIA_REQUERIDA: 'Este beneficio es para miembros.',
  FUERA_DE_VENTANA: 'Este beneficio no se puede reclamar en este momento.',
}

/** Hechos del lote, ya leídos de la base. */
export interface HechosLote {
  estado: SupplyLoteEstado
  inicioAt: Date
  venceAt: Date
  disponibles: number
  asignadas: number
  snapshotSucursalIds: readonly string[]
}

/** Hechos de la campaña/asignación desde la que se emite, si la hay. */
export interface HechosAsignacion {
  activa: boolean
  porEmitir: number
}

/** Hechos del cliente frente a ESTE lote y ESTA campaña. */
export interface HechosCliente {
  /** Derechos que esta persona ya tiene de este lote, en cualquier estado. */
  derechosDelLote: number
  /** Derechos ACTIVOS o RETENIDOS de este lote (los que puede usar hoy). */
  derechosVivosDelLote: number
  /** Derechos que ya obtuvo desde esta misma campaña. */
  derechosDeLaCampana: number
  /** ¿Tiene membresía vigente? Solo se mira si la campaña la exige. */
  tieneMembresia: boolean
}

export interface ReglasEmision {
  /** Máximo de unidades de este lote por persona. Null = sin límite. */
  maxPorCliente?: number | null
  /** Máximo desde esta campaña concreta. Null = sin límite. */
  maxPorCampana?: number | null
  /**
   * ¿Puede tener dos vouchers vivos del mismo lote a la vez?
   *
   * Por defecto NO: «me apareció la pizza dos veces» es el reporte de fallo, no
   * la experiencia buscada, y dos vouchers vivos de la misma persona son dos
   * unidades comprometidas que casi nunca se canjean las dos.
   */
  permitirVariosVivos?: boolean
  exigeMembresia?: boolean
  /** Sucursal elegida por el cliente, si la hubo. */
  sucursalId?: string | null
  ahora?: Date
}

export type Veredicto =
  | { elegible: true }
  | { elegible: false; motivo: MotivoRechazo; mensaje: string }

function no(motivo: MotivoRechazo): Veredicto {
  return { elegible: false, motivo, mensaje: MOTIVO_RECHAZO_LABELS[motivo] }
}

/**
 * ¿Se le puede emitir a esta persona una unidad de este lote?
 *
 * El ORDEN de las comprobaciones es el de la conversación: primero lo que hace
 * imposible el beneficio para cualquiera (lote muerto, sin unidades), después
 * lo de la campaña, y al final lo personal. Así el mensaje que ve la persona
 * es el más informativo: decirle «ya alcanzaste el máximo» cuando además el
 * lote está agotado la manda a soporte a preguntar por un beneficio que no
 * existe.
 */
export function evaluarElegibilidad(
  lote: HechosLote,
  cliente: HechosCliente,
  reglas: ReglasEmision = {},
  asignacion?: HechosAsignacion | null
): Veredicto {
  const ahora = reglas.ahora ?? new Date()

  if (lote.estado !== 'ACTIVO') {
    return no(lote.estado === 'VENCIDO' ? 'LOTE_VENCIDO' : 'LOTE_NO_ACTIVO')
  }
  if (lote.inicioAt > ahora) return no('LOTE_NO_INICIADO')
  if (lote.venceAt <= ahora) return no('LOTE_VENCIDO')

  if (reglas.sucursalId && lote.snapshotSucursalIds.length > 0) {
    if (!lote.snapshotSucursalIds.includes(reglas.sucursalId)) return no('SUCURSAL_NO_CUBIERTA')
  }

  if (asignacion) {
    if (!asignacion.activa) return no('CAMPANA_INACTIVA')
    if (asignacion.porEmitir <= 0) return no('CAMPANA_SIN_CUPO')
  } else if (lote.disponibles <= 0) {
    // Sin campaña se emite contra las unidades LIBRES: gastar lo apartado para
    // la bienvenida en una entrega manual es exactamente lo que la asignación
    // existe para impedir.
    return no('SIN_UNIDADES')
  }

  if (reglas.exigeMembresia && !cliente.tieneMembresia) return no('MEMBRESIA_REQUERIDA')

  if (!reglas.permitirVariosVivos && cliente.derechosVivosDelLote > 0) return no('YA_TIENE_ACTIVO')

  if (reglas.maxPorCliente != null && cliente.derechosDelLote >= reglas.maxPorCliente) {
    return no('LIMITE_POR_CLIENTE')
  }
  if (reglas.maxPorCampana != null && cliente.derechosDeLaCampana >= reglas.maxPorCampana) {
    return no('LIMITE_POR_CLIENTE')
  }

  return { elegible: true }
}

/**
 * Reglas por defecto según de dónde venga el derecho.
 *
 * Un regalo de bienvenida es UNO por persona y punto: es el gancho de entrada
 * y repartir dos a la misma persona es regalar el costo de adquisición de un
 * cliente que ya se tenía. Una COMPRA no lleva límite —si alguien quiere pagar
 * por tres pizzas, se le venden tres— y por eso permite varios vivos.
 */
export function reglasPorOrigen(origen: SupplyOrigenDerecho): ReglasEmision {
  switch (origen) {
    case 'CAMPANA_BIENVENIDA':
      return { maxPorCliente: 1, permitirVariosVivos: false }
    case 'REFERIDO':
    case 'INFLUENCER':
    case 'RECOMPENSA':
      return { maxPorCampana: 1, permitirVariosVivos: false }
    case 'MEMBRESIA':
      return { exigeMembresia: true, permitirVariosVivos: false }
    case 'COMPRA':
      return { permitirVariosVivos: true }
    case 'OFERTA':
      return { permitirVariosVivos: true }
    default:
      return { permitirVariosVivos: false }
  }
}
