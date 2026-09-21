export interface CardnetDisponibilidad {
  readonly capacidadActiva: boolean
  readonly credencialesCompletas: boolean
  readonly empresaDemo: boolean
}

export function cardnetDisponible(input: CardnetDisponibilidad): boolean {
  return input.capacidadActiva && input.credencialesCompletas && !input.empresaDemo
}
