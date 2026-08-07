/**
 * Normalización de nombres geográficos (docs/GEOLOCALIZACION.md §30).
 *
 * La clave de segmentación ES `normalizedName`: mayúsculas, sin tildes, sin
 * apóstrofos y con los espacios colapsados. Así "Bávaro", "BAVARO" y
 * "bavaro " se resuelven al mismo valor y la segmentación no depende de la
 * ortografía que escribió el usuario.
 */

export function normalizarNombre(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes/acentos
    .replace(/['’]/g, '') // apóstrofos (Santo Tomás → SANTO TOMAS)
    .replace(/[^A-Za-z0-9]+/g, ' ') // no-alfanuméricos → espacio
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
}
