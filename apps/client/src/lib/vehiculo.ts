/**
 * Validadores puros de vehículo (port desde src/modules/onboarding/vehiculo.ts).
 * Sin dependencias externas — solo lógica de dominio.
 */

export const PAIS_PLACA_DEFECTO = 'DO'
const ANIO_MINIMO = 1950
const MARGEN_ANIO_NUEVO = 1

export interface ValidacionPlaca {
  ok: boolean
  normalizada?: string
  error?: string
}

export function normalizarPlaca(placa: string | null | undefined): string {
  return (placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function validarPlaca(
  placa: string | null | undefined,
  _pais: string = PAIS_PLACA_DEFECTO
): ValidacionPlaca {
  const normalizada = normalizarPlaca(placa)
  if (!normalizada) {
    return { ok: false, error: 'Escribe la placa del vehículo.' }
  }
  if (normalizada.length < 4) {
    return { ok: false, error: 'La placa es demasiado corta. Revísala.' }
  }
  if (normalizada.length > 10) {
    return { ok: false, error: 'La placa es demasiado larga. Revísala.' }
  }
  if (!/\d/.test(normalizada)) {
    return { ok: false, error: 'Una placa incluye números. Revísala.' }
  }
  return { ok: true, normalizada }
}

export interface ValidacionAnio {
  ok: boolean
  anio?: number
  error?: string
}

export function validarAnio(
  anioRaw: string | number | null | undefined,
  ahora: Date = new Date()
): ValidacionAnio {
  const texto = String(anioRaw ?? '').trim()
  if (!texto) return { ok: false, error: 'Indica el año del vehículo.' }
  const anio = Number(texto)
  if (!Number.isInteger(anio)) {
    return { ok: false, error: 'El año debe ser un número, por ejemplo 2022.' }
  }
  const maximo = ahora.getFullYear() + MARGEN_ANIO_NUEVO
  if (anio < ANIO_MINIMO || anio > maximo) {
    return { ok: false, error: `El año debe estar entre ${ANIO_MINIMO} y ${maximo}.` }
  }
  return { ok: true, anio }
}

export const MARCAS_FRECUENTES = [
  'Toyota', 'Honda', 'Hyundai', 'Kia', 'Nissan', 'Mitsubishi', 'Suzuki',
  'Chevrolet', 'Ford', 'Mazda', 'Volkswagen', 'BMW', 'Mercedes-Benz', 'Audi',
  'Lexus', 'Jeep', 'RAM', 'Isuzu', 'Daihatsu', 'Subaru', 'Peugeot', 'Renault',
  'Fiat', 'Chery', 'BYD', 'Changan', 'JAC', 'Great Wall', 'Land Rover',
  'Porsche', 'Volvo', 'Mini', 'Acura', 'Infiniti', 'GMC', 'Dodge',
] as const

export function buscarMarcas(texto: string, limite = 8): string[] {
  const q = texto.trim().toLowerCase()
  if (!q) return MARCAS_FRECUENTES.slice(0, limite) as unknown as string[]
  const empiezan: string[] = []
  const contienen: string[] = []
  for (const m of MARCAS_FRECUENTES) {
    const ml = m.toLowerCase()
    if (ml.startsWith(q)) empiezan.push(m)
    else if (ml.includes(q)) contienen.push(m)
  }
  return [...empiezan, ...contienen].slice(0, limite)
}

export const COLORES_FRECUENTES = [
  'Blanco', 'Negro', 'Gris', 'Plateado', 'Azul', 'Rojo', 'Verde', 'Marrón',
  'Beige', 'Amarillo',
] as const
