/** Campos mínimos de la vigencia de una campaña de Marketing. */
export interface VentanaCampana {
  fechaInicio: Date
  fechaFin: Date
  horaInicioMin: number | null
  horaFinMin: number | null
  diasSemana: number[]
}

const RD_OFFSET_MS = 4 * 60 * 60 * 1000

/** Devuelve el final de la ventana activa en RD, o null si la campaña no está activa. */
export function finDeVentanaCampana(campana: VentanaCampana, ahora: Date): Date | null {
  if (campana.fechaInicio > ahora || campana.fechaFin < ahora) return null

  const rd = new Date(ahora.getTime() - RD_OFFSET_MS)
  const dia = rd.getUTCDay()
  if (campana.diasSemana.length > 0 && !campana.diasSemana.includes(dia)) return null

  let finMs = campana.fechaFin.getTime()
  if (campana.horaInicioMin != null && campana.horaFinMin != null) {
    const minutos = rd.getUTCHours() * 60 + rd.getUTCMinutes()
    if (minutos < campana.horaInicioMin || minutos >= campana.horaFinMin) return null
    const medianocheMs =
      Date.UTC(rd.getUTCFullYear(), rd.getUTCMonth(), rd.getUTCDate()) + RD_OFFSET_MS
    finMs = Math.min(medianocheMs + campana.horaFinMin * 60_000, finMs)
  }

  return new Date(finMs)
}
