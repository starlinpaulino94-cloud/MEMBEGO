/**
 * Plataforma · QUÉ CUBRE UNA MEMBRESÍA (puro, sin Prisma).
 *
 * `POST /benefits/evaluate` respondía si el cliente PUEDE consumir. No decía
 * QUÉ. Para un satélite que tiene un carro delante y un catálogo de servicios,
 * eso no alcanza: sin saber hasta qué vehículo llega el plan no puede marcar la
 * línea como cubierta ni decirle al cliente cuánto pone él.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ NO SE CALCULA DINERO, Y ES A PROPÓSITO
 *
 * MembeGo no conoce la tarifa del satélite. El plan dice «4 lavados para
 * vehículos hasta nivel 2»; cuánto cuesta un lavado de SUV en ESE car wash lo
 * sabe el car wash, en su propio catálogo. Si MembeGo devolviera un importe
 * tendría que haberse inventado un precio, y un precio inventado que sale por
 * una API acaba cobrado.
 *
 * El reparto queda así, y cada lado hace lo que sí sabe:
 *
 *   MembeGo  → «cubierto hasta nivel 2, quedan 3 lavados»
 *   Satélite → «este lavado de SUV son RD$1,300; el plan cubre el de sedán,
 *               RD$1,000; el cliente pone RD$300»
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REGLA DE COMPATIBILIDAD
 *
 * `nivelTarifarioMax: null` es el valor de todos los planes existentes y
 * significa SIN RESTRICCIÓN: cabe cualquier vehículo. Un satélite que no mande
 * contexto recibe los datos del plan y `covers: null` — «no se preguntó»— en
 * vez de un `false` que le haría cobrar de más.
 */

/** El tope de vehículo del plan. `null` = acepta cualquiera. */
export type NivelMaximo = number | null

export interface PlanCobertura {
  nivelTarifarioMax: NivelMaximo
  esIlimitado: boolean
  lavadosIncluidos: number
}

/** Un vehículo que la membresía protege, tal como se asoció. */
export interface VehiculoCubierto {
  vehiculoId: string
  placa: string | null
  /** Nivel CONGELADO al asociar: renivelar la categoría no cambia lo comprado. */
  nivelTarifario: number
}

/** Lo que el satélite tiene delante cuando pregunta. Todo opcional. */
export interface ContextoConsumo {
  /** Nivel tarifario del vehículo que llegó a la pista. */
  nivelVehiculo?: number | null
  /** Placa del vehículo que llegó, ya normalizada por el satélite. */
  placa?: string | null
}

export type MotivoNoCubre =
  /** El carro es de nivel superior al que el plan acepta. */
  | 'VEHICLE_LEVEL_ABOVE_PLAN'
  /** El plan solo protege vehículos concretos y este no está entre ellos. */
  | 'VEHICLE_NOT_IN_MEMBERSHIP'
  /** Sin lavados disponibles: no hay nada que cubrir. */
  | 'NO_USES_LEFT'

export interface Cobertura {
  /** Tope de vehículo. `null` = cualquiera. */
  vehicleLevelMax: NivelMaximo
  unlimited: boolean
  washesIncluded: number
  /** Los vehículos que la membresía protege. Vacío = no se asoció ninguno. */
  vehicles: VehiculoCubierto[]
  /**
   * `true` cubre, `false` no cubre, `null` NO SE PREGUNTÓ (llegó sin contexto).
   * Los tres son distintos y el satélite debe distinguirlos: `null` tratado
   * como `false` cobra de más; tratado como `true` regala el lavado.
   */
  covers: boolean | null
  reason: MotivoNoCubre | null
}

/**
 * ¿Cubre esta membresía el lavado que se está por hacer?
 *
 * `usosRestantes` entra aparte del plan porque es de la membresía viva, no del
 * plan: dos clientes del mismo plan pueden tener uno tres lavados y otro cero.
 */
export function coberturaDeMembresia(
  plan: PlanCobertura,
  vehiculos: VehiculoCubierto[],
  usosRestantes: number,
  contexto?: ContextoConsumo
): Cobertura {
  const base = {
    vehicleLevelMax: plan.nivelTarifarioMax,
    unlimited: plan.esIlimitado,
    washesIncluded: plan.lavadosIncluidos,
    vehicles: vehiculos,
  }

  // Sin contexto no hay veredicto. Devolver `false` aquí sería decirle al
  // satélite que la membresía no sirve solo porque no preguntó bien.
  const sinContexto = contexto === undefined
    || (contexto.nivelVehiculo == null && !contexto.placa)
  if (sinContexto) return { ...base, covers: null, reason: null }

  // Un plan ilimitado no gasta usos; el resto necesita al menos uno.
  if (!plan.esIlimitado && usosRestantes <= 0) {
    return { ...base, covers: false, reason: 'NO_USES_LEFT' }
  }

  // Si la membresía nombró sus vehículos, solo esos están protegidos. Si no
  // nombró ninguno —las membresías anteriores a la asociación— se cae al tope
  // por nivel, que es como funcionaban antes.
  if (vehiculos.length > 0 && contexto.placa) {
    const suyo = vehiculos.some(v => v.placa !== null && v.placa === contexto.placa)
    if (!suyo) return { ...base, covers: false, reason: 'VEHICLE_NOT_IN_MEMBERSHIP' }
    return { ...base, covers: true, reason: null }
  }

  // Tope por nivel. `null` = sin restricción: cabe cualquier vehículo.
  if (plan.nivelTarifarioMax !== null && contexto.nivelVehiculo != null) {
    if (contexto.nivelVehiculo > plan.nivelTarifarioMax) {
      return { ...base, covers: false, reason: 'VEHICLE_LEVEL_ABOVE_PLAN' }
    }
  }

  return { ...base, covers: true, reason: null }
}
