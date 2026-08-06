/**
 * Onboarding v2 · VALIDACIÓN DEL VEHÍCULO EN EL REGISTRO (Fase 4 · pura).
 *
 * La regla del asistente: en un negocio cuyo flujo exige vehículo, el
 * registro NUEVO debe traer el vehículo COMPLETO — categoría, marca, modelo,
 * año, color y placa válida. Se valida aquí (servidor) porque el navegador no
 * es de fiar; el asistente usa las mismas funciones de dominio para avisar en
 * vivo, pero la palabra final es esta.
 *
 * Arregla además el defecto del formulario clásico: un vehículo a medias se
 * descartaba EN SILENCIO (`if (marca && modelo && ...)`) y el cliente creía
 * haberlo registrado. Aquí, a medias = error con mensaje, nunca descarte.
 *
 * REGLA DE COMPATIBILIDAD: esto aplica SOLO al alta que entra por el
 * asistente v2 (`flujoV2`). Los clientes existentes y el formulario clásico
 * (bandera de emergencia) no pasan por aquí.
 */

import { validarAnio, validarPlaca, normalizarPlaca, PAIS_PLACA_DEFECTO } from '@/modules/onboarding/vehiculo'

export interface VehiculoNuevoInput {
  tipoVehiculoId: string
  marca: string
  modelo: string
  anioRaw: string
  color: string
  placa: string
  pais?: string
}

/** Vehículo ya validado y normalizado, listo para persistir. */
export interface VehiculoNuevoValidado {
  tipoVehiculoId: string
  marca: string
  modelo: string
  anio: number
  color: string
  placa: string
  placaNormalizada: string
  pais: string
}

export type ResultadoVehiculoNuevo =
  | { ok: true; vehiculo: VehiculoNuevoValidado }
  | { ok: false; error: string }

/** Valida y normaliza el vehículo de un registro nuevo (flujo car wash). */
export function validarVehiculoNuevo(input: VehiculoNuevoInput): ResultadoVehiculoNuevo {
  const tipoVehiculoId = input.tipoVehiculoId.trim()
  const marca = input.marca.trim()
  const modelo = input.modelo.trim()
  const color = input.color.trim()
  const pais = (input.pais ?? '').trim().toUpperCase() || PAIS_PLACA_DEFECTO

  if (!tipoVehiculoId) return { ok: false, error: 'Elige la categoría de tu vehículo.' }
  if (!marca) return { ok: false, error: 'Indica la marca de tu vehículo.' }
  if (!modelo) return { ok: false, error: 'Indica el modelo de tu vehículo.' }

  const anio = validarAnio(input.anioRaw)
  if (!anio.ok) return { ok: false, error: anio.error! }

  if (!color) return { ok: false, error: 'Indica el color de tu vehículo.' }

  const placa = validarPlaca(input.placa, pais)
  if (!placa.ok) return { ok: false, error: placa.error! }

  return {
    ok: true,
    vehiculo: {
      tipoVehiculoId,
      marca,
      modelo,
      anio: anio.anio!,
      color,
      placa: input.placa.trim(),
      placaNormalizada: placa.normalizada!,
      pais,
    },
  }
}

export { normalizarPlaca }
