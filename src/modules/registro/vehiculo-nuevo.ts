/**
 * Onboarding v2 · VALIDACIÓN DEL VEHÍCULO EN EL REGISTRO (Fase 4 · pura).
 *
 * La regla del asistente: en un negocio cuyo flujo exige vehículo, el
 * registro NUEVO exige PLACA + CATEGORÍA. Marca, modelo, año y color son
 * opcionales y se rellenan con los mismos defaults del alta de mostrador
 * (`crearClienteMostrador` en `mostrador-actions.ts`): 'Sin marca',
 * 'Sin modelo', año actual, 'Sin color'. Se valida aquí (servidor) porque
 * el navegador no es de fiar.
 *
 * Arregla además el defecto del formulario clásico: un vehículo a medias se
 * descartaba EN SILENCIO (`if (marca && modelo && ...)`) y el cliente creía
 * haberlo registrado. Aquí, a medias = error con mensaje, nunca descarte.
 *
 * Lo que NO decide esta función (vive en los llamadores y se conserva):
 * duplicados de placa entre cuentas, pertenencia de la categoría a la
 * empresa e idempotencia por placa del mismo cliente (`actions.ts`,
 * `vehiculosActions.ts`).
 *
 * REGLA DE COMPATIBILIDAD: esto aplica SOLO al alta que entra por el
 * asistente v2 (`flujoV2`). Los clientes existentes y el formulario clásico
 * (bandera de emergencia) no pasan por aquí.
 */

import { validarAnio, validarPlaca, normalizarPlaca, PAIS_PLACA_DEFECTO } from '@/modules/onboarding/vehiculo'
import type { ValidacionAnio } from '@/modules/onboarding/vehiculo'

export interface VehiculoNuevoInput {
  tipoVehiculoId: string
  placa: string
  marca?: string
  modelo?: string
  anioRaw?: string | number
  color?: string
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

/** Valida y normaliza el vehículo de un registro nuevo (flujo car wash).
 *
 * Obligatorios: placa (formato del dominio) + `tipoVehiculoId`. Marca,
 * modelo, año y color son opcionales: lo ausente se rellena con los defaults
 * del alta de mostrador; lo PRESENTE pero inválido (p. ej. un año fuera de
 * rango) sigue siendo error. Acepta entradas malformadas (campos ausentes o
 * no texto) tratándolas como vacías, nunca lanzando.
 */
export function validarVehiculoNuevo(input: VehiculoNuevoInput): ResultadoVehiculoNuevo {
  const tipoVehiculoId = texto(input?.tipoVehiculoId)
  const pais = texto(input?.pais).toUpperCase() || PAIS_PLACA_DEFECTO

  if (!tipoVehiculoId) return { ok: false, error: 'Elige la categoría de tu vehículo.' }

  const placa = validarPlaca(texto(input?.placa), pais)
  if (!placa.ok) return { ok: false, error: placa.error! }

  // Opcionales con los defaults del alta de mostrador
  // (`mostrador-actions.ts`: 'Sin marca', 'Sin modelo', año actual, 'Sin color').
  const marca = texto(input?.marca) || 'Sin marca'
  const modelo = texto(input?.modelo) || 'Sin modelo'
  const color = texto(input?.color) || 'Sin color'

  const anioCrudo = texto(input?.anioRaw)
  const anio: ValidacionAnio = anioCrudo
    ? validarAnio(anioCrudo)
    : { ok: true, anio: new Date().getFullYear() }
  if (!anio.ok) return { ok: false, error: anio.error! }

  return {
    ok: true,
    vehiculo: {
      tipoVehiculoId,
      marca,
      modelo,
      anio: anio.anio!,
      color,
      placa: texto(input?.placa),
      placaNormalizada: placa.normalizada!,
      pais,
    },
  }
}

/** Texto recortado o '' si no es texto (entrada malformada = vacía, no TypeError). */
function texto(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  return ''
}

export { normalizarPlaca }
