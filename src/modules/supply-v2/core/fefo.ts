/**
 * MEMBEGO SUPPLY 2.0 · FEFO — First Expire, First Out (§5, §33).
 *
 * PURO. Ordena candidatos (lotes al asignar, líneas de asignación al reservar)
 * por vencimiento más próximo; sin vencimiento, por recepción más antigua; y
 * reparte una cantidad entre ellos sin pedirle a nadie que elija a mano.
 */

export interface CandidatoFefo {
  id: string
  /** Unidades que este candidato puede aportar ahora mismo. */
  disponible: number
  expiresAt: Date | null
  receivedAt: Date
}

export interface RepartoFefo {
  id: string
  cantidad: number
}

export function ordenarFefo<T extends CandidatoFefo>(candidatos: readonly T[]): T[] {
  return [...candidatos].sort((a, b) => {
    if (a.expiresAt && b.expiresAt && a.expiresAt.getTime() !== b.expiresAt.getTime()) {
      return a.expiresAt.getTime() - b.expiresAt.getTime()
    }
    if (a.expiresAt && !b.expiresAt) return -1
    if (!a.expiresAt && b.expiresAt) return 1
    return a.receivedAt.getTime() - b.receivedAt.getTime()
  })
}

/**
 * Reparte `cantidad` entre los candidatos en orden FEFO. Devuelve el reparto
 * o lanza si no alcanza: nunca un reparto parcial que parezca completo.
 */
export function repartirFefo(candidatos: readonly CandidatoFefo[], cantidad: number): RepartoFefo[] {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new Error('La cantidad a repartir tiene que ser un entero positivo.')
  }
  const total = candidatos.reduce((t, c) => t + Math.max(0, c.disponible), 0)
  if (total < cantidad) {
    throw new Error(`Solo hay ${total.toLocaleString('es-DO')} unidades disponibles y se piden ${cantidad.toLocaleString('es-DO')}.`)
  }
  const reparto: RepartoFefo[] = []
  let pendiente = cantidad
  for (const c of ordenarFefo(candidatos)) {
    if (pendiente === 0) break
    const toma = Math.min(Math.max(0, c.disponible), pendiente)
    if (toma === 0) continue
    reparto.push({ id: c.id, cantidad: toma })
    pendiente -= toma
  }
  return reparto
}
