/**
 * Elegibilidad · DECISIONES PURAS (Fase 3 · sin Prisma).
 *
 * Una sola fuente de reglas para "¿qué le falta a este cliente?" y "¿puede
 * comprar este plan, y a qué precio?". Las páginas, el checkout, la API y el
 * admin NO deciden por su cuenta: componen datos y llaman aquí (§9: la misma
 * regla en todas partes). El envoltorio con base de datos vive en `index.ts`;
 * este archivo recibe datos planos y por eso se prueba al milímetro.
 *
 * REGLA DE COMPATIBILIDAD (primera regla del motor): los requisitos aplican
 * SOLO a compras nuevas. `USAR_MEMBRESIA` y `RENOVAR_MEMBRESIA` devuelven
 * siempre "puede continuar" — un cliente con cuenta de antes del rediseño,
 * sin vehículo o con un vehículo sin placa, sigue usando la app, su QR y su
 * membresía exactamente como hoy. Esa garantía está codificada aquí (no en
 * cada página) y protegida por pruebas.
 */

import {
  evaluarRequisitos,
  flujoRequiereVehiculo,
  type EvaluacionRequisitos,
  type RequisitoCodigo,
} from '@/modules/onboarding/flujos'
import {
  evaluarAsociacion,
  nivelPermitido,
  type OpcionNivelSuperior,
} from '@/modules/onboarding/niveles'
import type { CategoriaNegocio } from '@/modules/capacidades/catalogo'

// ── Acciones ─────────────────────────────────────────────────────────────────

export type AccionElegibilidad =
  /** Comprar una membresía NUEVA: aquí sí aplican los requisitos. */
  | 'COMPRAR_PLAN'
  /** Renovar/pagar una membresía que ya existe: protegida, nunca se bloquea. */
  | 'RENOVAR_MEMBRESIA'
  /** Usar el QR / registrar visita: protegida, nunca se bloquea. */
  | 'USAR_MEMBRESIA'

/** Lo que el motor necesita saber de cada vehículo (datos planos). */
export interface VehiculoInfo {
  id: string
  /** Placa normalizada (o null: vehículo histórico sin placa). */
  placaNormalizada: string | null
  /** null = vehículo sin categoría asignada (histórico). */
  tipoVehiculoId: string | null
  /** Nivel de su categoría; null cuando no tiene categoría. */
  nivelTarifario: number | null
}

// ── Requisitos por acción ────────────────────────────────────────────────────

/**
 * Qué le falta al cliente para una acción, según la categoría del negocio y
 * sus vehículos. El orden de los códigos es el orden de resolución: primero
 * tener vehículo, luego placa, luego categoría.
 */
export function requisitosParaAccion(args: {
  accion: AccionElegibilidad
  categoria: CategoriaNegocio | null
  vehiculos: VehiculoInfo[]
}): EvaluacionRequisitos {
  const { accion, categoria, vehiculos } = args

  // Regla de compatibilidad: usar o renovar lo ya comprado jamás exige nada.
  if (accion !== 'COMPRAR_PLAN') return evaluarRequisitos([])

  // Negocios sin paso de vehículo (salón, restaurante, gym, registro general):
  // comprar solo requiere la cuenta, que ya existe si llegó hasta aquí.
  if (!flujoRequiereVehiculo(categoria)) return evaluarRequisitos([])

  const faltantes: RequisitoCodigo[] = []
  if (vehiculos.length === 0) {
    faltantes.push('VEHICLE_REQUIRED')
  } else {
    // Basta UN vehículo completo para poder comprar. Solo si ninguno lo está,
    // se pide completar el mejor candidato (placa primero, luego categoría).
    const completo = vehiculos.some((v) => v.placaNormalizada && v.tipoVehiculoId)
    if (!completo) {
      if (!vehiculos.some((v) => v.placaNormalizada)) faltantes.push('LICENSE_PLATE_REQUIRED')
      if (!vehiculos.some((v) => v.tipoVehiculoId)) faltantes.push('VEHICLE_CATEGORY_REQUIRED')
      // Con placa en uno y categoría en otro, falta completar alguno de los dos.
      if (faltantes.length === 0) faltantes.push('VEHICLE_CATEGORY_REQUIRED')
    }
  }
  return evaluarRequisitos(faltantes)
}

// ── Precio y compra de un plan ───────────────────────────────────────────────

/** Reglas de vehículo de un plan, ya cargadas (datos planos). */
export interface PlanReglas {
  id: string
  /** `Plan.precio` — el precio base/fallback de siempre. */
  precioBase: number
  /** Precio de la categoría del vehículo elegido; null = el plan no tiene
   *  fila para esa categoría (o no hay vehículo) y se cobra el base. */
  precioCategoria: number | null
  /** null = el plan acepta cualquier vehículo (todos los planes actuales). */
  nivelTarifarioMax: number | null
}

export type DecisionPlan =
  | {
      puedeComprar: true
      precio: number
      /** De dónde salió el precio — la UI lo dice ("precio para SUV"). */
      precioOrigen: 'CATEGORIA' | 'BASE'
    }
  | {
      puedeComprar: false
      motivo: 'NIVEL_SUPERIOR'
      /** Salidas que la UI ofrece (§12): nunca un error mudo. */
      opciones: OpcionNivelSuperior[]
      /** Precio informativo (el que pagaría tras actualizar). */
      precio: number
      precioOrigen: 'CATEGORIA' | 'BASE'
    }

/**
 * ¿Puede comprarse este plan para este vehículo, y a qué precio?
 *
 * Vehículo null (negocio sin vehículos, o cliente protegido sin categoría):
 * precio base y compra permitida — exactamente el comportamiento actual.
 * Vehículo sin categoría: nivel 1 (base) y precio base, fail-open: un
 * vehículo histórico jamás bloquea más que uno nuevo.
 */
// ── Uso de la membresía con un vehículo (§13) ────────────────────────────────

export type AutorizacionVehiculo =
  | { autorizado: true }
  | { autorizado: false; mensaje: string }

/**
 * ¿Puede usarse la membresía con este vehículo?
 *
 * REGLA DE COMPATIBILIDAD primero: una membresía SIN vehículos asociados
 * (todas las anteriores al rediseño) autoriza siempre — el QR funciona como
 * siempre. Y escanear sin elegir vehículo también autoriza: la asociación
 * protege contra el uso con OTRO vehículo identificado, no convierte el
 * escaneo diario en un interrogatorio.
 */
export function vehiculoAutorizadoEnMembresia(
  asociados: Array<{ vehiculoId: string; etiqueta: string }>,
  vehiculoId: string | null | undefined
): AutorizacionVehiculo {
  if (asociados.length === 0) return { autorizado: true }
  if (!vehiculoId) return { autorizado: true }
  if (asociados.some((a) => a.vehiculoId === vehiculoId)) return { autorizado: true }
  const etiquetas = asociados.map((a) => a.etiqueta).join(', ')
  return {
    autorizado: false,
    mensaje: `Esta membresía está asociada a: ${etiquetas}. Para usarla con otro vehículo, el cliente debe actualizarla con el negocio.`,
  }
}

export function decidirPlan(plan: PlanReglas, vehiculo: VehiculoInfo | null): DecisionPlan {
  const precio = plan.precioCategoria ?? plan.precioBase
  const precioOrigen: 'CATEGORIA' | 'BASE' = plan.precioCategoria != null ? 'CATEGORIA' : 'BASE'

  const nivel = vehiculo?.nivelTarifario ?? 1
  if (nivelPermitido(nivel, plan.nivelTarifarioMax)) {
    return { puedeComprar: true, precio, precioOrigen }
  }
  const rechazo = evaluarAsociacion(nivel, plan.nivelTarifarioMax)
  return {
    puedeComprar: false,
    motivo: 'NIVEL_SUPERIOR',
    opciones: rechazo.permitido ? [] : rechazo.opciones,
    precio,
    precioOrigen,
  }
}
