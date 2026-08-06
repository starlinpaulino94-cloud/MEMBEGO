/**
 * Onboarding v2 · NIVELES TARIFARIOS (Fase 1 · puro, sin Prisma).
 *
 * La regla de "¿este vehículo cabe en esta membresía?" se decide comparando
 * NÚMEROS, nunca nombres de categoría (`category === "SUV"` es exactamente lo
 * que este módulo existe para impedir). Cada `TipoVehiculo` tendrá un
 * `nivelTarifario` (sedán 1, SUV 2-3, pickup 3, comercial 4…) que configura
 * cada empresa; un plan podrá fijar `nivelTarifarioMax`.
 *
 * REGLA DE COMPATIBILIDAD (grandfathering): esta comparación aplica al
 * ASOCIAR un vehículo a una membresía (compra nueva, upgrade, vehículo
 * adicional). Una membresía ya comprada sigue valiendo con lo que tiene: usar
 * el QR nunca pasa por aquí. Por eso `SIN_RESTRICCION` (null) es el valor de
 * los planes existentes: hasta que la empresa configure niveles, todo
 * vehículo cabe y nada cambia para nadie.
 */

/** Un plan sin `nivelTarifarioMax` acepta cualquier vehículo (planes actuales). */
export type NivelMaximo = number | null

export type ResultadoAsociacion =
  /** El vehículo cabe en la membresía tal cual. */
  | { permitido: true }
  /** Nivel superior al de la membresía: se ofrecen salidas, no un error mudo. */
  | { permitido: false; motivo: 'NIVEL_SUPERIOR'; opciones: OpcionNivelSuperior[] }

/**
 * Qué se le ofrece al cliente cuando su vehículo excede el nivel de la
 * membresía (§12: nunca un error genérico). El orden es el de presentación.
 */
export type OpcionNivelSuperior =
  | 'ACTUALIZAR_MEMBRESIA'
  | 'PAGAR_DIFERENCIA'
  | 'REGISTRAR_SIN_ASOCIAR'
  | 'CONTACTAR_EMPRESA'

const OPCIONES_NIVEL_SUPERIOR: OpcionNivelSuperior[] = [
  'ACTUALIZAR_MEMBRESIA',
  'PAGAR_DIFERENCIA',
  'REGISTRAR_SIN_ASOCIAR',
  'CONTACTAR_EMPRESA',
]

/**
 * ¿Un vehículo de `nivelVehiculo` puede asociarse a una membresía cuyo tope
 * es `nivelMax`? Regla única de la §12: `nivel del vehículo <= tope`, con
 * `null` = sin restricción. Una membresía comprada al nivel de SUV (3)
 * acepta un sedán (1); una comprada al nivel de sedán no acepta una SUV.
 */
export function nivelPermitido(nivelVehiculo: number, nivelMax: NivelMaximo): boolean {
  if (nivelMax == null) return true
  return nivelVehiculo <= nivelMax
}

/**
 * Decisión completa de asociación, con las salidas que la UI debe ofrecer
 * cuando no cabe. Las pantallas no inventan sus propias reglas: consumen esto.
 */
export function evaluarAsociacion(
  nivelVehiculo: number,
  nivelMax: NivelMaximo
): ResultadoAsociacion {
  if (nivelPermitido(nivelVehiculo, nivelMax)) return { permitido: true }
  return { permitido: false, motivo: 'NIVEL_SUPERIOR', opciones: [...OPCIONES_NIVEL_SUPERIOR] }
}

/**
 * Nivel que se CONGELA al comprar: el mayor entre los vehículos asociados.
 * Se guarda en la membresía (snapshot) para que renombrar o renivelar
 * categorías después no cambie retroactivamente lo ya comprado.
 */
export function nivelDeCompra(nivelesVehiculos: number[]): number {
  if (nivelesVehiculos.length === 0) return 1
  return Math.max(...nivelesVehiculos)
}
