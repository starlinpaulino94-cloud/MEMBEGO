/**
 * Onboarding v2 · MARCAS Y COLORES FRECUENTES (Fase 4 · datos puros).
 *
 * Datos del mundo real, no configuración de negocio: la lista de marcas que
 * circulan no depende de la empresa (a diferencia de las CATEGORÍAS de
 * vehículo, que sí viven en BD por empresa). El asistente las ofrece como
 * sugerencia con buscador y SIEMPRE permite escribir otra a mano — la lista
 * acelera, nunca limita.
 *
 * Ordenadas por frecuencia aproximada en el parque vehicular dominicano.
 */

export const MARCAS_FRECUENTES = [
  'Toyota', 'Honda', 'Hyundai', 'Kia', 'Nissan', 'Mitsubishi', 'Suzuki',
  'Chevrolet', 'Ford', 'Mazda', 'Volkswagen', 'BMW', 'Mercedes-Benz', 'Audi',
  'Lexus', 'Jeep', 'RAM', 'Isuzu', 'Daihatsu', 'Subaru', 'Peugeot', 'Renault',
  'Fiat', 'Chery', 'BYD', 'Changan', 'JAC', 'Great Wall', 'Land Rover',
  'Porsche', 'Volvo', 'Mini', 'Acura', 'Infiniti', 'GMC', 'Dodge',
] as const

/** Búsqueda tolerante para el selector (prefijo y subcadena, sin acentos). */
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

/** Colores frecuentes para las fichas rápidas (siempre se puede escribir otro). */
export const COLORES_FRECUENTES = [
  'Blanco', 'Negro', 'Gris', 'Plateado', 'Azul', 'Rojo', 'Verde', 'Marrón',
  'Beige', 'Amarillo',
] as const
